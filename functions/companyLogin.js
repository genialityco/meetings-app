// ============================================================================
// INGRESO POR EMPRESA + TELÉFONO (policy companyLoginEnabled)
// ============================================================================
//
// Para asistentes que no saben con qué correo los registraron (lo hizo otra
// persona de su empresa). En la Landing eligen su empresa (NIT o nombre), luego
// su nombre en la lista de asistentes de esa empresa y escriben completo el
// teléfono registrado, del que solo ven los últimos 4 dígitos.
//
// POST companyLoginCandidates { eventId, companyIds: string[] }
//   → { candidates: [{ uid, nombre, cargo, phoneMask }] }  (phoneMask null = sin teléfono)
// POST companyLoginVerify { eventId, userId, phone }
//   → { ok: true } | { ok: false, error: "mismatch", remaining } | { ok: false, error: "locked", retryAfterSec }
//
// El teléfono completo nunca sale del servidor. Los intentos fallidos se cuentan
// en events/{eventId}/loginAttempts/{userId}: MAX_FAILS seguidos bloquean ese
// asistente LOCK_MINUTES. Con ok el cliente lee users/{userId} y llama
// loginAsUser (mismo modelo de sesión que el login por correo y /acceso).

import { onRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const MAX_COMPANY_IDS = 10;

function setCors(req, res) {
  res.set({
    "Access-Control-Allow-Origin": req.headers.origin || "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
}

// Dígitos sin ceros iniciales (troncal / prefijo internacional 00)
const phoneDigits = (raw) => String(raw ?? "").replace(/\D/g, "").replace(/^0+/, "");

// Teléfonos registrados del asistente; una celda puede traer varios ("300…/310…")
function userPhones(u) {
  const all = [u?.telefono, u?.contacto?.telefono]
    .flatMap((v) => String(v ?? "").split(/[/;,|]/))
    .map(phoneDigits)
    .filter((d) => d.length >= 7);
  return [...new Set(all)];
}

// "573001234567" → "••• ••• 4567" (sin indicativo: se enmascaran los últimos 10 dígitos)
function maskPhone(digits) {
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  const hidden = "•".repeat(national.length - 4).replace(/(.{3})(?=.)/g, "$1 ");
  return `${hidden} ${national.slice(-4)}`;
}

// Iguales, o uno termina en el otro y la diferencia cabe en un indicativo de
// país (1-3 dígitos): acepta el número con o sin +57 en cualquiera de los lados.
function phoneMatches(stored, input) {
  if (input.length < 7) return false;
  if (stored === input) return true;
  const [long, short] = stored.length > input.length ? [stored, input] : [input, stored];
  return long.endsWith(short) && long.length - short.length <= 3;
}

async function loadEnabledEvent(db, eventId) {
  const snap = await db.collection("events").doc(eventId).get();
  if (!snap.exists) return null;
  return snap.data()?.config?.policies?.companyLoginEnabled === true ? snap : null;
}

export const companyLoginCandidates = onRequest(
  { region: "us-central1", memory: "256MiB" },
  async (req, res) => {
    setCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).send({ error: "Method not allowed" });

    const eventId = String(req.body?.eventId || "");
    const companyIds = Array.isArray(req.body?.companyIds)
      ? [...new Set(req.body.companyIds.map((c) => String(c || "").trim()).filter(Boolean))]
      : [];
    if (!eventId || !companyIds.length || companyIds.length > MAX_COMPANY_IDS) {
      return res.status(400).send({ error: "Parámetros inválidos" });
    }

    const db = getFirestore();
    try {
      if (!(await loadEnabledEvent(db, eventId))) {
        return res.status(403).send({ error: "El ingreso por empresa no está habilitado" });
      }
      const snap = await db
        .collection("users")
        .where("eventId", "==", eventId)
        .where("companyId", "in", companyIds)
        .get();

      const candidates = snap.docs
        .map((d) => {
          const u = d.data();
          const phones = userPhones(u);
          return {
            uid: d.id,
            nombre: (u.nombre || "").trim() || "Asistente",
            cargo: (u.cargo || "").trim() || null,
            phoneMask: phones.length ? maskPhone(phones[0]) : null,
          };
        })
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

      return res.status(200).send({ candidates });
    } catch (error) {
      console.error("companyLoginCandidates error:", error);
      return res.status(500).send({ error: "Internal error" });
    }
  }
);

export const companyLoginVerify = onRequest(
  { region: "us-central1", memory: "256MiB" },
  async (req, res) => {
    setCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).send({ error: "Method not allowed" });

    const eventId = String(req.body?.eventId || "");
    const userId = String(req.body?.userId || "");
    const input = phoneDigits(req.body?.phone);
    if (!eventId || !userId || !input) {
      return res.status(400).send({ error: "Parámetros inválidos" });
    }

    const db = getFirestore();
    try {
      if (!(await loadEnabledEvent(db, eventId))) {
        return res.status(403).send({ error: "El ingreso por empresa no está habilitado" });
      }
      const userRef = db.collection("users").doc(userId);
      const attemptsRef = db.collection("events").doc(eventId).collection("loginAttempts").doc(userId);

      // Transacción: dos intentos simultáneos no pueden saltarse el límite
      const result = await db.runTransaction(async (tx) => {
        const [userSnap, attemptsSnap] = await Promise.all([tx.get(userRef), tx.get(attemptsRef)]);
        if (!userSnap.exists || userSnap.data().eventId !== eventId) {
          return { status: 404, body: { ok: false, error: "not_found" } };
        }

        const now = Date.now();
        const attempts = attemptsSnap.exists ? attemptsSnap.data() : {};
        const lockedUntil = attempts.lockedUntil?.toMillis?.() || 0;
        if (lockedUntil > now) {
          return {
            status: 429,
            body: { ok: false, error: "locked", retryAfterSec: Math.ceil((lockedUntil - now) / 1000) },
          };
        }
        // Un bloqueo vencido reinicia el conteo
        const prevFails = lockedUntil ? 0 : attempts.fails || 0;

        if (userPhones(userSnap.data()).some((p) => phoneMatches(p, input))) {
          if (attemptsSnap.exists) tx.delete(attemptsRef);
          tx.update(userRef, { lastConnection: FieldValue.serverTimestamp() });
          return { status: 200, body: { ok: true } };
        }

        const fails = prevFails + 1;
        if (fails >= MAX_FAILS) {
          tx.set(attemptsRef, {
            fails,
            lockedUntil: Timestamp.fromMillis(now + LOCK_MINUTES * 60 * 1000),
            updatedAt: FieldValue.serverTimestamp(),
          });
          return { status: 429, body: { ok: false, error: "locked", retryAfterSec: LOCK_MINUTES * 60 } };
        }
        tx.set(attemptsRef, { fails, lockedUntil: null, updatedAt: FieldValue.serverTimestamp() });
        return { status: 200, body: { ok: false, error: "mismatch", remaining: MAX_FAILS - fails } };
      });

      return res.status(result.status).send(result.body);
    } catch (error) {
      console.error("companyLoginVerify error:", error);
      return res.status(500).send({ error: "Internal error" });
    }
  }
);

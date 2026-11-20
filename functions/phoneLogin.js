// ============================================================================
// INGRESO CON EL CELULAR (campo "Correo, cédula o celular" de la Landing)
// ============================================================================
//
// La Landing primero busca lo escrito como cédula (en el cliente); si no aparece
// y tiene 7+ dígitos, lo busca aquí como teléfono del asistente.
//
// POST phoneLogin { eventId, phone }
//   → { matches: [{ uid, nombre, empresa }] }  (0, 1 o varios: datos viejos con teléfono repetido)
//   → 429 { error: "locked", retryAfterSec }
//
// Mismo modelo de sesión que el ingreso por correo/cédula (users es público y el
// cliente llama loginAsUser). Para frenar que se recorran números al azar, las
// búsquedas sin resultado se cuentan por IP en events/{eventId}/loginAttempts/ip_<hash>:
// MAX_FAILS dentro de una ventana de WINDOW_MINUTES bloquean esa IP hasta que la
// ventana vence. El límite es amplio porque en el evento muchos comparten el wifi.

import { createHash } from "node:crypto";
import { onRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

const MAX_FAILS = 20;
const WINDOW_MINUTES = 15;
const MAX_MATCHES = 10;

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

// Iguales, o uno termina en el otro y la diferencia cabe en un indicativo de
// país (1-3 dígitos): acepta el número con o sin +57 en cualquiera de los lados.
function phoneMatches(stored, input) {
  if (input.length < 7) return false;
  if (stored === input) return true;
  const [long, short] = stored.length > input.length ? [stored, input] : [input, stored];
  return long.endsWith(short) && long.length - short.length <= 3;
}

// IP del cliente: Google agrega la IP real al final de X-Forwarded-For (lo que
// venga antes lo puede escribir el propio cliente)
function clientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return xff[xff.length - 1] || req.ip || "unknown";
}

const ipKey = (ip) => `ip_${createHash("sha256").update(ip).digest("hex").slice(0, 32)}`;

export const phoneLogin = onRequest(
  { region: "us-central1", memory: "256MiB" },
  async (req, res) => {
    setCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).send({ error: "Method not allowed" });

    const eventId = String(req.body?.eventId || "");
    const input = phoneDigits(req.body?.phone);
    if (!eventId || input.length < 7) {
      return res.status(400).send({ error: "Parámetros inválidos" });
    }

    const db = getFirestore();
    try {
      const eventSnap = await db.collection("events").doc(eventId).get();
      if (!eventSnap.exists) return res.status(200).send({ matches: [] });

      const attemptsRef = eventSnap.ref.collection("loginAttempts").doc(ipKey(clientIp(req)));
      const attempts = (await attemptsRef.get()).data() || {};
      const now = Date.now();
      const windowStart = attempts.windowStart?.toMillis?.() || 0;
      const windowEnd = windowStart + WINDOW_MINUTES * 60 * 1000;
      const inWindow = windowEnd > now;
      const fails = inWindow ? attempts.fails || 0 : 0;
      if (fails >= MAX_FAILS) {
        return res.status(429).send({ error: "locked", retryAfterSec: Math.ceil((windowEnd - now) / 1000) });
      }

      const snap = await db
        .collection("users")
        .where("eventId", "==", eventId)
        .select("telefono", "contacto", "nombre", "empresa", "company_razonSocial")
        .get();

      const matches = snap.docs
        .filter((d) => userPhones(d.data()).some((p) => phoneMatches(p, input)))
        .slice(0, MAX_MATCHES)
        .map((d) => {
          const u = d.data();
          return {
            uid: d.id,
            nombre: String(u.nombre || "").trim() || "Asistente",
            empresa: String(u.company_razonSocial || u.empresa || "").trim() || null,
          };
        })
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

      if (!matches.length) {
        // Sin transacción: un par de intentos simultáneos de más no cambia nada aquí
        await attemptsRef.set({
          fails: fails + 1,
          windowStart: inWindow ? attempts.windowStart : Timestamp.fromMillis(now),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      return res.status(200).send({ matches });
    } catch (error) {
      console.error("phoneLogin error:", error);
      return res.status(500).send({ error: "Internal error" });
    }
  }
);

// ============================================================================
// TELÉFONO YA REGISTRADO (registro en la Landing y "Registrar compañero")
// ============================================================================
//
// POST checkPhoneAvailability { eventId, phone, currentUserId? }
//   → { registered: false } | { registered: true, nombreMask, empresa, correoMask }
//
// Evita multicuentas con el mismo teléfono: el cliente bloquea el registro y ofrece
// ingresar con la cuenta existente. Solo devuelve datos enmascarados. Compara con
// phoneMatches (con o sin indicativo), porque los teléfonos se guardaron en formatos
// distintos y una consulta por igualdad no los encuentra.

// "Juan Pérez" → "J*** P****"
const maskName = (name) =>
  String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + "*".repeat(Math.max(2, Math.min(w.length - 1, 5))))
    .join(" ");

// "juan.perez@gmail.com" → "ju*******@gmail.com"
function maskEmail(email) {
  const [user, domain] = String(email || "").trim().split("@");
  if (!user || !domain) return null;
  return `${user.slice(0, 2)}${"*".repeat(Math.max(3, user.length - 2))}@${domain}`;
}

export const checkPhoneAvailability = onRequest(
  { region: "us-central1", memory: "256MiB" },
  async (req, res) => {
    setCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).send({ error: "Method not allowed" });

    const eventId = String(req.body?.eventId || "");
    const currentUserId = String(req.body?.currentUserId || "");
    const input = phoneDigits(req.body?.phone);
    if (!eventId || input.length < 7) {
      return res.status(400).send({ error: "Parámetros inválidos" });
    }

    const db = getFirestore();
    try {
      const snap = await db
        .collection("users")
        .where("eventId", "==", eventId)
        .select("telefono", "contacto", "nombre", "empresa", "company_razonSocial", "correo")
        .get();

      const match = snap.docs.find(
        (d) => d.id !== currentUserId && userPhones(d.data()).some((p) => phoneMatches(p, input))
      );
      if (!match) return res.status(200).send({ registered: false });

      const u = match.data();
      return res.status(200).send({
        registered: true,
        nombreMask: maskName(u.nombre) || null,
        empresa: (u.company_razonSocial || u.empresa || "").trim() || null,
        correoMask: maskEmail(u.correo),
      });
    } catch (error) {
      console.error("checkPhoneAvailability error:", error);
      return res.status(500).send({ error: "Internal error" });
    }
  }
);

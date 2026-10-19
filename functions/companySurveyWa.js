// ============================================================================
// ENCUESTA POR EMPRESA: RESPUESTA POR CHAT DE WHATSAPP
// ============================================================================
//
// La encuesta de resultados por empresa (policy companySurveyEnabled, ver
// src/utils/companySurvey.ts) también se responde escribiendo en WhatsApp los
// dos números ("5 20000" = reuniones y USD) a la plantilla configurada en
// companySurvey.waTemplate, enviada como campaña.
//
// wa-multi-session-backend reenvía a guardarRespuestaWhatsapp los textos
// entrantes con dígitos ({ type: "text", phone, text, wamid, timestamp }) ANTES
// de pasárselos a GenCampus. Aquí se busca en waMessages (collection group por
// `to`, ver fieldOverride en firestore.indexes.json) una campaña de esa plantilla
// enviada a ese número en los últimos SURVEY_WINDOW_DAYS días (también cuenta un
// "Enviar prueba" del asistente de campañas a un asistente registrado):
//   - Sin campaña → { handled: false } (el backend sigue con GenCampus).
//   - Con campaña → { handled: true, reply } y el backend responde `reply` por
//     WhatsApp (mensaje de sesión: el contacto acaba de escribir).
// La respuesta se guarda en events/{eventId}/companySurveys/{companyKey} con
// channel "whatsapp"; la primera respuesta de la empresa gana.

import { FieldValue } from "firebase-admin/firestore";

const SURVEY_WINDOW_DAYS = 14;
const MAX_MEETINGS = 10000;

const toDate = (v) => {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const normalizeRole = (v) => {
  const s = String(v ?? "").toLowerCase().trim();
  return s === "comprador" || s === "vendedor" ? s : "";
};

const fmtNumber = (n) => Number(n || 0).toLocaleString("es-CO", { maximumFractionDigits: 2 });

// Variantes del número: Meta a veces entrega el wa_id con otro formato que el usado al enviar
function phoneVariants(raw) {
  const p = String(raw || "").replace(/\D/g, "");
  const out = new Set([p]);
  if (/^521\d{10}$/.test(p)) out.add("52" + p.slice(3));
  if (/^52\d{10}$/.test(p)) out.add("521" + p.slice(2));
  if (/^549\d{10}$/.test(p)) out.add("54" + p.slice(3));
  if (/^54\d{10}$/.test(p)) out.add("549" + p.slice(2));
  return [...out].filter((v) => v.length >= 10);
}

/** Convierte un número escrito por una persona ("20.000", "20,000.50", "1,5") a Number, o null */
export function parseHumanNumber(token) {
  let t = String(token || "").replace(/[.,]+$/, "");
  if (!t) return null;
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) t = t.replace(/[.,]/g, ""); // 20.000 · 1,250,000
  else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(t)) t = t.replace(/\./g, "").replace(",", "."); // 20.000,50
  else if (/^\d{1,3}(,\d{3})+\.\d+$/.test(t)) t = t.replace(/,/g, ""); // 20,000.50
  else if (/^\d+[.,]\d{1,2}$/.test(t)) t = t.replace(",", "."); // 1,5 · 2.25
  else if (/^\d+$/.test(t)) {
    // entero
  } else return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extrae { reuniones, valorUSD } de un texto como "5 20000", "5, 20.000 USD",
 * "reuniones 5 monto 20 mil" o "5 1.5M". Exige exactamente dos números.
 * @returns {{ ok: true, reuniones: number, valorUSD: number } | { ok: false, reason: string }}
 */
export function parseSurveyAnswer(text) {
  const clean = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // "20000usd" → "20000 usd", "20mil" → "20 mil": el sufijo se lee aparte
    .replace(/(\d)([a-z])/g, "$1 $2");
  const re = /(\d[\d.,]*)\s*(millones|millon|mill|mm|mil|k|m)?(?![a-z])/g;
  const values = [];
  for (const match of clean.matchAll(re)) {
    const base = parseHumanNumber(match[1]);
    if (base === null) return { ok: false, reason: "format" };
    const suffix = match[2];
    const mult = !suffix ? 1 : suffix === "mil" || suffix === "k" ? 1e3 : 1e6;
    values.push(base * mult);
  }
  if (values.length !== 2) return { ok: false, reason: values.length < 2 ? "missing" : "extra" };
  const [reuniones, valorUSD] = values;
  if (!Number.isInteger(reuniones) || reuniones < 0 || reuniones > MAX_MEETINGS) return { ok: false, reason: "meetings" };
  if (valorUSD < 0) return { ok: false, reason: "format" };
  return { ok: true, reuniones, valorUSD: Math.round(valorUSD * 100) / 100 };
}

const HELP_REPLY =
  "No pudimos leer tu respuesta 🙏\n\nEnvíanos solo los 2 números separados por un espacio: primero el número de reuniones y luego el monto en USD.\n\nEjemplo: *5 20000*";

/** Busca la campaña de la encuesta más reciente enviada a este número */
async function findSurveyContext(db, phone) {
  const variants = phoneVariants(phone);
  if (!variants.length) return null;
  const snap = await db.collectionGroup("waMessages").where("to", "in", variants).get();
  const since = Date.now() - SURVEY_WINDOW_DAYS * 24 * 3600 * 1000;
  const candidates = snap.docs
    .map((d) => d.data())
    // Envíos de campaña, o de prueba del asistente de campañas (sin campaignId, con templateName)
    .filter((m) => m.type === "campaign" && m.status !== "error" && m.userId && m.eventId && (m.campaignId || m.templateName))
    .filter((m) => (toDate(m.createdAt)?.getTime() || 0) >= since)
    .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));

  const events = new Map();
  const seen = new Set();
  for (const m of candidates) {
    const k = `${m.eventId}/${m.campaignId || `test:${m.templateName}:${m.userId}`}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (!events.has(m.eventId)) {
      const ev = await db.collection("events").doc(m.eventId).get();
      events.set(m.eventId, ev.exists ? ev.data() : null);
    }
    const policies = events.get(m.eventId)?.config?.policies || {};
    const template = String(policies.companySurvey?.waTemplate || "").trim();
    if (policies.companySurveyEnabled !== true || !template) continue;
    if (m.campaignId) {
      const campaign = await db.collection("events").doc(m.eventId).collection("waCampaigns").doc(m.campaignId).get();
      if (campaign.data()?.template?.name !== template) continue;
    } else if (m.templateName !== template) {
      continue;
    }
    return { eventId: m.eventId, userId: m.userId, campaignId: m.campaignId || null, test: !!m.test };
  }
  return null;
}

/**
 * Texto entrante de WhatsApp (type "text"): guarda la respuesta de la encuesta
 * por empresa si el número recibió la campaña de la encuesta.
 */
export async function saveCompanySurveyTextReply(db, body) {
  const { phone, text, wamid } = body || {};
  const raw = String(text || "").trim();
  // Sin dígitos o códigos de evaluaciones de GenCampus (EV-XXXXXX): no es para nosotros
  if (!phone || !/\d/.test(raw) || /^ev-/i.test(raw)) return { status: 200, json: { handled: false } };

  const ctx = await findSurveyContext(db, phone);
  if (!ctx) return { status: 200, json: { handled: false } };

  const parsed = parseSurveyAnswer(raw);
  if (!parsed.ok) {
    console.log("companySurveyWa: respuesta no válida", JSON.stringify({ ...ctx, reason: parsed.reason }));
    return { status: 200, json: { handled: true, reply: HELP_REPLY } };
  }

  const userSnap = await db.collection("users").doc(ctx.userId).get();
  if (!userSnap.exists) return { status: 200, json: { handled: false } };
  const user = userSnap.data();
  const companyKey = user.companyId ? String(user.companyId) : `u_${ctx.userId}`;
  const companyName = String(user.company_razonSocial || user.empresa || "").trim();
  const ref = db.collection("events").doc(ctx.eventId).collection("companySurveys").doc(companyKey);

  const result = await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) return { alreadyAnswered: true, response: existing.data() };
    const response = {
      companyKey,
      companyId: user.companyId ? String(user.companyId) : null,
      companyName,
      reuniones: parsed.reuniones,
      valorUSD: parsed.valorUSD,
      channel: "whatsapp",
      respondedBy: ctx.userId,
      respondedByName: String(user.nombre || "").trim(),
      respondedByEmail: String(user.correo || "").trim(),
      respondedByRole: normalizeRole(user.tipoAsistente),
      respondedAt: FieldValue.serverTimestamp(),
      // Trazabilidad de la respuesta por chat
      rawText: raw.slice(0, 500),
      phone: String(phone).replace(/\D/g, ""),
      campaignId: ctx.campaignId,
      wamid: wamid || null,
      // Respuesta a un envío de prueba del asistente de campañas
      ...(ctx.test ? { test: true } : {}),
    };
    tx.set(ref, response);
    return { alreadyAnswered: false, response };
  });

  const r = result.response;
  const empresa = r.companyName || companyName || "tu empresa";
  const reply = result.alreadyAnswered
    ? `¡Gracias! ${r.respondedByName || "Alguien de tu empresa"} ya respondió por ${empresa}: ${fmtNumber(r.reuniones)} reuniones y USD ${fmtNumber(r.valorUSD)} en negocios proyectados. No necesitas hacer nada más. 🤝`
    : `¡Gracias${user.nombre ? `, ${String(user.nombre).trim().split(/\s+/)[0]}` : ""}! Registramos la respuesta de ${empresa}: ${fmtNumber(r.reuniones)} reuniones y USD ${fmtNumber(r.valorUSD)} en negocios proyectados. 🤝`;
  console.log("companySurveyWa", JSON.stringify({ ...ctx, companyKey, alreadyAnswered: result.alreadyAnswered }));
  return { status: 200, json: { handled: true, reply } };
}

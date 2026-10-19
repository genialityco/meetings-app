// ============================================================================
// TRACKING DE MENSAJES DE WHATSAPP (API oficial)
// ============================================================================
//
// Registro: events/{eventId}/waMessages/{wamid} (id automático si el envío falló
// y no hay wamid). Lo escriben el cliente (src/utils/waTracking.ts) y las Cloud
// Functions que envían por la API oficial (campañas, recordatorios de pendientes,
// reasignación automática) con waMessageDoc().
//
// Estados: wa-multi-session-backend reenvía cada webhook de estado de Meta a
// guardarRespuestaWhatsapp con { type: "status", wamid, status, timestamp, errors }
// y saveWaStatus() actualiza el registro: sent → delivered → read (nunca
// retrocede) o failed. Los estados de mensajes que no están registrados (otros
// sistemas que usan el mismo número) se ignoran.

import { FieldValue } from "firebase-admin/firestore";

const STATUS_RANK = { error: 0, sent: 1, failed: 1, delivered: 2, read: 3 };
const VALID_STATUSES = new Set(["sent", "delivered", "read", "failed"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Arma el documento de un envío hecho desde Cloud Functions.
 * @returns {{ ref: FirebaseFirestore.DocumentReference, data: object }}
 */
export function waMessageDoc(db, { eventId, type, to, userId, meetingId, meetingIds, campaignId, templateName, test, result }) {
  const col = db.collection("events").doc(String(eventId)).collection("waMessages");
  const ok = !!result?.ok;
  const messageId = (ok && result?.messageId) || null;
  const data = {
    eventId: String(eventId),
    type,
    status: ok ? "sent" : "error",
    to: String(to || "").replace(/[^\d]/g, ""),
    userId: userId || null,
    meetingId: meetingId || null,
    messageId,
    error: ok ? null : String(result?.error || "Error desconocido").slice(0, 300),
    errorCode: ok ? null : result?.code ?? null,
    source: "server",
    createdAt: FieldValue.serverTimestamp(),
  };
  if (ok) data.statusAt = { sent: FieldValue.serverTimestamp() };
  if (meetingIds?.length) data.meetingIds = meetingIds.slice(0, 50);
  if (campaignId) data.campaignId = campaignId;
  if (templateName) data.templateName = templateName;
  // Envío de prueba del asistente de campañas (sendWaTemplateTest)
  if (test) data.test = true;
  return { ref: messageId ? col.doc(messageId) : col.doc(), data };
}

/** Registra un envío. Nunca lanza: el tracking no debe romper el envío. */
export async function logWaMessageServer(db, params) {
  if (!params?.eventId) return;
  try {
    const { ref, data } = waMessageDoc(db, params);
    await ref.set(data);
  } catch (err) {
    console.warn("logWaMessageServer error:", err.message || err);
  }
}

async function findMessageRef(db, wamid) {
  const snap = await db.collectionGroup("waMessages").where("messageId", "==", wamid).limit(1).get();
  return snap.empty ? null : snap.docs[0].ref;
}

/**
 * Webhook de estado de Meta reenviado por wa-multi-session-backend:
 * { type: "status", wamid, status: "sent"|"delivered"|"read"|"failed", timestamp, errors? }
 */
export async function saveWaStatus(db, body) {
  const { wamid, status, timestamp, errors } = body;
  if (!wamid || !VALID_STATUSES.has(status)) {
    return { status: 400, json: { error: "Faltan campos: wamid, status (sent|delivered|read|failed)" } };
  }

  // El cliente registra el envío justo después de la respuesta del backend; un
  // delivered/failed muy rápido puede llegar antes, así que se reintenta una vez.
  // (sent ya lo deja el registro inicial y read llega mucho después.) El mismo
  // número lo usan otros sistemas: sus estados no se encuentran y se ignoran.
  let ref = await findMessageRef(db, String(wamid));
  if (!ref && (status === "delivered" || status === "failed")) {
    await sleep(3000);
    ref = await findMessageRef(db, String(wamid));
  }
  if (!ref) return { status: 200, json: { ok: true, ignored: true } };

  const at = timestamp ? new Date(Number(timestamp) * 1000) : new Date();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.data() || {};
    const update = { [`statusAt.${status}`]: at };
    // delivered/read tardíos no se pisan con sent; failed solo si no se entregó
    if ((STATUS_RANK[status] ?? 0) > (STATUS_RANK[current.status] ?? 0) ||
        (status === "failed" && current.status === "sent")) {
      update.status = status;
    }
    if (status === "failed" && errors?.length) {
      const e = errors[0] || {};
      update.error = String(e.error_data?.details || e.message || e.title || "Fallo de entrega").slice(0, 300);
      update.errorCode = e.code ?? null;
    }
    tx.update(ref, update);
  });
  return { status: 200, json: { ok: true } };
}

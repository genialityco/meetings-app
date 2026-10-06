// ============================================================================
// CAMPAÑAS MASIVAS DE WHATSAPP (por evento)
// ============================================================================
//
// Flujo:
//  1. El admin arma la campaña en el panel (EventAdmin → "Campañas WhatsApp"):
//     elige una plantilla aprobada en Meta (listWaTemplates), mapea sus variables
//     y los destinatarios. El cliente escribe
//       events/{eventId}/waCampaigns/{campaignId}                (config + contadores)
//       events/{eventId}/waCampaigns/{campaignId}/recipients/{uid} (components ya armados)
//     y pasa la campaña a status "queued".
//  2. processWaCampaign (trigger) toma la campaña y envía a los destinatarios
//     "pending" vía wa-multi-session-backend (/api/campaign/send). Cada invocación
//     trabaja ~8 min; si quedan pendientes vuelve a poner "queued" y se re-dispara.
//     El admin puede pausar (status "paused") y reanudar ("queued").
//  3. Las respuestas a botones quick reply llegan del backend de WhatsApp a
//     guardarRespuestaWhatsapp, que las guarda en el destinatario (y opcionalmente
//     en un campo del usuario, ver campaign.responseField).
//
// Estados de campaña: draft → queued → running → (queued ↔ running)* → completed
//                     con paused como pausa manual.
// Estados de destinatario: pending → sent | error

import { onRequest } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { defineSecret, defineString } from "firebase-functions/params";

// URL base de wa-multi-session-backend (mismo secret que usan las notificaciones)
const WHATSAPP_API_V2 = defineSecret("WHATSAPP_API_V2");
// Clave compartida con el backend (CAMPAIGN_API_KEY en su .env)
const WA_CAMPAIGN_API_KEY = defineSecret("WA_CAMPAIGN_API_KEY");
// Secreto con el que el backend de WhatsApp autentica las respuestas a botones.
const SURVEY_WEBHOOK_SECRET = defineString("SURVEY_WEBHOOK_SECRET", {
  default: "geniality-encuesta-webhook",
});

// Tiempo de trabajo por invocación del trigger (el timeout es 540 s)
const RUN_BUDGET_MS = 470_000;
// Destinatarios que se leen por tanda y envíos simultáneos dentro de la tanda
const PAGE_SIZE = 50;
const CONCURRENCY = 5;
// Reintentos de un destinatario ante errores transitorios (429/5xx/red)
const MAX_ATTEMPTS = 3;
// Códigos de Meta que indican límite de velocidad (reintentables)
const TRANSIENT_META_CODES = new Set([4, 80007, 130429, 131056]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ----------------------------------------------------------------------------
// Auth: el llamador debe ser superadmin u owner del evento (igual que
// canManageEvent en firestore.rules)
// ----------------------------------------------------------------------------
async function assertCanManageEvent(req, eventId) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    const err = new Error("Falta el token de autenticación");
    err.status = 401;
    throw err;
  }
  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(match[1]);
  } catch {
    const err = new Error("Token inválido");
    err.status = 401;
    throw err;
  }

  const db = getFirestore();
  const [adminSnap, eventSnap] = await Promise.all([
    db.collection("admins").doc(decoded.uid).get(),
    db.collection("events").doc(String(eventId)).get(),
  ]);
  if (!eventSnap.exists) {
    const err = new Error("Evento no encontrado");
    err.status = 404;
    throw err;
  }
  const isSuperAdmin = adminSnap.exists && adminSnap.data()?.isSuperAdmin === true;
  const owners = eventSnap.data()?.owners || [];
  if (!isSuperAdmin && !owners.includes(decoded.uid)) {
    const err = new Error("No tienes permisos sobre este evento");
    err.status = 403;
    throw err;
  }
  return decoded.uid;
}

/**
 * listWaTemplates
 * GET/POST ?eventId=... (Authorization: Bearer <idToken de admin>)
 * Devuelve las plantillas aprobadas de la cuenta de WhatsApp Business.
 */
export const listWaTemplates = onRequest(
  {
    region: "us-central1",
    memory: "256MiB",
    cors: true,
    secrets: [WHATSAPP_API_V2, WA_CAMPAIGN_API_KEY],
  },
  async (req, res) => {
    if (req.method !== "GET" && req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const eventId = req.query.eventId || req.body?.eventId;
    if (!eventId) {
      res.status(400).json({ error: "Falta eventId" });
      return;
    }

    try {
      await assertCanManageEvent(req, eventId);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
      return;
    }

    try {
      const response = await fetch(`${WHATSAPP_API_V2.value()}/api/templates`, {
        headers: { "x-api-key": WA_CAMPAIGN_API_KEY.value() },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        res.status(502).json({ error: data.error || "Error consultando plantillas", details: data.details });
        return;
      }
      res.status(200).json({ templates: data.templates || [] });
    } catch (err) {
      console.error("listWaTemplates error:", err);
      res.status(502).json({ error: "No se pudo contactar el backend de WhatsApp" });
    }
  }
);

// ----------------------------------------------------------------------------
// Envío de un destinatario
// ----------------------------------------------------------------------------
async function sendToRecipient(campaign, recipient) {
  try {
    const response = await fetch(`${WHATSAPP_API_V2.value()}/api/campaign/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": WA_CAMPAIGN_API_KEY.value(),
      },
      body: JSON.stringify({
        to: recipient.phone,
        templateName: campaign.template.name,
        languageCode: campaign.template.language,
        components: recipient.components || [],
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      return { ok: true, messageId: data.messageId || null };
    }
    const transient =
      response.status === 429 ||
      (response.status >= 500 && !data.code) ||
      TRANSIENT_META_CODES.has(Number(data.code));
    return {
      ok: false,
      transient,
      code: data.code ?? response.status,
      error: String(data.details || data.error || `HTTP ${response.status}`).slice(0, 500),
    };
  } catch (err) {
    return { ok: false, transient: true, code: "network", error: String(err.message || err).slice(0, 500) };
  }
}

/**
 * processWaCampaign
 * Se dispara cuando una campaña pasa a status "queued".
 */
export const processWaCampaign = onDocumentWritten(
  {
    document: "events/{eventId}/waCampaigns/{campaignId}",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 540,
    secrets: [WHATSAPP_API_V2, WA_CAMPAIGN_API_KEY],
  },
  async (event) => {
    const after = event.data?.after?.data();
    const before = event.data?.before?.data();
    if (!after || after.status !== "queued" || before?.status === "queued") return;

    const { eventId, campaignId } = event.params;
    const db = getFirestore();
    const campaignRef = db.doc(`events/${eventId}/waCampaigns/${campaignId}`);
    const recipientsRef = campaignRef.collection("recipients");

    // Tomar la campaña (evita dos ejecuciones simultáneas)
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(campaignRef);
      if (snap.data()?.status !== "queued") return false;
      tx.update(campaignRef, {
        status: "running",
        startedAt: snap.data().startedAt || FieldValue.serverTimestamp(),
        heartbeatAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!claimed) return;

    const campaign = after;
    const deadline = Date.now() + RUN_BUDGET_MS;
    let stoppedByUser = false;
    let processed = 0;

    try {
      outer: while (Date.now() < deadline) {
        const current = (await campaignRef.get()).data();
        if (current?.status !== "running") {
          stoppedByUser = true;
          break;
        }

        const page = await recipientsRef.where("status", "==", "pending").limit(PAGE_SIZE).get();
        if (page.empty) break;

        let anyProgress = false;
        for (let i = 0; i < page.docs.length; i += CONCURRENCY) {
          if (Date.now() >= deadline) break outer;
          const chunk = page.docs.slice(i, i + CONCURRENCY);
          const results = await Promise.all(chunk.map((d) => sendToRecipient(campaign, d.data())));

          const batch = db.batch();
          let sent = 0;
          let failed = 0;
          let throttled = false;
          results.forEach((r, idx) => {
            const docRef = chunk[idx].ref;
            const attempts = (chunk[idx].data().attempts || 0) + 1;
            if (r.ok) {
              sent++;
              batch.update(docRef, {
                status: "sent",
                messageId: r.messageId,
                sentAt: FieldValue.serverTimestamp(),
                attempts,
                error: FieldValue.delete(),
                errorCode: FieldValue.delete(),
              });
            } else if (r.transient && attempts < MAX_ATTEMPTS) {
              throttled = true;
              batch.update(docRef, { attempts, lastError: r.error });
            } else {
              failed++;
              batch.update(docRef, {
                status: "error",
                error: r.error,
                errorCode: r.code ?? null,
                attempts,
                failedAt: FieldValue.serverTimestamp(),
              });
            }
          });
          batch.update(campaignRef, {
            "counts.sent": FieldValue.increment(sent),
            "counts.failed": FieldValue.increment(failed),
            heartbeatAt: FieldValue.serverTimestamp(),
          });
          await batch.commit();

          processed += sent + failed;
          if (sent + failed > 0) anyProgress = true;
          // Ante límites de velocidad, bajar el ritmo
          if (throttled) await sleep(3000);
        }

        // Todos los de la página quedaron pendientes por errores transitorios:
        // esperar antes de volver a consultarlos
        if (!anyProgress) await sleep(5000);
      }

      // Cierre: si sigue en "running" (no la pausaron), decidir si continúa o terminó
      const pendingLeft = !(await recipientsRef.where("status", "==", "pending").limit(1).get()).empty;
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(campaignRef);
        if (snap.data()?.status !== "running") return;
        tx.update(
          campaignRef,
          pendingLeft
            ? { status: "queued", heartbeatAt: FieldValue.serverTimestamp() } // re-dispara el trigger
            : { status: "completed", completedAt: FieldValue.serverTimestamp() }
        );
      });

      console.log(
        `processWaCampaign ${eventId}/${campaignId}: ${processed} procesados` +
          (stoppedByUser ? " (pausada)" : pendingLeft ? " (continúa)" : " (completada)")
      );
    } catch (err) {
      console.error(`processWaCampaign ${eventId}/${campaignId} error:`, err);
      await campaignRef.update({
        status: "paused",
        lastError: String(err.message || err).slice(0, 500),
        heartbeatAt: FieldValue.serverTimestamp(),
      }).catch(() => {});
    }
  }
);

// ----------------------------------------------------------------------------
// Respuestas a botones (webhook desde wa-multi-session-backend)
// ----------------------------------------------------------------------------

// Respuestas válidas de la encuesta legacy "valor de negocio" (PR #20) y su texto.
const VALOR_NEGOCIO_RESPUESTAS = {
  menos_100M: "Menos de $100 millones",
  "100M_500M": "Entre $100 y $500 millones",
  "500M_1000M": "Entre $500 millones y $1.000 millones",
  "1000M_5000M": "Entre $1.000 millones y $5.000 millones",
  mas_5000M: "Más de $5.000 millones",
};

// Ruta de campo válida para guardar la respuesta en el usuario (ej. "encuestaValorNegocio")
const RESPONSE_FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

const toDate = (timestamp) => (timestamp ? new Date(Number(timestamp) * 1000) : new Date());

/** Respuesta a un botón de una campaña: { type: "campaign", eventId, campaignId, userId, buttonIndex, answerText, ... } */
async function saveCampaignReply(db, body) {
  const { eventId, campaignId, userId, answerText, wamid, timestamp } = body;
  const buttonIndex = Number(body.buttonIndex ?? 0);
  if (!eventId || !campaignId || !userId) {
    return { status: 400, json: { error: "Faltan campos: eventId, campaignId, userId" } };
  }

  const campaignRef = db.doc(`events/${eventId}/waCampaigns/${campaignId}`);
  const recipientRef = campaignRef.collection("recipients").doc(String(userId));
  const receivedAt = toDate(timestamp);

  const result = await db.runTransaction(async (tx) => {
    const userRef = db.collection("users").doc(String(userId));
    const [campaignSnap, recipientSnap, userSnap] = await Promise.all([
      tx.get(campaignRef),
      tx.get(recipientRef),
      tx.get(userRef),
    ]);
    if (!campaignSnap.exists || !recipientSnap.exists) return { notFound: true };

    const prev = recipientSnap.data().response;
    if (wamid && prev?.wamid === wamid) return { duplicated: true };

    tx.update(recipientRef, {
      response: {
        buttonIndex,
        answerText: answerText ?? "",
        wamid: wamid ?? null,
        receivedAt,
      },
    });

    // Contadores: una respuesta por destinatario; si cambia de opción, se mueve el conteo
    const counters = {};
    if (!prev) {
      counters["counts.responded"] = FieldValue.increment(1);
      counters[`responseCounts.${buttonIndex}`] = FieldValue.increment(1);
    } else if (prev.buttonIndex !== buttonIndex) {
      counters[`responseCounts.${prev.buttonIndex}`] = FieldValue.increment(-1);
      counters[`responseCounts.${buttonIndex}`] = FieldValue.increment(1);
    }
    if (Object.keys(counters).length) tx.update(campaignRef, counters);

    const responseField = campaignSnap.data().responseField;
    // El asistente pudo haber sido eliminado después del envío
    if (responseField && RESPONSE_FIELD_RE.test(responseField) && userSnap.exists) {
      tx.update(userRef, {
        [responseField]: {
          answer: answerText ?? "",
          answerText: answerText ?? "",
          buttonIndex,
          campaignId,
          wamid: wamid ?? null,
          receivedAt,
          updatedAt: FieldValue.serverTimestamp(),
        },
      });
    }
    return { ok: true };
  });

  if (result.notFound) return { status: 404, json: { error: "Campaña o destinatario no encontrado" } };
  if (result.duplicated) return { status: 200, json: { ok: true, duplicated: true } };
  return { status: 200, json: { ok: true } };
}

/** Respuesta legacy de la encuesta "valor de negocio" (PR #20): busca al usuario por teléfono. */
async function saveLegacySurveyReply(db, body) {
  const { eventId, phone, answer, answerText, wamid, timestamp } = body;

  if (!eventId || !phone || !answer) {
    return { status: 400, json: { error: "Faltan campos: eventId, phone, answer" } };
  }
  if (!VALOR_NEGOCIO_RESPUESTAS[answer]) {
    return { status: 400, json: { error: `answer inválido: ${answer}` } };
  }

  const phoneDigits = String(phone).replace(/\D/g, "");
  if (phoneDigits.length < 7) {
    return { status: 400, json: { error: `phone inválido: ${phone}` } };
  }
  // Compara dos teléfonos tolerando presencia/ausencia del indicativo.
  const phoneMatches = (stored) => {
    const s = String(stored || "").replace(/\D/g, "");
    if (s.length < 7) return false;
    return (
      s === phoneDigits ||
      s.endsWith(phoneDigits) ||
      phoneDigits.endsWith(s) ||
      s.slice(-10) === phoneDigits.slice(-10)
    );
  };

  // Idempotencia: si ya procesamos este wamid, no repetimos.
  if (wamid) {
    const seenRef = db.collection("encuestaValorNegocioWamids").doc(String(wamid));
    const isNew = await db.runTransaction(async (tx) => {
      const snap = await tx.get(seenRef);
      if (snap.exists) return false;
      tx.set(seenRef, {
        eventId: String(eventId),
        phone: phoneDigits,
        answer,
        createdAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!isNew) return { status: 200, json: { ok: true, duplicated: true } };
  }

  const usersSnap = await db.collection("users").where("eventId", "==", String(eventId)).get();
  const userDoc = usersSnap.docs.find((d) => {
    const data = d.data();
    return phoneMatches(data.telefono) || phoneMatches(data.celular) || phoneMatches(data.phone);
  });

  if (!userDoc) {
    console.warn(
      `guardarRespuestaWhatsapp: usuario no encontrado (evento ${eventId}, tel ...${phoneDigits.slice(-4)})`
    );
    return { status: 404, json: { error: "Usuario no encontrado para ese evento y teléfono" } };
  }

  await userDoc.ref.update({
    encuestaValorNegocio: {
      answer,
      answerText: answerText ?? VALOR_NEGOCIO_RESPUESTAS[answer],
      phone: phoneDigits,
      wamid: wamid ?? null,
      receivedAt: toDate(timestamp),
      updatedAt: FieldValue.serverTimestamp(),
    },
  });
  return { status: 200, json: { ok: true, userId: userDoc.id } };
}

async function handleWhatsappReply(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const expectedSecret = SURVEY_WEBHOOK_SECRET.value();
  if (expectedSecret && req.get("x-webhook-secret") !== expectedSecret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = req.body || {};
  const db = getFirestore();
  try {
    const { status, json } =
      body.type === "campaign" ? await saveCampaignReply(db, body) : await saveLegacySurveyReply(db, body);
    res.status(status).json(json);
  } catch (err) {
    console.error("guardarRespuestaWhatsapp error:", err);
    res.status(500).json({ error: "internal" });
  }
}

/**
 * guardarRespuestaWhatsapp
 * Webhook llamado por wa-multi-session-backend cuando un contacto toca un botón
 * quick reply de una plantilla (campañas o encuesta legacy de valor de negocio).
 * Auth: header x-webhook-secret = SURVEY_WEBHOOK_SECRET.
 */
export const guardarRespuestaWhatsapp = onRequest(
  { region: "us-central1", memory: "256MiB" },
  handleWhatsappReply
);

/** @deprecated alias de guardarRespuestaWhatsapp (URL usada por el backend antes de las campañas) */
export const guardarRespuestaEncuesta = onRequest(
  { region: "us-central1", memory: "256MiB" },
  handleWhatsappReply
);

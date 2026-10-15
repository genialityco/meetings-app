// ============================================================================
// RECORDATORIO DE REUNIÓN PRÓXIMA (WhatsApp API oficial + correo)
// ============================================================================
//
// Cada 5 min busca, en los eventos del secret MEETING_REMINDER_EVENT_ID (uno o
// varios ids separados por coma), las reuniones "accepted" que empiezan dentro
// de los próximos MEETING_REMINDER_MINUTES (default 15) y avisa a cada
// participante por WhatsApp (plantilla aprobada en Meta, vía
// wa-multi-session-backend /api/campaign/send) y por correo.
//
// Marca en la reunión (events/{eventId}/meetings/{id}):
//   reminderNotified     boolean  true cuando ya se notificó (se reclama en una
//                                 transacción antes de enviar: no hay duplicados
//                                 aunque dos ejecuciones se solapen)
//   reminderNotifiedFor  string   "<fecha> <timeSlot>" notificado; si la reunión
//                                 se mueve a otro horario se vuelve a notificar
//   reminderNotifiedAt   Timestamp
//   reminderResults      { [uid]: { whatsapp, email } }  resultado por canal
// Se marca aunque falle un canal (no se reintenta contra un número inválido).
//
// Contrato de la plantilla de WhatsApp (MEETING_REMINDER_TEMPLATE, por defecto
// notificacion_reunion_networking), variables del cuerpo en este orden
// ({{1}}..{{8}}, o con nombre si la plantilla es NAMED):
//   1 / nombre             → nombre del participante
//   2 / evento             → nombre del evento
//   3 / fecha              → fecha (ej. "jueves, 15 de octubre")
//   4 / hora               → hora (ej. "10:30 - 10:50")
//   5 / contraparte        → nombre de con quién es la reunión
//   6 / empresaContraparte → empresa de la contraparte
//   7 / mesa               → mesa asignada
//   8 / link               → link de acceso directo (AutoLoginPage, /acceso/:eventId/:userId)
// El texto de la plantilla dice "comienza en 15 minutos": si se cambia
// MEETING_REMINDER_MINUTES hay que ajustar también la plantilla en Meta.
// Un botón URL dinámico recibe el mismo link de acceso: si empieza con la parte
// fija de la URL del botón (ej. https://gen-meetings.netlify.app/{{1}}) se envía
// solo el final, como en las campañas. Sin plantilla solo se envía correo.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { defineSecret, defineString } from "firebase-functions/params";
import { logWaMessageServer } from "./waTracking.js";
import {
  escapeHtml,
  extractPlaceholders,
  fetchTemplate,
  HAS_PLACEHOLDER,
  sendEmail,
  sendWhatsApp,
  toWhatsAppNumber,
} from "./pendingReminders.js";

const WHATSAPP_API_V2 = defineSecret("WHATSAPP_API_V2");
const WA_CAMPAIGN_API_KEY = defineSecret("WA_CAMPAIGN_API_KEY");
const MEETING_REMINDER_EVENT_ID = defineSecret("MEETING_REMINDER_EVENT_ID");
const MEETING_REMINDER_TEMPLATE = defineString("MEETING_REMINDER_TEMPLATE", {
  default: "notificacion_reunion_networking",
});
const MEETING_REMINDER_TEMPLATE_LANG = defineString("MEETING_REMINDER_TEMPLATE_LANG", { default: "es" });
const MEETING_REMINDER_MINUTES = defineString("MEETING_REMINDER_MINUTES", { default: "15" });
const PUBLIC_APP_URL = defineString("PUBLIC_APP_URL", {
  default: "https://gen-meetings.netlify.app",
});

const TZ = "America/Bogota";
// Bogotá no tiene horario de verano: UTC-5 fijo
const BOGOTA_OFFSET = "-05:00";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Día de la reunión: meetingDate, o la fecha única del evento (reuniones legacy)
function meetingDay(meeting, event) {
  if (meeting.meetingDate) return String(meeting.meetingDate).slice(0, 10);
  const dates = Array.isArray(event.eventDates) ? event.eventDates : [];
  if (dates.length === 1) return String(dates[0]).slice(0, 10);
  return event.config?.eventDate ? String(event.config.eventDate).slice(0, 10) : null;
}

// Inicio de la reunión en ms (epoch) o null si no se puede calcular
function meetingStartMs(meeting, event) {
  const day = meetingDay(meeting, event);
  const start = String(meeting.timeSlot || "").split("-")[0].trim();
  const m = start.match(/^(\d{1,2}):(\d{2})$/);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !m) return null;
  const ms = Date.parse(`${day}T${m[1].padStart(2, "0")}:${m[2]}:00${BOGOTA_OFFSET}`);
  return isNaN(ms) ? null : ms;
}

const reminderKey = (meeting, event) => `${meetingDay(meeting, event)} ${meeting.timeSlot}`;

function buildComponents(template, values) {
  const named = template.parameter_format === "NAMED";
  const ordered = [
    values.nombre,
    values.evento,
    values.fecha,
    values.hora,
    values.contraparte,
    values.empresaContraparte,
    values.mesa,
    values.link,
  ];
  const components = [];
  for (const comp of template.components || []) {
    if (comp.type === "BODY") {
      const params = extractPlaceholders(comp.text).map((p, i) => {
        const isNum = /^\d+$/.test(p);
        const v = named && !isNum ? values[p] : ordered[isNum ? Number(p) - 1 : i];
        return {
          type: "text",
          text: String(v ?? "-").trim() || "-",
          ...(named && !isNum ? { parameter_name: p } : {}),
        };
      });
      if (params.length) components.push({ type: "body", parameters: params });
    } else if (comp.type === "BUTTONS") {
      (comp.buttons || []).forEach((btn, index) => {
        if (btn.type === "URL" && btn.url && HAS_PLACEHOLDER.test(btn.url)) {
          // Meta solo reemplaza el final de la URL del botón
          const prefix = btn.url.split("{{")[0];
          const suffix = prefix && values.link.startsWith(prefix) ? values.link.slice(prefix.length) : values.link;
          components.push({
            type: "button",
            sub_type: "url",
            index: String(index),
            parameters: [{ type: "text", text: suffix }],
          });
        }
      });
    }
  }
  return components;
}

function buildEmailHtml({ event, values, fecha }) {
  const eventName = escapeHtml(event.eventName || "el evento");
  const logo = event.dashboardLogo
    ? `<div style="text-align:center;margin-bottom:20px;"><img src="${escapeHtml(event.dashboardLogo)}" alt="Logo" style="max-width:200px;max-height:80px;" /></div>`
    : "";
  const row = (label, value) =>
    value
      ? `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;">${label}</td><td style="padding:6px 0;font-weight:bold;color:#111827;">${escapeHtml(value)}</td></tr>`
      : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Tu reunión está por comenzar</title></head>
  <body style="font-family:Arial,sans-serif;background:#f9fafb;color:#374151;margin:0;padding:20px;">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
      <div style="padding:30px;">
        ${logo}
        <p>Hola <strong>${escapeHtml(values.nombre)}</strong>,</p>
        <p>Tu reunión en <strong>${eventName}</strong> comienza en unos minutos. Por favor dirígete a tu mesa asignada.</p>
        <table style="border-collapse:collapse;margin:16px 0;">
          ${row("Con", values.contraparte)}
          ${row("Empresa", values.empresaContraparte)}
          ${row("Fecha", fecha)}
          ${row("Hora", values.hora)}
          ${row("Mesa", values.mesa)}
        </table>
        <div style="text-align:center;margin-top:24px;">
          <a href="${escapeHtml(values.link)}" style="display:inline-block;padding:12px 24px;color:#fff;background:#3b82f6;text-decoration:none;border-radius:6px;font-weight:bold;font-size:13px;">Ver mi agenda</a>
        </div>
      </div>
      <div style="background:#f3f4f6;padding:15px;text-align:center;font-size:12px;color:#6b7280;">
        Este es un mensaje automático de la plataforma de agendamiento.
      </div>
    </div>
  </body></html>`;
}

/**
 * Reclama la reunión para notificar (transacción): devuelve false si ya fue
 * notificada para su horario actual o dejó de estar aceptada.
 */
async function claimMeeting(db, ref, key) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const m = snap.data();
    if (!m || m.status !== "accepted") return false;
    if (m.reminderNotified === true && m.reminderNotifiedFor === key) return false;
    tx.update(ref, { reminderNotified: true, reminderNotifiedFor: key, reminderNotifiedAt: Timestamp.now() });
    return true;
  });
}

export async function processMeetingReminders(eventId) {
  const db = getFirestore();
  const eventRef = db.collection("events").doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) return { eventId, skipped: "Evento no encontrado" };
  const event = eventSnap.data();

  const leadMs = Math.max(1, Number(MEETING_REMINDER_MINUTES.value()) || 15) * 60 * 1000;
  const now = Date.now();

  const meetingsSnap = await eventRef.collection("meetings").where("status", "==", "accepted").get();
  const due = [];
  meetingsSnap.forEach((d) => {
    const m = { id: d.id, ref: d.ref, ...d.data() };
    if (m.isExternal || m.completed) return;
    const start = meetingStartMs(m, event);
    if (start === null || start <= now || start - now > leadMs) return;
    if (m.reminderNotified === true && m.reminderNotifiedFor === reminderKey(m, event)) return;
    due.push(m);
  });

  const summary = { eventId, accepted: meetingsSnap.size, due: due.length, notified: 0, whatsappSent: 0, whatsappFailed: 0, emailSent: 0, emailFailed: 0, templateError: null };
  if (!due.length) return summary;

  let template = null;
  const templateName = MEETING_REMINDER_TEMPLATE.value().trim();
  if (!templateName) summary.templateError = "MEETING_REMINDER_TEMPLATE no configurado";
  else {
    try {
      template = await fetchTemplate({ template: { name: templateName, language: MEETING_REMINDER_TEMPLATE_LANG.value() || "es" } });
    } catch (err) {
      summary.templateError = err.message;
    }
  }

  // Usuarios de las reuniones a notificar
  const uids = [...new Set(due.flatMap((m) => m.participants || []).filter(Boolean))];
  const userSnaps = uids.length ? await db.getAll(...uids.map((uid) => db.collection("users").doc(uid))) : [];
  const users = new Map(userSnaps.filter((s) => s.exists).map((s) => [s.id, { id: s.id, ...s.data() }]));

  const origin = PUBLIC_APP_URL.value().replace(/\/+$/, "");
  const displayName = (u) => {
    const empresa = u?.empresa || u?.company_razonSocial || "";
    const raw = (u?.nombre || "").trim();
    // Los representantes genéricos (rep_<nit>) se llaman "Asistente": se usa la empresa
    return !raw || raw.toLowerCase() === "asistente" ? empresa || "asistente" : raw;
  };

  for (const m of due) {
    const key = reminderKey(m, event);
    if (!(await claimMeeting(db, m.ref, key))) continue;
    summary.notified++;

    const day = meetingDay(m, event);
    const fecha = day
      ? new Date(`${day}T12:00:00${BOGOTA_OFFSET}`).toLocaleDateString("es-CO", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" })
      : "";
    const results = {};

    for (const uid of m.participants || []) {
      const user = users.get(uid);
      if (!user) {
        results[uid] = { error: "Usuario no encontrado" };
        continue;
      }
      const other = users.get((m.participants || []).find((p) => p !== uid));
      const values = {
        nombre: displayName(user),
        evento: event.eventName || "el evento",
        fecha: fecha || "-",
        hora: m.timeSlot || "-",
        contraparte: other ? displayName(other) : "-",
        empresaContraparte: other?.empresa || other?.company_razonSocial || "-",
        mesa: m.tableAssigned ? String(m.tableAssigned) : "-",
        link: `${origin}/acceso/${encodeURIComponent(eventId)}/${encodeURIComponent(uid)}`,
      };

      const phone = toWhatsAppNumber(user.telefono);
      let wa;
      if (!template) wa = { ok: false, error: summary.templateError };
      else if (!phone) wa = { ok: false, error: "Sin teléfono válido" };
      else {
        wa = await sendWhatsApp(phone, template, buildComponents(template, values));
        await logWaMessageServer(db, { eventId, type: "meeting_reminder", to: phone, userId: uid, meetingId: m.id, result: wa });
      }
      wa.ok ? summary.whatsappSent++ : summary.whatsappFailed++;

      const email = String(user.correo || "").trim();
      const mail = email
        ? await sendEmail(
            email,
            `Tu reunión comienza pronto (${values.hora}) - ${event.eventName || "Evento"}`,
            buildEmailHtml({ event, values, fecha })
          )
        : { ok: false, error: "Sin correo" };
      mail.ok ? summary.emailSent++ : summary.emailFailed++;

      results[uid] = { whatsapp: wa, email: mail };
      await sleep(150);
    }

    await m.ref.update({ reminderResults: results });
  }

  return summary;
}

/**
 * sendMeetingReminders
 * Cada 5 min notifica las reuniones aceptadas que empiezan en los próximos
 * MEETING_REMINDER_MINUTES de los eventos del secret MEETING_REMINDER_EVENT_ID.
 */
export const sendMeetingReminders = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: TZ,
    memory: "512MiB",
    timeoutSeconds: 300,
    region: "us-central1",
    secrets: [WHATSAPP_API_V2, WA_CAMPAIGN_API_KEY, MEETING_REMINDER_EVENT_ID],
  },
  async () => {
    const eventIds = MEETING_REMINDER_EVENT_ID.value()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!eventIds.length) {
      console.log("meetingReminders: MEETING_REMINDER_EVENT_ID vacío");
      return;
    }
    for (const eventId of eventIds) {
      try {
        const result = await processMeetingReminders(eventId);
        console.log("meetingReminders", JSON.stringify(result));
      } catch (err) {
        console.error(`meetingReminders ${eventId} error:`, err);
      }
    }
  }
);

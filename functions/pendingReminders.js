// ============================================================================
// RECORDATORIOS DE SOLICITUDES PENDIENTES (por evento)
// ============================================================================
//
// Cada N horas (policy pendingRemindersEveryHours) se avisa por WhatsApp y/o
// correo a quien tiene solicitudes de reunión "pending" por aceptar:
//  - Solicitud directa (receiverId): a ese asesor.
//  - Solicitud a una empresa (receiverId null + companyId): a todos los
//    asistentes del evento asociados a esa empresa (cualquiera puede reclamarla,
//    igual que en MeetingAutoResponse / getCompanyAdvisors).
// Un solo mensaje por destinatario con el total de sus pendientes (resumen).
//
// Policies (event.config.policies):
//   pendingRemindersEnabled        boolean  (interruptor general)
//   pendingRemindersEveryHours     number   (default 12)
//   pendingRemindersMinAgeHours    number   (solo solicitudes con al menos esta antigüedad, default 2)
//   pendingRemindersStartHour      number   (ventana de envío, hora Bogotá, default 8)
//   pendingRemindersEndHour        number   (default 20, exclusiva)
//   pendingRemindersWhatsapp       boolean  (default true)
//   pendingRemindersTemplate       { name, language }  plantilla aprobada en Meta
//   pendingRemindersEmail          boolean  (default true)
//
// Contrato de la plantilla de WhatsApp: variables del cuerpo en este orden
// ({{1}}..{{4}}, o con nombre si la plantilla es NAMED):
//   1 / nombre      → nombre del asesor
//   2 / evento      → nombre del evento
//   3 / pendientes  → cantidad de solicitudes pendientes
//   4 / empresa     → empresa del asesor
// Un botón URL dinámico recibe "event/<eventId>?ingresar=1" (la plantilla debe
// tener la URL base de la app, ej. https://gen-meetings.netlify.app/{{1}}).
//
// Estado por destinatario: events/{eventId}/pendingReminders/{userId}
// (lastSentAt, lastPendingCount, lastWhatsapp, lastEmail, sendCount).

import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { defineSecret, defineString } from "firebase-functions/params";
import { assertCanManageEvent } from "./waCampaigns.js";

const WHATSAPP_API_V2 = defineSecret("WHATSAPP_API_V2");
const WA_CAMPAIGN_API_KEY = defineSecret("WA_CAMPAIGN_API_KEY");
const PUBLIC_APP_URL = defineString("PUBLIC_APP_URL", {
  default: "https://gen-meetings.netlify.app",
});
const EMAIL_API_URL = defineString("EMAIL_API_URL", {
  default: "https://apigencampus.geniality.com.co/email/custom",
});

const TZ = "America/Bogota";
// Margen para que la deriva del scheduler (cada 30 min) no salte un ciclo
const INTERVAL_TOLERANCE_MS = 10 * 60 * 1000;
// Máximo de solicitudes listadas en el correo
const MAX_EMAIL_ITEMS = 25;
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const HAS_PLACEHOLDER = /\{\{\s*[A-Za-z0-9_]+\s*\}\}/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const escapeHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const toDate = (v) => {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

// Fecha (YYYY-MM-DD) y hora actuales en Bogotá
function nowInBogota() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

// Último día del evento (YYYY-MM-DD) o null si no tiene fechas configuradas
function lastEventDay(event) {
  const days = [
    ...(Array.isArray(event.eventDates) ? event.eventDates : []),
    ...Object.keys(event.dailyConfig || {}),
    event.config?.eventDate,
  ]
    .filter(Boolean)
    .map((d) => String(d).slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  return days.length ? days[days.length - 1] : null;
}

// Equivalente servidor de toWhatsAppNumber (src/utils/phoneUtils.ts), simplificado:
// indicativo + número nacional, solo dígitos; "" si no es válido.
function toWhatsAppNumber(raw) {
  const value = String(raw ?? "")
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, "")
    .split(/[/;,|]/)[0]
    .trim();
  if (!value) return "";
  let digits;
  const withSpace = value.match(/^\+(\d{1,4})\s+(.+)$/);
  if (withSpace) {
    const local = withSpace[2].replace(/\D/g, "");
    digits = withSpace[1] + (withSpace[1] === "39" ? local : local.replace(/^0+/, ""));
  } else {
    const all = value.replace(/\D/g, "").replace(/^00/, "");
    if (value.startsWith("+") || all.length > 10) digits = all;
    else digits = "57" + all.replace(/^0+/, "");
  }
  if (/^574\d{9}$/.test(digits)) digits = "58" + digits.slice(2);
  return digits.length >= 10 && digits.length <= 15 ? digits : "";
}

function readConfig(policies = {}) {
  const num = (v, def, min = 0) => (Number.isFinite(Number(v)) && Number(v) >= min ? Number(v) : def);
  return {
    enabled: policies.pendingRemindersEnabled === true,
    everyHours: num(policies.pendingRemindersEveryHours, 12, 1),
    minAgeHours: num(policies.pendingRemindersMinAgeHours, 2),
    startHour: num(policies.pendingRemindersStartHour, 8),
    endHour: num(policies.pendingRemindersEndHour, 20),
    whatsapp: policies.pendingRemindersWhatsapp !== false,
    template: policies.pendingRemindersTemplate?.name ? policies.pendingRemindersTemplate : null,
    email: policies.pendingRemindersEmail !== false,
  };
}

// ----------------------------------------------------------------------------
// Destinatarios: agrupa las solicitudes pendientes por asesor
// ----------------------------------------------------------------------------
async function collectRecipients(db, eventId, cfg) {
  const [meetingsSnap, usersSnap] = await Promise.all([
    db.collection("events").doc(eventId).collection("meetings").where("status", "==", "pending").get(),
    db.collection("users").where("eventId", "==", eventId).get(),
  ]);

  const users = new Map();
  const byCompany = new Map();
  usersSnap.forEach((d) => {
    const u = { id: d.id, ...d.data() };
    users.set(d.id, u);
    if (u.companyId) {
      if (!byCompany.has(u.companyId)) byCompany.set(u.companyId, []);
      byCompany.get(u.companyId).push(u);
    }
  });

  const cutoff = Date.now() - cfg.minAgeHours * 3600 * 1000;
  const recipients = new Map(); // userId -> { user, meetings[] }
  const add = (user, meeting) => {
    if (!user || user.id === meeting.requesterId) return;
    if (!recipients.has(user.id)) recipients.set(user.id, { user, meetings: [] });
    recipients.get(user.id).meetings.push(meeting);
  };

  let skippedRecent = 0;
  meetingsSnap.forEach((d) => {
    const m = { id: d.id, ...d.data() };
    const created = toDate(m.createdAt);
    if (created && created.getTime() > cutoff) {
      skippedRecent++;
      return;
    }
    if (m.receiverId) add(users.get(m.receiverId), m);
    else if (m.companyId) (byCompany.get(m.companyId) || []).forEach((u) => add(u, m));
  });

  return { recipients: [...recipients.values()], users, pendingTotal: meetingsSnap.size, skippedRecent };
}

// ----------------------------------------------------------------------------
// WhatsApp
// ----------------------------------------------------------------------------
async function fetchTemplate(cfg) {
  const response = await fetch(`${WHATSAPP_API_V2.value()}/api/templates`, {
    headers: { "x-api-key": WA_CAMPAIGN_API_KEY.value() },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status} consultando plantillas`);
  const lang = cfg.template.language || "es";
  const tpl = (data.templates || []).find((t) => t.name === cfg.template.name && t.language === lang);
  if (!tpl) throw new Error(`Plantilla ${cfg.template.name} (${lang}) no encontrada o no aprobada`);
  return tpl;
}

const extractPlaceholders = (text = "") => {
  const names = [];
  for (const m of text.matchAll(PLACEHOLDER_RE)) if (!names.includes(m[1])) names.push(m[1]);
  if (names.every((n) => /^\d+$/.test(n))) names.sort((a, b) => Number(a) - Number(b));
  return names;
};

function buildComponents(template, values, buttonSuffix) {
  const named = template.parameter_format === "NAMED";
  const ordered = [values.nombre, values.evento, values.pendientes, values.empresa];
  const components = [];
  for (const comp of template.components || []) {
    if (comp.type === "BODY") {
      const params = extractPlaceholders(comp.text).map((p, i) => {
        const v = named && !/^\d+$/.test(p) ? values[p] : ordered[/^\d+$/.test(p) ? Number(p) - 1 : i];
        return {
          type: "text",
          text: String(v ?? "-").trim() || "-",
          ...(named && !/^\d+$/.test(p) ? { parameter_name: p } : {}),
        };
      });
      if (params.length) components.push({ type: "body", parameters: params });
    } else if (comp.type === "BUTTONS") {
      (comp.buttons || []).forEach((btn, index) => {
        if (btn.type === "URL" && btn.url && HAS_PLACEHOLDER.test(btn.url)) {
          components.push({
            type: "button",
            sub_type: "url",
            index: String(index),
            parameters: [{ type: "text", text: buttonSuffix }],
          });
        }
      });
    }
  }
  return components;
}

async function sendWhatsApp(phone, template, components) {
  try {
    const response = await fetch(`${WHATSAPP_API_V2.value()}/api/campaign/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": WA_CAMPAIGN_API_KEY.value() },
      body: JSON.stringify({ to: phone, templateName: template.name, languageCode: template.language, components }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) return { ok: true, messageId: data.messageId || null };
    return { ok: false, error: String(data.details || data.error || `HTTP ${response.status}`).slice(0, 300) };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 300) };
  }
}

// ----------------------------------------------------------------------------
// Correo
// ----------------------------------------------------------------------------
function buildEmailHtml({ event, eventId, recipient, users, origin, greetingName }) {
  const { user, meetings } = recipient;
  const btn =
    "display:inline-block;padding:8px 16px;margin:4px 6px 0 0;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:13px;";
  const items = meetings
    .slice()
    .sort((a, b) => (toDate(a.createdAt)?.getTime() || 0) - (toDate(b.createdAt)?.getTime() || 0))
    .slice(0, MAX_EMAIL_ITEMS)
    .map((m) => {
      const r = users.get(m.requesterId) || {};
      const company = r.empresa || r.company_razonSocial || "";
      const created = toDate(m.createdAt);
      const createdTxt = created
        ? created.toLocaleString("es-CO", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
        : "";
      const base = `${origin}/meeting-response/${eventId}/${m.id}`;
      return `
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:12px;">
          <div style="font-weight:bold;color:#111827;">${escapeHtml(r.nombre || "Asistente")}${company ? ` · ${escapeHtml(company)}` : ""}</div>
          ${r.cargo ? `<div style="font-size:13px;color:#6b7280;">${escapeHtml(r.cargo)}</div>` : ""}
          ${m.contextNote ? `<div style="font-size:14px;margin-top:8px;font-style:italic;">"${escapeHtml(m.contextNote)}"</div>` : ""}
          ${createdTxt ? `<div style="font-size:12px;color:#9ca3af;margin-top:6px;">Enviada: ${escapeHtml(createdTxt)}</div>` : ""}
          <div style="margin-top:8px;">
            <a href="${base}/accept/${user.id}" style="${btn}background:#10b981;">Aceptar</a>
            <a href="${base}/reject/${user.id}" style="${btn}background:#ef4444;">Rechazar</a>
          </div>
        </div>`;
    })
    .join("");
  const more =
    meetings.length > MAX_EMAIL_ITEMS
      ? `<p style="color:#6b7280;">…y ${meetings.length - MAX_EMAIL_ITEMS} solicitudes más. Revísalas todas en la plataforma.</p>`
      : "";
  const eventName = escapeHtml(event.eventName || "el evento");
  const logo = event.dashboardLogo
    ? `<div style="text-align:center;margin-bottom:20px;"><img src="${escapeHtml(event.dashboardLogo)}" alt="Logo" style="max-width:200px;max-height:80px;" /></div>`
    : "";
  const n = meetings.length;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Solicitudes pendientes</title></head>
  <body style="font-family:Arial,sans-serif;background:#f9fafb;color:#374151;margin:0;padding:20px;">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
      <div style="padding:30px;">
        ${logo}
        <p>Hola <strong>${escapeHtml(greetingName)}</strong>,</p>
        <p>Tienes <strong>${n} ${n === 1 ? "solicitud de reunión pendiente" : "solicitudes de reunión pendientes"}</strong> por responder en <strong>${eventName}</strong>. Acéptalas para agendar la reunión o recházalas para avisarle al solicitante.</p>
        ${items}
        ${more}
        <div style="text-align:center;margin-top:24px;">
          <a href="${origin}/event/${eventId}?ingresar=1" style="${btn}background:#3b82f6;padding:12px 24px;">Ir a la plataforma</a>
        </div>
      </div>
      <div style="background:#f3f4f6;padding:15px;text-align:center;font-size:12px;color:#6b7280;">
        Este es un mensaje automático de la plataforma de agendamiento.
      </div>
    </div>
  </body></html>`;
}

async function sendEmail(to, subject, html) {
  try {
    const response = await fetch(EMAIL_API_URL.value(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, html, emailName: "Magnetic" }),
    });
    if (response.ok) return { ok: true };
    const text = await response.text().catch(() => "");
    return { ok: false, error: `HTTP ${response.status} ${text}`.slice(0, 300) };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 300) };
  }
}

// ----------------------------------------------------------------------------
// Proceso de un evento
// ----------------------------------------------------------------------------
/**
 * @param {{ dryRun?: boolean, ignoreSchedule?: boolean }} opts
 *   dryRun: no envía ni escribe, devuelve a quién se enviaría.
 *   ignoreSchedule: no aplica ventana horaria ni fin de evento (el intervalo por
 *   destinatario se sigue respetando para no duplicar envíos).
 */
export async function processEventReminders(eventId, opts = {}) {
  const db = getFirestore();
  const eventRef = db.collection("events").doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) return { eventId, skipped: "Evento no encontrado" };
  const event = eventSnap.data();
  const cfg = readConfig(event.config?.policies);

  if (!opts.dryRun && !cfg.enabled) return { eventId, skipped: "Recordatorios desactivados" };

  const now = nowInBogota();
  if (!opts.ignoreSchedule) {
    const lastDay = lastEventDay(event);
    if (lastDay && now.date > lastDay) return { eventId, skipped: "El evento ya terminó" };
    if (now.hour < cfg.startHour || now.hour >= cfg.endHour) {
      return { eventId, skipped: `Fuera de la ventana de envío (${cfg.startHour}:00–${cfg.endHour}:00)` };
    }
  }

  const { recipients, users, pendingTotal, skippedRecent } = await collectRecipients(db, eventId, cfg);

  // Intervalo por destinatario
  const stateRefs = recipients.map((r) => eventRef.collection("pendingReminders").doc(r.user.id));
  const states = stateRefs.length ? await db.getAll(...stateRefs) : [];
  const intervalMs = cfg.everyHours * 3600 * 1000 - INTERVAL_TOLERANCE_MS;
  const due = recipients.filter((r, i) => {
    const last = toDate(states[i]?.data()?.lastSentAt);
    return !last || Date.now() - last.getTime() >= intervalMs;
  });

  let template = null;
  let templateError = null;
  if (cfg.whatsapp) {
    if (!cfg.template) templateError = "No hay plantilla de WhatsApp configurada";
    else {
      try {
        template = await fetchTemplate(cfg);
      } catch (err) {
        templateError = err.message;
      }
    }
  }

  const origin = PUBLIC_APP_URL.value().replace(/\/+$/, "");
  const summary = {
    eventId,
    pendingTotal,
    skippedRecent,
    recipientsWithPending: recipients.length,
    due: due.length,
    whatsappSent: 0,
    whatsappFailed: 0,
    emailSent: 0,
    emailFailed: 0,
    templateError,
    preview: [],
  };

  for (const r of due) {
    const { user, meetings } = r;
    const phone = toWhatsAppNumber(user.telefono);
    const email = String(user.correo || "").trim();
    const empresa = user.empresa || user.company_razonSocial || "";
    // Los representantes genéricos (rep_<nit>) se llaman "Asistente": se saluda a la empresa
    const rawName = (user.nombre || "").trim();
    const values = {
      nombre: !rawName || rawName.toLowerCase() === "asistente" ? empresa || "asesor" : rawName,
      evento: event.eventName || "el evento",
      pendientes: String(meetings.length),
      empresa: empresa || "-",
    };

    if (opts.dryRun) {
      if (summary.preview.length < 200) {
        summary.preview.push({
          userId: user.id,
          nombre: values.nombre,
          empresa: values.empresa,
          pendientes: meetings.length,
          whatsapp: cfg.whatsapp ? phone || null : null,
          email: cfg.email ? email || null : null,
        });
      }
      continue;
    }

    let wa = null;
    if (cfg.whatsapp) {
      if (!template) wa = { ok: false, error: templateError };
      else if (!phone) wa = { ok: false, error: "Sin teléfono válido" };
      else wa = await sendWhatsApp(phone, template, buildComponents(template, values, `event/${eventId}?ingresar=1`));
      wa.ok ? summary.whatsappSent++ : summary.whatsappFailed++;
    }

    let mail = null;
    if (cfg.email) {
      if (!email) mail = { ok: false, error: "Sin correo" };
      else {
        const n = meetings.length;
        mail = await sendEmail(
          email,
          `Tienes ${n} ${n === 1 ? "solicitud de reunión pendiente" : "solicitudes de reunión pendientes"} - ${event.eventName || "Evento"}`,
          buildEmailHtml({ event, eventId, recipient: r, users, origin, greetingName: values.nombre })
        );
      }
      mail.ok ? summary.emailSent++ : summary.emailFailed++;
    }

    // Se marca como enviado aunque falle un canal: evita reintentar cada 30 min
    // contra un número/correo inválido; el error queda registrado.
    await eventRef.collection("pendingReminders").doc(user.id).set(
      {
        userId: user.id,
        companyId: user.companyId || null,
        lastSentAt: Timestamp.now(),
        lastPendingCount: meetings.length,
        lastMeetingIds: meetings.slice(0, 50).map((m) => m.id),
        lastWhatsapp: wa,
        lastEmail: mail,
        sendCount: FieldValue.increment(1),
      },
      { merge: true }
    );
    await sleep(150);
  }

  if (!opts.dryRun) {
    await eventRef.set(
      {
        pendingRemindersLastRun: {
          at: Timestamp.now(),
          due: summary.due,
          whatsappSent: summary.whatsappSent,
          whatsappFailed: summary.whatsappFailed,
          emailSent: summary.emailSent,
          emailFailed: summary.emailFailed,
          templateError: templateError || null,
        },
      },
      { merge: true }
    );
  }

  return summary;
}

/**
 * sendPendingRequestReminders
 * Cada 30 min revisa los eventos con pendingRemindersEnabled y envía a los
 * destinatarios cuyo último recordatorio tiene más de N horas.
 */
export const sendPendingRequestReminders = onSchedule(
  {
    schedule: "every 30 minutes",
    timeZone: TZ,
    memory: "512MiB",
    timeoutSeconds: 540,
    region: "us-central1",
    secrets: [WHATSAPP_API_V2, WA_CAMPAIGN_API_KEY],
  },
  async () => {
    const db = getFirestore();
    const events = await db.collection("events").where("config.policies.pendingRemindersEnabled", "==", true).get();
    for (const ev of events.docs) {
      try {
        const result = await processEventReminders(ev.id);
        const { preview, ...rest } = result;
        console.log("pendingReminders", JSON.stringify(rest));
      } catch (err) {
        console.error(`pendingReminders ${ev.id} error:`, err);
      }
    }
  }
);

/**
 * runPendingReminders
 * POST { eventId, dryRun?: boolean } (Authorization: Bearer <idToken de admin>)
 * dryRun=true: simula y devuelve a quién se enviaría ahora (sin ventana horaria).
 * dryRun=false: envía ya (respeta el intervalo por destinatario, ignora la ventana horaria).
 */
export const runPendingReminders = onRequest(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 540,
    cors: true,
    secrets: [WHATSAPP_API_V2, WA_CAMPAIGN_API_KEY],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const { eventId, dryRun = true } = req.body || {};
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
      const result = await processEventReminders(String(eventId), { dryRun: dryRun !== false, ignoreSchedule: true });
      res.status(200).json(result);
    } catch (err) {
      console.error("runPendingReminders error:", err);
      res.status(500).json({ error: err.message || "Error procesando recordatorios" });
    }
  }
);

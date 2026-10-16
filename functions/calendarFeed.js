// ============================================================================
// SUSCRIPCIÓN AL CALENDARIO (policy calendarFeedEnabled)
// ============================================================================
//
// GET calendarFeed?e=<eventId>&u=<userId>&t=<token>
// Devuelve un calendario iCalendar con las reuniones aceptadas del asistente en
// el evento. El asistente lo agrega una vez en Google Calendar / Outlook / Apple
// ("Sincronizar con mi calendario" en la Agenda, CalendarSyncButton.tsx) y su
// calendario lo vuelve a consultar solo: reuniones nuevas, cambios de horario o
// mesa y cancelaciones aparecen sin reenviar nada. La frecuencia la decide cada
// calendario (Google cada 12-24 h, Outlook cada pocas horas, Apple configurable);
// REFRESH-INTERVAL / X-PUBLISHED-TTL solo son una sugerencia.
//
// Acceso: t debe coincidir con users/{userId}.calendarFeedToken (lo genera el
// cliente la primera vez y lo puede regenerar para invalidar un link filtrado).
// Mismo nivel de protección que el link de acceso directo /acceso/:eventId/:uid.
// Los UID de los eventos son los mismos de la invitación por correo
// (calendarInvites.js).

import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { defineString } from "firebase-functions/params";
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { meetingDay, meetingRangeMs } from "./meetingReminders.js";

const PUBLIC_APP_URL = defineString("PUBLIC_APP_URL", {
  default: "https://gen-meetings.netlify.app",
});

// Duración usada si el timeSlot no trae una hora de fin válida
const DEFAULT_DURATION_MS = 30 * 60 * 1000;

const escapeIcs = (s) =>
  String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");

// Fecha UTC en formato básico: 20261015T153000Z
const icsDate = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// Las líneas no pueden pasar de 75 octetos: se doblan con CRLF + espacio
function foldLine(line) {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const parts = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const len = Buffer.byteLength(ch, "utf8");
    if (size + len > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += len;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const toDate = (v) => {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const displayName = (u) => {
  const empresa = u?.empresa || u?.company_razonSocial || "";
  const raw = (u?.nombre || "").trim();
  // Los representantes genéricos (rep_<nit>) se llaman "Asistente": se usa la empresa
  return !raw || raw.toLowerCase() === "asistente" ? empresa || "Asistente" : raw;
};

function sameToken(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

function buildCalendar({ name, events }) {
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Geniality//Meetings//ES",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(name)}`,
    "X-WR-TIMEZONE:America/Bogota",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  const now = icsDate(new Date());
  for (const ev of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.uid}`,
      `DTSTAMP:${now}`,
      ev.lastModified ? `LAST-MODIFIED:${icsDate(ev.lastModified)}` : null,
      `DTSTART:${icsDate(ev.start)}`,
      `DTEND:${icsDate(ev.end)}`,
      `SUMMARY:${escapeIcs(ev.summary)}`,
      ev.description ? `DESCRIPTION:${escapeIcs(ev.description)}` : null,
      ev.location ? `LOCATION:${escapeIcs(ev.location)}` : null,
      ev.url ? `URL:${ev.url}` : null,
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcs(ev.summary)}`,
      "TRIGGER:-PT15M",
      "END:VALARM",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.filter(Boolean).map(foldLine).join("\r\n") + "\r\n";
}

export const calendarFeed = onRequest(
  {
    region: "us-central1",
    memory: "256MiB",
  },
  async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.status(405).send("Method not allowed");
      return;
    }
    const eventId = String(req.query.e || "");
    const userId = String(req.query.u || "");
    const token = String(req.query.t || "");
    if (!eventId || !userId || !token) {
      res.status(400).send("Faltan parámetros");
      return;
    }

    try {
      const db = getFirestore();
      const [userSnap, eventSnap] = await Promise.all([
        db.collection("users").doc(userId).get(),
        db.collection("events").doc(eventId).get(),
      ]);
      const user = userSnap.exists ? userSnap.data() : null;
      // Respuesta genérica: no revela si existe el usuario o el evento
      if (!user || !eventSnap.exists || user.eventId !== eventId || !sameToken(user.calendarFeedToken, token)) {
        res.status(404).send("Calendario no encontrado");
        return;
      }
      const ev = eventSnap.data();
      const policies = ev.config?.policies || {};
      const eventName = ev.eventName || "Evento";

      // Con la suscripción apagada se devuelve el calendario vacío (no un error)
      // para que los calendarios ya suscritos simplemente queden sin eventos
      let meetings = [];
      if (policies.calendarFeedEnabled === true) {
        const snap = await db
          .collection("events")
          .doc(eventId)
          .collection("meetings")
          .where("participants", "array-contains", userId)
          .get();
        meetings = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((m) => m.status === "accepted" && !m.isExternal);
      }

      const otherIds = [...new Set(meetings.map((m) => (m.participants || []).find((p) => p !== userId)).filter(Boolean))];
      const others = otherIds.length ? await db.getAll(...otherIds.map((id) => db.collection("users").doc(id))) : [];
      const users = new Map(others.filter((s) => s.exists).map((s) => [s.id, s.data()]));

      const origin = PUBLIC_APP_URL.value().replace(/\/+$/, "");
      const accessUrl = `${origin}/acceso/${encodeURIComponent(eventId)}/${encodeURIComponent(userId)}`;
      const venue = String(policies.calendarInvitesLocation || "").trim();

      const events = [];
      for (const m of meetings) {
        const range = meetingRangeMs(m, ev);
        if (!range || !meetingDay(m, ev)) continue;
        const other = users.get((m.participants || []).find((p) => p !== userId));
        const otherName = other ? displayName(other) : "";
        const otherCompany = other?.empresa || other?.company_razonSocial || "";
        const withWho = otherName
          ? `${otherName}${otherCompany && otherCompany !== otherName ? ` (${otherCompany})` : ""}`
          : "";
        const table = m.tableAssigned ? String(m.tableAssigned) : "";
        events.push({
          uid: `${eventId}-${m.id}@gen-meetings.geniality.com.co`,
          start: range.start,
          end: range.end ?? range.start + DEFAULT_DURATION_MS,
          lastModified: toDate(m.updatedAt) || toDate(m.createdAt),
          summary: `Reunión${withWho ? ` con ${withWho}` : ""} · ${eventName}`,
          description: [withWho ? `Reunión con ${withWho}` : "", table ? `Mesa: ${table}` : "", `Consulta tu agenda: ${accessUrl}`]
            .filter(Boolean)
            .join("\n"),
          location: [table ? `Mesa ${table}` : "", venue].filter(Boolean).join(" · "),
          url: accessUrl,
        });
      }

      res.set("Content-Type", "text/calendar; charset=utf-8");
      res.set("Content-Disposition", 'inline; filename="agenda.ics"');
      res.set("Cache-Control", "private, max-age=300");
      res.status(200).send(buildCalendar({ name: `Agenda · ${eventName}`, events }));
    } catch (err) {
      console.error("calendarFeed error:", err);
      res.status(500).send("Error generando el calendario");
    }
  }
);

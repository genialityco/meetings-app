// ============================================================================
// INVITACIONES DE CALENDARIO POR CORREO (policy calendarInvitesEnabled)
// ============================================================================
//
// Trigger sobre events/{eventId}/meetings/{meetingId}: cuando una reunión pasa a
// "accepted", cada participante recibe un correo con la invitación (.ics) para
// agregarla a su calendario, vía wa-multi-session-backend POST
// /api/email/meeting-invite (x-api-key). Se envía una sola vez por reunión: los
// cambios posteriores (horario, mesa, cancelación) no se reenvían. No se envía
// para reuniones externas ni para las que ya empezaron.
//
// Estado en la reunión: calendarInvite = { sent: true, recipients, sentAt,
// lastResults }. Se reclama en una transacción antes de enviar, así que la
// escritura del propio trigger (y dos ejecuciones simultáneas) no duplican envíos.

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { defineSecret, defineString } from "firebase-functions/params";
import { meetingDay, meetingRangeMs } from "./meetingReminders.js";

const WHATSAPP_API_V2 = defineSecret("WHATSAPP_API_V2");
const WA_CAMPAIGN_API_KEY = defineSecret("WA_CAMPAIGN_API_KEY");
const PUBLIC_APP_URL = defineString("PUBLIC_APP_URL", {
  default: "https://gen-meetings.netlify.app",
});

const TZ = "America/Bogota";
// Duración usada si el timeSlot no trae una hora de fin válida
const DEFAULT_DURATION_MS = 30 * 60 * 1000;

const participantsOf = (m) => [...new Set((m?.participants || []).filter(Boolean))];
const isAccepted = (m) => !!m && m.status === "accepted" && !m.isExternal;

const displayName = (u) => {
  const empresa = u?.empresa || u?.company_razonSocial || "";
  const raw = (u?.nombre || "").trim();
  // Los representantes genéricos (rep_<nit>) se llaman "Asistente": se usa la empresa
  return !raw || raw.toLowerCase() === "asistente" ? empresa || "Asistente" : raw;
};

async function postInvite(payload) {
  try {
    const response = await fetch(`${WHATSAPP_API_V2.value()}/api/email/meeting-invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": WA_CAMPAIGN_API_KEY.value() },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) return { ok: true, messageId: data.messageId || null };
    return { ok: false, error: String(data.details || data.error || `HTTP ${response.status}`).slice(0, 300) };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 300) };
  }
}

export const onMeetingCalendarInvite = onDocumentWritten(
  {
    document: "events/{eventId}/meetings/{meetingId}",
    region: "us-central1",
    memory: "256MiB",
    secrets: [WHATSAPP_API_V2, WA_CAMPAIGN_API_KEY],
  },
  async (fsEvent) => {
    const { eventId, meetingId } = fsEvent.params;
    const after = fsEvent.data?.after?.exists ? fsEvent.data.after.data() : null;
    // Salida rápida sin leer el evento: solo reuniones aceptadas aún sin invitación
    if (!isAccepted(after) || after.calendarInvite?.sent) return;

    const db = getFirestore();
    const eventRef = db.collection("events").doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) return;
    const ev = eventSnap.data();
    const policies = ev.config?.policies || {};
    if (policies.calendarInvitesEnabled !== true) return;

    const now = Date.now();
    const meetingRef = eventRef.collection("meetings").doc(meetingId);
    const meeting = await db.runTransaction(async (tx) => {
      const snap = await tx.get(meetingRef);
      const current = snap.exists ? snap.data() : null;
      if (!isAccepted(current) || current.calendarInvite?.sent) return null;
      const range = meetingRangeMs(current, ev);
      if (!range || range.start <= now) return null;
      const recipients = participantsOf(current);
      tx.update(meetingRef, { calendarInvite: { sent: true, recipients, sentAt: Timestamp.now() } });
      return { ...current, range, recipients };
    });
    if (!meeting) return;

    const { range, recipients } = meeting;
    const snaps = recipients.length ? await db.getAll(...recipients.map((u) => db.collection("users").doc(u))) : [];
    const users = new Map(snaps.filter((s) => s.exists).map((s) => [s.id, s.data()]));

    const origin = PUBLIC_APP_URL.value().replace(/\/+$/, "");
    const day = meetingDay(meeting, ev);
    const dateLabel = day
      ? new Date(`${day}T12:00:00-05:00`).toLocaleDateString("es-CO", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" })
      : "";

    const results = {};
    for (const uid of recipients) {
      const user = users.get(uid);
      const email = String(user?.correo || "").trim();
      if (!email) {
        results[uid] = { ok: false, error: user ? "Sin correo" : "Usuario no encontrado" };
        continue;
      }
      const other = users.get(recipients.find((p) => p !== uid));
      results[uid] = await postInvite({
        // PUBLISH: Gmail muestra "Agregar al calendario" en vez de Sí/No/Quizás
        method: "PUBLISH",
        uid: `${eventId}-${meetingId}@gen-meetings.geniality.com.co`,
        sequence: 0,
        start: new Date(range.start).toISOString(),
        end: new Date(range.end ?? range.start + DEFAULT_DURATION_MS).toISOString(),
        to: { email, name: displayName(user) },
        eventName: ev.eventName || "Evento",
        counterpartName: other ? displayName(other) : "",
        counterpartCompany: other?.empresa || other?.company_razonSocial || "",
        table: meeting.tableAssigned ? String(meeting.tableAssigned) : "",
        location: String(policies.calendarInvitesLocation || "").trim(),
        dateLabel,
        timeLabel: meeting.timeSlot || "",
        accessUrl: `${origin}/acceso/${encodeURIComponent(eventId)}/${encodeURIComponent(uid)}`,
        logoUrl: ev.dashboardLogo || "",
        alarmMinutes: 15,
      });
    }

    console.log("calendarInvite", JSON.stringify({ eventId, meetingId, results }));
    await meetingRef
      .update({ "calendarInvite.lastResults": results })
      .catch((err) => console.warn("calendarInvite: no se pudo guardar el resultado", err.message));
  }
);

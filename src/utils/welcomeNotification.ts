// Envío del mensaje de bienvenida (WhatsApp + correo) de un asistente.
// Lo usan el registro (Landing.jsx) y el pop-up de bienvenida del dashboard
// ("No me llegó, volver a enviar"), así ambos envían exactamente lo mismo.

import { sendWelcomeNotification } from "./whatsappService";

/** "14:30" → "2:30 p. m." */
export function formatTime(timeString?: string): string {
  if (!timeString) return "";
  const [hourStr, minuteStr] = timeString.split(":");
  let hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  const suffix = hour >= 12 ? "p. m." : "a. m.";
  hour = hour % 12 || 12;
  return `${hour}:${minute.toString().padStart(2, "0")} ${suffix}`;
}

/** "2026-11-23" → "23 de noviembre de 2026" */
export function formatDate(dateString?: string): string {
  if (!dateString) return "";
  const [year, month, day] = dateString.split("-").map(Number);
  const months = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  return `${day} de ${months[month - 1]} de ${year}`;
}

/** Fecha y hora de inicio del evento para el mensaje ("Por definir" si no hay). */
function eventStartLabels(config: any): { date: string; time: string } {
  let date = "Por definir";
  let time = "Por definir";
  if (config?.eventDates?.length > 0) {
    date = formatDate(config.eventDates[0]);
    const firstDay = config.dailyConfig?.[config.eventDates[0]];
    if (firstDay?.startTime) time = formatTime(firstDay.startTime);
  } else if (config?.eventDate) {
    date = formatDate(config.eventDate);
    if (config?.eventStartTime) time = formatTime(config.eventStartTime);
  }
  return { date, time };
}

/**
 * Envía la bienvenida por WhatsApp (si hay teléfono) y por correo (si hay correo).
 * No valida la política welcomeMessageEnabled: eso lo decide quien llama.
 * Los errores se registran en consola y no se propagan.
 */
export async function sendWelcomeMessages(opts: {
  eventId: string;
  uid: string;
  /** Datos del evento: eventName, eventImage y config */
  event: { eventName?: string; eventImage?: string; config?: any };
  nombre?: string;
  telefono?: string;
  correo?: string;
}): Promise<void> {
  const { eventId, uid, event, nombre, telefono, correo } = opts;
  const eventName = event?.eventName || "el evento";
  const badgeUrl = `badge/${eventId}/${uid}`;
  const headerImageUrl = event?.eventImage || event?.config?.landingTitleImage;
  const { date, time } = eventStartLabels(event?.config);
  const name = nombre || "Asistente";

  try {
    // 1. WhatsApp
    if (telefono) {
      await sendWelcomeNotification({
        phone: telefono,
        name,
        eventName,
        eventId,
        badgeUrl,
        headerImageUrl,
        date,
        time,
        fallbackInfo: { enabled: false, email: "", subject: "" }, // Evitar doble correo
        tracking: { eventId, userId: uid },
      });
    }

    // 2. Correo: teléfono falso para forzar el fallback al correo
    if (correo) {
      await sendWelcomeNotification({
        phone: "+570000000000",
        name,
        eventName,
        eventId,
        badgeUrl,
        headerImageUrl,
        date,
        time,
        fallbackInfo: {
          enabled: true,
          email: correo,
          subject: `Bienvenido a ${eventName}`,
        },
      });
    }
  } catch (err) {
    console.error("No se pudo enviar la notificación de bienvenida:", err);
  }
}

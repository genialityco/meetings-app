/**
 * Tracking de mensajes de WhatsApp enviados por la API oficial (v2).
 *
 * Cada envío queda en events/{eventId}/waMessages/{wamid} (o id automático si
 * el backend rechazó el envío y no hay wamid). El estado de entrega lo actualiza
 * la Cloud Function guardarRespuestaWhatsapp con los webhooks de Meta que le
 * reenvía wa-multi-session-backend (sent → delivered → read, o failed).
 * La página de admin /admin/event/:eventId/whatsapp lee esta colección.
 */
import { addDoc, collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";

export type WaMessageType =
  | "meeting_request"
  | "meeting_confirmation"
  | "meeting_cancelled"
  | "meeting_rejected"
  | "welcome"
  | "advisor_notice"
  | "pending_reminder"
  | "campaign";

/**
 * Estado del mensaje:
 * - error: el backend/Meta rechazó el envío (nunca salió)
 * - sent / delivered / read: estados reportados por Meta
 * - failed: Meta aceptó el envío pero reportó que no se pudo entregar
 */
export type WaMessageStatus = "error" | "sent" | "delivered" | "read" | "failed";

export const WA_MESSAGE_TYPE_LABELS: Record<WaMessageType, string> = {
  meeting_request: "Solicitud de reunión",
  meeting_confirmation: "Reunión confirmada",
  meeting_cancelled: "Reunión cancelada",
  meeting_rejected: "Solicitud rechazada",
  welcome: "Bienvenida",
  advisor_notice: "Aviso a compañero de empresa",
  pending_reminder: "Recordatorio de pendientes",
  campaign: "Campaña",
};

/** Contexto que el caller pasa para registrar el envío. Sin eventId no se registra nada. */
export interface WaTrackingContext {
  eventId?: string | null;
  /** Destinatario (users/{uid}) */
  userId?: string | null;
  meetingId?: string | null;
  /** Sobrescribe el tipo que asigna la función de envío */
  type?: WaMessageType;
}

export interface WaMessageLog {
  id: string;
  eventId: string;
  type: WaMessageType;
  status: WaMessageStatus;
  to: string;
  userId: string | null;
  meetingId: string | null;
  meetingIds?: string[];
  campaignId?: string;
  messageId: string | null;
  error?: string | null;
  errorCode?: string | number | null;
  fallbackEmail?: boolean;
  source: "client" | "server";
  createdAt?: any;
  statusAt?: Partial<Record<"sent" | "delivered" | "read" | "failed", any>>;
}

/** Resultado de una llamada a un endpoint /api/send-* de wa-multi-session-backend. */
export interface WaSendResult {
  ok: boolean;
  messageId: string | null;
  error?: string;
  errorCode?: string | number;
}

/** Interpreta la respuesta del backend (éxito, wamid y error) sin consumir el body original. */
export async function readWaSendResult(response: Response, label: string): Promise<WaSendResult> {
  let ok = response.ok;
  let data: any = null;
  try {
    data = await response.clone().json();
    console.log(`[whatsappService] ${label} response:`, response.status, data);
    if (data && (data.success === false || data.error)) ok = false;
  } catch {
    console.log(`[whatsappService] ${label} response (no-JSON):`, response.status, await response.clone().text());
  }
  return {
    ok,
    messageId: (ok && data?.messageId) || null,
    error: ok ? undefined : String(data?.details || data?.error || `HTTP ${response.status}`).slice(0, 300),
    errorCode: ok ? undefined : data?.code ?? response.status,
  };
}

/** Registra un envío. Nunca lanza: el tracking no debe romper el flujo de notificación. */
export async function logWaMessage(params: {
  tracking?: WaTrackingContext;
  type: WaMessageType;
  to: string;
  result: WaSendResult;
  fallbackEmail?: boolean;
}): Promise<void> {
  const { tracking, type, to, result, fallbackEmail } = params;
  const eventId = tracking?.eventId;
  if (!eventId) return;

  try {
    const data: Record<string, unknown> = {
      eventId,
      type: tracking?.type || type,
      status: result.ok ? "sent" : "error",
      to: String(to || "").replace(/[^\d]/g, ""),
      userId: tracking?.userId || null,
      meetingId: tracking?.meetingId || null,
      messageId: result.messageId,
      error: result.ok ? null : result.error || "Error desconocido",
      errorCode: result.ok ? null : result.errorCode ?? null,
      fallbackEmail: !!fallbackEmail,
      source: "client",
      createdAt: serverTimestamp(),
    };
    if (result.ok) data.statusAt = { sent: serverTimestamp() };

    const col = collection(db, "events", eventId, "waMessages");
    if (result.messageId) await setDoc(doc(col, result.messageId), data);
    else await addDoc(col, data);
  } catch (err) {
    console.warn("[waTracking] No se pudo registrar el mensaje:", err);
  }
}

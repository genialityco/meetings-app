/**
 * Destacado en vivo ("spotlight"): un admin activa a la persona o empresa que está
 * presentándose en el escenario y aparece en el dashboard de todos los asistentes, con
 * "Solicitar reunión" y "Me interesa". Normalmente hay uno solo, pero pueden ser varios a la vez.
 *
 * Firestore:
 * - events/{eventId}/spotlights/{id}               → Spotlight (lo escriben los admins del evento)
 * - events/{eventId}/spotlights/{id}/engagement/{uid} → vistas/aperturas por asistente (métricas)
 * - events/{eventId}/spotlights/{id}/interests/{uid}  → "Me interesa" con los datos de contacto
 * - events/{eventId}/meetings.spotlightId            → solicitudes que nacieron del destacado
 *
 * El apagado automático (endsAt) lo resuelve cada cliente comparando con su reloj; la página de
 * admin, mientras está abierta, además pasa a "done" los que vencieron.
 */
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { localTodayISO } from "./eventDays";

export type SpotlightType = "attendee" | "company";
export type SpotlightStatus = "queued" | "live" | "done";

export interface Spotlight {
  id: string;
  type: SpotlightType;
  /** uid del asistente o companyId (nitNorm) de la empresa */
  targetId: string;
  /** Copia al crear: el banner se pinta aunque el asistente no esté en la lista visible */
  displayName: string;
  subtitle?: string;
  imageUrl?: string | null;
  description?: string;
  /** Texto superior del banner, ej. "Ahora en el escenario" */
  headline?: string;
  /** Nota opcional del organizador (tema de la charla, stand, etc.) */
  note?: string;
  status: SpotlightStatus;
  order: number;
  /** null = sin límite */
  durationMinutes?: number | null;
  startedAt?: Timestamp | null;
  endsAt?: Timestamp | null;
  endedAt?: Timestamp | null;
  createdAt?: Timestamp | null;
  createdBy?: string | null;
}

export interface SpotlightInterest {
  id: string; // == uid del asistente interesado
  uid: string;
  nombre: string;
  empresa?: string;
  cargo?: string;
  telefono?: string;
  correo?: string;
  tipoAsistente?: string;
  companyId?: string | null;
  createdAt?: Timestamp | null;
}

export const DEFAULT_SPOTLIGHT_HEADLINE = "Ahora en el escenario";

export const spotlightsCol = (eventId: string) => collection(db, "events", eventId, "spotlights");
export const spotlightDoc = (eventId: string, id: string) => doc(db, "events", eventId, "spotlights", id);
export const interestsCol = (eventId: string, id: string) =>
  collection(db, "events", eventId, "spotlights", id, "interests");
export const engagementCol = (eventId: string, id: string) =>
  collection(db, "events", eventId, "spotlights", id, "engagement");

const millis = (t: any): number | null => {
  if (!t) return null;
  if (typeof t.toMillis === "function") return t.toMillis();
  if (t instanceof Date) return t.getTime();
  return null;
};

/** En vivo ahora: status "live" y sin vencer */
export const isSpotlightLive = (s: Spotlight, now = Date.now()) => {
  if (s.status !== "live") return false;
  const end = millis(s.endsAt);
  return end == null || end > now;
};

/** Ya salió al escenario (terminó, o venció su tiempo) */
export const hasSpotlightEnded = (s: Spotlight, now = Date.now()) =>
  !!s.startedAt && !isSpotlightLive(s, now);

/** Fecha local (YYYY-MM-DD) en que empezó */
export const spotlightDay = (s: Spotlight): string | null => {
  const ms = millis(s.startedAt);
  if (ms == null) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const presentedToday = (s: Spotlight, now = Date.now()) =>
  hasSpotlightEnded(s, now) && spotlightDay(s) === localTodayISO();

export const spotlightStartedMs = (s: Spotlight) => millis(s.startedAt) ?? 0;
export const spotlightEndsMs = (s: Spotlight) => millis(s.endsAt);
export const spotlightEndedMs = (s: Spotlight) => millis(s.endedAt) ?? millis(s.endsAt);

// ---------------------------------------------------------------------------
// Acciones del asistente
// ---------------------------------------------------------------------------

type EngagementField = "seenAt" | "openedAt" | "requestClickedAt" | "interestedAt";

/** Guarda la primera vez que el asistente vio / abrió / pidió reunión / marcó interés */
export async function trackSpotlightEngagement(
  eventId: string,
  spotlightId: string,
  uid: string,
  field: EngagementField,
) {
  const key = `spotlight:${eventId}:${spotlightId}:${uid}:${field}`;
  try {
    if (localStorage.getItem(key)) return;
  } catch {
    /* modo privado: se escribe igual (merge, idempotente) */
  }
  try {
    await setDoc(
      doc(engagementCol(eventId, spotlightId), uid),
      { uid, [field]: serverTimestamp() },
      { merge: true },
    );
    try {
      localStorage.setItem(key, "1");
    } catch {
      /* noop */
    }
  } catch (err) {
    console.warn("No se pudo registrar la métrica del destacado:", err);
  }
}

export async function addSpotlightInterest(
  eventId: string,
  spotlightId: string,
  user: { uid: string; data: any },
) {
  const d = user.data || {};
  await setDoc(doc(interestsCol(eventId, spotlightId), user.uid), {
    uid: user.uid,
    nombre: d.nombre || "",
    empresa: d.company_razonSocial || d.empresa || "",
    cargo: d.cargo || "",
    telefono: d.telefono || d.contacto?.telefono || "",
    correo: d.correo || d.contacto?.correo || "",
    tipoAsistente: d.tipoAsistente || "",
    companyId: d.companyId || null,
    createdAt: serverTimestamp(),
  });
  await trackSpotlightEngagement(eventId, spotlightId, user.uid, "interestedAt");
}

export async function removeSpotlightInterest(eventId: string, spotlightId: string, uid: string) {
  await deleteDoc(doc(interestsCol(eventId, spotlightId), uid));
}

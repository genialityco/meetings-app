/**
 * Ingreso con el celular y chequeo de teléfono ya registrado: la comparación de
 * teléfonos vive en las Cloud Functions de functions/phoneLogin.js (los teléfonos se
 * guardaron en formatos distintos y una consulta por igualdad no los encuentra).
 */
const FUNCTIONS_BASE = `https://us-central1-${import.meta.env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net`;
const PHONE_LOGIN_URL =
  (import.meta.env.VITE_PHONE_LOGIN_URL as string) || `${FUNCTIONS_BASE}/phoneLogin`;

export interface PhoneLoginMatch {
  uid: string;
  nombre: string;
  empresa: string | null;
}

export type PhoneLoginResult =
  | { ok: true; matches: PhoneLoginMatch[] }
  | { ok: false; error: "locked"; retryAfterSec: number };

/** Asistentes del evento con este teléfono (0, 1 o varios si el número está repetido) */
export async function findAttendeesByPhone(eventId: string, phone: string): Promise<PhoneLoginResult> {
  const res = await fetch(PHONE_LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId, phone }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 429) return { ok: false, error: "locked", retryAfterSec: data?.retryAfterSec || 900 };
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return { ok: true, matches: data.matches || [] };
}

/** Minúsculas, sin tildes ni espacios repetidos (para buscar empresas por nombre) */
export const normalizeSearch = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const PHONE_CHECK_URL =
  (import.meta.env.VITE_PHONE_CHECK_URL as string) || `${FUNCTIONS_BASE}/checkPhoneAvailability`;

export type PhoneAvailability =
  | { registered: false }
  | { registered: true; nombreMask: string | null; empresa: string | null; correoMask: string | null };

/** ¿Ya hay un asistente del evento (distinto de currentUserId) con este teléfono? (functions/phoneLogin.js) */
export async function checkPhoneAvailability(
  eventId: string,
  phone: string,
  currentUserId?: string | null,
): Promise<PhoneAvailability> {
  const res = await fetch(PHONE_CHECK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId, phone, currentUserId: currentUserId || "" }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

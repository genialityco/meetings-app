/**
 * Ingreso por empresa + teléfono (policy companyLoginEnabled). La verificación
 * vive en las Cloud Functions de functions/companyLogin.js: el cliente solo
 * recibe los teléfonos enmascarados.
 */
const FUNCTIONS_BASE = `https://us-central1-${import.meta.env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net`;
const CANDIDATES_URL =
  (import.meta.env.VITE_COMPANY_LOGIN_CANDIDATES_URL as string) ||
  `${FUNCTIONS_BASE}/companyLoginCandidates`;
const VERIFY_URL =
  (import.meta.env.VITE_COMPANY_LOGIN_VERIFY_URL as string) || `${FUNCTIONS_BASE}/companyLoginVerify`;

export interface CompanyLoginCandidate {
  uid: string;
  nombre: string;
  cargo: string | null;
  /** Ej. "••• ••• 4567"; null si el asistente no tiene teléfono registrado */
  phoneMask: string | null;
}

export type CompanyLoginVerifyResult =
  | { ok: true }
  | { ok: false; error: "mismatch"; remaining: number }
  | { ok: false; error: "locked"; retryAfterSec: number }
  | { ok: false; error: "not_found" };

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  // 404/429 traen un resultado de negocio (not_found / locked), no un error
  if (!res.ok && res.status !== 404 && res.status !== 429) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data as T;
}

export async function fetchCompanyLoginCandidates(
  eventId: string,
  companyIds: string[],
): Promise<CompanyLoginCandidate[]> {
  const data = await post<{ candidates?: CompanyLoginCandidate[] }>(CANDIDATES_URL, { eventId, companyIds });
  return data.candidates || [];
}

export function verifyCompanyLogin(eventId: string, userId: string, phone: string) {
  return post<CompanyLoginVerifyResult>(VERIFY_URL, { eventId, userId, phone });
}

/** Minúsculas, sin tildes ni espacios repetidos (para buscar empresas por nombre) */
export const normalizeSearch = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

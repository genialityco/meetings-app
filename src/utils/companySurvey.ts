import { doc, onSnapshot, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { normalizeTipoAsistente } from "./attendeeRole";

/**
 * Encuesta de resultados por empresa (policy companySurveyEnabled).
 *
 * Una sola respuesta por empresa: events/{eventId}/companySurveys/{companyKey},
 * donde companyKey es el companyId del asistente (o "u_<uid>" si no tiene empresa).
 * La primera respuesta gana: cuando un asistente la llena (en el dashboard o desde
 * el link de WhatsApp), los demás asistentes de su empresa ya no quedan bloqueados.
 *
 * Canales: "web" (modal obligatorio del dashboard, CompanySurveyGuard) y
 * "whatsapp": respuesta por chat ("5 20000") a la campaña de la plantilla
 * waTemplate (functions/companySurveyWa.js), o la página
 * /encuesta-empresa/:eventId/:userId (variable de campaña $link.encuestaEmpresa).
 */

export type CompanySurveyChannel = "web" | "whatsapp";
export type CompanySurveyTarget = "all" | "vendedor" | "comprador";

export interface CompanySurveyConfig {
  /** A quién se le pide: todos, solo expositores (vendedores) o solo compradores */
  targetRole: CompanySurveyTarget;
  title: string;
  /** Texto antes de las preguntas (admite saltos de línea) */
  intro: string;
  meetingsQuestion: string;
  valueQuestion: string;
  /** Texto después de las preguntas (admite saltos de línea) */
  outro: string;
  /** Plantilla de Meta enviada como campaña para responder por chat ("5 20000"):
   * las respuestas de quienes la recibieron se guardan como canal whatsapp
   * (functions/companySurveyWa.js). Vacío = no se leen respuestas por chat. */
  waTemplate: string;
}

export const DEFAULT_COMPANY_SURVEY: CompanySurveyConfig = {
  targetRole: "all",
  title: "¡Gracias por participar!",
  intro: "Para conocer los resultados de tu participación, queremos hacerte dos preguntas:",
  meetingsQuestion: "¿Cuántas reuniones realizaste a partir de los contactos de la plataforma?",
  valueQuestion: "En dólares (USD), ¿cuál es el valor estimado de los negocios proyectados a partir de estos contactos y reuniones?",
  outro: "",
  waTemplate: "",
};

export interface CompanySurveyResponse {
  companyKey: string;
  companyId: string | null;
  companyName: string;
  reuniones: number;
  valorUSD: number;
  channel: CompanySurveyChannel;
  respondedBy: string;
  respondedByName: string;
  respondedByEmail: string;
  respondedByRole: string;
  respondedAt?: any;
}

export const COMPANY_SURVEY_CHANNEL_LABELS: Record<CompanySurveyChannel, string> = {
  web: "Plataforma",
  whatsapp: "WhatsApp",
};

export function getCompanySurveyConfig(policies: any): CompanySurveyConfig {
  const saved = policies?.companySurvey || {};
  const pick = (k: keyof CompanySurveyConfig) =>
    typeof saved[k] === "string" && saved[k].trim() ? saved[k] : DEFAULT_COMPANY_SURVEY[k];
  return {
    targetRole: ["all", "vendedor", "comprador"].includes(saved.targetRole) ? saved.targetRole : "all",
    title: pick("title") as string,
    intro: typeof saved.intro === "string" ? saved.intro : DEFAULT_COMPANY_SURVEY.intro,
    meetingsQuestion: pick("meetingsQuestion") as string,
    valueQuestion: pick("valueQuestion") as string,
    outro: typeof saved.outro === "string" ? saved.outro : DEFAULT_COMPANY_SURVEY.outro,
    waTemplate: typeof saved.waTemplate === "string" ? saved.waTemplate.trim() : "",
  };
}

export const getCompanySurveyKey = (userData: any, uid: string) =>
  userData?.companyId ? String(userData.companyId) : `u_${uid}`;

/** Si la encuesta aplica a este asistente según el rol configurado */
export function companySurveyAppliesTo(config: CompanySurveyConfig, userData: any) {
  if (config.targetRole === "all") return true;
  return normalizeTipoAsistente(userData?.tipoAsistente) === config.targetRole;
}

const surveyRef = (eventId: string, key: string) => doc(db, "events", eventId, "companySurveys", key);

/** Escucha la respuesta de la empresa (null mientras nadie haya respondido) */
export function subscribeCompanySurvey(
  eventId: string,
  key: string,
  cb: (response: CompanySurveyResponse | null) => void,
  onError?: (err: unknown) => void
) {
  return onSnapshot(
    surveyRef(eventId, key),
    (snap) => cb(snap.exists() ? (snap.data() as CompanySurveyResponse) : null),
    (err) => {
      console.error("companySurvey:", err);
      onError?.(err);
    }
  );
}

/**
 * Guarda la respuesta de la empresa. Si otro asistente de la misma empresa ya
 * respondió, no la pisa y devuelve la existente (alreadyAnswered: true).
 */
export async function submitCompanySurvey(params: {
  eventId: string;
  uid: string;
  userData: any;
  reuniones: number;
  valorUSD: number;
  channel: CompanySurveyChannel;
}): Promise<{ alreadyAnswered: boolean; response: CompanySurveyResponse }> {
  const { eventId, uid, userData, channel } = params;
  const key = getCompanySurveyKey(userData, uid);
  const ref = surveyRef(eventId, key);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) return { alreadyAnswered: true, response: snap.data() as CompanySurveyResponse };
    const response: CompanySurveyResponse = {
      companyKey: key,
      companyId: userData?.companyId ? String(userData.companyId) : null,
      companyName: String(userData?.company_razonSocial || userData?.empresa || "").trim(),
      reuniones: Math.max(0, Math.round(Number(params.reuniones) || 0)),
      valorUSD: Math.max(0, Number(params.valorUSD) || 0),
      channel,
      respondedBy: uid,
      respondedByName: String(userData?.nombre || "").trim(),
      respondedByEmail: String(userData?.correo || "").trim(),
      respondedByRole: normalizeTipoAsistente(userData?.tipoAsistente) || "",
    };
    tx.set(ref, { ...response, respondedAt: serverTimestamp() });
    return { alreadyAnswered: false, response };
  });
}

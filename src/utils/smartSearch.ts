/**
 * Búsqueda inteligente de empresas y asistentes (políticas `smartSearchEnabled` /
 * `smartSearchExplanationsEnabled`). El índice y el ranking viven en las Cloud Functions de
 * functions/smartSearch.js; aquí están las llamadas y la búsqueda exacta por palabras (portada de
 * acho-web-totems/src/utils/text.ts) con la que se combinan los resultados.
 */
import { auth } from "../firebase/firebaseConfig";

const FUNCTIONS_BASE = `https://us-central1-${import.meta.env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net`;
const SMART_SEARCH_URL =
  (import.meta.env.VITE_SMART_SEARCH_URL as string) || `${FUNCTIONS_BASE}/smartSearch`;
const EXPLAIN_URL =
  (import.meta.env.VITE_SMART_SEARCH_EXPLAIN_URL as string) || `${FUNCTIONS_BASE}/explainSmartSearchMatch`;
const SUMMARY_URL =
  (import.meta.env.VITE_SMART_SEARCH_SUMMARY_URL as string) || `${FUNCTIONS_BASE}/summarizeSmartSearchResults`;
const REINDEX_URL =
  (import.meta.env.VITE_SMART_SEARCH_REINDEX_URL as string) || `${FUNCTIONS_BASE}/reindexSmartSearch`;

export type SmartSearchKind = "companies" | "attendees";

/** Mínimo de caracteres para buscar: con 1–2 letras casi todo coincide y se pediría un embedding por nada */
export const MIN_SEARCH_LENGTH = 3;

/**
 * Orden con búsqueda: afinidad por significado (coseno, ~0.5–0.8) + un bonus si además hay
 * coincidencia exacta. Así, dentro de las coincidencias exactas van primero las más afines, y una
 * coincidencia en el nombre pesa más que una en un campo secundario. Mismos valores que los tótems.
 */
export const EXACT_BONUS = { name: 0.08, other: 0.03 } as const;

export interface SmartSearchResponse {
  /** Los más cercanos con su coseno (orden descendente), incluidos los que no llegan al corte */
  scores: Map<string, number>;
  /** Puntaje mínimo para contar como resultado por significado */
  cutoff: number;
}

export async function fetchSmartSearch(
  eventId: string,
  kind: SmartSearchKind,
  query: string,
  signal?: AbortSignal,
): Promise<SmartSearchResponse> {
  const res = await fetch(SMART_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId, kind, query }),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  const results: Array<{ id: string; score: number }> = Array.isArray(data.results) ? data.results : [];
  return { scores: new Map(results.map((r) => [r.id, r.score])), cutoff: Number(data.cutoff) || 1 };
}

export async function fetchSearchExplanation(
  eventId: string,
  kind: SmartSearchKind,
  id: string,
  query: string,
): Promise<string> {
  const res = await fetch(EXPLAIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId, kind, id, query }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.explanation) throw new Error(data?.error || `HTTP ${res.status}`);
  return String(data.explanation);
}

/** Resumen general de los primeros resultados mostrados (summarizeSmartSearchResults) */
export async function fetchSearchSummary(
  eventId: string,
  kind: SmartSearchKind,
  query: string,
  ids: string[],
): Promise<string> {
  const res = await fetch(SUMMARY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId, kind, query, ids }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.summary) throw new Error(data?.error || `HTTP ${res.status}`);
  return String(data.summary);
}

export interface SmartSearchIndexStatus {
  companies?: { total: number; indexed: number; pending: number; orphans: number };
  attendees?: { total: number; indexed: number; pending: number; orphans: number };
  written?: number;
  deleted?: number;
}

/** Estado del índice (dryRun) o reindexado de lo pendiente. Requiere admin del evento. */
export async function runSmartSearchReindex(eventId: string, dryRun: boolean): Promise<SmartSearchIndexStatus> {
  const user = auth.currentUser;
  if (!user) throw new Error("Inicia sesión como administrador");
  const token = await user.getIdToken();
  const res = await fetch(REINDEX_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ eventId, dryRun }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

// ---------------------------------------------------------------------------
// Búsqueda exacta por palabras (sin tildes ni mayúsculas, en cualquier orden)
// ---------------------------------------------------------------------------

export const normalizeSearchText = (text: unknown) =>
  String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Palabras vacías: no hace falta que aparezcan para que algo coincida, y no se resaltan solas.
// "cafe de colombia" coincide con "…Colombia, café especial…".
const STOPWORDS = new Set(
  "a al con de del e el en la las lo los o para por u un una y the of and in with for".split(" "),
);

/** Palabras significativas de una búsqueda, normalizadas. Si todas son vacías ("de la"), se usan todas. */
export const searchWords = (term: string): string[] => {
  const words = normalizeSearchText(term).split(" ").filter(Boolean);
  const meaningful = words.filter((w) => !STOPWORDS.has(w));
  return meaningful.length ? meaningful : words;
};

/** true si `text` contiene todas las palabras (también como parte de otra: "export" ↔ "exportación") */
export const containsAllWords = (text: unknown, words: string[]) => {
  if (!words.length) return false;
  const folded = normalizeSearchText(text);
  return !!folded && words.every((w) => folded.includes(w));
};

/** true si todas las palabras aparecen repartidas entre los textos (ej. "café Bogotá": producto + ciudad) */
export const containsAllWordsAcross = (texts: unknown[], words: string[]) =>
  containsAllWords(texts.map((t) => String(t ?? "")).join(" "), words);

/** Valor para el `highlight` de Mantine: cada palabra significativa por separado */
export const highlightWords = (term: string): string[] => {
  const raw = term.trim();
  if (!raw) return [];
  // Las palabras tal como se escribieron (Mantine no ignora tildes), sin las vacías.
  const words = raw.split(/\s+/).filter((w) => !STOPWORDS.has(normalizeSearchText(w)));
  return words.length ? words : [raw];
};

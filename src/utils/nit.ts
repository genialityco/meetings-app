/**
 * Utilidades de NIT (identificación tributaria). Los ids de
 * events/{eventId}/companies son el NIT normalizado (`normalizeNit`), así que
 * la misma empresa escrita con y sin dígito de verificación (DV) termina como
 * dos documentos distintos: `findNitVariants` detecta esos casos para sugerir
 * la empresa existente antes de crear otra.
 */

/** Mayúsculas, solo letras y números (sin puntos, guiones ni espacios) */
export const normalizeNit = (v: unknown = ""): string =>
  String(v ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

// Pesos del algoritmo de la DIAN, aplicados de derecha a izquierda
const DV_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

/** Dígito de verificación DIAN de un NIT colombiano (solo dígitos, sin DV). null si no aplica */
export function computeNitDV(nitBase: string): number | null {
  if (!/^\d{1,15}$/.test(nitBase)) return null;
  const digits = nitBase.split("").reverse();
  const sum = digits.reduce((acc, d, i) => acc + Number(d) * DV_WEIGHTS[i], 0);
  const r = sum % 11;
  return r > 1 ? 11 - r : r;
}

/** "9001234567" → "900.123.456-7" cuando el último dígito es un DV válido; si no, con puntos */
export function formatNit(nit: string): string {
  const n = normalizeNit(nit);
  if (!/^\d+$/.test(n)) return n;
  const dots = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (n.length >= 9) {
    const base = n.slice(0, -1);
    if (computeNitDV(base) === Number(n.slice(-1))) return `${dots(base)}-${n.slice(-1)}`;
  }
  return dots(n);
}

export type NitVariantKind =
  /** El NIT existente es el escrito + su DV */
  | "dv_missing"
  /** El escrito es el NIT existente + un dígito al final (DV) */
  | "dv_extra"
  /** Mismo NIT base, distinto último dígito (DV diferente) */
  | "dv_different"
  /** Misma longitud, difieren en un solo dígito (posible error de digitación) */
  | "one_digit";

export interface NitVariant {
  id: string;
  kind: NitVariantKind;
}

const MIN_VARIANT_LEN = 6;

/**
 * NITs existentes que parecen la misma empresa que `input` salvo el dígito de
 * verificación o un dígito mal digitado. No incluye la coincidencia exacta.
 * Ordenados del caso más probable al menos probable.
 */
export function findNitVariants(input: string, existingIds: string[]): NitVariant[] {
  const q = normalizeNit(input);
  if (q.length < MIN_VARIANT_LEN) return [];
  const order: NitVariantKind[] = ["dv_missing", "dv_extra", "dv_different", "one_digit"];
  const out: NitVariant[] = [];
  for (const id of existingIds) {
    if (id === q || id.length < MIN_VARIANT_LEN) continue;
    let kind: NitVariantKind | null = null;
    if (id.length === q.length + 1 && id.startsWith(q)) kind = "dv_missing";
    else if (q.length === id.length + 1 && q.startsWith(id)) kind = "dv_extra";
    else if (id.length === q.length) {
      let diff = 0;
      let lastDiffIdx = -1;
      for (let i = 0; i < id.length && diff < 2; i++) {
        if (id[i] !== q[i]) {
          diff++;
          lastDiffIdx = i;
        }
      }
      if (diff === 1) kind = lastDiffIdx === id.length - 1 ? "dv_different" : "one_digit";
    }
    if (kind) out.push({ id, kind });
  }
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

export const NIT_VARIANT_MESSAGES: Record<NitVariantKind, string> = {
  dv_missing: "Parece la misma empresa: solo le falta el dígito de verificación.",
  dv_extra: "Parece la misma empresa: solo cambia el dígito de verificación.",
  dv_different: "Parece la misma empresa: solo cambia el dígito de verificación.",
  one_digit: "Es un NIT casi igual (difiere en un solo dígito). ¿Puede ser un error de digitación?",
};

// Normaliza el campo tipoAsistente ("comprador" | "vendedor"), que históricamente
// se ha guardado con distinta capitalización según el flujo de escritura
// (registro, edición desde admin, ediciones antiguas). Centraliza aquí la
// comparación en vez de repetir ".toLowerCase().trim()" en cada archivo.

export type TipoAsistente = "comprador" | "vendedor";

export function normalizeTipoAsistente(value: unknown): TipoAsistente | "" {
  const v = String(value ?? "").toLowerCase().trim();
  return v === "comprador" || v === "vendedor" ? v : "";
}

export function isVendedor(value: unknown): boolean {
  return normalizeTipoAsistente(value) === "vendedor";
}

export function isComprador(value: unknown): boolean {
  return normalizeTipoAsistente(value) === "comprador";
}

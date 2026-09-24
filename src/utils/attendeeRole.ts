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

// Rol que la política del evento impone a todo registro público (oculta el
// selector "Tipo de asistente"), o null si el asistente elige libremente.
// El modal admin solo ofrece estas políticas con roleMode "buyer_seller".
// Si por datos antiguos vinieran ambas activas, prevalece comprador.
export function getForcedRegistrationRole(
  policies?: {
    forceBuyerRoleOnRegistration?: boolean;
    forceSellerRoleOnRegistration?: boolean;
  } | null,
): TipoAsistente | null {
  if (policies?.forceBuyerRoleOnRegistration === true) return "comprador";
  if (policies?.forceSellerRoleOnRegistration === true) return "vendedor";
  return null;
}

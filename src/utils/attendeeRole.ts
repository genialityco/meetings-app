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

export const DEFAULT_ROLE_URL_PARAM_NAME = "rol";

interface RegistrationRolePolicies {
  forceBuyerRoleOnRegistration?: boolean;
  forceSellerRoleOnRegistration?: boolean;
  roleUrlParamEnabled?: boolean;
  roleUrlParamName?: string;
  roleUrlParamValues?: { comprador?: string; vendedor?: string } | null;
}

// Rol indicado por el parámetro de URL del registro (política roleUrlParamEnabled),
// p. ej. /event/:id?rol=vendedor. El nombre del parámetro y el valor que representa
// cada rol son configurables; la comparación ignora mayúsculas/espacios.
export function getRoleFromUrlParam(
  policies: RegistrationRolePolicies | null | undefined,
  search: string | URLSearchParams | null | undefined,
): TipoAsistente | null {
  if (policies?.roleUrlParamEnabled !== true || !search) return null;
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const paramName = policies.roleUrlParamName?.trim() || DEFAULT_ROLE_URL_PARAM_NAME;
  const raw = params.get(paramName);
  if (!raw) return null;
  const value = raw.toLowerCase().trim();
  const matches = (role: TipoAsistente) => {
    const configured = String(policies.roleUrlParamValues?.[role] || role).toLowerCase().trim();
    return value === configured;
  };
  if (matches("comprador")) return "comprador";
  if (matches("vendedor")) return "vendedor";
  return null;
}

// Rol que se impone al registro público (oculta el selector "Tipo de asistente"),
// o null si el asistente elige libremente. El parámetro de URL (si la política está
// activa y trae un valor válido) prevalece sobre el forzado global, para poder tener
// p. ej. un enlace público de compradores y otro enlace de vendedores.
// El modal admin solo ofrece estas políticas con roleMode "buyer_seller".
// Si por datos antiguos vinieran ambos forzados globales, prevalece comprador.
export function getForcedRegistrationRole(
  policies?: RegistrationRolePolicies | null,
  search?: string | URLSearchParams | null,
): TipoAsistente | null {
  const fromUrl = getRoleFromUrlParam(policies, search);
  if (fromUrl) return fromUrl;
  if (policies?.forceBuyerRoleOnRegistration === true) return "comprador";
  if (policies?.forceSellerRoleOnRegistration === true) return "vendedor";
  return null;
}

export type DiscoveryMode = "all" | "by_role" | "sellers_see_all";

// ¿Puede un asistente con rol `viewerTipo` ver en el directorio a uno con rol `targetTipo`?
// - "all": todos ven a todos.
// - "by_role": solo roles opuestos (quien no tiene rol ve a todos).
// - "sellers_see_all": vendedores ven a vendedores y compradores; compradores solo a
//   vendedores (quien no tiene rol ve a todos).
export function canDiscoverAttendee(
  mode: string | undefined,
  viewerTipo: unknown,
  targetTipo: unknown,
): boolean {
  const viewer = normalizeTipoAsistente(viewerTipo);
  if (!viewer) return true;
  const target = normalizeTipoAsistente(targetTipo);
  if (mode === "by_role") return target !== viewer;
  if (mode === "sellers_see_all") return viewer === "vendedor" || target === "vendedor";
  return true;
}

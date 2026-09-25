import { normalizeTipoAsistente } from "./attendeeRole";

/**
 * Etiqueta de un campo del formulario según el rol del asistente. Cada campo de
 * config.formFields puede traer `labelByRole: { comprador?, vendedor? }` (se configura
 * en ConfigureFieldsModal); si el rol no tiene etiqueta propia se usa `label`.
 */
export function getFieldLabel(field: any, tipoAsistente?: unknown): string {
  if (!field) return "";
  const tipo = normalizeTipoAsistente(tipoAsistente);
  const byRole = tipo ? String(field.labelByRole?.[tipo] ?? "").trim() : "";
  return byRole || field.label || field.name || "";
}

/** Devuelve el campo con `label` ya resuelto para el rol (útil para mapear listas completas). */
export function withRoleLabel<T extends { label?: string }>(field: T, tipoAsistente?: unknown): T {
  if (!field || !(field as any).labelByRole) return field;
  return { ...field, label: getFieldLabel(field, tipoAsistente) };
}

export const BASIC_ATTENDEE_FIELDS = [
  { name: "nombre", label: "Nombre" },
  { name: "cargo", label: "Cargo" },
  { name: "correo", label: "Correo" },
  { name: "telefono", label: "Teléfono" },
  { name: "tipoAsistente", label: "Tipo" },
];

/** Separa los campos configurados del evento en básicos y adicionales, con
 * fallback a BASIC_ATTENDEE_FIELDS cuando el evento no tiene formFields propio. */
export function splitAttendeeFields(formFields: any[] = []) {
  const basicNames = BASIC_ATTENDEE_FIELDS.map((f) => f.name);

  if (!formFields || formFields.length === 0) {
    return { basicFields: BASIC_ATTENDEE_FIELDS, additionalFields: [] as any[] };
  }

  const basicFields = basicNames
    .map((name) => formFields.find((f) => f.name === name))
    .filter(Boolean);
  const additionalFields = formFields.filter(
    (f) => !basicNames.includes(f.name) && f.name !== "photoURL" && f.name !== "aceptaTratamiento",
  );
  return { basicFields, additionalFields };
}

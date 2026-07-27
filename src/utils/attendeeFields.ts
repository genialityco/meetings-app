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

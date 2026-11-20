/**
 * Mensaje de bienvenida sobre el formulario de registro de la Landing.
 *
 * Se guarda en event.config.registrationWelcome (editado en la pestaña "Campos",
 * ConfigureFieldsModal.tsx). Variante según el rol forzado del registro
 * (getForcedRegistrationRole): "vendedor", "comprador" o "general" si no hay rol
 * forzado. Un campo vacío usa el texto por defecto de esa variante.
 *
 * El texto admite párrafos (separados por una línea en blanco) y **negrita**.
 */

export type WelcomeVariant = "general" | "comprador" | "vendedor";

export interface WelcomeMessage {
  title?: string;
  text?: string;
}

export type RegistrationWelcomeConfig = Partial<Record<WelcomeVariant, WelcomeMessage>>;

export const DEFAULT_REGISTRATION_WELCOME: Record<WelcomeVariant, Required<WelcomeMessage>> = {
  general: {
    title: "",
    text: "Completa el formulario para crear tu registro.",
  },
  vendedor: {
    title: "¡Bienvenido, EXPOSITOR!",
    text: [
      "Para agilizar tu registro en la rueda de negocios, hemos precargado algunos datos de empresas que ya se encuentran en nuestro sistema.",
      "Ingresa el **NIT/RIF** de tu empresa y, al pasar al siguiente campo, se cargarán automáticamente los datos que tengamos disponibles. **Revisa la información, completa los campos que falten y actualiza cualquier dato que sea necesario.**",
      "Así podremos contar con la información correcta de tu empresa y facilitar las conexiones y reuniones durante la rueda de negocios.",
    ].join("\n\n"),
  },
  comprador: {
    title: "¡Bienvenido EMPRESARIA/O a la rueda de negocios!",
    text: [
      "Estamos felices de contar contigo en este espacio de conexión y oportunidades de negocio.",
      "Completa tus datos para crear tu perfil como asistente/comprador. Esta información nos permitirá identificar tus intereses, ayudarte a encontrar empresas y oportunidades relevantes, y facilitar las reuniones durante la rueda de negocios.",
      "Procura completar la información con el mayor detalle posible para aprovechar mejor tus conexiones.",
    ].join("\n\n"),
  },
};

export const WELCOME_VARIANT_LABELS: Record<WelcomeVariant, string> = {
  general: "General",
  vendedor: "Registro de vendedores",
  comprador: "Registro de compradores",
};

/** Mensaje efectivo de una variante: lo configurado, o el texto por defecto. */
export function resolveWelcomeMessage(
  config: RegistrationWelcomeConfig | undefined | null,
  variant: WelcomeVariant,
): Required<WelcomeMessage> {
  const custom = config?.[variant];
  const def = DEFAULT_REGISTRATION_WELCOME[variant];
  return {
    title: custom?.title?.trim() || def.title,
    text: custom?.text?.trim() || def.text,
  };
}

/** Párrafos del texto (separados por líneas en blanco). */
export const splitParagraphs = (text: string): string[] =>
  String(text || "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

/** Trozos de un párrafo marcando lo que va entre **…** como negrita. */
export const splitBold = (paragraph: string): { text: string; bold: boolean }[] =>
  paragraph
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("**") && part.endsWith("**") && part.length > 4
        ? { text: part.slice(2, -2), bold: true }
        : { text: part, bold: false },
    );

// ---------------- Consentimiento ----------------

export const DEFAULT_CONSENT_LABEL = "Acepto el tratamiento de mis datos personales";

// Etiqueta que el editor guardaba por defecto: como texto de una casilla no es una
// aceptación, así que se muestra con la redacción nueva.
const LEGACY_CONSENT_LABEL = "Consentimiento de tratamiento de datos";

export function resolveConsentLabel(label: string | undefined | null): string {
  const clean = String(label || "").trim();
  if (!clean || clean === LEGACY_CONSENT_LABEL) return DEFAULT_CONSENT_LABEL;
  return clean;
}

// Texto que se convierte en embedding para la búsqueda inteligente (smartSearch.js) de empresas y
// asistentes. Módulo puro (sin Firebase) para poder usarlo también desde scripts/ (calibración).
import { createHash } from "node:crypto";

// Subirlo invalida todas las firmas: cambia el texto indexado o el modelo, y todo se re-embebe en
// el siguiente reindexado.
export const SMART_SEARCH_INDEX_VERSION = 1;
export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSION = 768;
// gemini-embedding-001 acepta 2048 tokens; en español son ~4 caracteres por token, así que 6000
// caracteres deja margen. Lo primero del texto (nombre, sector, descripción) siempre entra.
export const MAX_EMBEDDING_INPUT_CHARS = 6000;
const MAX_PRODUCT_DESCRIPTION_CHARS = 400;
const MAX_PRODUCTS = 15;
const MAX_REPS = 8;

const clean = (value) =>
  (typeof value === "string" ? value : value == null ? "" : String(value))
    .replace(/<[^>]*>/g, " ") // descripciones richtext
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const fold = (text) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Campos del formulario que describen a qué se dedica alguien (sector, país, productos de interés…).
// Fuera: contacto, identificación, archivos, redes y los que ya entran aparte (nombre, empresa,
// descripción). Los de texto libre solo entran si su nombre sugiere contenido descriptivo.
const SKIP_FIELD_TYPES = new Set(["phone", "email", "file", "image", "date", "checkbox", "consent", "number"]);
const SKIP_FIELD_NAME =
  /(^|_)(nombre|correo|email|telefono|phone|cedula|documento|nit|razonsocial|logo|password|instagram|facebook|linkedin|twitter|tiktok|web|pagina|pgina|url|sitio|direccion|ciudad_?postal)($|_)|^company_(nit|razonSocial|logo)$|^descripcion$|^empresa$|^cargo$/i;
const DESCRIPTIVE_TEXT_FIELD = /(sector|producto|servicio|interes|necesidad|busca|ofrece|categoria|industria|actividad|pais|ciudad|region|cargo|area)/i;

export function descriptiveFields(formFields) {
  return (Array.isArray(formFields) ? formFields : []).filter((f) => {
    if (!f?.name || SKIP_FIELD_TYPES.has(f.type)) return false;
    if (SKIP_FIELD_NAME.test(f.name)) return false;
    if (f.type === "text") return DESCRIPTIVE_TEXT_FIELD.test(`${f.name} ${f.label || ""}`);
    return true; // select, multiselect, textarea, richtext…
  });
}

const fieldValue = (value) => (Array.isArray(value) ? value.map(clean).filter(Boolean).join(", ") : clean(value));

// "Sector: Logística, transporte y zonas francas" para cada campo descriptivo con valor.
function describeFields(fields, data) {
  return fields.flatMap((f) => {
    const value = fieldValue(data?.[f.name]);
    return value ? [`${clean(f.label) || f.name}: ${value}`] : [];
  });
}

const productLine = (p) => {
  const title = clean(p.title);
  const category = clean(p.category);
  const description = clip(clean(p.description), MAX_PRODUCT_DESCRIPTION_CHARS);
  return [title + (category ? ` (${category})` : ""), description].filter(Boolean).join(": ");
};

// Agrega líneas sin repetir (comparando sin tildes ni mayúsculas): varios representantes suelen
// copiar la misma descripción de la empresa.
function dedupeLines(lines) {
  const seen = new Set();
  return lines.filter((line) => {
    const key = fold(line);
    if (!line || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Texto de una empresa: nombre, campos (sector, país…), su descripción, sus productos y lo que
 * dicen sus representantes. Los representantes aportan mucho: en varios eventos la empresa no tiene
 * descripción propia y la de cada persona es lo único que explica a qué se dedica.
 */
export function buildCompanyText({ company, reps, products, formFields }) {
  const fields = descriptiveFields(formFields);
  const name = clean(company?.razonSocial || company?.company_razonSocial || reps?.[0]?.empresa);
  const repLines = (reps || []).slice(0, MAX_REPS).flatMap((r) => [
    clean(r.descripcion),
    clean(r.necesidad),
    clean(r.interesPrincipal),
    ...describeFields(fields, r),
  ]);
  const lines = dedupeLines([
    ...describeFields(fields, company),
    clean(company?.descripcion),
    ...(products || []).slice(0, MAX_PRODUCTS).map(productLine).map((l) => `Producto: ${l}`),
    ...repLines,
  ]);
  return { title: name, text: clip([name, ...lines].filter(Boolean).join("\n"), MAX_EMBEDDING_INPUT_CHARS) };
}

/**
 * Texto de un asistente: su empresa, cargo, campos descriptivos, su descripción, sus productos y la
 * descripción de su empresa (contexto cuando la suya es corta). El nombre de la persona no entra:
 * no aporta significado y la búsqueda exacta ya lo cubre.
 */
export function buildAttendeeText({ user, company, products, formFields }) {
  const fields = descriptiveFields(formFields);
  const empresa = clean(user?.empresa || user?.company_razonSocial || company?.razonSocial);
  const companyDescription = clean(company?.descripcion);
  // Muchos representantes copian la descripción de la empresa como la suya: no se repite.
  const repeatsCompany = companyDescription && fold(companyDescription) === fold(clean(user?.descripcion));
  const lines = dedupeLines([
    empresa ? `Empresa: ${empresa}` : "",
    clean(user?.cargo) ? `Cargo: ${clean(user.cargo)}` : "",
    ...describeFields(fields, user),
    clean(user?.descripcion),
    clean(user?.necesidad),
    clean(user?.interesPrincipal),
    ...(products || []).slice(0, MAX_PRODUCTS).map(productLine).map((l) => `Producto: ${l}`),
    companyDescription && !repeatsCompany ? `Sobre la empresa: ${companyDescription}` : "",
  ]);
  return { title: empresa, text: clip(lines.join("\n"), MAX_EMBEDDING_INPUT_CHARS) };
}

export const textSignature = (text) =>
  createHash("sha1")
    .update(JSON.stringify([SMART_SEARCH_INDEX_VERSION, EMBEDDING_MODEL, EMBEDDING_DIMENSION, text]))
    .digest("hex");

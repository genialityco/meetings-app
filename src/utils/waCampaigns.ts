/**
 * Campañas masivas de WhatsApp por evento.
 *
 * El cliente arma la campaña (plantilla de Meta + mapeo de variables +
 * destinatarios) y escribe en Firestore:
 *   events/{eventId}/waCampaigns/{campaignId}
 *   events/{eventId}/waCampaigns/{campaignId}/recipients/{userId}
 * Al pasar la campaña a "queued", la Cloud Function processWaCampaign hace el
 * envío (ver functions/waCampaigns.js).
 */
import {
  collection,
  doc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  deleteField,
  DocumentReference,
} from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";

// ─── Tipos de plantillas de Meta ─────────────────────────────────────────────

export interface WaTemplateButton {
  type: string; // QUICK_REPLY | URL | PHONE_NUMBER | COPY_CODE | FLOW | ...
  text: string;
  url?: string;
}

export interface WaTemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: string; // HEADER: TEXT | IMAGE | VIDEO | DOCUMENT | LOCATION
  text?: string;
  buttons?: WaTemplateButton[];
}

export interface WaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string; // MARKETING | UTILITY | AUTHENTICATION
  parameter_format?: "POSITIONAL" | "NAMED";
  components: WaTemplateComponent[];
}

/** Variable de una plantilla que hay que llenar para cada destinatario */
export interface TemplateSlot {
  key: string; // "header:1", "body:1", "body:nombre", "header_media", "button:0"
  kind: "header_text" | "header_media" | "body" | "button_url";
  label: string;
  paramName: string; // nombre/número del placeholder
  mediaFormat?: string; // IMAGE | VIDEO | DOCUMENT
  buttonIndex?: number;
  /** Parte fija de la URL del botón, antes de {{1}} (ej. "https://gen-meetings.netlify.app/") */
  urlPrefix?: string;
}

export interface TemplateAnalysis {
  slots: TemplateSlot[];
  quickReplies: { index: number; text: string }[];
  unsupported: string[]; // motivos por los que no se puede usar en campañas
}

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

const extractPlaceholders = (text = ""): string[] => {
  const names: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  // Posicionales: Meta los espera en orden numérico ({{1}}, {{2}}, ...)
  if (names.every((n) => /^\d+$/.test(n))) names.sort((a, b) => Number(a) - Number(b));
  return names;
};

export function analyzeTemplate(template: WaTemplate): TemplateAnalysis {
  const slots: TemplateSlot[] = [];
  const quickReplies: { index: number; text: string }[] = [];
  const unsupported: string[] = [];

  for (const comp of template.components || []) {
    if (comp.type === "HEADER") {
      if (comp.format === "TEXT") {
        extractPlaceholders(comp.text).forEach((p) =>
          slots.push({ key: `header:${p}`, kind: "header_text", label: `Encabezado {{${p}}}`, paramName: p })
        );
      } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(comp.format || "")) {
        const label = { IMAGE: "imagen", VIDEO: "video", DOCUMENT: "documento" }[comp.format as string];
        slots.push({
          key: "header_media",
          kind: "header_media",
          label: `Encabezado (${label})`,
          paramName: "media",
          mediaFormat: comp.format,
        });
      } else if (comp.format) {
        unsupported.push(`Encabezado de tipo ${comp.format}`);
      }
    } else if (comp.type === "BODY") {
      extractPlaceholders(comp.text).forEach((p) =>
        slots.push({ key: `body:${p}`, kind: "body", label: `Cuerpo {{${p}}}`, paramName: p })
      );
    } else if (comp.type === "BUTTONS") {
      (comp.buttons || []).forEach((btn, index) => {
        if (btn.type === "QUICK_REPLY") {
          quickReplies.push({ index, text: btn.text });
        } else if (btn.type === "URL") {
          if (btn.url && /\{\{\s*[A-Za-z0-9_]+\s*\}\}/.test(btn.url)) {
            slots.push({
              key: `button:${index}`,
              kind: "button_url",
              label: `Botón "${btn.text}" (${btn.url.split("{{")[0]}…)`,
              paramName: String(index),
              buttonIndex: index,
              urlPrefix: btn.url.split("{{")[0],
            });
          }
        } else if (btn.type !== "PHONE_NUMBER") {
          unsupported.push(`Botón de tipo ${btn.type}`);
        }
      });
    }
  }

  return { slots, quickReplies, unsupported };
}

// ─── Fuentes de valores ──────────────────────────────────────────────────────

export interface SlotMapping {
  source: "field" | "fixed";
  field?: string;
  value?: string;
  fallback?: string;
}

export interface FieldOption {
  value: string;
  label: string;
  group: string;
}

/** Campos especiales calculados (no se leen directo del documento del asistente) */
const SPECIAL_FIELDS: FieldOption[] = [
  { value: "$evento.nombre", label: "Nombre del evento", group: "Evento" },
  { value: "$link.credencial", label: "Link de su credencial (QR)", group: "Links" },
  { value: "$link.dashboard", label: "Link del dashboard del evento", group: "Links" },
  { value: "$link.registro", label: "Link de registro del evento", group: "Links" },
];

const BASE_FIELDS: FieldOption[] = [
  { value: "nombre", label: "Nombre", group: "Asistente" },
  { value: "$empresa", label: "Empresa (razón social)", group: "Asistente" },
  { value: "cargo", label: "Cargo", group: "Asistente" },
  { value: "correo", label: "Correo", group: "Asistente" },
  { value: "telefono", label: "Teléfono", group: "Asistente" },
  { value: "tipoAsistente", label: "Tipo de asistente", group: "Asistente" },
  { value: "attendeeId", label: "ID de asistente", group: "Asistente" },
];

/** Prefijo de las variables que salen de una columna del archivo importado */
export const COLUMN_FIELD_PREFIX = "$col:";

/**
 * Fuentes de valores para las variables. Con `importColumns` (destinatarios desde
 * un archivo) se ofrecen las columnas del archivo y los datos del evento, pero no
 * los campos del asistente ni su link de credencial (no están registrados).
 */
export function getFieldOptions(event: any, importColumns?: string[]): FieldOption[] {
  if (importColumns) {
    return [
      ...importColumns.map((c) => ({ value: `${COLUMN_FIELD_PREFIX}${c}`, label: c, group: "Columnas del archivo" })),
      ...SPECIAL_FIELDS.filter((f) => f.value !== "$link.credencial"),
    ];
  }
  const seen = new Set(BASE_FIELDS.map((f) => f.value));
  const extra: FieldOption[] = [];
  for (const f of event?.config?.formFields || []) {
    if (!f?.name || seen.has(f.name)) continue;
    if (["photo", "image", "file", "consent", "checkbox"].includes(f.type)) continue;
    seen.add(f.name);
    extra.push({ value: f.name, label: f.label || f.name, group: "Formulario del evento" });
  }
  return [...BASE_FIELDS, ...extra, ...SPECIAL_FIELDS];
}

/**
 * Dominio público de la app para los links de los mensajes. Se configura con
 * VITE_PUBLIC_APP_URL para que una campaña armada desde localhost o un preview
 * no envíe links a ese dominio.
 */
export const getPublicAppOrigin = () =>
  ((import.meta.env.VITE_PUBLIC_APP_URL as string) || window.location.origin).replace(/\/+$/, "");

export interface ResolveContext {
  event: any;
  origin: string;
}

const getNested = (obj: any, path: string) =>
  path.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);

// Meta rechaza parámetros con saltos de línea, tabs o más de 4 espacios seguidos
const sanitizeParam = (value: string) =>
  value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();

export function resolveField(attendee: any, field: string, ctx: ResolveContext): string {
  const eventId = ctx.event?.id;
  let raw: unknown;
  switch (field) {
    case "$evento.nombre":
      raw = ctx.event?.eventName;
      break;
    case "$link.credencial":
      raw = `${ctx.origin}/badge/${eventId}/${attendee.id}`;
      break;
    case "$link.dashboard":
      raw = `${ctx.origin}/dashboard/${eventId}`;
      break;
    case "$link.registro":
      raw = `${ctx.origin}/event/${eventId}`;
      break;
    case "$empresa":
      raw = attendee.company_razonSocial || attendee.empresa;
      break;
    case "nombre":
      raw = attendee.nombre || attendee.nombres;
      break;
    default:
      raw = field.startsWith(COLUMN_FIELD_PREFIX)
        ? attendee.__row?.[field.slice(COLUMN_FIELD_PREFIX.length)]
        : getNested(attendee, field);
  }
  if (Array.isArray(raw)) raw = raw.join(", ");
  if (raw == null || typeof raw === "object") return "";
  return sanitizeParam(String(raw));
}

export function resolveSlot(mapping: SlotMapping | undefined, attendee: any, ctx: ResolveContext): string {
  if (!mapping) return "";
  const value =
    mapping.source === "fixed"
      ? sanitizeParam(mapping.value || "")
      : mapping.field
        ? resolveField(attendee, mapping.field, ctx)
        : "";
  return value || sanitizeParam(mapping.fallback || "");
}

// ─── Destinatarios desde archivo (contactos no registrados en el evento) ─────

export interface ImportedFile {
  fileName: string;
  columns: string[];
  rows: Record<string, string>[];
}

/** Lee la primera hoja de un Excel/CSV: la primera fila son los encabezados */
export async function parseContactsFile(file: File): Promise<ImportedFile> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("El archivo no tiene hojas");
  // raw: los teléfonos numéricos llegan como número (sin formato científico)
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
  const columns: string[] = [];
  const rows = raw
    .map((r) => {
      const row: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) {
        const key = String(k).trim();
        if (!key || key.startsWith("__EMPTY")) continue;
        if (!columns.includes(key)) columns.push(key);
        row[key] = v instanceof Date ? v.toLocaleDateString("es-CO") : String(v ?? "").trim();
      }
      return row;
    })
    .filter((row) => Object.values(row).some(Boolean));
  if (!columns.length) throw new Error("No se encontraron encabezados en la primera fila");
  return { fileName: file.name, columns, rows };
}

/**
 * Adivina la columna por su encabezado (ej. teléfono, nombre). Con `rows` se
 * descartan las columnas vacías (formularios exportados suelen traer, por
 * ejemplo, una columna "Nombre" vacía junto a "Nombre:" con el dato).
 */
export function guessColumn(columns: string[], patterns: RegExp[], rows?: Record<string, string>[]): string | null {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const candidates = rows ? columns.filter((c) => rows.some((r) => r[c])) : columns;
  for (const re of patterns) {
    const found = candidates.find((c) => re.test(norm(c)));
    if (found) return found;
  }
  return null;
}

// ─── Armado de components por destinatario ───────────────────────────────────

/** Payload de los botones quick reply; lo interpreta wa-multi-session-backend (CAMPAIGN_TAG = "wac") */
export const buildQuickReplyPayload = (eventId: string, campaignId: string, userId: string, index: number) =>
  JSON.stringify({ t: "wac", e: eventId, c: campaignId, u: userId, b: index });

export interface BuiltMessage {
  components: any[];
  values: Record<string, string>; // slot.key → valor
  missing: string[]; // labels de slots que quedaron vacíos
}

export function buildRecipientMessage(params: {
  template: WaTemplate;
  analysis: TemplateAnalysis;
  mapping: Record<string, SlotMapping>;
  attendee: any;
  ctx: ResolveContext;
  campaignId: string;
}): BuiltMessage {
  const { template, analysis, mapping, attendee, ctx, campaignId } = params;
  const named = template.parameter_format === "NAMED";
  const values: Record<string, string> = {};
  const missing: string[] = [];

  for (const slot of analysis.slots) {
    let v = resolveSlot(mapping[slot.key], attendee, ctx);
    // Meta solo reemplaza el final de la URL del botón: si el valor es una URL
    // completa con la misma base (ej. "Link de su credencial"), se envía solo el final
    if (slot.kind === "button_url" && slot.urlPrefix && v.startsWith(slot.urlPrefix)) {
      v = v.slice(slot.urlPrefix.length);
    }
    values[slot.key] = v;
    if (!v) missing.push(slot.label);
  }

  const textParam = (slot: TemplateSlot) => ({
    type: "text",
    text: values[slot.key],
    ...(named && !/^\d+$/.test(slot.paramName) ? { parameter_name: slot.paramName } : {}),
  });

  const components: any[] = [];

  const headerText = analysis.slots.filter((s) => s.kind === "header_text");
  const headerMedia = analysis.slots.find((s) => s.kind === "header_media");
  if (headerText.length) {
    components.push({ type: "header", parameters: headerText.map(textParam) });
  } else if (headerMedia) {
    const kind = String(headerMedia.mediaFormat).toLowerCase(); // image | video | document
    components.push({ type: "header", parameters: [{ type: kind, [kind]: { link: values[headerMedia.key] } }] });
  }

  const body = analysis.slots.filter((s) => s.kind === "body");
  if (body.length) components.push({ type: "body", parameters: body.map(textParam) });

  for (const slot of analysis.slots.filter((s) => s.kind === "button_url")) {
    components.push({
      type: "button",
      sub_type: "url",
      index: String(slot.buttonIndex),
      parameters: [{ type: "text", text: values[slot.key] }],
    });
  }
  for (const qr of analysis.quickReplies) {
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: String(qr.index),
      parameters: [{ type: "payload", payload: buildQuickReplyPayload(ctx.event.id, campaignId, attendee.id, qr.index) }],
    });
  }

  return { components, values, missing };
}

/** Texto de la plantilla con las variables reemplazadas (vista previa) */
export function renderTemplatePreview(template: WaTemplate, values: Record<string, string>) {
  const fill = (text: string | undefined, prefix: string) =>
    (text || "").replace(PLACEHOLDER_RE, (_m, p) => values[`${prefix}:${p}`] || `{{${p}}}`);
  const get = (type: string) => template.components.find((c) => c.type === type);
  const header = get("HEADER");
  return {
    headerText: header?.format === "TEXT" ? fill(header.text, "header") : "",
    headerMediaUrl: header && header.format !== "TEXT" ? values.header_media || "" : "",
    headerFormat: header?.format || "",
    body: fill(get("BODY")?.text, "body"),
    footer: get("FOOTER")?.text || "",
    buttons: (get("BUTTONS")?.buttons || []).map((b) => b.text),
  };
}

// ─── Firestore ───────────────────────────────────────────────────────────────

export type WaCampaignStatus = "draft" | "queued" | "running" | "paused" | "completed";

export interface WaCampaign {
  id: string;
  name: string;
  status: WaCampaignStatus;
  template: {
    name: string;
    language: string;
    category: string;
    parameterFormat?: string;
    components: WaTemplateComponent[];
  };
  mapping: Record<string, SlotMapping>;
  quickReplies: { index: number; text: string }[];
  responseField?: string | null;
  /** "event": asistentes del evento; "import": contactos de un archivo (no registrados) */
  source?: "event" | "import";
  importInfo?: { fileName: string; rows: number; columns: string[]; phoneColumn: string; defaultCountry: string };
  filters?: Record<string, any>;
  counts: { total: number; sent?: number; failed?: number; responded?: number };
  responseCounts?: Record<string, number>;
  createdAt?: any;
  createdBy?: { uid: string; email?: string | null };
  startedAt?: any;
  completedAt?: any;
  heartbeatAt?: any;
  lastError?: string;
}

export interface WaCampaignRecipient {
  id: string;
  userId: string;
  nombre: string;
  empresa?: string;
  phone: string;
  status: "pending" | "sent" | "error";
  components: any[];
  /** Fila original del archivo (solo campañas importadas) */
  data?: Record<string, string>;
  attempts?: number;
  messageId?: string;
  sentAt?: any;
  error?: string;
  errorCode?: string | number;
  response?: { buttonIndex: number; answerText: string; receivedAt: any };
}

/**
 * Copia de los componentes de la plantilla apta para Firestore: Meta incluye
 * `example` con arrays anidados (ej. body_text: [["Juan"]]), que Firestore no
 * admite. Solo se guarda lo necesario para la vista previa.
 */
export const toStoredComponents = (components: WaTemplateComponent[] = []): WaTemplateComponent[] =>
  components.map((c) => ({
    type: c.type,
    ...(c.format ? { format: c.format } : {}),
    ...(c.text ? { text: c.text } : {}),
    ...(c.buttons
      ? { buttons: c.buttons.map((b) => ({ type: b.type, text: b.text, ...(b.url ? { url: b.url } : {}) })) }
      : {}),
  }));

export const campaignsCollection = (eventId: string) => collection(db, "events", eventId, "waCampaigns");
export const recipientsCollection = (eventId: string, campaignId: string) =>
  collection(db, "events", eventId, "waCampaigns", campaignId, "recipients");

/** Id de campaña generado en el cliente (se necesita antes de armar los payloads de botones) */
export const newCampaignRef = (eventId: string) => doc(campaignsCollection(eventId));

const BATCH_SIZE = 400;

export async function createAndQueueCampaign(params: {
  ref: DocumentReference;
  campaign: Omit<WaCampaign, "id" | "status" | "counts" | "createdAt" | "createdBy">;
  recipients: Omit<WaCampaignRecipient, "id" | "status">[];
}) {
  const { ref, campaign, recipients } = params;
  const user = auth.currentUser;

  await setDoc(ref, {
    ...campaign,
    status: "draft",
    counts: { total: recipients.length, sent: 0, failed: 0, responded: 0 },
    responseCounts: {},
    createdAt: serverTimestamp(),
    createdBy: { uid: user?.uid || "", email: user?.email || null },
  });

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    for (const r of recipients.slice(i, i + BATCH_SIZE)) {
      batch.set(doc(ref, "recipients", r.userId), {
        ...r,
        status: "pending",
        attempts: 0,
        createdAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }

  await updateDoc(ref, { status: "queued", queuedAt: serverTimestamp() });
}

const campaignDoc = (eventId: string, campaignId: string) => doc(db, "events", eventId, "waCampaigns", campaignId);

export const pauseCampaign = (eventId: string, campaignId: string) =>
  updateDoc(campaignDoc(eventId, campaignId), { status: "paused" });

export const resumeCampaign = (eventId: string, campaignId: string) =>
  updateDoc(campaignDoc(eventId, campaignId), { status: "queued", lastError: deleteField() });

/** Vuelve a "pending" los destinatarios con error y reencola la campaña */
export async function retryFailedRecipients(eventId: string, campaignId: string): Promise<number> {
  const failed = await getDocs(query(recipientsCollection(eventId, campaignId), where("status", "==", "error")));
  if (failed.empty) return 0;
  for (let i = 0; i < failed.docs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    failed.docs.slice(i, i + BATCH_SIZE).forEach((d) =>
      batch.update(d.ref, {
        status: "pending",
        attempts: 0,
        error: deleteField(),
        errorCode: deleteField(),
        lastError: deleteField(),
      })
    );
    await batch.commit();
  }
  await updateDoc(campaignDoc(eventId, campaignId), {
    "counts.failed": increment(-failed.size),
    status: "queued",
    lastError: deleteField(),
  });
  return failed.size;
}

export async function deleteCampaign(eventId: string, campaignId: string) {
  const recipients = await getDocs(recipientsCollection(eventId, campaignId));
  for (let i = 0; i < recipients.docs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    recipients.docs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  const batch = writeBatch(db);
  batch.delete(campaignDoc(eventId, campaignId));
  await batch.commit();
}

/** Una campaña "running" sin latido reciente quedó colgada (la función se cayó) */
export const isCampaignStale = (c: WaCampaign) => {
  if (c.status !== "running" || !c.heartbeatAt?.toMillis) return false;
  return Date.now() - c.heartbeatAt.toMillis() > 10 * 60 * 1000;
};

// ─── Cloud Function: listar plantillas ───────────────────────────────────────

const LIST_TEMPLATES_URL =
  (import.meta.env.VITE_WA_TEMPLATES_URL as string) || "https://listwatemplates-6eaymlz5eq-uc.a.run.app";

export async function fetchWaTemplates(eventId: string): Promise<WaTemplate[]> {
  const user = auth.currentUser;
  if (!user) throw new Error("Debes iniciar sesión como administrador");
  const token = await user.getIdToken();
  const res = await fetch(`${LIST_TEMPLATES_URL}?eventId=${encodeURIComponent(eventId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status} consultando plantillas`);
  return data.templates || [];
}

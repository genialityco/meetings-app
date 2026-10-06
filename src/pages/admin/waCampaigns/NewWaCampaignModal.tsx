import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  FileInput,
  Group,
  Loader,
  Modal,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Stepper,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../../firebase/firebaseConfig";
import { COUNTRY_CODES, detectDefaultIso2, toWhatsAppNumber } from "../../../utils/phoneUtils";
import { isComprador, isVendedor } from "../../../utils/attendeeRole";
import { formatDayLabel, getEventDayKeys, isCheckedInOnDay } from "../../../utils/eventDays";
import {
  analyzeTemplate,
  buildRecipientMessage,
  COLUMN_FIELD_PREFIX,
  createAndQueueCampaign,
  fetchWaTemplates,
  getFieldOptions,
  getPublicAppOrigin,
  guessColumn,
  ImportedFile,
  newCampaignRef,
  parseContactsFile,
  renderTemplatePreview,
  SlotMapping,
  toStoredComponents,
  WaTemplate,
} from "../../../utils/waCampaigns";
import WaMessagePreview from "./WaMessagePreview";

interface Props {
  opened: boolean;
  onClose: () => void;
  event: any;
  onCreated: (campaignId: string) => void;
}

type RoleFilter = "all" | "comprador" | "vendedor";
type CheckInFilter = "all" | "in" | "out";
type Source = "event" | "import";

const RESPONSE_FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

// Contactos importados: `__phoneRaw` es el valor de la columna de teléfono
const getAttendeePhone = (a: any) =>
  a.__phoneRaw ?? (a.telefono || a.celular || a.contacto?.telefono || a.phone || "");

// Id del destinatario: uid del asistente, o "ext_<whatsapp>" para contactos importados
const recipientIdFor = (c: { attendee: any; phone: string }) =>
  c.attendee.__row ? `ext_${c.phone}` : c.attendee.id;

const COUNTRY_OPTIONS = COUNTRY_CODES.map((c) => ({ value: c.value, label: c.label }));

export default function NewWaCampaignModal({ opened, onClose, event, onCreated }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");

  // Plantillas
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);

  // Variables
  const [mapping, setMapping] = useState<Record<string, SlotMapping>>({});
  const [responseField, setResponseField] = useState("");

  // Origen de los destinatarios: asistentes del evento o archivo importado
  const [source, setSource] = useState<Source>("event");
  const [importFile, setImportFile] = useState<ImportedFile | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [phoneColumn, setPhoneColumn] = useState<string | null>(null);
  const [nameColumn, setNameColumn] = useState<string | null>(null);
  const [companyColumn, setCompanyColumn] = useState<string | null>(null);
  const [importCountry, setImportCountry] = useState<string>("co");

  // Destinatarios
  const [attendees, setAttendees] = useState<any[]>([]);
  const [loadingAttendees, setLoadingAttendees] = useState(false);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [checkInFilter, setCheckInFilter] = useState<CheckInFilter>("all");
  const [checkInDay, setCheckInDay] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [previewAttendeeId, setPreviewAttendeeId] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const defaultIso2 = useMemo(() => detectDefaultIso2(), []);
  const dayKeys = useMemo(() => getEventDayKeys(event?.config), [event]);
  const isImport = source === "import";
  const fieldOptions = useMemo(
    () => getFieldOptions(event, isImport ? importFile?.columns || [] : undefined),
    [event, isImport, importFile]
  );
  const ctx = useMemo(() => ({ event, origin: getPublicAppOrigin() }), [event]);

  const template = templates.find((t) => t.id === templateId) || null;
  const analysis = useMemo(() => (template ? analyzeTemplate(template) : null), [template]);

  // Reiniciar al abrir
  useEffect(() => {
    if (!opened) return;
    setStep(0);
    setName("");
    setTemplateId(null);
    setMapping({});
    setResponseField("");
    setRoleFilter("all");
    setCheckInFilter("all");
    setCheckInDay(dayKeys[0] || null);
    setSearch("");
    setExcluded(new Set());
    setPreviewAttendeeId(null);
    setSubmitError(null);
    setSource("event");
    setImportFile(null);
    setImportError(null);
    setPhoneColumn(null);
    setNameColumn(null);
    setCompanyColumn(null);
    setImportCountry(defaultIso2);

    setLoadingTemplates(true);
    setTemplatesError(null);
    fetchWaTemplates(event.id)
      .then(setTemplates)
      .catch((err) => setTemplatesError(err.message))
      .finally(() => setLoadingTemplates(false));

    setLoadingAttendees(true);
    getDocs(query(collection(db, "users"), where("eventId", "==", event.id)))
      .then((snap) => setAttendees(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .finally(() => setLoadingAttendees(false));
  }, [opened, event.id]);

  // Mapeo por defecto (se recalcula si cambia la plantilla o el origen, que se
  // eligen en el paso 1): la primera variable del cuerpo suele ser el nombre
  useEffect(() => {
    if (!analysis) return;
    const nameField = isImport ? (nameColumn ? `${COLUMN_FIELD_PREFIX}${nameColumn}` : undefined) : "nombre";
    const initial: Record<string, SlotMapping> = {};
    const firstBody = analysis.slots.find((s) => s.kind === "body");
    for (const slot of analysis.slots) {
      if (slot.kind === "header_media") initial[slot.key] = { source: "fixed", value: "" };
      else if (slot === firstBody || slot.paramName === "nombre")
        initial[slot.key] = { source: "field", field: nameField, fallback: "" };
      else initial[slot.key] = { source: "field", field: undefined, fallback: "" };
    }
    setMapping(initial);
  }, [analysis, isImport, nameColumn, importFile]);

  const handleImportFile = async (file: File | null) => {
    setImportError(null);
    setImportFile(null);
    setExcluded(new Set());
    if (!file) return;
    setImporting(true);
    try {
      const parsed = await parseContactsFile(file);
      if (!parsed.rows.length) throw new Error("El archivo no tiene filas con datos");
      setImportFile(parsed);
      setPhoneColumn(guessColumn(parsed.columns, [/whats/, /celular/, /movil/, /telefono/, /phone/, /tel/], parsed.rows));
      setNameColumn(guessColumn(parsed.columns, [/^nombres?$/, /nombre/, /name/, /contacto/], parsed.rows));
      setCompanyColumn(guessColumn(parsed.columns, [/empresa/, /razon/, /company/, /compan/, /organizacion/], parsed.rows));
    } catch (err: any) {
      setImportError(err.message || "No se pudo leer el archivo");
    } finally {
      setImporting(false);
    }
  };

  // Contactos del archivo con la misma forma que un asistente (para filtros y variables)
  const importedContacts = useMemo(
    () =>
      (importFile?.rows || []).map((row, i) => ({
        id: `row_${i}`,
        nombre: nameColumn ? row[nameColumn] : "",
        empresa: companyColumn ? row[companyColumn] : "",
        __row: row,
        __phoneRaw: phoneColumn ? row[phoneColumn] : "",
      })),
    [importFile, nameColumn, companyColumn, phoneColumn]
  );

  // ─── Destinatarios ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (isImport) {
      return q
        ? importedContacts.filter((c) => Object.values(c.__row).join(" ").toLowerCase().includes(q))
        : importedContacts;
    }
    return attendees.filter((a) => {
      if (roleFilter === "comprador" && !isComprador(a.tipoAsistente)) return false;
      if (roleFilter === "vendedor" && !isVendedor(a.tipoAsistente)) return false;
      if (checkInFilter !== "all" && checkInDay) {
        const checked = isCheckedInOnDay(a, checkInDay);
        if (checkInFilter === "in" && !checked) return false;
        if (checkInFilter === "out" && checked) return false;
      }
      if (q) {
        const hay = `${a.nombre || ""} ${a.company_razonSocial || a.empresa || ""} ${a.correo || ""} ${getAttendeePhone(a)}`;
        if (!hay.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [attendees, roleFilter, checkInFilter, checkInDay, search, isImport, importedContacts]);

  // Teléfono normalizado; inválidos y duplicados (se conserva el primero) quedan fuera
  const { candidates, invalidPhone, duplicates } = useMemo(() => {
    const seen = new Set<string>();
    const candidates: { attendee: any; phone: string }[] = [];
    const invalidPhone: any[] = [];
    const duplicates: any[] = [];
    const country = isImport ? importCountry : defaultIso2;
    for (const a of filtered) {
      const phone = toWhatsAppNumber(getAttendeePhone(a), country);
      if (!phone) invalidPhone.push(a);
      else if (seen.has(phone)) duplicates.push(a);
      else {
        seen.add(phone);
        candidates.push({ attendee: a, phone });
      }
    }
    return { candidates, invalidPhone, duplicates };
  }, [filtered, defaultIso2, isImport, importCountry]);

  const selected = useMemo(() => candidates.filter((c) => !excluded.has(c.attendee.id)), [candidates, excluded]);

  // Mensajes armados (con id provisional; el definitivo se usa al crear)
  const built = useMemo(() => {
    if (!template || !analysis || step < 3) return [];
    return selected.map((c) => ({
      ...c,
      message: buildRecipientMessage({
        template,
        analysis,
        mapping,
        attendee: { ...c.attendee, id: recipientIdFor(c) },
        ctx,
        campaignId: "preview",
      }),
    }));
  }, [template, analysis, mapping, selected, ctx, step]);
  const withMissing = built.filter((b) => b.message.missing.length > 0);
  const ready = built.filter((b) => b.message.missing.length === 0);

  const previewItem = built.find((b) => b.attendee.id === previewAttendeeId) || built[0];
  const preview = template && previewItem ? renderTemplatePreview(template, previewItem.message.values) : null;

  // ─── Validaciones por paso ──────────────────────────────────────────────────
  const sourceValid = !isImport || (!!importFile && !!phoneColumn);
  const step0Valid = !!name.trim() && !!template && !!analysis && analysis.unsupported.length === 0 && sourceValid;
  const mappingErrors = useMemo(() => {
    if (!analysis) return [];
    const validFields = new Set(fieldOptions.map((f) => f.value));
    const errors: string[] = [];
    for (const slot of analysis.slots) {
      const m = mapping[slot.key];
      if (!m) errors.push(slot.label);
      else if (m.source === "fixed" && !m.value?.trim()) errors.push(slot.label);
      else if (m.source === "field" && (!m.field || !validFields.has(m.field))) errors.push(slot.label);
      else if (slot.kind === "header_media" && !/^https:\/\//i.test(m.value || "")) errors.push(`${slot.label}: URL https`);
    }
    if (!isImport && responseField && !RESPONSE_FIELD_RE.test(responseField))
      errors.push("Campo para guardar la respuesta");
    return errors;
  }, [analysis, mapping, responseField, fieldOptions, isImport]);

  const canNext = [step0Valid, mappingErrors.length === 0, selected.length > 0][step] ?? false;

  const updateMapping = (key: string, patch: Partial<SlotMapping>) =>
    setMapping((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } as SlotMapping }));

  const toggleExcluded = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ─── Envío ──────────────────────────────────────────────────────────────────
  const submit = async () => {
    if (!template || !analysis) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const ref = newCampaignRef(event.id);
      const recipients = selected
        .map((c) => {
          const id = recipientIdFor(c);
          return {
            c,
            id,
            message: buildRecipientMessage({
              template,
              analysis,
              mapping,
              attendee: { ...c.attendee, id },
              ctx,
              campaignId: ref.id,
            }),
          };
        })
        .filter(({ message }) => message.missing.length === 0)
        .map(({ c, id, message }) => ({
          userId: id,
          nombre: c.attendee.nombre || c.attendee.nombres || "",
          empresa: c.attendee.company_razonSocial || c.attendee.empresa || "",
          phone: c.phone,
          components: message.components,
          ...(c.attendee.__row ? { data: c.attendee.__row } : {}),
        }));

      await createAndQueueCampaign({
        ref,
        campaign: {
          name: name.trim(),
          template: {
            name: template.name,
            language: template.language,
            category: template.category,
            parameterFormat: template.parameter_format || "POSITIONAL",
            components: toStoredComponents(template.components),
          },
          mapping,
          quickReplies: analysis.quickReplies,
          // Los contactos importados no tienen ficha en el evento donde guardar la respuesta
          responseField:
            !isImport && analysis.quickReplies.length && responseField.trim() ? responseField.trim() : null,
          source,
          ...(isImport && importFile
            ? {
                importInfo: {
                  fileName: importFile.fileName,
                  rows: importFile.rows.length,
                  columns: importFile.columns,
                  phoneColumn: phoneColumn || "",
                  defaultCountry: importCountry,
                },
              }
            : {}),
          filters: isImport
            ? { search, excludedCount: excluded.size }
            : { roleFilter, checkInFilter, checkInDay, search, excludedCount: excluded.size },
        },
        recipients,
      });
      onCreated(ref.id);
      onClose();
    } catch (err: any) {
      console.error("Error creando campaña:", err);
      setSubmitError(err.message || "No se pudo crear la campaña");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmSubmit = () =>
    modals.openConfirmModal({
      title: "Enviar campaña",
      children: (
        <Text size="sm">
          Se enviará la plantilla <b>{template?.name}</b> a <b>{ready.length}</b> destinatario(s). Esta acción no se
          puede deshacer (sí se puede pausar).
        </Text>
      ),
      labels: { confirm: "Enviar", cancel: "Cancelar" },
      confirmProps: { color: "teal" },
      onConfirm: submit,
    });

  // ─── Render ─────────────────────────────────────────────────────────────────
  const templateOptions = templates.map((t) => ({ value: t.id, label: `${t.name} (${t.language})` }));
  const fieldSelectData = Object.entries(
    fieldOptions.reduce<Record<string, { value: string; label: string }[]>>((acc, f) => {
      (acc[f.group] ||= []).push({ value: f.value, label: f.label });
      return acc;
    }, {})
  ).map(([group, items]) => ({ group, items }));

  return (
    <Modal opened={opened} onClose={onClose} title="Nueva campaña de WhatsApp" size="xl" closeOnClickOutside={false}>
      <Stepper active={step} onStepClick={(s) => s < step && setStep(s)} size="sm">
        {/* Paso 1: plantilla */}
        <Stepper.Step label="Plantilla">
          <Stack gap="sm" mt="md">
            <TextInput
              label="Nombre de la campaña"
              placeholder="Ej. Recordatorio día 1"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              required
            />
            {loadingTemplates ? (
              <Group>
                <Loader size="sm" /> <Text size="sm">Cargando plantillas aprobadas…</Text>
              </Group>
            ) : templatesError ? (
              <Alert color="red" title="No se pudieron cargar las plantillas">
                {templatesError}
              </Alert>
            ) : (
              <Select
                label="Plantilla aprobada en Meta"
                placeholder={templates.length ? "Selecciona una plantilla" : "No hay plantillas aprobadas"}
                data={templateOptions}
                value={templateId}
                onChange={setTemplateId}
                searchable
                nothingFoundMessage="Sin resultados"
              />
            )}
            {template && analysis && (
              <>
                <Group gap="xs">
                  <Badge color={template.category === "MARKETING" ? "orange" : "blue"}>{template.category}</Badge>
                  <Badge variant="light">{template.language}</Badge>
                  <Badge variant="light">{analysis.slots.length} variable(s)</Badge>
                  {analysis.quickReplies.length > 0 && (
                    <Badge variant="light" color="teal">
                      {analysis.quickReplies.length} botón(es) de respuesta
                    </Badge>
                  )}
                </Group>
                {analysis.unsupported.length > 0 && (
                  <Alert color="red" title="Plantilla no compatible con campañas">
                    {analysis.unsupported.join(", ")}
                  </Alert>
                )}
                <WaMessagePreview preview={renderTemplatePreview(template, {})} />
              </>
            )}

            <Stack gap={6}>
              <Text size="sm" fw={600}>
                Destinatarios desde
              </Text>
              <SegmentedControl
                value={source}
                onChange={(v) => {
                  setSource(v as Source);
                  setExcluded(new Set());
                  setPreviewAttendeeId(null);
                }}
                data={[
                  { value: "event", label: "Asistentes del evento" },
                  { value: "import", label: "Archivo Excel / CSV" },
                ]}
              />
            </Stack>

            {isImport && (
              <Stack gap="xs">
                <Alert color="yellow" title="Contactos que no están registrados en el evento">
                  Envía solo a personas que aceptaron recibir mensajes de la organización. Si muchos bloquean o
                  reportan el número, Meta baja su calidad y limita los envíos, también las notificaciones de
                  reuniones de todos los eventos.
                </Alert>
                <FileInput
                  label="Archivo de contactos"
                  description="Primera hoja; la primera fila debe tener los encabezados (ej. nombre, telefono, empresa)"
                  placeholder="Selecciona un .xlsx, .xls o .csv"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleImportFile}
                  clearable
                />
                {importing && (
                  <Group>
                    <Loader size="sm" /> <Text size="sm">Leyendo archivo…</Text>
                  </Group>
                )}
                {importError && <Alert color="red">{importError}</Alert>}
                {importFile && (
                  <>
                    <Text size="xs" c="dimmed">
                      {importFile.rows.length} fila(s) · columnas: {importFile.columns.join(", ")}
                    </Text>
                    <Group grow align="flex-start">
                      <Select
                        label="Columna de WhatsApp"
                        data={importFile.columns}
                        value={phoneColumn}
                        onChange={setPhoneColumn}
                        error={!phoneColumn ? "Requerida" : null}
                      />
                      <Select
                        label="Indicativo si el número no lo trae"
                        data={COUNTRY_OPTIONS}
                        value={importCountry}
                        onChange={(v) => setImportCountry(v || "co")}
                        searchable
                      />
                    </Group>
                    <Group grow align="flex-start">
                      <Select
                        label="Columna de nombre (opcional)"
                        data={importFile.columns}
                        value={nameColumn}
                        onChange={setNameColumn}
                        clearable
                      />
                      <Select
                        label="Columna de empresa (opcional)"
                        data={importFile.columns}
                        value={companyColumn}
                        onChange={setCompanyColumn}
                        clearable
                      />
                    </Group>
                  </>
                )}
              </Stack>
            )}
          </Stack>
        </Stepper.Step>

        {/* Paso 2: variables */}
        <Stepper.Step label="Variables">
          <Stack gap="md" mt="md">
            {analysis?.slots.length === 0 && <Text size="sm">Esta plantilla no tiene variables.</Text>}
            {analysis?.slots.map((slot) => {
              const m = mapping[slot.key];
              if (!m) return null;
              if (slot.kind === "header_media") {
                return (
                  <TextInput
                    key={slot.key}
                    label={slot.label}
                    description="URL pública (https) del archivo"
                    placeholder="https://..."
                    value={m.value || ""}
                    onChange={(e) => updateMapping(slot.key, { value: e.currentTarget.value })}
                  />
                );
              }
              return (
                <Stack key={slot.key} gap={4}>
                  <Group justify="space-between">
                    <Text size="sm" fw={600}>
                      {slot.label}
                    </Text>
                    <SegmentedControl
                      size="xs"
                      value={m.source}
                      onChange={(v) => updateMapping(slot.key, { source: v as SlotMapping["source"] })}
                      data={[
                        { value: "field", label: "Campo" },
                        { value: "fixed", label: "Texto fijo" },
                      ]}
                    />
                  </Group>
                  {m.source === "field" ? (
                    <Group grow align="flex-start">
                      <Select
                        placeholder={isImport ? "Columna del archivo" : "Campo del asistente"}
                        data={fieldSelectData}
                        value={m.field || null}
                        onChange={(v) => updateMapping(slot.key, { field: v || undefined })}
                        searchable
                      />
                      <TextInput
                        placeholder="Valor si está vacío (opcional)"
                        value={m.fallback || ""}
                        onChange={(e) => updateMapping(slot.key, { fallback: e.currentTarget.value })}
                      />
                    </Group>
                  ) : (
                    <TextInput
                      placeholder="Texto que verán todos"
                      value={m.value || ""}
                      onChange={(e) => updateMapping(slot.key, { value: e.currentTarget.value })}
                    />
                  )}
                </Stack>
              );
            })}
            {analysis && analysis.quickReplies.length > 0 && isImport && (
              <Text size="xs" c="dimmed">
                Botones: {analysis.quickReplies.map((q) => q.text).join(" · ")}. Las respuestas quedan en la campaña
                (detalle y Excel).
              </Text>
            )}
            {analysis && analysis.quickReplies.length > 0 && !isImport && (
              <TextInput
                label="Guardar la respuesta en un campo del asistente (opcional)"
                description={`Botones: ${analysis.quickReplies.map((q) => q.text).join(" · ")}. La respuesta siempre queda en la campaña; si indicas un campo (ej. encuestaValorNegocio) también se guarda en el asistente y puedes verla en la tabla de asistentes.`}
                placeholder="encuestaValorNegocio"
                value={responseField}
                onChange={(e) => setResponseField(e.currentTarget.value.trim())}
                error={responseField && !RESPONSE_FIELD_RE.test(responseField) ? "Solo letras, números, _ y puntos" : null}
              />
            )}
          </Stack>
        </Stepper.Step>

        {/* Paso 3: destinatarios */}
        <Stepper.Step label="Destinatarios">
          <Stack gap="sm" mt="md">
            {loadingAttendees && !isImport ? (
              <Group>
                <Loader size="sm" /> <Text size="sm">Cargando asistentes…</Text>
              </Group>
            ) : (
              <>
                {isImport ? (
                  <TextInput
                    label="Buscar"
                    placeholder="Cualquier dato del archivo…"
                    value={search}
                    onChange={(e) => setSearch(e.currentTarget.value)}
                  />
                ) : (
                <Group grow align="flex-end">
                  <Select
                    label="Rol"
                    value={roleFilter}
                    onChange={(v) => setRoleFilter((v as RoleFilter) || "all")}
                    data={[
                      { value: "all", label: "Todos" },
                      { value: "comprador", label: "Compradores" },
                      { value: "vendedor", label: "Vendedores" },
                    ]}
                  />
                  <Select
                    label="Check-in"
                    value={checkInFilter}
                    onChange={(v) => setCheckInFilter((v as CheckInFilter) || "all")}
                    data={[
                      { value: "all", label: "Todos" },
                      { value: "in", label: "Con check-in" },
                      { value: "out", label: "Sin check-in" },
                    ]}
                  />
                  {checkInFilter !== "all" && dayKeys.length > 1 && (
                    <Select
                      label="Día"
                      value={checkInDay}
                      onChange={setCheckInDay}
                      data={dayKeys.map((d, i) => ({ value: d, label: formatDayLabel(d, i) }))}
                    />
                  )}
                  <TextInput
                    label="Buscar"
                    placeholder="Nombre, empresa, correo…"
                    value={search}
                    onChange={(e) => setSearch(e.currentTarget.value)}
                  />
                </Group>
                )}

                <Group gap="xs">
                  <Badge color="teal">{selected.length} seleccionados</Badge>
                  <Badge variant="light">{filtered.length} con los filtros</Badge>
                  {invalidPhone.length > 0 && (
                    <Badge color="red" variant="light">
                      {invalidPhone.length} sin teléfono válido
                    </Badge>
                  )}
                  {duplicates.length > 0 && (
                    <Badge color="yellow" variant="light">
                      {duplicates.length} teléfono repetido
                    </Badge>
                  )}
                  <Button size="compact-xs" variant="subtle" onClick={() => setExcluded(new Set())}>
                    Seleccionar todos
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => setExcluded(new Set(candidates.map((c) => c.attendee.id)))}
                  >
                    Ninguno
                  </Button>
                </Group>

                <ScrollArea h={320}>
                  <Table striped stickyHeader>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th />
                        <Table.Th>Nombre</Table.Th>
                        <Table.Th>Empresa</Table.Th>
                        <Table.Th>WhatsApp</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {candidates.map(({ attendee, phone }) => (
                        <Table.Tr key={attendee.id}>
                          <Table.Td>
                            <Checkbox
                              checked={!excluded.has(attendee.id)}
                              onChange={() => toggleExcluded(attendee.id)}
                            />
                          </Table.Td>
                          <Table.Td>{attendee.nombre || attendee.nombres || attendee.id}</Table.Td>
                          <Table.Td>{attendee.company_razonSocial || attendee.empresa || "-"}</Table.Td>
                          <Table.Td>+{phone}</Table.Td>
                        </Table.Tr>
                      ))}
                      {[...invalidPhone, ...duplicates].map((a) => (
                        <Table.Tr key={`x-${a.id}`} style={{ opacity: 0.5 }}>
                          <Table.Td />
                          <Table.Td>{a.nombre || a.nombres || a.id}</Table.Td>
                          <Table.Td>{a.company_razonSocial || a.empresa || "-"}</Table.Td>
                          <Table.Td>
                            {getAttendeePhone(a) || "Sin teléfono"}{" "}
                            <Badge size="xs" color={invalidPhone.includes(a) ? "red" : "yellow"}>
                              {invalidPhone.includes(a) ? "inválido" : "repetido"}
                            </Badge>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </>
            )}
          </Stack>
        </Stepper.Step>

        {/* Paso 4: confirmar */}
        <Stepper.Step label="Confirmar">
          <Stack gap="sm" mt="md">
            <Group gap="xs">
              <Badge size="lg" color="teal">
                {ready.length} se enviarán
              </Badge>
              {withMissing.length > 0 && (
                <Badge size="lg" color="orange" variant="light">
                  {withMissing.length} excluidos por variables vacías
                </Badge>
              )}
              {template && <Badge variant="light">{template.name}</Badge>}
            </Group>
            {template?.category === "MARKETING" && (
              <Alert color="orange" title="Plantilla de marketing">
                Meta limita cuántos mensajes de marketing recibe cada usuario; algunos envíos pueden fallar con el
                error 131049 aunque el número sea válido.
              </Alert>
            )}
            {withMissing.length > 0 && (
              <Alert color="orange" title="Destinatarios sin datos para alguna variable">
                {withMissing
                  .slice(0, 5)
                  .map((b) => `${b.attendee.nombre || b.attendee.id} (${b.message.missing.join(", ")})`)
                  .join(" · ")}
                {withMissing.length > 5 && ` y ${withMissing.length - 5} más`}. Agrega un “valor si está vacío” en el
                paso de variables para incluirlos.
              </Alert>
            )}
            {built.length > 0 && (
              <Select
                label="Vista previa para"
                value={previewItem?.attendee.id || null}
                onChange={setPreviewAttendeeId}
                data={built.map((b) => ({ value: b.attendee.id, label: b.attendee.nombre || `+${b.phone}` }))}
                searchable
              />
            )}
            {preview && <WaMessagePreview preview={preview} />}
            {submitError && <Alert color="red">{submitError}</Alert>}
          </Stack>
        </Stepper.Step>
      </Stepper>

      <Group justify="space-between" mt="lg">
        <Button variant="default" onClick={() => (step === 0 ? onClose() : setStep(step - 1))} disabled={submitting}>
          {step === 0 ? "Cancelar" : "Atrás"}
        </Button>
        {step < 3 ? (
          <Button onClick={() => setStep(step + 1)} disabled={!canNext}>
            Siguiente
          </Button>
        ) : (
          <Button color="teal" onClick={confirmSubmit} loading={submitting} disabled={ready.length === 0}>
            Enviar a {ready.length}
          </Button>
        )}
      </Group>
      {step === 1 && mappingErrors.length > 0 && (
        <Text size="xs" c="dimmed" ta="right" mt={4}>
          Falta completar: {mappingErrors.join(", ")}
        </Text>
      )}
    </Modal>
  );
}

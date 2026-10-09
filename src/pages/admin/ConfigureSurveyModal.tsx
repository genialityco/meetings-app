import { useState, useEffect } from "react";
import {
  Modal, Stack, Text, Button, Group, TextInput, Select,
  Paper, ActionIcon, Divider, Switch, Badge, Tabs,
  Alert, Checkbox, Collapse, Textarea,
} from "@mantine/core";
import { IconPlus, IconTrash, IconGripVertical, IconFileImport } from "@tabler/icons-react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";

export interface SurveyField {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "rating";
  required: boolean;
  options?: string[];
  isDefault?: boolean;
}

export const DEFAULT_SURVEY_FIELDS: SurveyField[] = [
  { name: "value", label: "Valor estimado del negocio", type: "text", required: true, isDefault: true },
  { name: "comments", label: "Comentarios", type: "textarea", required: false, isDefault: true },
];

const TYPE_LABELS: Record<SurveyField["type"], string> = {
  text: "Texto", textarea: "Área de texto", number: "Número",
  select: "Selección", rating: "Calificación (1-5)",
};

const TYPE_OPTIONS = [
  { value: "text", label: "Texto" },
  { value: "textarea", label: "Área de texto" },
  { value: "number", label: "Número" },
  { value: "select", label: "Selección" },
  { value: "rating", label: "Calificación (1-5)" },
];

/** Opciones del Select de un campo "rating": 1..N con etiqueta si el campo trae
 * `options` (escala con nombres, ej. "Nada probable" … "Muy probable"); si no, 1-5 ⭐.
 * El valor guardado siempre es el número ("1".."N"). */
export function getRatingData(field: Pick<SurveyField, "options">) {
  if (field.options?.length) {
    return field.options.map((label, i) => ({ value: String(i + 1), label: `${i + 1} - ${label}` }));
  }
  return ["1", "2", "3", "4", "5"].map((n) => ({ value: n, label: `${n} ⭐` }));
}

// Campos con nombre fijo: el listado /admin/surveys y los exports leen value/comments
const RESERVED_IDS: Record<string, string> = {
  value: "value",
  valor_estimado: "value",
  valor_estimado_negocio: "value",
  comments: "comments",
  comentarios: "comments",
};

/**
 * Convierte una encuesta en JSON ({ questions: [{ id, type, text, options?, required? }] })
 * a campos de la encuesta por reunión. Tipos: single_choice/select → Selección,
 * scale/rating → Calificación (con etiquetas), open_text/text → Texto (Área de texto
 * para comentarios), long_text/textarea → Área de texto, number → Número.
 */
export function parseSurveyJson(text: string): SurveyField[] {
  const data = JSON.parse(text);
  const questions = Array.isArray(data) ? data : data?.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("El JSON debe tener un arreglo \"questions\" con al menos una pregunta.");
  }
  const used = new Set<string>();
  return questions.map((q: any, i: number) => {
    const label = String(q.text || q.label || "").trim();
    if (!label) throw new Error(`La pregunta ${i + 1} no tiene texto.`);
    const rawId = String(q.id || q.name || label)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
    let name = RESERVED_IDS[rawId] || rawId || `pregunta_${i + 1}`;
    if (used.has(name)) name = `${name}_${i + 1}`;
    used.add(name);

    const t = String(q.type || "open_text").toLowerCase();
    const options: string[] = Array.isArray(q.options) ? q.options.map((o: any) => String(o).trim()).filter(Boolean) : [];
    let type: SurveyField["type"];
    if (["single_choice", "select", "choice"].includes(t)) type = "select";
    else if (["scale", "rating", "likert"].includes(t)) type = "rating";
    else if (["number", "numeric"].includes(t)) type = "number";
    else if (["long_text", "textarea", "paragraph"].includes(t) || name === "comments") type = "textarea";
    else type = "text";
    if (type === "select" && options.length === 0) {
      throw new Error(`La pregunta "${label}" es de selección pero no tiene opciones.`);
    }

    const field: SurveyField = { name, label, type, required: q.required === true };
    if ((type === "select" || type === "rating") && options.length) field.options = options;
    if (name === "value" || name === "comments") field.isDefault = true;
    return field;
  });
}

interface Props {
  opened: boolean;
  onClose: () => void;
  event: any;
  refreshEvents: () => void;
  setGlobalMessage: (msg: string) => void;
  inline?: boolean;
}

export function FieldEditor({
  fields,
  setFields,
}: {
  fields: SurveyField[];
  setFields: React.Dispatch<React.SetStateAction<SurveyField[]>>;
}) {
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<SurveyField["type"]>("text");
  const [newOptions, setNewOptions] = useState("Opción 1, Opción 2");
  const [newRequired, setNewRequired] = useState(false);
  const [newScaleLabels, setNewScaleLabels] = useState("");

  const handleAdd = () => {
    if (!newLabel.trim()) return;
    const name =
      "survey_" +
      newLabel.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").substring(0, 25) +
      "_" + Math.floor(Math.random() * 10000);
    const field: SurveyField = { name, label: newLabel.trim(), type: newType, required: newRequired };
    if (newType === "select") {
      field.options = newOptions.split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (newType === "rating") {
      // Etiquetas opcionales de la escala (sin ellas: 1-5 ⭐)
      const labels = newScaleLabels.split(",").map((s) => s.trim()).filter(Boolean);
      if (labels.length) field.options = labels;
    }
    setFields((prev) => [...prev, field]);
    setNewLabel(""); setNewType("text"); setNewOptions("Opción 1, Opción 2"); setNewScaleLabels(""); setNewRequired(false);
  };

  const move = (idx: number, dir: -1 | 1) => {
    setFields((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  return (
    <Stack gap="sm">
      <Paper withBorder p="sm">
        <Stack gap={4}>
          {fields.map((field, idx) => (
            <div key={field.name} style={{ display: "grid", gridTemplateColumns: "20px 1fr auto auto auto", gap: 6, alignItems: "center", padding: "4px 2px", borderBottom: "1px solid #f1f3f5" }}>
              <IconGripVertical size={14} color="#adb5bd" />
              <TextInput
                value={field.label}
                onChange={(e) => setFields((prev) => prev.map((f) => f.name === field.name ? { ...f, label: e.currentTarget.value } : f))}
                size="xs"
                rightSection={<Badge size="xs" variant="light" color="gray" style={{ whiteSpace: "nowrap" }}>{TYPE_LABELS[field.type]}</Badge>}
                rightSectionWidth={100}
              />
              <Switch
                size="xs"
                label="Req."
                checked={field.required}
                onChange={(e) => setFields((prev) => prev.map((f) => f.name === field.name ? { ...f, required: e.currentTarget.checked } : f))}
              />
              <Group gap={2}>
                <ActionIcon size="xs" variant="subtle" onClick={() => move(idx, -1)} disabled={idx === 0}>▲</ActionIcon>
                <ActionIcon size="xs" variant="subtle" onClick={() => move(idx, 1)} disabled={idx === fields.length - 1}>▼</ActionIcon>
              </Group>
              <ActionIcon size="sm" color="red" variant="light" onClick={() => setFields((prev) => prev.filter((f) => f.name !== field.name))} disabled={!!field.isDefault} title={field.isDefault ? "Campo por defecto" : "Eliminar"}>
                <IconTrash size={13} />
              </ActionIcon>
              {!!field.options?.length && (
                <Text size="xs" c="dimmed" style={{ gridColumn: "2 / -1", marginTop: -2 }}>
                  {field.type === "rating"
                    ? getRatingData(field).map((o) => o.label).join(" · ")
                    : `Opciones: ${field.options.join(" · ")}`}
                </Text>
              )}
            </div>
          ))}
        </Stack>
      </Paper>

      <Divider label="Agregar campo" labelPosition="left" />
      <Group align="flex-end" gap="xs">
        <TextInput label="Etiqueta" placeholder="Ej: Probabilidad de cierre" value={newLabel} onChange={(e) => setNewLabel(e.currentTarget.value)} style={{ flex: 1 }} size="xs" />
        <Select label="Tipo" value={newType} onChange={(v) => setNewType((v as SurveyField["type"]) || "text")} data={TYPE_OPTIONS} size="xs" style={{ width: 150 }} />
        <Switch label="Requerido" checked={newRequired} onChange={(e) => setNewRequired(e.currentTarget.checked)} size="xs" />
        <ActionIcon color="blue" variant="filled" onClick={handleAdd} title="Agregar" style={{ marginBottom: 1 }}>
          <IconPlus size={16} />
        </ActionIcon>
      </Group>
      {newType === "select" && (
        <TextInput label="Opciones (separadas por coma)" placeholder="Opción 1, Opción 2" value={newOptions} onChange={(e) => setNewOptions(e.currentTarget.value)} size="xs" />
      )}
      {newType === "rating" && (
        <TextInput
          label="Etiquetas de la escala (opcional, separadas por coma)"
          description="Ej: Nada probable, Poco probable, Moderadamente probable, Probable, Muy probable. Vacío = 1 a 5 estrellas."
          placeholder="Nada probable, Poco probable, …"
          value={newScaleLabels}
          onChange={(e) => setNewScaleLabels(e.currentTarget.value)}
          size="xs"
        />
      )}
    </Stack>
  );
}

export default function ConfigureSurveyModal({ opened, onClose, event, refreshEvents, setGlobalMessage, inline = false }: Props) {
  const [compradorFields, setCompradorFields] = useState<SurveyField[]>(DEFAULT_SURVEY_FIELDS);
  const [vendedorFields, setVendedorFields] = useState<SurveyField[]>(DEFAULT_SURVEY_FIELDS);
  const [saving, setSaving] = useState(false);
  const [activeRole, setActiveRole] = useState<string | null>("comprador");
  // Importar desde JSON
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importTarget, setImportTarget] = useState<"ambos" | "comprador" | "vendedor">("ambos");
  const [importError, setImportError] = useState<string | null>(null);

  const surveyModeIsCustom = event?.config?.policies?.surveyMode === "custom";
  const [activateCustomMode, setActivateCustomMode] = useState(true);

  useEffect(() => {
    if (!opened) return;
    const cfg = event?.config?.surveyConfig;
    setCompradorFields(cfg?.compradorFields?.length ? cfg.compradorFields : DEFAULT_SURVEY_FIELDS);
    setVendedorFields(cfg?.vendedorFields?.length ? cfg.vendedorFields : DEFAULT_SURVEY_FIELDS);
  }, [opened, event]);

  let importPreview: SurveyField[] | null = null;
  let importPreviewError: string | null = null;
  if (importText.trim()) {
    try {
      importPreview = parseSurveyJson(importText);
    } catch (e: any) {
      importPreviewError = e instanceof SyntaxError ? "JSON inválido: revisa comas, comillas y llaves." : e.message;
    }
  }

  const handleImport = () => {
    if (!importPreview) {
      setImportError(importPreviewError || "Pega el JSON de la encuesta.");
      return;
    }
    if (importTarget !== "vendedor") setCompradorFields(importPreview);
    if (importTarget !== "comprador") setVendedorFields(importPreview);
    if (importTarget !== "ambos") setActiveRole(importTarget);
    setImportOpen(false);
    setImportText("");
    setImportError(null);
    setGlobalMessage(
      `Se cargaron ${importPreview.length} preguntas. Revisa y pulsa "Guardar encuesta" para aplicarlas.`
    );
  };

  const handleSave = async () => {
    if (!event?.id) return;
    setSaving(true);
    try {
      const update: Record<string, any> = {
        "config.surveyConfig": { compradorFields, vendedorFields },
      };
      // La encuesta personalizada solo se usa con surveyMode "custom"
      if (!surveyModeIsCustom && activateCustomMode) update["config.policies.surveyMode"] = "custom";
      await updateDoc(doc(db, "events", event.id), update);
      setGlobalMessage("Configuración de encuesta guardada.");
      refreshEvents();
      if (!inline) onClose();
    } catch (e) {
      console.error(e);
      setGlobalMessage("Error al guardar encuesta.");
    } finally {
      setSaving(false);
    }
  };

  const content = (
      <Stack>
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Text size="sm" c="dimmed">
            Define campos independientes para compradores y vendedores. Solo aplica cuando el modo de encuesta es "Personalizada" en las políticas.
          </Text>
          <Button
            size="xs"
            variant="light"
            leftSection={<IconFileImport size={14} />}
            onClick={() => setImportOpen((v) => !v)}
            style={{ flexShrink: 0 }}
          >
            Importar desde JSON
          </Button>
        </Group>

        {!surveyModeIsCustom && (
          <Alert color="yellow" variant="light" p="sm">
            <Text size="sm" mb={6}>
              El modo de encuesta del evento está en <b>"Por defecto"</b>: los asistentes verán solo "Valor estimado" y
              "Comentarios", no esta encuesta.
            </Text>
            <Checkbox
              size="xs"
              label='Cambiar el modo a "Personalizada por rol" al guardar'
              checked={activateCustomMode}
              onChange={(e) => setActivateCustomMode(e.currentTarget.checked)}
            />
          </Alert>
        )}

        <Collapse in={importOpen}>
          <Paper withBorder p="sm" radius="md" bg="gray.0">
            <Stack gap="xs">
              <Textarea
                label="JSON de la encuesta"
                description='Formato: { "questions": [{ "id", "type": "single_choice" | "scale" | "open_text" | "number", "text", "options", "required" }] }'
                placeholder='{ "questions": [ ... ] }'
                autosize
                minRows={5}
                maxRows={14}
                value={importText}
                onChange={(e) => {
                  setImportText(e.currentTarget.value);
                  setImportError(null);
                }}
                styles={{ input: { fontFamily: "monospace", fontSize: 12 } }}
                error={importError || (importText.trim() ? importPreviewError : null)}
              />
              {importPreview && (
                <Text size="xs" c="teal.8">
                  {importPreview.length} preguntas detectadas:{" "}
                  {importPreview.map((f) => `${f.label} (${TYPE_LABELS[f.type]}${f.required ? ", requerida" : ""})`).join(" · ")}
                </Text>
              )}
              <Group justify="space-between" align="flex-end">
                <Select
                  size="xs"
                  label="Aplicar a"
                  data={[
                    { value: "ambos", label: "Compradores y vendedores" },
                    { value: "comprador", label: "Solo compradores" },
                    { value: "vendedor", label: "Solo vendedores" },
                  ]}
                  value={importTarget}
                  onChange={(v) => setImportTarget((v as typeof importTarget) || "ambos")}
                  allowDeselect={false}
                  w={220}
                />
                <Group gap="xs">
                  <Button size="xs" variant="default" onClick={() => setImportOpen(false)}>
                    Cancelar
                  </Button>
                  <Button size="xs" onClick={handleImport} disabled={!importPreview}>
                    Reemplazar campos
                  </Button>
                </Group>
              </Group>
            </Stack>
          </Paper>
        </Collapse>

        <Tabs value={activeRole} onChange={setActiveRole}>
          <Tabs.List>
            <Tabs.Tab value="comprador">Comprador</Tabs.Tab>
            <Tabs.Tab value="vendedor">Vendedor</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="comprador" pt="md">
            <FieldEditor fields={compradorFields} setFields={setCompradorFields} />
          </Tabs.Panel>
          <Tabs.Panel value="vendedor" pt="md">
            <FieldEditor fields={vendedorFields} setFields={setVendedorFields} />
          </Tabs.Panel>
        </Tabs>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={onClose}>Cancelar</Button>
          <Button loading={saving} onClick={handleSave}>Guardar encuesta</Button>
        </Group>
      </Stack>
  );

  if (inline) return content;
  return (
    <Modal opened={opened} onClose={onClose} title="Configurar encuesta por rol" size="lg">
      {content}
    </Modal>
  );
}

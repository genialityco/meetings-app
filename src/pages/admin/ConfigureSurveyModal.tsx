import { useState, useEffect } from "react";
import {
  Modal, Stack, Text, Button, Group, TextInput, Select,
  Paper, ActionIcon, Divider, Switch, Badge, Tabs,
} from "@mantine/core";
import { IconPlus, IconTrash, IconGripVertical } from "@tabler/icons-react";
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

interface Props {
  opened: boolean;
  onClose: () => void;
  event: any;
  refreshEvents: () => void;
  setGlobalMessage: (msg: string) => void;
}

function FieldEditor({
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
    setFields((prev) => [...prev, field]);
    setNewLabel(""); setNewType("text"); setNewOptions("Opción 1, Opción 2"); setNewRequired(false);
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
    </Stack>
  );
}

export default function ConfigureSurveyModal({ opened, onClose, event, refreshEvents, setGlobalMessage }: Props) {
  const [compradorFields, setCompradorFields] = useState<SurveyField[]>(DEFAULT_SURVEY_FIELDS);
  const [vendedorFields, setVendedorFields] = useState<SurveyField[]>(DEFAULT_SURVEY_FIELDS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!opened) return;
    const cfg = event?.config?.surveyConfig;
    setCompradorFields(cfg?.compradorFields?.length ? cfg.compradorFields : DEFAULT_SURVEY_FIELDS);
    setVendedorFields(cfg?.vendedorFields?.length ? cfg.vendedorFields : DEFAULT_SURVEY_FIELDS);
  }, [opened, event]);

  const handleSave = async () => {
    if (!event?.id) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "events", event.id), {
        "config.surveyConfig": { compradorFields, vendedorFields },
      });
      setGlobalMessage("Configuración de encuesta guardada.");
      refreshEvents();
      onClose();
    } catch (e) {
      console.error(e);
      setGlobalMessage("Error al guardar encuesta.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Configurar encuesta por rol" size="lg">
      <Stack>
        <Text size="sm" c="dimmed">
          Define campos independientes para compradores y vendedores. Solo aplica cuando el modo de encuesta es "Personalizada" en las políticas.
        </Text>
        <Tabs defaultValue="comprador">
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
          <Button loading={saving} onClick={handleSave}>Guardar</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

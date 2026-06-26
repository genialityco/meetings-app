import { useState, useEffect } from "react";
import {
  Modal, Stack, Text, Button, Group, TextInput, Textarea, Switch, Paper,
} from "@mantine/core";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { FieldEditor, SurveyField } from "./ConfigureSurveyModal";

/** Campos por defecto de la encuesta global del evento */
export const DEFAULT_EVENT_SURVEY_FIELDS: SurveyField[] = [
  { name: "overall_rating", label: "Calificación general del evento", type: "rating", required: true },
  { name: "comments", label: "Comentarios y sugerencias", type: "textarea", required: false },
];

const DEFAULT_TITLE = "Encuesta de satisfacción del evento";
const DEFAULT_DESCRIPTION =
  "Ayúdanos a mejorar respondiendo esta breve encuesta sobre tu experiencia en el evento.";

interface Props {
  opened: boolean;
  onClose: () => void;
  event: any;
  refreshEvents: () => void;
  setGlobalMessage: (msg: string) => void;
  inline?: boolean;
}

export default function ConfigureEventSurveyModal({
  opened, onClose, event, refreshEvents, setGlobalMessage, inline = false,
}: Props) {
  const [enabled, setEnabled] = useState(false);
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [fields, setFields] = useState<SurveyField[]>(DEFAULT_EVENT_SURVEY_FIELDS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!opened) return;
    const cfg = event?.config?.eventSurvey;
    setEnabled(!!cfg?.enabled);
    setTitle(cfg?.title || DEFAULT_TITLE);
    setDescription(cfg?.description || DEFAULT_DESCRIPTION);
    setFields(cfg?.fields?.length ? cfg.fields : DEFAULT_EVENT_SURVEY_FIELDS);
  }, [opened, event]);

  const handleSave = async () => {
    if (!event?.id) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "events", event.id), {
        "config.eventSurvey": { enabled, title, description, fields },
      });
      setGlobalMessage("Encuesta del evento guardada.");
      refreshEvents();
      if (!inline) onClose();
    } catch (e) {
      console.error(e);
      setGlobalMessage("Error al guardar la encuesta del evento.");
    } finally {
      setSaving(false);
    }
  };

  const content = (
    <Stack>
      <Paper withBorder p="sm" radius="md">
        <Switch
          checked={enabled}
          onChange={(e) => setEnabled(e.currentTarget.checked)}
          label="Mostrar la sección de encuesta del evento en el dashboard del asistente"
        />
      </Paper>

      <TextInput
        label="Título"
        value={title}
        onChange={(e) => setTitle(e.currentTarget.value)}
        placeholder={DEFAULT_TITLE}
      />
      <Textarea
        label="Descripción"
        value={description}
        onChange={(e) => setDescription(e.currentTarget.value)}
        placeholder={DEFAULT_DESCRIPTION}
        minRows={2}
        autosize
      />

      <Text size="sm" fw={600} mt="xs">Campos de la encuesta</Text>
      <FieldEditor fields={fields} setFields={setFields} />

      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onClose}>Cancelar</Button>
        <Button loading={saving} onClick={handleSave}>Guardar encuesta del evento</Button>
      </Group>
    </Stack>
  );

  if (inline) return content;
  return (
    <Modal opened={opened} onClose={onClose} title="Encuesta de satisfacción del evento" size="lg">
      {content}
    </Modal>
  );
}

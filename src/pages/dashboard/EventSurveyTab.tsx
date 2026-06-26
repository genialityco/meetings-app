import { useState, useEffect } from "react";
import {
  Paper, Stack, Title, Text, Button, Group, TextInput, Textarea,
  Select, Loader, Alert, Box, ThemeIcon,
} from "@mantine/core";
import { IconStar, IconCircleCheck } from "@tabler/icons-react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { showNotification } from "@mantine/notifications";
import { EventSurveyConfig, EventSurveyField } from "./types";

interface EventSurveyTabProps {
  eventId: string;
  uid: string;
  currentUser?: any;
  eventConfig?: { eventSurvey?: EventSurveyConfig };
}

export default function EventSurveyTab({
  eventId, uid, currentUser, eventConfig,
}: EventSurveyTabProps) {
  const survey = eventConfig?.eventSurvey;
  const fields: EventSurveyField[] = survey?.fields || [];

  const [values, setValues] = useState<Record<string, string>>({});
  const [existing, setExisting] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const docId = `${eventId}_${uid}`;

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, "eventSurveys", docId));
        if (!active) return;
        if (snap.exists()) {
          const data = snap.data();
          setExisting(data);
          const vals: Record<string, string> = {};
          fields.forEach((f) => { vals[f.name] = data[f.name] ?? ""; });
          setValues(vals);
        } else {
          setExisting(null);
          setValues({});
        }
      } catch (err) {
        console.error("Error cargando encuesta del evento:", err);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const setField = (name: string, v: string) =>
    setValues((prev) => ({ ...prev, [name]: v }));

  const missingRequired = fields
    .filter((f) => f.required)
    .some((f) => !String(values[f.name] ?? "").trim());

  const handleSave = async () => {
    setSaving(true);
    try {
      const info = currentUser?.data || {};
      const payload: Record<string, any> = {
        eventId,
        userId: uid,
        userName: info.nombre || "",
        userEmpresa: info.empresa || "",
        updatedAt: new Date(),
        ...(existing?.createdAt ? {} : { createdAt: new Date() }),
        ...values,
      };
      await setDoc(doc(db, "eventSurveys", docId), payload, { merge: true });
      setExisting(payload);
      setEditing(false);
      showNotification({
        title: "¡Gracias!",
        message: "Tu encuesta del evento fue registrada.",
        color: "teal",
      });
    } catch (err) {
      console.error("Error guardando encuesta del evento:", err);
      showNotification({
        title: "Error",
        message: "No se pudo guardar tu encuesta. Intenta de nuevo.",
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  };

  // Sección deshabilitada por el admin
  if (!survey?.enabled) {
    return (
      <Paper withBorder radius="lg" p="lg" mt="md">
        <Text c="dimmed" ta="center">
          La encuesta del evento no está disponible en este momento.
        </Text>
      </Paper>
    );
  }

  if (loading) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    );
  }

  const renderField = (field: EventSurveyField, readOnly: boolean) => {
    const val = values[field.name] ?? "";
    if (readOnly) {
      return (
        <Paper key={field.name} withBorder radius="md" p="sm">
          <Text size="sm">
            <Text span fw={600}>{field.label}:</Text>{" "}
            {existing?.[field.name] ? String(existing[field.name]) : "-"}
          </Text>
        </Paper>
      );
    }
    if (field.type === "textarea") {
      return (
        <Textarea
          key={field.name}
          label={field.label}
          value={val}
          onChange={(e) => setField(field.name, e.currentTarget.value)}
          minRows={3}
          autosize
          required={field.required}
          radius="md"
        />
      );
    }
    if (field.type === "select" && field.options?.length) {
      return (
        <Select
          key={field.name}
          label={field.label}
          value={val}
          onChange={(v) => setField(field.name, v || "")}
          data={field.options.map((o) => ({ value: o, label: o }))}
          required={field.required}
          radius="md"
        />
      );
    }
    if (field.type === "rating") {
      return (
        <Select
          key={field.name}
          label={field.label}
          value={val}
          onChange={(v) => setField(field.name, v || "")}
          data={["1", "2", "3", "4", "5"].map((n) => ({ value: n, label: `${n} ⭐` }))}
          required={field.required}
          radius="md"
        />
      );
    }
    return (
      <TextInput
        key={field.name}
        label={field.label}
        value={val}
        onChange={(e) => setField(field.name, e.currentTarget.value)}
        type={field.type === "number" ? "number" : "text"}
        required={field.required}
        radius="md"
      />
    );
  };

  const alreadyAnswered = !!existing && !editing;

  return (
    <Paper withBorder radius="lg" p="lg" mt="md">
      <Stack gap="md">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon variant="light" radius="xl" size={40} color="yellow">
            <IconStar size={22} />
          </ThemeIcon>
          <Box>
            <Title order={4}>{survey.title || "Encuesta de satisfacción del evento"}</Title>
            {survey.description && (
              <Text size="sm" c="dimmed">{survey.description}</Text>
            )}
          </Box>
        </Group>

        {fields.length === 0 ? (
          <Text c="dimmed" ta="center" py="md">
            La encuesta aún no tiene campos configurados.
          </Text>
        ) : alreadyAnswered ? (
          <Stack gap="md">
            <Alert color="teal" variant="light" icon={<IconCircleCheck size={18} />}>
              Ya completaste esta encuesta. ¡Gracias por tu retroalimentación!
            </Alert>
            {fields.map((f) => renderField(f, true))}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setEditing(true)}>
                Editar respuestas
              </Button>
            </Group>
          </Stack>
        ) : (
          <Stack gap="md">
            {fields.map((f) => renderField(f, false))}
            <Group justify="flex-end" mt="xs">
              {editing && (
                <Button variant="default" onClick={() => setEditing(false)}>
                  Cancelar
                </Button>
              )}
              <Button loading={saving} onClick={handleSave} disabled={missingRequired}>
                {existing ? "Actualizar encuesta" : "Enviar encuesta"}
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

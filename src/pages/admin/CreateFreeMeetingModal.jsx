import { useState, useEffect, useMemo } from "react";
import {
  Modal,
  Select,
  Button,
  Text,
  Badge,
  Stack,
  Paper,
  Checkbox,
  Alert,
  Group,
} from "@mantine/core";

const addMinutes = (time, mins) => {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

const CreateFreeMeetingModal = ({
  opened,
  onClose,
  fixedAttendee = null,
  timeSlot: initialTimeSlot = "",
  assistants = [],
  getAffinity,
  onCreate,
  loading,
  timeSlots = [],
  meetingDuration = 30,
}) => {
  const [user1, setUser1] = useState("");
  const [user2, setUser2] = useState("");
  const [timeSlot, setTimeSlot] = useState("");
  const [checkDuplicates, setCheckDuplicates] = useState(true);
  const [duplicateError, setDuplicateError] = useState("");

  const timeSlotOptions = useMemo(() => {
    return timeSlots.map((start) => {
      const end = addMinutes(start, meetingDuration);
      const label = `${start} - ${end}`;
      return { value: label, label };
    });
  }, [timeSlots, meetingDuration]);

  useEffect(() => {
    if (opened) {
      setUser1(fixedAttendee?.id || "");
      setUser2("");
      // Normalize: if initialTimeSlot is just a start time ("09:00"), expand to "09:00 - 09:30"
      let normalized = initialTimeSlot || "";
      if (normalized && !normalized.includes(" - ")) {
        const end = addMinutes(normalized, meetingDuration);
        normalized = `${normalized} - ${end}`;
      }
      // Only keep the value if it exists in the options list
      const exists = timeSlotOptions.some((o) => o.value === normalized);
      setTimeSlot(exists ? normalized : (timeSlotOptions[0]?.value || ""));
      setCheckDuplicates(true);
      setDuplicateError("");
    }
  }, [opened, fixedAttendee, initialTimeSlot, timeSlotOptions, meetingDuration]);

  const assistantOptions = assistants.map((a) => ({
    value: a.id,
    label: `${a.empresa} — ${a.nombre}`,
  }));

  const assistant2Options = useMemo(() => {
    return assistants
      .filter((a) => a.id !== user1)
      .map((a) => {
        const aff = getAffinity && user1 ? getAffinity(user1, a.id) : null;
        const affLabel = aff ? ` · ${aff.score}%` : "";
        return {
          value: a.id,
          label: `${a.empresa} — ${a.nombre}${affLabel}`,
          affScore: aff?.score ?? 0,
        };
      })
      .sort((a, b) => b.affScore - a.affScore);
  }, [assistants, user1, getAffinity]);

  const handleCreate = () => {
    if (!user1 || !user2 || user1 === user2) return;
    setDuplicateError("");
    onCreate({
      user1,
      user2,
      timeSlot,
      checkDuplicates,
      onDuplicateFound: () =>
        setDuplicateError(
          "Estos asistentes ya se reunieron ese día. Desactiva 'Verificar duplicados' para crear de todas formas."
        ),
    });
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Crear reunión libre"
      size="sm"
      centered
    >
      <Stack gap="md">
        <Badge color="teal" variant="light" size="sm">
          Sin slot reservado · no bloquea agenda
        </Badge>

        {fixedAttendee ? (
          <Paper withBorder p="sm" radius="md" bg="var(--mantine-color-teal-0)">
            <Text size="xs" c="dimmed">Participante fijo</Text>
            <Text size="sm" fw={600}>{fixedAttendee.empresa}</Text>
            <Text size="xs" c="dimmed">{fixedAttendee.nombre}</Text>
          </Paper>
        ) : (
          <Select
            label="Participante 1"
            placeholder="Buscar asistente..."
            data={assistantOptions}
            value={user1}
            onChange={(v) => { setUser1(v || ""); setDuplicateError(""); }}
            searchable
            clearable
            required
          />
        )}

        <Select
          label={fixedAttendee ? "Segundo participante" : "Participante 2"}
          placeholder="Buscar asistente..."
          data={assistant2Options}
          value={user2}
          onChange={(v) => { setUser2(v || ""); setDuplicateError(""); }}
          searchable
          clearable
          required
          disabled={!user1}
        />

        <Select
          label="Horario"
          placeholder="Seleccionar horario..."
          data={timeSlotOptions}
          value={timeSlot}
          onChange={(v) => setTimeSlot(v || "")}
          searchable
          clearable
          disabled={timeSlotOptions.length === 0}
        />

        <Checkbox
          label="Verificar duplicados"
          description="No permite crear la reunión si los asistentes ya se reunieron ese día"
          checked={checkDuplicates}
          onChange={(e) => { setCheckDuplicates(e.currentTarget.checked); setDuplicateError(""); }}
          color="orange"
        />

        {duplicateError && (
          <Alert color="red" variant="light" radius="md" size="sm">
            {duplicateError}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            color="teal"
            loading={loading}
            disabled={!user1 || !user2 || user1 === user2}
            onClick={handleCreate}
          >
            Crear reunión libre
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

export default CreateFreeMeetingModal;

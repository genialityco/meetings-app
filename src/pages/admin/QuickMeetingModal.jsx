import { Modal, Select, Button, Text, Badge, Checkbox, Stack, Alert, Group, Paper } from "@mantine/core";
import { useState, useEffect } from "react";

const QuickMeetingModal = ({
  opened,
  onClose,
  slotsDisponibles = [],
  defaultUser,
  assistants,
  onCreate,
  loading,
}) => {
  const [user1, setUser1] = useState(defaultUser || "");
  const [user2, setUser2] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [checkDuplicates, setCheckDuplicates] = useState(true);
  const [duplicateError, setDuplicateError] = useState("");

  useEffect(() => {
    setUser1(defaultUser || "");
    setUser2("");
    const firstTime =
      slotsDisponibles.length > 0
        ? `${slotsDisponibles[0].startTime} - ${slotsDisponibles[0].endTime}`
        : "";
    setSelectedTime(firstTime);
    // Auto-seleccionar slot si sólo hay uno disponible para ese horario
    const slotsForFirst = slotsDisponibles.filter(
      (s) => `${s.startTime} - ${s.endTime}` === firstTime
    );
    setSelectedSlotId(slotsForFirst.length === 1 ? slotsForFirst[0].id : "");
    setCheckDuplicates(true);
    setDuplicateError("");
  }, [defaultUser, opened, slotsDisponibles]);

  useEffect(() => {
    setDuplicateError("");
  }, [user1, user2]);

  const assistantOptions = assistants.map((a) => ({
    value: a.id,
    label: `${a.nombre} (${a.empresa})`,
  }));

  const timeOptions = Array.from(
    new Set(slotsDisponibles.map((s) => `${s.startTime} - ${s.endTime}`))
  ).map((t) => ({ value: t, label: t }));

  const slotsFiltered = slotsDisponibles.filter(
    (s) => `${s.startTime} - ${s.endTime}` === selectedTime
  );

  const slotOptions = slotsFiltered.map((s) => ({
    value: s.id,
    label: `Mesa ${s.tableNumber}`,
  }));

  const selectedSlot = slotsFiltered.find((s) => s.id === selectedSlotId);
  const fixedAttendeeInfo = defaultUser
    ? assistants.find((a) => a.id === defaultUser)
    : null;

  const handleCreate = () => {
    if (!user1 || !user2 || user1 === user2 || !selectedSlotId) return;
    const slotElegido = slotsDisponibles.find((s) => s.id === selectedSlotId);
    setDuplicateError("");
    onCreate({
      user1,
      user2,
      slot: slotElegido,
      checkDuplicates,
      onDuplicateFound: () =>
        setDuplicateError(
          "Los asistentes ya se han reunido ese día. Desactiva 'Verificar duplicados' para crear de todas formas."
        ),
    });
  };

  if (!opened) return null;

  if (!slotsDisponibles || slotsDisponibles.length === 0) {
    return (
      <Modal opened={opened} onClose={onClose} title="⚡ Cita rápida" size="sm" centered>
        <Stack gap="md">
          <Badge color="orange" variant="light" size="sm">
            Reserva slot · bloquea agenda
          </Badge>
          <Text c="dimmed" size="sm">No hay mesas disponibles en este horario.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cerrar</Button>
          </Group>
        </Stack>
      </Modal>
    );
  }

  return (
    <Modal opened={opened} onClose={onClose} title="⚡ Cita rápida" size="sm" centered>
      <Stack gap="md">
        <Badge color="orange" variant="light" size="sm">
          Reserva slot · bloquea agenda
        </Badge>

        {/* Participante fijo (desde "Por Usuarios") */}
        {fixedAttendeeInfo && (
          <Paper withBorder p="sm" radius="md" bg="var(--mantine-color-orange-0)">
            <Text size="xs" c="dimmed">Participante fijo</Text>
            <Text size="sm" fw={600}>{fixedAttendeeInfo.empresa}</Text>
            <Text size="xs" c="dimmed">{fixedAttendeeInfo.nombre}</Text>
          </Paper>
        )}

        {/* Horario + Mesa en dos columnas */}
        <Group grow align="flex-start">
          <Select
            label="Horario"
            data={timeOptions}
            value={selectedTime}
            onChange={(val) => {
              setSelectedTime(val || "");
              setSelectedSlotId("");
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            }}
            required
            searchable
            placeholder="Elige un horario"
          />
          <Select
            label="Mesa"
            data={slotOptions}
            value={selectedSlotId}
            onChange={(val) => {
              setSelectedSlotId(val || "");
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            }}
            required
            searchable
            placeholder="Elige una mesa"
            disabled={!selectedTime}
          />
        </Group>

        {/* Resumen del slot seleccionado */}
        {selectedSlot && (
          <Paper withBorder p="xs" radius="md" bg="var(--mantine-color-blue-0)">
            <Group gap={8}>
              <Badge size="xs" color="blue" variant="filled">Mesa {selectedSlot.tableNumber}</Badge>
              <Text size="xs" c="dimmed">{selectedSlot.startTime} – {selectedSlot.endTime}</Text>
            </Group>
          </Paper>
        )}

        {/* Participante 1 (oculto si hay fijo) */}
        {!fixedAttendeeInfo && (
          <Select
            label="Participante 1"
            data={assistantOptions}
            value={user1}
            onChange={(v) => {
              setUser1(v || "");
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            }}
            required
            searchable
            clearable
          />
        )}

        {/* Participante 2 */}
        <Select
          label={fixedAttendeeInfo ? "Segundo participante" : "Participante 2"}
          data={assistantOptions.filter((a) => a.value !== user1)}
          value={user2}
          onChange={(v) => {
            setUser2(v || "");
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          }}
          required
          searchable
          clearable
          disabled={!user1}
        />

        <Checkbox
          label="Verificar duplicados"
          description="No permite crear la reunión si los asistentes ya se reunieron ese día"
          checked={checkDuplicates}
          onChange={(e) => {
            setCheckDuplicates(e.currentTarget.checked);
            setDuplicateError("");
          }}
          color="orange"
        />

        {duplicateError && (
          <Alert color="red" variant="light" radius="md" size="sm">
            {duplicateError}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancelar</Button>
          <Button
            color="orange"
            loading={loading}
            disabled={!user1 || !user2 || user1 === user2 || !selectedSlotId}
            onClick={handleCreate}
          >
            Crear cita rápida
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

export default QuickMeetingModal;

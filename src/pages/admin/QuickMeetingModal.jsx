import { Modal, Select, Button, Text, Checkbox, Stack, Alert } from "@mantine/core";
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
  const [user1, setUser1] = useState(defaultUser ? defaultUser.id : "");
  const [user2, setUser2] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [checkDuplicates, setCheckDuplicates] = useState(true);
  const [duplicateError, setDuplicateError] = useState("");

  useEffect(() => {
    setUser1(defaultUser ? defaultUser.id : "");
    setUser2("");
    setSelectedSlotId("");
    setCheckDuplicates(true);
    setDuplicateError("");
  }, [defaultUser, opened, slotsDisponibles]);

  // Clear error when participants change
  useEffect(() => { setDuplicateError(""); }, [user1, user2]);

  const assistantOptions = assistants.map((a) => ({
    value: a.id,
    label: `${a.nombre} (${a.empresa})`,
  }));

  const slotOptions = slotsDisponibles.map((s) => ({
    value: s.id,
    label: `Mesa ${s.tableNumber} (${s.startTime} - ${s.endTime})`,
  }));

  const handleCreate = () => {
    if (!user1 || !user2 || user1 === user2 || !selectedSlotId) return;
    const slotElegido = slotsDisponibles.find((s) => s.id === selectedSlotId);
    setDuplicateError("");
    onCreate({ user1, user2, slot: slotElegido, checkDuplicates, onDuplicateFound: () => {
      setDuplicateError("Los asistentes ya se han reunido ese día. Desactiva 'Verificar duplicados' para crear de todas formas.");
    }});
  };

  if (!opened) return null;
  if (!slotsDisponibles || slotsDisponibles.length === 0)
    return (
      <Modal opened={opened} onClose={onClose} title="Crear reunión manual">
        <Text>No hay mesas disponibles en este horario.</Text>
      </Modal>
    );

  return (
    <Modal opened={opened} onClose={onClose} title="Crear reunión manual">
      <Stack gap="sm">
        <Select
          label="Selecciona la mesa"
          data={slotOptions}
          value={selectedSlotId}
          onChange={setSelectedSlotId}
          required
          searchable
          placeholder="Elige una mesa"
        />
        {selectedSlotId && (
          <Text size="sm">
            <b>Mesa: {slotsDisponibles.find((s) => s.id === selectedSlotId)?.tableNumber}</b>
            {" · "}Hora: {slotsDisponibles.find((s) => s.id === selectedSlotId)?.startTime}{" - "}
            {slotsDisponibles.find((s) => s.id === selectedSlotId)?.endTime}
          </Text>
        )}
        <Select
          label="Participante 1"
          data={assistantOptions}
          value={user1}
          onChange={setUser1}
          disabled={!!defaultUser}
          required
          searchable
        />
        <Select
          label="Participante 2"
          data={assistantOptions.filter((a) => a.value !== user1)}
          value={user2}
          onChange={setUser2}
          required
          searchable
        />
        <Checkbox
          label="Verificar duplicados"
          description="Si está activo, no permite crear la reunión si los asistentes ya se reunieron ese día"
          checked={checkDuplicates}
          onChange={(e) => { setCheckDuplicates(e.currentTarget.checked); setDuplicateError(""); }}
          color="orange"
        />
        {duplicateError && (
          <Alert color="red" variant="light" radius="md" size="sm">{duplicateError}</Alert>
        )}
        <Button
          mt="xs"
          fullWidth
          onClick={handleCreate}
          loading={loading}
          disabled={user1 === user2 || !user1 || !user2 || !selectedSlotId}
        >
          Crear reunión
        </Button>
      </Stack>
    </Modal>
  );
};

export default QuickMeetingModal;

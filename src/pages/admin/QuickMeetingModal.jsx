import { Modal, Select, Button, Text } from "@mantine/core";
import { useState, useEffect } from "react";

const QuickMeetingModal = ({
  opened,
  onClose,
  slotsDisponibles = [],    // <-- Array de slots libres para ese horario (cada uno: {tableNumber, startTime, endTime, ...})
  defaultUser,
  assistants,
  onCreate,
  loading,
}) => {
  const [user1, setUser1] = useState(defaultUser ? defaultUser.id : "");
  const [user2, setUser2] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState(""); // Selección de mesa

  // Reset form cuando cambian props relevantes
  useEffect(() => {
    setUser1(defaultUser ? defaultUser.id : "");
    setUser2("");
    setSelectedSlotId("");
  }, [defaultUser, opened, slotsDisponibles]);

  // Opciones: filtras para que user1 y user2 no sean iguales
  const assistantOptions = assistants.map((a) => ({
    value: a.id,
    label: `${a.nombre} (${a.empresa})`,
  }));

  // Opciones para seleccionar mesa
  const slotOptions = slotsDisponibles.map((s) => ({
    value: s.id,
    label: `Mesa ${s.tableNumber} (${s.startTime} - ${s.endTime})`,
  }));

  const handleCreate = () => {
    if (!user1 || !user2 || user1 === user2 || !selectedSlotId) return;
    const slotElegido = slotsDisponibles.find((s) => s.id === selectedSlotId);
    onCreate({
      user1,
      user2,
      slot: slotElegido, // Este es el slot completo
    });
  };

  // Si no hay slots disponibles, muestra aviso
  if (!opened) return null;
  if (!slotsDisponibles || slotsDisponibles.length === 0)
    return (
      <Modal opened={opened} onClose={onClose} title="Crear reunión manual">
        <Text>No hay mesas disponibles en este horario.</Text>
      </Modal>
    );

  return (
    <Modal opened={opened} onClose={onClose} title="Crear reunión manual">
      <Select
        label="Selecciona la mesa"
        data={slotOptions}
        value={selectedSlotId}
        onChange={setSelectedSlotId}
        required
        searchable
        mb="sm"
        placeholder="Elige una mesa"
      />
      {selectedSlotId && (
        <Text mb="sm" size="sm">
          <b>
            Mesa:{" "}
            {
              slotsDisponibles.find((s) => s.id === selectedSlotId)
                ?.tableNumber
            }
          </b>
          {" · "}
          Hora:{" "}
          {
            slotsDisponibles.find((s) => s.id === selectedSlotId)
              ?.startTime
          }{" "}
          -{" "}
          {
            slotsDisponibles.find((s) => s.id === selectedSlotId)
              ?.endTime
          }
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
        mb="sm"
      />
      <Select
        label="Participante 2"
        data={assistantOptions.filter((a) => a.value !== user1)}
        value={user2}
        onChange={setUser2}
        required
        searchable
      />
      <Button
        mt="md"
        fullWidth
        onClick={handleCreate}
        loading={loading}
        disabled={user1 === user2 || !user1 || !user2 || !selectedSlotId}
      >
        Crear reunión
      </Button>
    </Modal>
  );
};

export default QuickMeetingModal;

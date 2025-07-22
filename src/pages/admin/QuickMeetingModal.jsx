import { Modal, Select, Button, Text } from "@mantine/core";
import { useState, useEffect } from "react";

const QuickMeetingModal = ({
  opened,
  onClose,
  slot,
  defaultUser,
  assistants,
  onCreate,
  loading,
}) => {
  const [user1, setUser1] = useState(defaultUser ? defaultUser.id : "");
  const [user2, setUser2] = useState("");

  console.log(assistants.length)

  // Cuando cambie defaultUser o se abra el modal, setea user1 y limpia user2
  useEffect(() => {
    setUser1(defaultUser ? defaultUser.id : "");
    setUser2("");
  }, [defaultUser, opened]);

  // Opciones: filtras para que user1 y user2 no sean iguales
  const assistantOptions = assistants.map((a) => ({
    value: a.id,
    label: `${a.nombre} (${a.empresa})`,
  }));

  const handleCreate = () => {
    if (!user1 || !user2 || user1 === user2) return;
    onCreate({
      user1,
      user2,
      slot,
    });
  };

  if (!slot) return null;

  return (
    <Modal opened={opened} onClose={onClose} title="Crear reunión manual">
      <Text mb="sm">
        Mesa: {slot.tableNumber} <br /> Hora: {slot.startTime} - {slot.endTime}
      </Text>
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
        disabled={user1 === user2 || !user1 || !user2}
      >
        Crear reunión
      </Button>
    </Modal>
  );
};

export default QuickMeetingModal;

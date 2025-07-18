import { Modal, Select, Button, Text } from "@mantine/core";
import { useState, useEffect } from "react";

const EditMeetingModal = ({
  opened,
  onClose,
  slot,
  meeting,
  assistants,
  onUpdate,
  onCancel,
  loading,
  lockedUserId
}) => {
  const [user1, setUser1] = useState("");
  const [user2, setUser2] = useState("");

  useEffect(() => {
    if (meeting) {
      if (lockedUserId) {
        setUser1(lockedUserId);
        setUser2(
          meeting.participants.find((id) => id !== lockedUserId) || ""
        );
      } else {
        setUser1(meeting.participants[0]);
        setUser2(meeting.participants[1]);
      }
    }
  }, [meeting, lockedUserId]);

  const assistantOptions = assistants.map((a) => ({
    value: a.id,
    label: `${a.nombre} (${a.empresa})`,
  }));

  const handleUpdate = () => {
    if (!user1 || !user2 || user1 === user2) return;
    onUpdate({
      meetingId: meeting.id,
      user1,
      user2,
      slot,
    });
  };

  if (!slot || !meeting) return null;

  return (
    <Modal opened={opened} onClose={onClose} title="Editar reunión">
      <Text mb="sm">
        Mesa: {slot.tableNumber} <br />
        Hora: {slot.startTime} - {slot.endTime}
      </Text>
      <Select
        label="Participante 1"
        data={assistantOptions}
        value={user1}
        onChange={setUser1}
        required
        searchable
        mb="sm"
        disabled={!!lockedUserId}
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
        color="red"
        variant="outline"
        my="xs"
        fullWidth
        loading={loading}
        onClick={() => onCancel(meeting.id, slot?.id)}
      >
        Cancelar reunión
      </Button>
      <Button
        mt="md"
        fullWidth
        onClick={handleUpdate}
        loading={loading}
        disabled={user1 === user2 || !user1 || !user2}
      >
        Actualizar reunión
      </Button>
    </Modal>
  );
};

export default EditMeetingModal;

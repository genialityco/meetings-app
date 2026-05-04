import { useState, useEffect, useMemo } from "react";
import {
  Modal,
  Select,
  Button,
  Text,
  Badge,
  TextInput,
  Stack,
  Divider,
} from "@mantine/core";

const EditFreeMeetingModal = ({
  opened,
  onClose,
  meeting,
  assistants = [],
  onUpdate,
  onCancel,
  loading,
  participantsInfo = {},
  getAffinity,
}) => {
  const [user1, setUser1] = useState("");
  const [user2, setUser2] = useState("");
  const [timeSlot, setTimeSlot] = useState("");

  useEffect(() => {
    if (meeting) {
      setUser1(meeting.participants?.[0] || "");
      setUser2(meeting.participants?.[1] || "");
      setTimeSlot(meeting.timeSlot || "");
    }
  }, [meeting]);

  const assistantOptions = assistants.map((a) => ({
    value: a.id,
    label: `${a.nombre} (${a.empresa})`,
  }));

  const assistant2Options = useMemo(() => {
    return assistants
      .filter((a) => a.id !== user1)
      .map((a) => {
        const aff = getAffinity && user1 ? getAffinity(user1, a.id) : null;
        const affLabel = aff ? ` · ${aff.score}%` : "";
        return {
          value: a.id,
          label: `${a.nombre} (${a.empresa})${affLabel}`,
          affScore: aff?.score ?? 0,
        };
      })
      .sort((a, b) => b.affScore - a.affScore);
  }, [assistants, user1, getAffinity]);

  const handleUpdate = () => {
    if (!user1 || !user2 || user1 === user2) return;
    onUpdate({ meetingId: meeting.id, user1, user2, timeSlot });
  };

  if (!meeting) return null;

  const p1Info = participantsInfo[meeting.participants?.[0]];
  const p2Info = participantsInfo[meeting.participants?.[1]];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Editar reunión libre"
      size="sm"
      centered
    >
      <Stack gap="sm">
        <Badge color="teal" variant="light" size="sm">
          Sin slot reservado · no bloquea agenda
        </Badge>

        {p1Info && p2Info && (
          <Text size="xs" c="dimmed">
            Actual: <b>{p1Info.empresa}</b> ↔ <b>{p2Info.empresa}</b>
          </Text>
        )}

        <Divider label="Participantes" labelPosition="left" />

        <Select
          label="Participante 1"
          data={assistantOptions}
          value={user1}
          onChange={(v) => setUser1(v || "")}
          searchable
          required
        />
        <Select
          label="Participante 2"
          data={assistant2Options}
          value={user2}
          onChange={(v) => setUser2(v || "")}
          searchable
          required
          disabled={!user1}
        />

        <TextInput
          label="Referencia de horario (opcional)"
          placeholder="ej: 09:00 - 09:30"
          value={timeSlot}
          onChange={(e) => setTimeSlot(e.currentTarget.value)}
        />

        <Button
          color="red"
          variant="outline"
          fullWidth
          loading={loading}
          onClick={() => onCancel(meeting.id)}
        >
          Cancelar reunión
        </Button>
        <Button
          fullWidth
          color="teal"
          onClick={handleUpdate}
          loading={loading}
          disabled={!user1 || !user2 || user1 === user2}
        >
          Guardar cambios
        </Button>
      </Stack>
    </Modal>
  );
};

export default EditFreeMeetingModal;

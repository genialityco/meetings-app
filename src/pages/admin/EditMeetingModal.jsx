import { useState, useEffect } from "react";
import { Modal, Select, Button, Text, Group } from "@mantine/core";

const EditMeetingModal = ({
  opened,
  onClose,
  slot,
  meeting,
  assistants,
  onUpdate,
  onCancel,
  loading,
  lockedUserId,
  allMeetings = [],
  agenda = [],
  onSwapMeetings,
}) => {
  // Estados para editar participantes
  const [user1, setUser1] = useState("");
  const [user2, setUser2] = useState("");

  // Estados para swap
  const [swapMode, setSwapMode] = useState(false);
  const [swapMeetingId, setSwapMeetingId] = useState("");

  useEffect(() => {
    if (meeting) {
      if (lockedUserId) {
        setUser1(lockedUserId);
        setUser2(meeting.participants.find((id) => id !== lockedUserId) || "");
      } else {
        setUser1(meeting.participants[0]);
        setUser2(meeting.participants[1]);
      }
    }
  }, [meeting, lockedUserId]);

  // Opciones para los selects de asistentes
  const assistantOptions = assistants.map((a) => ({
    value: a.id,
    label: `${a.nombre} (${a.empresa})`,
  }));

  console.log("allMeetings", allMeetings);
  console.log("meeting", meeting);
  console.log("swapMode", swapMode);

  // Opciones para el swap (otras reuniones aceptadas)
  const swapOptions = allMeetings
    .filter((m) => m.id !== meeting.id && m.status === "accepted")
    .map((m) => ({
      value: m.id,
      label: `Mesa ${m.tableAssigned} — ${m.timeSlot} (${m.participants
        .map((id) => assistants.find((a) => a.id === id)?.nombre || id)
        .join(" vs ")})`,
    }));

  // Busca el slot de agenda para una reunión dada
  const getSlotForMeeting = (mtg) => {
    if (!mtg) return null;
    const [startTime] = mtg.timeSlot.split(" - ");
    return agenda.find(
      (s) =>
        s.tableNumber === Number(mtg.tableAssigned) && s.startTime === startTime
    );
  };

  // Actualiza la reunión (editar participantes)
  const handleUpdate = () => {
    if (!user1 || !user2 || user1 === user2) return;
    onUpdate({
      meetingId: meeting.id,
      user1,
      user2,
      slot,
    });
  };

  // Swap de reuniones
  const handleSwap = async () => {
    if (!swapMeetingId) return;
    const meetingB = allMeetings.find((m) => m.id === swapMeetingId);
    const slotA = getSlotForMeeting(meeting);
    const slotB = getSlotForMeeting(meetingB);
    if (onSwapMeetings) {
      await onSwapMeetings(meeting, slotA, meetingB, slotB);
      setSwapMode(false);
      setSwapMeetingId("");
      onClose();
    }
  };

  if (!slot || !meeting) return null;

  return (
    <Modal opened={opened} onClose={onClose} title="Editar reunión">
      <Text mb="sm">
        Mesa: {slot.tableNumber} <br />
        Hora: {slot.startTime} - {slot.endTime}
      </Text>
      {!swapMode ? (
        <>
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
            mb="sm"
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
          <Button
            mt="xs"
            variant="light"
            color="blue"
            fullWidth
            onClick={() => setSwapMode(true)}
            disabled={swapOptions.length === 0}
          >
            Intercambiar con otra reunión
          </Button>
        </>
      ) : (
        <>
          <Text c="dimmed" size="sm" mb="xs">
            Selecciona la reunión con la que quieres intercambiar horario y
            mesa.
          </Text>
          <Select
            label="Reunión para intercambiar"
            data={swapOptions}
            value={swapMeetingId}
            onChange={setSwapMeetingId}
            searchable
            mb="sm"
          />
          {swapMeetingId && (
            <Text size="xs" mb="sm">
              <b>Resumen de la reunión seleccionada:</b>
              <br />
              {(() => {
                const m = allMeetings.find((x) => x.id === swapMeetingId);
                if (!m) return null;
                return (
                  <>
                    Mesa: {m.tableAssigned} <br />
                    Hora: {m.timeSlot} <br />
                    Participantes:{" "}
                    {m.participants
                      .map(
                        (id) =>
                          assistants.find((a) => a.id === id)?.nombre || id
                      )
                      .join(" vs ")}
                  </>
                );
              })()}
            </Text>
          )}
          <Group grow>
            <Button
              color="gray"
              variant="outline"
              onClick={() => {
                setSwapMode(false);
                setSwapMeetingId("");
              }}
            >
              Cancelar
            </Button>
            <Button
              color="teal"
              loading={loading}
              disabled={!swapMeetingId}
              onClick={handleSwap}
            >
              Confirmar intercambio
            </Button>
          </Group>
        </>
      )}
    </Modal>
  );
};

export default EditMeetingModal;

import { useState, useEffect, useMemo } from "react";
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
  participantsInfo = {},
}) => {
  // Estados para editar participantes y slot
  const [user1, setUser1] = useState("");
  const [user2, setUser2] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState(slot?.id || "");

  // Estados para swap
  const [swapMode, setSwapMode] = useState(false);
  const [swapMeetingId, setSwapMeetingId] = useState("");

  // Filtrar slots disponibles que coincidan con la hora del slot actual y que estén libres o sean la mesa actual
  const slotsFiltered = useMemo(() => {
    if (!agenda || !slot?.startTime || !meeting) return [];

    return agenda.filter((s) => {
      const isSameTime = s.startTime === slot.startTime;
      const isAvailable = s.available;
      const isCurrentTable = s.tableNumber === Number(meeting.tableAssigned);
      return isSameTime && (isAvailable || isCurrentTable);
    });
  }, [agenda, slot, meeting]);

  // Inicializa los estados cuando cambia meeting, lockedUserId, slot o slotsFiltered
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

    if (slot && slotsFiltered.some((s) => s.id === slot.id)) {
      setSelectedSlotId(slot.id);
    } else if (slotsFiltered.length > 0) {
      setSelectedSlotId(slotsFiltered[0].id);
    } else {
      setSelectedSlotId("");
    }
  }, [meeting, lockedUserId, slot, slotsFiltered]);

  // Opciones para selects de asistentes
  const assistantOptions = assistants.map((a) => ({
    value: a.id,
    label: `${a.nombre} (${a.empresa})`,
  }));

  // Opciones para slots disponibles (filtrados)
  const slotOptions = slotsFiltered.map((s) => ({
    value: s.id,
    label: `Mesa ${s.tableNumber} (${s.startTime} - ${s.endTime})`,
  }));

  // Opciones para swap
  const swapOptions = meeting
    ? allMeetings
        .filter((m) => m.id !== meeting.id && m.status === "accepted")
        .map((m) => ({
          value: m.id,
          label: `Mesa ${m.tableAssigned} — ${m.timeSlot} ${m.participants
            .map((id) =>
              participantsInfo[id]
                ? `${participantsInfo[id].empresa} (${participantsInfo[id].nombre})`
                : id
            )
            .join(" vs ")}`,
        }))
    : [];

  // Slot seleccionado (memoizado)
  const selectedSlot = useMemo(
    () => slotsFiltered.find((s) => s.id === selectedSlotId),
    [slotsFiltered, selectedSlotId]
  );

  // Obtiene slot de agenda para una reunión (si necesitas)
  const getSlotForMeeting = (mtg) => {
    if (!mtg) return null;
    const [startTime] = mtg.timeSlot.split(" - ");
    return agenda.find(
      (s) =>
        s.tableNumber === Number(mtg.tableAssigned) && s.startTime === startTime
    );
  };

  // Actualiza la reunión
  const handleUpdate = () => {
    if (!user1 || !user2 || user1 === user2 || !selectedSlotId) return;
    const slotElegido = slotsFiltered.find((s) => s.id === selectedSlotId);
    onUpdate({
      meetingId: meeting.id,
      user1,
      user2,
      slot: slotElegido,
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
      {!swapMode ? (
        <>
          <Select
            label="Selecciona la mesa"
            data={slotOptions}
            value={selectedSlotId}
            onChange={setSelectedSlotId}
            required
            searchable
            mb="sm"
          />
          {selectedSlotId && selectedSlot && (
            <Text mb="sm" size="sm">
              <b>Mesa: {selectedSlot.tableNumber}</b> · Hora:{" "}
              {selectedSlot.startTime} - {selectedSlot.endTime}
            </Text>
          )}

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
            disabled={user1 === user2 || !user1 || !user2 || !selectedSlotId}
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

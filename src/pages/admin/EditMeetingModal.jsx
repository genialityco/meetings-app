import { useState, useEffect, useMemo } from "react";
import { Modal, Select, Button, Text, Group, Checkbox, Alert } from "@mantine/core";

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
  getAffinity,
  companies = [],
}) => {
  // Estados para editar participantes y slot
  const [user1, setUser1] = useState("");
  const [user2, setUser2] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState(slot?.id || "");

  // Estados para swap
  const [swapMode, setSwapMode] = useState(false);
  const [swapMeetingId, setSwapMeetingId] = useState("");
  const [checkDuplicates, setCheckDuplicates] = useState(true);
  const [duplicateError, setDuplicateError] = useState("");

  // Obtiene la mesa fija de un usuario según su compañía
  const getFixedTable = (userId) => {
    const user = participantsInfo[userId] || assistants.find((a) => a.id === userId);
    if (!user?.companyId) return null;
    const company = companies.find((c) => c.id === user.companyId || c.nitNorm === user.companyId);
    return company?.fixedTable ? Number(company.fixedTable) : null;
  };

  // Opciones de horarios únicos de la agenda
  const timeOptions = useMemo(() => {
    if (!agenda) return [];
    const times = new Set();
    agenda.forEach((s) => times.add(`${s.startTime} - ${s.endTime}`));
    return Array.from(times).sort().map((t) => ({ value: t, label: t }));
  }, [agenda]);

  // Filtrar slots disponibles que coincidan con la hora seleccionada y que estén libres,
  // sean la mesa actual, o sean la mesa fija del participante 2 seleccionado
  const slotsFiltered = useMemo(() => {
    if (!agenda || !selectedTime || !meeting) return [];

    const [start] = selectedTime.split(" - ");
    const fixedTable2 = getFixedTable(user2);

    return agenda.filter((s) => {
      const isSameTime = s.startTime === start;
      const isAvailable = s.available;
      const isCurrentTable = s.tableNumber === Number(meeting.tableAssigned) && s.startTime === slot?.startTime;
      const isFixedTableOfUser2 = fixedTable2 && s.tableNumber === fixedTable2;
      return isSameTime && (isAvailable || isCurrentTable || isFixedTableOfUser2 || !checkDuplicates);
    });
  }, [agenda, selectedTime, meeting, slot, user2, companies, participantsInfo, assistants, checkDuplicates]);

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

    if (slot && !selectedTime) {
      setSelectedTime(`${slot.startTime} - ${slot.endTime}`);
    }

    if (slot && slotsFiltered.some((s) => s.id === slot.id)) {
      setSelectedSlotId(slot.id);
    } else if (slotsFiltered.length > 0) {
      // Intentar mantener la misma mesa si está disponible en el nuevo horario
      const sameTableSlot = slotsFiltered.find((s) => s.tableNumber === Number(meeting?.tableAssigned));
      setSelectedSlotId(sameTableSlot ? sameTableSlot.id : slotsFiltered[0].id);
    } else {
      setSelectedSlotId("");
    }
  }, [meeting, lockedUserId, slot, slotsFiltered]);

  // Cuando cambia user2, auto-seleccionar su mesa fija si la tiene
  useEffect(() => {
    if (!user2 || !selectedTime) return;
    const [start] = selectedTime.split(" - ");
    setDuplicateError("");
    const fixedTable = getFixedTable(user2);
    if (!fixedTable) return;
    const fixedSlot = agenda.find(
      (s) => s.startTime === start && s.tableNumber === fixedTable
    );
    if (fixedSlot) {
      setSelectedSlotId(fixedSlot.id);
    }
  }, [user2]);

  // Opciones para selects de asistentes
  const assistantOptions = assistants.map((a) => ({
    value: a.id,
    label: `${a.nombre} (${a.empresa})`,
  }));

  // Opciones participante 2 con afinidad respecto a participante 1
  const assistant2Options = useMemo(() => {
    return assistants
      .filter((a) => a.value !== user1 && a.id !== user1)
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

  // Opciones para slots disponibles (filtrados)
  const slotOptions = slotsFiltered.map((s) => ({
    value: s.id,
    label: `Mesa ${s.tableNumber}`,
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
    setDuplicateError("");
    onUpdate({
      meetingId: meeting.id,
      user1,
      user2,
      slot: slotElegido,
      checkDuplicates,
      onDuplicateFound: () => setDuplicateError("Los asistentes ya se han reunido ese día. Desactiva 'Verificar duplicados' para actualizar de todas formas."),
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
          <Group grow mb="sm" align="flex-start">
            <Select
              label="Horario"
              data={timeOptions}
              value={selectedTime}
              onChange={(val) => {
                setSelectedTime(val);
                setDuplicateError("");
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
              }}
              required
              searchable
            />
            <Select
              label="Selecciona la mesa"
              data={slotOptions}
              value={selectedSlotId}
              onChange={(val) => {
                setSelectedSlotId(val);
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
              }}
              required
              searchable
              disabled={!selectedTime}
            />
          </Group>
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
            onChange={(val) => {
              setUser1(val);
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            }}
            required
            searchable
            mb="sm"
            disabled={!!lockedUserId}
          />
          <Select
            label="Participante 2"
            data={assistant2Options}
            value={user2}
            onChange={(val) => {
              setUser2(val);
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            }}
            required
            searchable
            mb="sm"
          />
          <Checkbox
            label="Verificar duplicados"
            description="Si está activo, no permite actualizar si los asistentes ya se reunieron ese día"
            checked={checkDuplicates}
            onChange={(e) => { setCheckDuplicates(e.currentTarget.checked); setDuplicateError(""); }}
            color="orange"
            mb="sm"
          />
          {duplicateError && (
            <Alert color="red" variant="light" radius="md" size="sm" mb="sm">{duplicateError}</Alert>
          )}
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
            onChange={(val) => {
              setSwapMeetingId(val);
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            }}
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

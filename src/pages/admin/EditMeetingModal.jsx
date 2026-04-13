import { useState, useEffect, useMemo } from "react";
import { Modal, Select, Button, Text, Group, Badge, Checkbox, Alert, Stack, Divider, Paper } from "@mantine/core";

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
  onCreateFree,        // (user1, user2, checkDuplicates, onDuplicateFound) => void
  freeMeetingsInSlot = [], // reuniones libres ya existentes en este slot
}) => {
  // Estados para editar participantes y slot
  const [user1, setUser1] = useState("");
  const [user2, setUser2] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState(slot?.id || "");

  // Estados para swap
  const [swapMode, setSwapMode] = useState(false);
  const [swapMeetingId, setSwapMeetingId] = useState("");
  const [checkDuplicates, setCheckDuplicates] = useState(true);
  const [duplicateError, setDuplicateError] = useState("");

  // Estado para reunión libre
  const [freeUser1, setFreeUser1] = useState("");
  const [freeUser2, setFreeUser2] = useState("");
  const [freeCheckDuplicates, setFreeCheckDuplicates] = useState(true);
  const [freeDuplicateError, setFreeDuplicateError] = useState("");
  const [creatingFree, setCreatingFree] = useState(false);

  // Obtiene la mesa fija de un usuario según su compañía
  const getFixedTable = (userId) => {
    const user = participantsInfo[userId] || assistants.find((a) => a.id === userId);
    if (!user?.companyId) return null;
    const company = companies.find((c) => c.id === user.companyId || c.nitNorm === user.companyId);
    return company?.fixedTable ? Number(company.fixedTable) : null;
  };

  // Filtrar slots disponibles que coincidan con la hora del slot actual y que estén libres,
  // sean la mesa actual, o sean la mesa fija del participante 2 seleccionado
  const slotsFiltered = useMemo(() => {
    if (!agenda || !slot?.startTime || !meeting) return [];

    const fixedTable2 = getFixedTable(user2);

    return agenda.filter((s) => {
      const isSameTime = s.startTime === slot.startTime;
      const isAvailable = s.available;
      const isCurrentTable = s.tableNumber === Number(meeting.tableAssigned);
      const isFixedTableOfUser2 = fixedTable2 && s.tableNumber === fixedTable2;
      return isSameTime && (isAvailable || isCurrentTable || isFixedTableOfUser2);
    });
  }, [agenda, slot, meeting, user2, companies, participantsInfo, assistants]);

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
    // Reset free meeting form
    setFreeUser1("");
    setFreeUser2("");
    setFreeCheckDuplicates(true);
    setFreeDuplicateError("");
  }, [meeting, lockedUserId, slot, slotsFiltered]);

  // Cuando cambia user2, auto-seleccionar su mesa fija si la tiene
  useEffect(() => {
    if (!user2 || !slot?.startTime) return;
    setDuplicateError("");
    const fixedTable = getFixedTable(user2);
    if (!fixedTable) return;
    const fixedSlot = agenda.find(
      (s) => s.startTime === slot.startTime && s.tableNumber === fixedTable
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

  const handleCreateFree = () => {
    if (!freeUser1 || !freeUser2 || freeUser1 === freeUser2) return;
    setFreeDuplicateError("");
    setCreatingFree(true);
    onCreateFree(freeUser1, freeUser2, freeCheckDuplicates, () => {
      setFreeDuplicateError("Los asistentes ya se han reunido ese día. Desactiva 'Verificar duplicados' para crear de todas formas.");
      setCreatingFree(false);
    }, () => setCreatingFree(false));
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
            data={assistant2Options}
            value={user2}
            onChange={setUser2}
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

          {/* Reuniones libres existentes en este slot */}
          {freeMeetingsInSlot.length > 0 && (
            <>
              <Divider label="Reuniones libres en este slot" labelPosition="left" mt="md" mb="xs" />
              <Stack gap={4}>
                {freeMeetingsInSlot.map((fm) => {
                  const p0 = participantsInfo[fm.participants?.[0]];
                  const p1 = participantsInfo[fm.participants?.[1]];
                  return (
                    <Paper key={fm.id} withBorder p="xs" radius="sm" style={{ background: "#f0fdf4" }}>
                      <Text size="xs" fw={600} c="teal">Libre</Text>
                      <Text size="xs">{p0 ? `${p0.empresa} (${p0.nombre})` : fm.participants?.[0]}</Text>
                      <Text size="xs">{p1 ? `${p1.empresa} (${p1.nombre})` : fm.participants?.[1]}</Text>
                    </Paper>
                  );
                })}
              </Stack>
            </>
          )}

          {/* Crear reunión libre en este slot */}
          {onCreateFree && (
            <>
              <Divider label="Agregar reunión libre" labelPosition="left" mt="md" mb="xs" />
              <Text size="xs" c="dimmed" mb="xs">No reserva el slot. Puede coexistir con la reunión existente.</Text>
              <Select
                label="Participante 1"
                placeholder="Buscar..."
                data={assistantOptions}
                value={freeUser1}
                onChange={(v) => { setFreeUser1(v || ""); setFreeDuplicateError(""); }}
                searchable clearable size="xs" mb={4}
              />
              <Select
                label="Participante 2"
                placeholder="Buscar..."
                data={assistantOptions.filter((a) => a.value !== freeUser1)}
                value={freeUser2}
                onChange={(v) => { setFreeUser2(v || ""); setFreeDuplicateError(""); }}
                searchable clearable size="xs" mb={4}
                disabled={!freeUser1}
              />
              <Checkbox
                label="Verificar duplicados"
                description="Bloquea si ya se reunieron ese día"
                checked={freeCheckDuplicates}
                onChange={(e) => { setFreeCheckDuplicates(e.currentTarget.checked); setFreeDuplicateError(""); }}
                color="orange" size="xs" mb={4}
              />
              {freeDuplicateError && (
                <Alert color="red" variant="light" radius="md" size="xs" mb={4}>{freeDuplicateError}</Alert>
              )}
              <Button
                size="xs"
                color="teal"
                fullWidth
                loading={creatingFree}
                disabled={!freeUser1 || !freeUser2 || freeUser1 === freeUser2}
                onClick={handleCreateFree}
              >
                Crear reunión libre
              </Button>
            </>
          )}
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

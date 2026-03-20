import { useState, useMemo } from "react";
import {
  Modal, Stack, Text, Select, Group, Button, Table, Badge,
  Alert, Checkbox, ScrollArea,
} from "@mantine/core";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";

/**
 * Modal para transferir reuniones de un asistente a otro del mismo rol.
 * Props:
 *   opened, onClose, eventId, asistentes, meetings, participantsInfo
 */
export default function TransferMeetingsModal({
  opened, onClose, eventId, asistentes, meetings, participantsInfo,
}) {
  const [fromId, setFromId] = useState(null);
  const [toId, setToId] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [transferring, setTransferring] = useState(false);
  const [result, setResult] = useState(null);

  // Opciones de asistentes agrupadas por rol
  const asistentesOptions = useMemo(() =>
    asistentes.map((a) => ({
      value: a.id,
      label: `${a.empresa} — ${a.nombre} (${a.tipoAsistente || a.role || "?"})`,
      role: (a.tipoAsistente || a.role || "").toLowerCase(),
    })), [asistentes]);

  const fromRole = useMemo(() =>
    asistentesOptions.find((a) => a.value === fromId)?.role || null,
    [fromId, asistentesOptions]);

  // Solo mostrar destinos del mismo rol, excluyendo el origen
  const toOptions = useMemo(() =>
    asistentesOptions.filter((a) => a.value !== fromId && (!fromRole || a.role === fromRole)),
    [asistentesOptions, fromId, fromRole]);

  // Reuniones aceptadas del origen
  const fromMeetings = useMemo(() =>
    meetings.filter((m) =>
      m.status === "accepted" && m.participants?.includes(fromId)
    ), [meetings, fromId]);

  // Horarios que ya tiene el destino
  const toTimeSlots = useMemo(() => {
    if (!toId) return new Set();
    return new Set(
      meetings
        .filter((m) => m.status === "accepted" && m.participants?.includes(toId))
        .map((m) => m.timeSlot)
    );
  }, [meetings, toId]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const transferable = fromMeetings.filter((m) => !toTimeSlots.has(m.timeSlot));
    if (selected.size === transferable.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(transferable.map((m) => m.id)));
    }
  };

  const handleTransfer = async () => {
    if (!fromId || !toId || selected.size === 0) return;
    setTransferring(true);
    setResult(null);
    let ok = 0, fail = 0;
    try {
      for (const meetingId of selected) {
        const meeting = fromMeetings.find((m) => m.id === meetingId);
        if (!meeting) continue;
        const newParticipants = meeting.participants.map((p) => p === fromId ? toId : p);
        const newRequesterId = meeting.requesterId === fromId ? toId : meeting.requesterId;
        const newReceiverId = meeting.receiverId === fromId ? toId : meeting.receiverId;
        try {
          await updateDoc(doc(db, "events", eventId, "meetings", meetingId), {
            participants: newParticipants,
            requesterId: newRequesterId,
            receiverId: newReceiverId,
          });
          ok++;
        } catch {
          fail++;
        }
      }
      setResult({ ok, fail });
      setSelected(new Set());
    } finally {
      setTransferring(false);
    }
  };

  const handleClose = () => {
    setFromId(null);
    setToId(null);
    setSelected(new Set());
    setResult(null);
    onClose();
  };

  const transferable = fromMeetings.filter((m) => !toTimeSlots.has(m.timeSlot));
  const conflicting = fromMeetings.filter((m) => toTimeSlots.has(m.timeSlot));

  return (
    <Modal opened={opened} onClose={handleClose} title="Transferir reuniones" size="xl">
      <Stack gap="md">
        <Group grow>
          <Select
            label="Asistente origen"
            placeholder="Selecciona quién transfiere"
            data={asistentesOptions}
            value={fromId}
            onChange={(v) => { setFromId(v); setToId(null); setSelected(new Set()); setResult(null); }}
            searchable
            clearable
          />
          <Select
            label="Asistente destino (mismo rol)"
            placeholder={fromId ? "Selecciona destino" : "Primero elige origen"}
            data={toOptions}
            value={toId}
            onChange={(v) => { setToId(v); setSelected(new Set()); setResult(null); }}
            searchable
            clearable
            disabled={!fromId}
          />
        </Group>

        {result && (
          <Alert color={result.fail === 0 ? "green" : "orange"} withCloseButton onClose={() => setResult(null)}>
            {result.ok} reunión(es) transferida(s){result.fail > 0 ? `, ${result.fail} con error` : ""}.
          </Alert>
        )}

        {fromId && toId && (
          <>
            {conflicting.length > 0 && (
              <Alert color="orange" title={`${conflicting.length} conflicto(s) de horario`}>
                Las siguientes reuniones no se pueden transferir porque el destino ya tiene reunión en ese horario:
                <Stack gap={2} mt="xs">
                  {conflicting.map((m) => {
                    const otherId = m.participants.find((p) => p !== fromId);
                    const other = participantsInfo[otherId];
                    return (
                      <Text key={m.id} size="xs">
                        • {m.timeSlot} — Mesa {m.tableAssigned} — con {other?.empresa || otherId}
                      </Text>
                    );
                  })}
                </Stack>
              </Alert>
            )}

            {transferable.length === 0 ? (
              <Alert color="red">No hay reuniones transferibles (todas tienen conflicto de horario).</Alert>
            ) : (
              <>
                <Group justify="space-between">
                  <Text size="sm" fw={600}>{transferable.length} reunión(es) transferible(s)</Text>
                  <Group gap="xs">
                    <Checkbox
                      label="Seleccionar todas"
                      checked={selected.size === transferable.length && transferable.length > 0}
                      indeterminate={selected.size > 0 && selected.size < transferable.length}
                      onChange={toggleAll}
                    />
                    <Button
                      size="xs"
                      disabled={selected.size === 0}
                      loading={transferring}
                      onClick={handleTransfer}
                    >
                      Transferir seleccionadas ({selected.size})
                    </Button>
                  </Group>
                </Group>

                <ScrollArea mah={400}>
                  <Table striped highlightOnHover withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={40} />
                        <Table.Th>Horario</Table.Th>
                        <Table.Th>Mesa</Table.Th>
                        <Table.Th>Contraparte</Table.Th>
                        <Table.Th>Estado</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {transferable.map((m) => {
                        const otherId = m.participants.find((p) => p !== fromId);
                        const other = participantsInfo[otherId];
                        return (
                          <Table.Tr key={m.id} style={{ cursor: "pointer" }} onClick={() => toggleSelect(m.id)}>
                            <Table.Td>
                              <Checkbox
                                checked={selected.has(m.id)}
                                onChange={() => toggleSelect(m.id)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </Table.Td>
                            <Table.Td><Text size="sm">{m.timeSlot}</Text></Table.Td>
                            <Table.Td><Text size="sm">{m.tableAssigned}</Text></Table.Td>
                            <Table.Td>
                              <Text size="sm" fw={600}>{other?.empresa || otherId}</Text>
                              <Text size="xs" c="dimmed">{other?.nombre || ""}</Text>
                            </Table.Td>
                            <Table.Td>
                              <Badge color="green" variant="light" size="sm">Transferible</Badge>
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </>
            )}
          </>
        )}
      </Stack>
    </Modal>
  );
}

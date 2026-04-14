import { useState, useEffect, useMemo } from "react";
import {
  Modal, Stack, Select, TextInput, Button, Text, Alert, Group,
} from "@mantine/core";
import { collection, query, where, getDocs, addDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";

export default function ExternalMeetingModal({ opened, onClose, event, setGlobalMessage }) {
  const [assistants, setAssistants] = useState([]);
  const [participant1, setParticipant1] = useState("");
  const [participant2, setParticipant2] = useState("");
  const [timeSlot, setTimeSlot] = useState("");
  const [tableAssigned, setTableAssigned] = useState("");
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState("");

  // Multi-day support
  const eventDates = event?.config?.eventDates || (event?.config?.eventDate ? [event.config.eventDate] : []);
  const isMultiDay = eventDates.length > 1;
  const [selectedDate, setSelectedDate] = useState(eventDates[0] || "");

  const numTables = event?.config?.numTables || 0;
  const tableOptions = [
    { value: "", label: "Sin mesa" },
    ...Array.from({ length: numTables }, (_, i) => ({
      value: String(i + 1),
      label: `Mesa ${i + 1}`,
    })),
  ];

  const formatDate = (dateStr) => {
    const [year, month, day] = dateStr.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString("es-ES", {
      weekday: "short", day: "numeric", month: "short",
    });
  };

  useEffect(() => {
    if (!event?.id || !opened) return;
    getDocs(query(collection(db, "users"), where("eventId", "==", event.id))).then((snap) => {
      setAssistants(snap.docs.map((d) => ({
        value: d.id,
        label: `${d.data().nombre || ""} — ${d.data().empresa || ""}`,
      })));
    });
    // Reset on open
    setParticipant1("");
    setParticipant2("");
    setTimeSlot("");
    setTableAssigned("");
    setValidationError("");
    setSelectedDate(eventDates[0] || "");
  }, [opened, event?.id]);

  // Clear validation error when participants change
  useEffect(() => { setValidationError(""); }, [participant1, participant2, selectedDate]);

  const handleSave = async () => {
    if (!participant1 || !participant2) {
      setGlobalMessage("Selecciona ambos participantes.");
      return;
    }
    if (participant1 === participant2) {
      setGlobalMessage("Los participantes deben ser diferentes.");
      return;
    }

    setSaving(true);
    setValidationError("");

    try {
      // Validar que no se hayan reunido ese día
      const meetingDate = selectedDate || null;
      const existingSnap = await getDocs(
        query(
          collection(db, "events", event.id, "meetings"),
          where("status", "==", "accepted"),
          where("participants", "array-contains", participant1)
        )
      );
      const alreadyMet = existingSnap.docs.some((d) => {
        const m = d.data();
        const sameDay = !meetingDate || !m.meetingDate || m.meetingDate === meetingDate;
        return sameDay && (m.participants || []).includes(participant2);
      });

      if (alreadyMet) {
        setValidationError("Los asistentes ya se han reunido ese día.");
        setSaving(false);
        return;
      }

      await addDoc(collection(db, "events", event.id, "meetings"), {
        eventId: event.id,
        requesterId: participant1,
        receiverId: participant2,
        participants: [participant1, participant2],
        status: "accepted",
        isExternal: true,
        completed: true,
        timeSlot: timeSlot.trim() || "—",
        tableAssigned: tableAssigned || "",
        meetingDate: meetingDate,
        motivoMatch: "Externa",
        razonMatch: "Registrada manualmente como reunión externa",
        scoreMatch: null,
        isNotificated: false,
        createdAt: new Date(),
      });
      setGlobalMessage("Reunión externa registrada correctamente.");
      onClose();
    } catch (e) {
      console.error(e);
      setGlobalMessage("Error al registrar la reunión externa.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Registrar reunión externa" size="md">
      <Stack gap="md">
        <Alert color="blue" variant="light" radius="md">
          Esta reunión se registrará como realizada sin ocupar ningún slot de agenda.
          Úsala para reuniones que ocurrieron por fuera del sistema.
        </Alert>

        {isMultiDay && (
          <Select
            label="Día"
            data={eventDates.map((d) => ({ value: d, label: formatDate(d) }))}
            value={selectedDate}
            onChange={setSelectedDate}
          />
        )}

        <Select
          label="Participante 1"
          placeholder="Buscar asistente..."
          data={assistants}
          value={participant1}
          onChange={setParticipant1}
          searchable
          clearable
        />
        <Select
          label="Participante 2"
          placeholder="Buscar asistente..."
          data={assistants.filter((a) => a.value !== participant1)}
          value={participant2}
          onChange={setParticipant2}
          searchable
          clearable
          disabled={!participant1}
        />

        {validationError && (
          <Alert color="red" variant="light" radius="md">
            {validationError}
          </Alert>
        )}

        <TextInput
          label="Horario (opcional)"
          placeholder="Ej: 10:00 - 10:30"
          value={timeSlot}
          onChange={(e) => setTimeSlot(e.currentTarget.value)}
          description="Texto libre, no se valida contra la agenda"
        />

        <Select
          label="Mesa (opcional)"
          placeholder="Sin mesa"
          data={tableOptions}
          value={tableAssigned}
          onChange={(v) => setTableAssigned(v || "")}
          clearable
        />

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={handleSave}
            loading={saving}
            disabled={!participant1 || !participant2}
          >
            Registrar reunión
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

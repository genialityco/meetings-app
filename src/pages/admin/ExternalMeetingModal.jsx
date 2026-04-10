/* eslint-disable react/prop-types */
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
  const [saving, setSaving] = useState(false);

  // Multi-day support
  const eventDates = event?.config?.eventDates || (event?.config?.eventDate ? [event.config.eventDate] : []);
  const isMultiDay = eventDates.length > 1;
  const [selectedDate, setSelectedDate] = useState(eventDates[0] || "");

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
    setSelectedDate(eventDates[0] || "");
  }, [opened, event?.id]);

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
    try {
      await addDoc(collection(db, "events", event.id, "meetings"), {
        eventId: event.id,
        requesterId: participant1,
        receiverId: participant2,
        participants: [participant1, participant2],
        status: "accepted",
        isExternal: true,
        completed: true,
        timeSlot: timeSlot.trim() || "—",
        tableAssigned: "",
        meetingDate: selectedDate || null,
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

        <TextInput
          label="Horario (opcional)"
          placeholder="Ej: 10:00 - 10:30"
          value={timeSlot}
          onChange={(e) => setTimeSlot(e.currentTarget.value)}
          description="Texto libre, no se valida contra la agenda"
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

/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable react/prop-types */
import { Button, Modal, Select, Stack } from "@mantine/core";
import { addDoc, collection, getDocs, query, where, updateDoc, doc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { useEffect, useState, useMemo } from "react";

const ManualMeetingModal = ({
  opened,
  onClose,
  event,
  setGlobalMessage,
  initialParticipant1 = null,
  initialParticipant2 = null,
}) => {
  const [assistants, setAssistants] = useState([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [selectedTimeSlot, setSelectedTimeSlot] = useState("");
  const [participant1, setParticipant1] = useState("");
  const [participant2, setParticipant2] = useState("");

  // Multi-day support
  const eventDates = event.config?.eventDates || (event.config?.eventDate ? [event.config.eventDate] : []);
  const isMultiDay = eventDates.length > 1;
  const [selectedDate, setSelectedDate] = useState(eventDates[0] || null);

  const formatDate = (dateStr) => {
    const [year, month, day] = dateStr.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString("es-ES", {
      weekday: "short", day: "numeric", month: "short",
    });
  };

  useEffect(() => {
    fetchAssistants();
    setSelectedTable("");
    setSelectedTimeSlot("");
    setParticipant1(initialParticipant1 || "");
    setParticipant2(initialParticipant2 || "");
    setSelectedDate(eventDates[0] || null);
  }, [event, initialParticipant1, initialParticipant2]);

  // Reset slot when date changes
  useEffect(() => {
    setSelectedTimeSlot("");
  }, [selectedDate]);

  const fetchAssistants = async () => {
    try {
      const q = query(collection(db, "users"), where("eventId", "==", event.id));
      const snap = await getDocs(q);
      setAssistants(snap.docs.map((d) => ({
        value: d.id,
        label: `${d.data().nombre} - ${d.data().empresa}`,
      })));
    } catch (error) {
      console.error("Error al obtener asistentes:", error);
    }
  };

  const timeSlots = useMemo(() => {
    const cfg = event.config;
    const dayConfig = (selectedDate && cfg.dailyConfig?.[selectedDate]) || {
      startTime: cfg.startTime,
      endTime: cfg.endTime,
      breakBlocks: cfg.breakBlocks || [],
    };
    const { meetingDuration, breakTime } = cfg;
    const blockLength = meetingDuration + breakTime;

    const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
    const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

    const sortedBreaks = [...(dayConfig.breakBlocks || [])]
      .filter((b) => b.start && b.end)
      .map((b) => ({ start: toMin(b.start), end: toMin(b.end) }))
      .sort((a, b) => a.start - b.start);

    const segments = [];
    let segStart = toMin(dayConfig.startTime);
    const dayEnd = toMin(dayConfig.endTime);
    for (const br of sortedBreaks) {
      if (br.start > segStart) segments.push([segStart, br.start]);
      segStart = br.end;
    }
    if (segStart < dayEnd) segments.push([segStart, dayEnd]);

    const slots = [];
    for (const [segBegin, segEnd] of segments) {
      const total = Math.floor((segEnd - segBegin) / blockLength);
      for (let i = 0; i < total; i++) {
        const t = toHHMM(segBegin + i * blockLength);
        slots.push({ value: t, label: t });
      }
    }
    return slots;
  }, [event.config, selectedDate]);

  const assignMeetingManually = async () => {
    if (!selectedTable || !selectedTimeSlot || !participant1 || !participant2) {
      setGlobalMessage("Todos los campos son obligatorios.");
      return;
    }
    if (isMultiDay && !selectedDate) {
      setGlobalMessage("Debes seleccionar un día.");
      return;
    }
    if (participant1 === participant2) {
      setGlobalMessage("Los participantes deben ser diferentes.");
      return;
    }

    const meetingData = {
      eventId: event.id,
      requesterId: participant1,
      receiverId: participant2,
      status: "accepted",
      createdAt: new Date(),
      timeSlot: selectedTimeSlot,
      tableAssigned: selectedTable.toString(),
      participants: [participant1, participant2],
      motivoMatch: "Manual",
      razonMatch: "Agendada manualmente por admin",
      scoreMatch: null,
      agendadoAutomatico: false,
      isNotificated: false,
      ...(selectedDate ? { meetingDate: selectedDate } : {}),
    };

    try {
      const docRef = await addDoc(collection(db, "events", event.id, "meetings"), meetingData);

      // Marcar slot en agenda como ocupado
      try {
        const q = query(
          collection(db, "events", event.id, "agenda"),
          where("tableNumber", "==", parseInt(selectedTable, 10)),
          where("startTime", "==", selectedTimeSlot),
          ...(selectedDate ? [where("date", "==", selectedDate)] : [])
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          await updateDoc(doc(db, "events", event.id, "agenda", snap.docs[0].id), {
            available: false,
            meetingId: docRef.id,
          });
        }
      } catch (slotErr) {
        console.warn("No se pudo actualizar el slot en agenda:", slotErr);
      }

      setGlobalMessage("Reunión asignada manualmente.");
      onClose();
    } catch (error) {
      console.error("Error al asignar reunión:", error);
      setGlobalMessage("Error al asignar reunión.");
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Agendar Reunión Manual">
      <Stack>
        {isMultiDay && (
          <Select
            label="Día"
            data={eventDates.map((d) => ({ value: d, label: formatDate(d) }))}
            value={selectedDate}
            onChange={setSelectedDate}
          />
        )}
        <Select
          label="Número de Mesa"
          data={Array.from({ length: event.config.numTables }, (_, i) => ({
            value: (i + 1).toString(),
            label: `Mesa ${i + 1}`,
          }))}
          value={selectedTable}
          onChange={setSelectedTable}
          searchable
        />
        <Select
          label="Horario"
          data={timeSlots}
          value={selectedTimeSlot}
          onChange={setSelectedTimeSlot}
          searchable
        />
        <Select
          label="Participante 1"
          data={assistants}
          value={participant1}
          onChange={setParticipant1}
          searchable
        />
        <Select
          label="Participante 2"
          data={assistants}
          value={participant2}
          onChange={setParticipant2}
          searchable
        />
        <Button onClick={assignMeetingManually}>Asignar Reunión</Button>
      </Stack>
    </Modal>
  );
};

export default ManualMeetingModal;

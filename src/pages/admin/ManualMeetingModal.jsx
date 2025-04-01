/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable react/prop-types */
import { Button, Modal, Select, Stack } from "@mantine/core";
import { addDoc, collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { useEffect, useState } from "react";

/* ===================================================
   Componente ManualMeetingModal
   – Modal para asignar una reunión manual a un evento.
     Se generan los horarios disponibles a partir de la
     configuración del evento y se listan los asistentes.
=================================================== */
const ManualMeetingModal = ({ opened, onClose, event, setGlobalMessage }) => {
  const [assistants, setAssistants] = useState([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [selectedTimeSlot, setSelectedTimeSlot] = useState("");
  const [participant1, setParticipant1] = useState("");
  const [participant2, setParticipant2] = useState("");
  const [timeSlots, setTimeSlots] = useState([]);

  useEffect(() => {
    fetchAssistants();
    generateTimeSlots();
    // Reiniciamos los campos al abrir el modal
    setSelectedTable("");
    setSelectedTimeSlot("");
    setParticipant1("");
    setParticipant2("");
  }, [event]);

  const fetchAssistants = async () => {
    try {
      // Consulta a la colección "users" SOLO los que tengan eventId == event.id
      const q = query(
        collection(db, "users"),
        where("eventId", "==", event.id)
      );
      const usersSnapshot = await getDocs(q);

      const usersList = usersSnapshot.docs.map((doc) => ({
        value: doc.id,
        label: `${doc.data().nombre} - ${doc.data().empresa}`,
      }));
      setAssistants(usersList);
    } catch (error) {
      console.error("Error al obtener asistentes:", error);
    }
  };

  const generateTimeSlots = () => {
    const { startTime, endTime, meetingDuration, breakTime } = event.config;
    const slots = [];
    let currentTime = new Date(`1970-01-01T${startTime}:00`);
    const endTimeObj = new Date(`1970-01-01T${endTime}:00`);
    while (currentTime < endTimeObj) {
      const formattedTime = currentTime.toTimeString().substring(0, 5);
      slots.push({ value: formattedTime, label: formattedTime });
      currentTime.setMinutes(
        currentTime.getMinutes() + meetingDuration + breakTime
      );
    }
    setTimeSlots(slots);
  };

  const assignMeetingManually = async () => {
    if (!selectedTable || !selectedTimeSlot || !participant1 || !participant2) {
      setGlobalMessage("Todos los campos son obligatorios.");
      return;
    }
    if (participant1 === participant2) {
      setGlobalMessage("Los participantes deben ser diferentes.");
      return;
    }
    const meetingData = {
      tableAssigned: selectedTable,
      timeSlot: selectedTimeSlot,
      status: "accepted",
      participants: [participant1, participant2],
    };
    try {
      // Se agrega la reunión en un subdocumento de "meetings" dentro del evento
      await addDoc(collection(db, "events", event.id, "meetings"), meetingData);
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

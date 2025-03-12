import { useEffect, useState } from "react";
import {
  Container,
  Title,
  Paper,
  Stack,
  NumberInput,
  TextInput,
  Button,
  Group,
  Text,
  Select,
  Switch,
} from "@mantine/core";
import {
  doc,
  setDoc,
  addDoc,
  collection,
  deleteDoc,
  getDocs,
  updateDoc,
  getDoc,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";

const AdminPanel = () => {
  // Estados para la configuración
  const [maxPersons, setMaxPersons] = useState(100);
  const [numTables, setNumTables] = useState(50);
  const [meetingDuration, setMeetingDuration] = useState(10);
  const [breakTime, setBreakTime] = useState(5);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [tableNamesInput, setTableNamesInput] = useState("");
  const [message, setMessage] = useState("");

  const [solicitarReunionHabilitado, setSolicitarReunionHabilitado] =
    useState(true);

  // Estados para asignación manual
  const [selectedTable, setSelectedTable] = useState("");
  const [selectedTimeSlot, setSelectedTimeSlot] = useState("");
  const [participant1, setParticipant1] = useState("");
  const [participant2, setParticipant2] = useState("");
  const [assistants, setAssistants] = useState([]);
  const [timeSlots, setTimeSlots] = useState([]);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const configDoc = await getDoc(doc(db, "config", "meetingConfig"));
        if (configDoc.exists()) {
          const data = configDoc.data();
          setMaxPersons(data.maxPersons);
          setNumTables(data.numTables);
          setMeetingDuration(data.meetingDuration);
          setBreakTime(data.breakTime);
          setStartTime(data.startTime);
          setEndTime(data.endTime);
          setTableNamesInput(data.tableNames.join(", "));
          generateTimeSlots(
            data.startTime,
            data.endTime,
            data.meetingDuration,
            data.breakTime
          );
        }
        const generalSettings = await getDoc(
          doc(db, "config", "generalSettings")
        );
        if (generalSettings.exists()) {
          setSolicitarReunionHabilitado(
            generalSettings.data().solicitarReunionHabilitado
          );
        }
      } catch (error) {
        console.error("Error al cargar configuración:", error);
      }
    };

    fetchConfig();
    fetchAssistants();
  }, []);

  const toggleSolicitarReunion = async (value) => {
    setSolicitarReunionHabilitado(value);
    try {
      await setDoc(doc(db, "config", "generalSettings"), {
        solicitarReunionHabilitado: value,
      });
    } catch (error) {
      console.error("Error al actualizar configuración global:", error);
    }
  };

  // Obtener asistentes desde Firestore
  const fetchAssistants = async () => {
    try {
      const usersSnapshot = await getDocs(collection(db, "users"));
      const usersList = usersSnapshot.docs.map((doc) => ({
        value: doc.id,
        label: doc.data().nombre + " - " + doc.data().empresa,
      }));
      setAssistants(usersList);
    } catch (error) {
      console.error("Error al obtener asistentes:", error);
    }
  };

  // Generar horarios disponibles
  const generateTimeSlots = (start, end, duration, breakTime) => {
    const slots = [];
    let currentTime = new Date(`1970-01-01T${start}:00`);
    const endTime = new Date(`1970-01-01T${end}:00`);

    while (currentTime < endTime) {
      let formattedTime = currentTime.toTimeString().substring(0, 5);
      slots.push({ value: formattedTime, label: formattedTime });

      currentTime.setMinutes(currentTime.getMinutes() + duration + breakTime);
    }

    setTimeSlots(slots);
  };

  // Guardar configuración en Firestore
  const saveConfig = async () => {
    try {
      let tableNames = [];
      if (tableNamesInput.trim() !== "") {
        tableNames = tableNamesInput
          .split(",")
          .map((name) => name.trim())
          .filter((name) => name !== "");
        if (tableNames.length !== numTables) {
          setMessage(
            `Se han ingresado ${tableNames.length} nombres de mesas; se usará este número como cantidad de mesas.`
          );
          setNumTables(tableNames.length);
        }
      } else {
        tableNames = Array.from({ length: numTables }, (_, i) =>
          (i + 1).toString()
        );
      }

      const configData = {
        maxPersons,
        numTables,
        meetingDuration,
        breakTime,
        startTime,
        endTime,
        tableNames,
      };

      await setDoc(doc(db, "config", "meetingConfig"), configData);
      setMessage("Configuración guardada correctamente.");
    } catch (error) {
      console.error("Error al guardar configuración:", error);
      setMessage("Error al guardar configuración.");
    }
  };

  // Funciones auxiliares para convertir horas a minutos y viceversa
  const timeToMinutes = (timeStr) => {
    const [hours, minutes] = timeStr.split(":").map(Number);
    return hours * 60 + minutes;
  };

  const minutesToTime = (minutes) => {
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hrs.toString().padStart(2, "0")}:${mins
      .toString()
      .padStart(2, "0")}`;
  };

  // Generar la agenda con descanso entre citas
  const generateAgenda = async () => {
    try {
      await resetAgenda(); // Borrar agenda antes de generar nueva

      const startMinutes = timeToMinutes(startTime);
      const endMinutes = timeToMinutes(endTime);
      const totalSlots = Math.floor(
        (endMinutes - startMinutes) / (meetingDuration + breakTime)
      );
      let createdCount = 0;

      for (let slot = 0; slot < totalSlots; slot++) {
        const slotStart = startMinutes + slot * (meetingDuration + breakTime);
        const slotEnd = slotStart + meetingDuration;
        const slotStartTime = minutesToTime(slotStart);
        const slotEndTime = minutesToTime(slotEnd);

        for (let tableNumber = 1; tableNumber <= numTables; tableNumber++) {
          const slotData = {
            tableNumber,
            startTime: slotStartTime,
            endTime: slotEndTime,
            available: true,
          };

          await addDoc(collection(db, "agenda"), slotData);
          createdCount++;
        }
      }
      setMessage(`Agenda generada con éxito: ${createdCount} slots creados.`);
    } catch (error) {
      console.error("Error al generar la agenda:", error);
      setMessage("Error al generar la agenda.");
    }
  };

  // Restablecer la agenda (Eliminar todas las citas)
  const resetAgenda = async () => {
    try {
      // Eliminar todas las reuniones en la colección "meetings"
      const meetingsSnapshot = await getDocs(collection(db, "meetings"));
      meetingsSnapshot.forEach(async (docItem) => {
        await deleteDoc(doc(db, "meetings", docItem.id));
      });

      // Marcar todos los slots en "agenda" como disponibles nuevamente
      const agendaSnapshot = await getDocs(collection(db, "agenda"));
      agendaSnapshot.forEach(async (docItem) => {
        await updateDoc(doc(db, "agenda", docItem.id), {
          available: true,
          meetingId: null, // Removemos la reunión asignada
        });
      });

      setMessage(
        "Agenda restablecida: Todas las reuniones eliminadas y los horarios habilitados."
      );
    } catch (error) {
      console.error("Error al restablecer la agenda:", error);
      setMessage("Error al restablecer la agenda.");
    }
  };

  // Asignar reunión manualmente
  const assignMeetingManually = async () => {
    try {
      if (
        !selectedTable ||
        !selectedTimeSlot ||
        !participant1 ||
        !participant2
      ) {
        setMessage(
          "Todos los campos son obligatorios para asignar una reunión."
        );
        return;
      }

      if (participant1 === participant2) {
        setMessage("No puedes seleccionar el mismo usuario dos veces.");
        return;
      }

      const meetingData = {
        tableAssigned: selectedTable,
        timeSlot: selectedTimeSlot,
        status: "accepted",
        participants: [participant1, participant2],
      };

      await addDoc(collection(db, "meetings"), meetingData);
      setMessage("Reunión asignada manualmente con éxito.");
    } catch (error) {
      console.error("Error al asignar reunión:", error);
      setMessage("Error al asignar reunión.");
    }
  };

  return (
    <Container>
      <Title order={2} mt="md" mb="md">
        Panel de Administración
      </Title>
      <Paper shadow="sm" p="xl" style={{ maxWidth: 600, margin: "0 auto" }}>
        <Stack spacing="md">
          <Switch
            label="Habilitar solicitudes de reunión"
            checked={solicitarReunionHabilitado}
            onChange={(event) =>
              toggleSolicitarReunion(event.currentTarget.checked)
            }
            size="lg"
          />
          <NumberInput
            label="Cantidad máxima de personas"
            value={maxPersons}
            onChange={setMaxPersons}
            min={1}
          />
          <NumberInput
            label="Cantidad de mesas"
            value={numTables}
            onChange={setNumTables}
            min={1}
          />
          <TextInput
            label="Nombres de mesas (opcional)"
            placeholder="Ej. Mesa 1, Mesa 2, ..."
            value={tableNamesInput}
            onChange={(e) => setTableNamesInput(e.target.value)}
          />
          <NumberInput
            label="Duración de cada cita (minutos)"
            value={meetingDuration}
            onChange={setMeetingDuration}
            min={5}
          />
          <NumberInput
            label="Tiempo entre citas (minutos)"
            value={breakTime}
            onChange={setBreakTime}
            min={0}
          />
          <TextInput
            label="Hora de inicio de citas (HH:mm)"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
          <TextInput
            label="Hora de fin de citas (HH:mm)"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
          <Group position="center">
            <Button onClick={saveConfig}>Guardar Configuración</Button>
            <Button onClick={generateAgenda} color="blue">
              Generar Agenda
            </Button>
            <Button onClick={resetAgenda} color="red">
              Restablecer Agenda
            </Button>
          </Group>
          {message && <Text color="green">{message}</Text>}
        </Stack>

        {/* Asignación Manual */}
        <Title order={3} mt="xl">
          Asignar Reunión Manualmente
        </Title>
        <Title order={3} mt="xl">
          Asignar Reunión Manualmente
        </Title>
        <Stack>
          <Select
            label="Número de Mesa"
            data={Array.from({ length: numTables }, (_, i) => ({
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
          <Button onClick={assignMeetingManually} color="green">
            Asignar Reunión
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
};

export default AdminPanel;

import { useState, useEffect } from "react";
import {
  Container,
  Title,
  Button,
  Card,
  Text,
  Group,
  Stack,
} from "@mantine/core";
import {
  collection,
  getDocs,
  updateDoc,
  doc,
  getDoc,
  addDoc,
  deleteDoc,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import CreateEventModal from "./CreateEventModal";
import EditEventConfigModal from "./EditEventConfigModal";
import ManualMeetingModal from "./ManualMeetingModal";
import { Link } from "react-router-dom";

const AdminPanel = () => {
  const [events, setEvents] = useState([]);
  const [globalMessage, setGlobalMessage] = useState("");
  const [createModalOpened, setCreateModalOpened] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [editConfigModalOpened, setEditConfigModalOpened] = useState(false);
  const [manualMeetingModalOpened, setManualMeetingModalOpened] = useState(false);

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    try {
      const eventsSnapshot = await getDocs(collection(db, "events"));
      const eventsList = eventsSnapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      }));
      setEvents(eventsList);
    } catch (error) {
      console.error("Error al obtener eventos:", error);
      setGlobalMessage("Error al obtener eventos.");
    }
  };

  // Función para alternar la habilitación de registros para un evento
  const toggleRegistration = async (event) => {
    try {
      const currentStatus = event.config?.registrationEnabled ?? true;
      await updateDoc(doc(db, "events", event.id), {
        "config.registrationEnabled": !currentStatus,
      });
      setGlobalMessage(
        `Registros ${!currentStatus ? "habilitados" : "inhabilitados"} correctamente.`
      );
      fetchEvents();
    } catch (error) {
      console.error("Error toggling registration:", error);
      setGlobalMessage("Error al actualizar el estado de registros.");
    }
  };

  // Funciones auxiliares para conversión de horas a minutos y viceversa
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

  // Función para obtener la configuración de reuniones desde Firestore
  const fetchMeetingConfig = async () => {
    try {
      const configDoc = await getDoc(doc(db, "config", "meetingConfig"));
      if (configDoc.exists()) {
        return configDoc.data();
      } else {
        throw new Error("No existe la configuración de reuniones");
      }
    } catch (error) {
      console.error("Error fetching meeting config:", error);
      throw error;
    }
  };

  // Generar la agenda para un evento (se asigna eventId a cada slot)
  const generateAgendaForEvent = async (event) => {
    try {
      // Obtener configuración de reuniones
      const config = await fetchMeetingConfig();
      const { meetingDuration, breakTime, startTime, endTime, numTables } = config;
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
            eventId: event.id, // Se asocia el slot al evento actual
            tableNumber,
            startTime: slotStartTime,
            endTime: slotEndTime,
            available: true,
          };
          await addDoc(collection(db, "agenda"), slotData);
          createdCount++;
        }
      }
      setGlobalMessage(
        `Agenda generada: ${createdCount} slots creados para el evento ${event.eventName}.`
      );
    } catch (error) {
      console.error("Error al generar agenda:", error);
      setGlobalMessage("Error al generar la agenda.");
    }
  };

  // Restablecer la agenda para un evento: se actualizan los slots existentes para marcarlos disponibles
  const resetAgendaForEvent = async (event) => {
    try {
      const agendaQuery = query(
        collection(db, "agenda"),
        where("eventId", "==", event.id)
      );
      const agendaSnapshot = await getDocs(agendaQuery);
      agendaSnapshot.forEach(async (docItem) => {
        await updateDoc(doc(db, "agenda", docItem.id), {
          available: true,
          meetingId: null, // Se elimina la asignación de reunión
        });
      });
      setGlobalMessage(`Agenda restablecida para el evento ${event.eventName}.`);
    } catch (error) {
      console.error("Error al restablecer agenda:", error);
      setGlobalMessage("Error al restablecer la agenda.");
    }
  };

  // Borrar completamente la agenda para un evento (eliminar documentos)
  const deleteAgendaForEvent = async (event) => {
    try {
      const agendaQuery = query(
        collection(db, "agenda"),
        where("eventId", "==", event.id)
      );
      const agendaSnapshot = await getDocs(agendaQuery);
      let deletedCount = 0;
      agendaSnapshot.forEach(async (docItem) => {
        await deleteDoc(doc(db, "agenda", docItem.id));
        deletedCount++;
      });
      setGlobalMessage(
        `Agenda borrada: ${deletedCount} slots eliminados para el evento ${event.eventName}.`
      );
    } catch (error) {
      console.error("Error al borrar agenda:", error);
      setGlobalMessage("Error al borrar la agenda.");
    }
  };

  // Función que se llama al hacer clic en "Generar Agenda" dentro de la tarjeta de un evento
  const handleGenerateAgenda = async (event) => {
    await generateAgendaForEvent(event);
    // Opcional: actualizar la configuración del evento indicando que la agenda fue generada
    await updateDoc(doc(db, "events", event.id), {
      "config.agendaGenerated": true,
    });
    fetchEvents();
  };

  return (
    <Container>
      <Title mt="md">Dashboard de Eventos</Title>
      <Button mt="md" onClick={() => setCreateModalOpened(true)}>
        Crear Evento
      </Button>

      <Stack mt="md">
        {events.map((event) => (
          <Card key={event.id} shadow="sm" p="lg">
            <Group position="apart">
              <div>
                <Title order={4}>{event.eventName}</Title>
                {event.eventImage && (
                  <img
                    src={event.eventImage}
                    alt={event.eventName}
                    style={{ maxWidth: 200, marginTop: 8 }}
                  />
                )}
              </div>
              <Group>
                <Button
                  onClick={() => {
                    setSelectedEvent(event);
                    setEditConfigModalOpened(true);
                  }}
                >
                  Editar Configuración
                </Button>
                <Button
                  onClick={() => {
                    setSelectedEvent(event);
                    setManualMeetingModalOpened(true);
                  }}
                >
                  Agendar Reunión Manual
                </Button>
                <Button component={Link} to={`/event/${event.id}`}>
                  Ir a la landing
                </Button>
                <Button component={Link} to={`/matrix/${event.id}`}>
                  Ver Matriz
                </Button>
                <Button onClick={() => toggleRegistration(event)}>
                  {event.config?.registrationEnabled
                    ? "Inhabilitar Registros"
                    : "Habilitar Registros"}
                </Button>
                {/* Botones para la agenda (por evento) */}
                <Button onClick={() => handleGenerateAgenda(event)}>
                  Generar Agenda
                </Button>
                <Button color="orange" onClick={() => resetAgendaForEvent(event)}>
                  Restablecer Agenda
                </Button>
                <Button color="red" onClick={() => deleteAgendaForEvent(event)}>
                  Borrar Agenda
                </Button>
              </Group>
            </Group>
          </Card>
        ))}
      </Stack>

      <CreateEventModal
        opened={createModalOpened}
        onClose={() => setCreateModalOpened(false)}
        refreshEvents={fetchEvents}
        setGlobalMessage={setGlobalMessage}
      />

      {selectedEvent && (
        <EditEventConfigModal
          opened={editConfigModalOpened}
          onClose={() => setEditConfigModalOpened(false)}
          event={selectedEvent}
          refreshEvents={fetchEvents}
          setGlobalMessage={setGlobalMessage}
        />
      )}

      {selectedEvent && (
        <ManualMeetingModal
          opened={manualMeetingModalOpened}
          onClose={() => setManualMeetingModalOpened(false)}
          event={selectedEvent}
          setGlobalMessage={setGlobalMessage}
        />
      )}

      {globalMessage && (
        <Text mt="md" c="green">
          {globalMessage}
        </Text>
      )}
    </Container>
  );
};

export default AdminPanel;

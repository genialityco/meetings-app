import { useState, useEffect } from "react";
import {
  Container,
  Title,
  Button,
  Card,
  Text,
  Group,
  Stack,
  Loader,
  Center,
  Image,
  Alert,
} from "@mantine/core";
import {
  collection,
  getDocs,
  updateDoc,
  doc,
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
import MeetingsListModal from "./MeetingsListModal";
import AttendeesListModal from "./AttendeesListModal";

const AdminPanel = () => {
  const [events, setEvents] = useState([]);
  const [globalMessage, setGlobalMessage] = useState("");
  const [createModalOpened, setCreateModalOpened] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [editConfigModalOpened, setEditConfigModalOpened] = useState(false);
  const [manualMeetingModalOpened, setManualMeetingModalOpened] =
    useState(false);
  const [meetingsModalOpened, setMeetingsModalOpened] = useState(false);
  const [attendeesModalOpened, setAttendeesModalOpened] = useState(false);

  // Estados de loading
  const [loadingEvents, setLoadingEvents] = useState(false); // Cargando eventos inicialmente
  const [actionLoading, setActionLoading] = useState(false); // Cargando acciones (e.g. toggle, generar agenda, etc.)

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    try {
      setLoadingEvents(true); // Mostrar loader mientras obtenemos datos
      const eventsSnapshot = await getDocs(collection(db, "events"));
      const eventsList = eventsSnapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      }));
      setEvents(eventsList);
    } catch (error) {
      console.error("Error al obtener eventos:", error);
      setGlobalMessage("Error al obtener eventos.");
    } finally {
      setLoadingEvents(false); // Dejar de mostrar loader
    }
  };

  // Función para alternar la habilitación de registros para un evento
  const toggleRegistration = async (event) => {
    try {
      setActionLoading(true);
      const currentStatus = event.config?.registrationEnabled ?? true;
      await updateDoc(doc(db, "events", event.id), {
        "config.registrationEnabled": !currentStatus,
      });
      setGlobalMessage(
        `Registros ${
          !currentStatus ? "habilitados" : "inhabilitados"
        } correctamente.`
      );
      fetchEvents();
    } catch (error) {
      console.error("Error toggling registration:", error);
      setGlobalMessage("Error al actualizar el estado de registros.");
    } finally {
      setActionLoading(false);
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

  // Generar la agenda para un evento (se asigna eventId a cada slot)
  const generateAgendaForEvent = async (event) => {
    try {
      setActionLoading(true);

      // IMPORTANTE: Usar la config del propio evento
      const { meetingDuration, breakTime, startTime, endTime, numTables } =
        event.config;

      const startMinutes = timeToMinutes(startTime);
      const endMinutes = timeToMinutes(endTime);

      // Cada bloque = meetingDuration + breakTime
      const blockLength = meetingDuration + breakTime;
      const totalSlots = Math.floor((endMinutes - startMinutes) / blockLength);

      let createdCount = 0;

      for (let slot = 0; slot < totalSlots; slot++) {
        const slotStart = startMinutes + slot * blockLength;
        const slotEnd = slotStart + meetingDuration;
        const slotStartTime = minutesToTime(slotStart);
        const slotEndTime = minutesToTime(slotEnd);

        for (let tableNumber = 1; tableNumber <= numTables; tableNumber++) {
          const slotData = {
            eventId: event.id,
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
    } finally {
      setActionLoading(false);
    }
  };

  // Restablecer la agenda para un evento (marcar slots existentes como disponibles)
  const resetAgendaForEvent = async (event) => {
    try {
      setActionLoading(true);
      const agendaQuery = query(
        collection(db, "agenda"),
        where("eventId", "==", event.id)
      );
      const agendaSnapshot = await getDocs(agendaQuery);
      agendaSnapshot.forEach(async (docItem) => {
        await updateDoc(doc(db, "agenda", docItem.id), {
          available: true,
          meetingId: null, // Se quita la asignación a reunión
        });
      });
      setGlobalMessage(
        `Agenda restablecida para el evento ${event.eventName}.`
      );
    } catch (error) {
      console.error("Error al restablecer agenda:", error);
      setGlobalMessage("Error al restablecer la agenda.");
    } finally {
      setActionLoading(false);
    }
  };

  // Borrar completamente la agenda para un evento (eliminar documentos en "agenda" y en subcolección "meetings")
  const deleteAgendaForEvent = async (event) => {
    try {
      setActionLoading(true);

      // 1. Eliminar todos los documentos de "agenda" que pertenezcan a este evento
      const agendaQuery = query(
        collection(db, "agenda"),
        where("eventId", "==", event.id)
      );
      const agendaSnapshot = await getDocs(agendaQuery);
      let deletedCountAgenda = 0;
      for (const docItem of agendaSnapshot.docs) {
        await deleteDoc(doc(db, "agenda", docItem.id));
        deletedCountAgenda++;
      }

      // 2. Eliminar todos los documentos de la subcolección "meetings" del evento
      const meetingsRef = collection(db, "events", event.id, "meetings");
      const meetingsSnapshot = await getDocs(meetingsRef);
      let deletedCountMeetings = 0;
      for (const docItem of meetingsSnapshot.docs) {
        await deleteDoc(doc(db, "events", event.id, "meetings", docItem.id));
        deletedCountMeetings++;
      }

      setGlobalMessage(
        `Agenda borrada: ${deletedCountAgenda} slots y ${deletedCountMeetings} reuniones eliminados para el evento ${event.eventName}.`
      );
    } catch (error) {
      console.error("Error al borrar agenda:", error);
      setGlobalMessage("Error al borrar la agenda.");
    } finally {
      setActionLoading(false);
    }
  };

  // Función para "Generar Agenda" dentro de la tarjeta de un evento
  const handleGenerateAgenda = async (event) => {
    await generateAgendaForEvent(event);
    // Opcional: marcar en la config del evento que se ha generado la agenda
    await updateDoc(doc(db, "events", event.id), {
      "config.agendaGenerated": true,
    });
    fetchEvents();
  };

  return (
    <Container>
      <Title mt="md">Dashboard de Eventos</Title>

      {/* Loader global si aún se están cargando los eventos */}
      {loadingEvents ? (
        <Center mt="lg">
          <Loader size="lg" />
        </Center>
      ) : (
        <>
          <Button mt="md" onClick={() => setCreateModalOpened(true)}>
            Crear Evento
          </Button>

          {/* Si hay un mensaje global, lo mostramos en un Alert */}
          {globalMessage && (
            <Alert
              mt="md"
              title="Aviso"
              color="green"
              withCloseButton
              onClose={() => setGlobalMessage("")}
            >
              {globalMessage}
            </Alert>
          )}

          <Stack mt="md">
            {events.map((event) => (
              <Card key={event.id} shadow="sm" p="lg" withBorder>
                <Card.Section>
                  {/* Si el evento tiene imagen, la mostramos */}
                  {event.eventImage && (
                    <Image
                      src={event.eventImage}
                      alt={event.eventName}
                      height={160}
                      fit="cover"
                    />
                  )}
                </Card.Section>

                <Group position="apart" mt="md">
                  <div>
                    <Title order={4}>{event.eventName}</Title>
                    <Text size="sm" color="dimmed">
                      ID: {event.id}
                    </Text>
                  </div>

                  <Group spacing="xs" align="flex-start">
                    <Button
                      onClick={() => {
                        setSelectedEvent(event);
                        setEditConfigModalOpened(true);
                      }}
                      loading={actionLoading}
                      disabled={actionLoading}
                    >
                      Editar Configuración
                    </Button>

                    <Button
                      onClick={() => {
                        setSelectedEvent(event);
                        setManualMeetingModalOpened(true);
                      }}
                      loading={actionLoading}
                      disabled={actionLoading}
                    >
                      Agendar Reunión Manual
                    </Button>

                    <Button
                      component={Link}
                      to={`/event/${event.id}`}
                      loading={actionLoading}
                      disabled={actionLoading}
                    >
                      Ir a la landing
                    </Button>

                    <Button
                      component={Link}
                      to={`/matrix/${event.id}`}
                      loading={actionLoading}
                      disabled={actionLoading}
                    >
                      Ver Matriz
                    </Button>

                    <Button
                      onClick={() => toggleRegistration(event)}
                      loading={actionLoading}
                      disabled={actionLoading}
                    >
                      {event.config?.registrationEnabled
                        ? "Inhabilitar Registros"
                        : "Habilitar Registros"}
                    </Button>

                    <Button
                      onClick={() => handleGenerateAgenda(event)}
                      loading={actionLoading}
                      disabled={actionLoading}
                    >
                      Generar Agenda
                    </Button>

                    <Button
                      color="orange"
                      onClick={() => resetAgendaForEvent(event)}
                      loading={actionLoading}
                      disabled={actionLoading}
                    >
                      Restablecer Agenda
                    </Button>

                    <Button
                      color="red"
                      onClick={() => deleteAgendaForEvent(event)}
                      loading={actionLoading}
                      disabled={actionLoading}
                    >
                      Borrar Agenda
                    </Button>

                    <Button
                      onClick={() => {
                        setSelectedEvent(event);
                        setMeetingsModalOpened(true);
                      }}
                      loading={actionLoading}
                      disabled={actionLoading}
                    >
                      Ver Reuniones
                    </Button>

                    {/* Nuevo botón para ver asistentes */}
                    <Button
                      onClick={() => {
                        setSelectedEvent(event);
                        setAttendeesModalOpened(true);
                      }}
                      loading={actionLoading}
                      disabled={actionLoading}
                    >
                      Ver Asistentes
                    </Button>
                  </Group>
                </Group>
              </Card>
            ))}
          </Stack>
        </>
      )}

      {/* Modales */}
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

{selectedEvent && (
  <MeetingsListModal
    opened={meetingsModalOpened}
    onClose={() => setMeetingsModalOpened(false)}
    event={selectedEvent}
    setGlobalMessage={setGlobalMessage}
  />
)}

{selectedEvent && (
  <AttendeesListModal
    opened={attendeesModalOpened}
    onClose={() => setAttendeesModalOpened(false)}
    event={selectedEvent}
    setGlobalMessage={setGlobalMessage}
  />
)}

    </Container>
  );
};

export default AdminPanel;

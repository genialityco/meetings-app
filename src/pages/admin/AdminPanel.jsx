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
import { collection, getDocs, updateDoc, doc } from "firebase/firestore";
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
      const eventsList = eventsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
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
                <Button onClick={() => toggleRegistration(event)}>
                  {event.config?.registrationEnabled
                    ? "Inhabilitar Registros"
                    : "Habilitar Registros"}
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
        <Text mt="md" color="green">
          {globalMessage}
        </Text>
      )}
    </Container>
  );
};

export default AdminPanel;

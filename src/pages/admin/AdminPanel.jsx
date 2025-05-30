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
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import CreateEventModal from "./CreateEventModal";
import { Link } from "react-router-dom";

const AdminPanel = () => {
  const [events, setEvents] = useState([]);
  const [globalMessage, setGlobalMessage] = useState("");
  const [createModalOpened, setCreateModalOpened] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    try {
      setLoadingEvents(true);
      const eventsSnapshot = await getDocs(collection(db, "events"));
      const eventsList = eventsSnapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      }));
      setEvents(eventsList);
    } catch (error) {
      console.log(error);
      setGlobalMessage("Error al obtener eventos.");
    } finally {
      setLoadingEvents(false);
    }
  };

  return (
    <Container>
      <Title mt="md">Dashboard de Eventos</Title>
      {loadingEvents ? (
        <Center mt="lg">
          <Loader size="lg" />
        </Center>
      ) : (
        <>
          <Button mt="md" onClick={() => setCreateModalOpened(true)}>
            Crear Evento
          </Button>
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
                  <Button component={Link} to={`/admin/event/${event.id}`}>
                    Administrar Evento
                  </Button>
                </Group>
              </Card>
            ))}
          </Stack>
        </>
      )}
      <CreateEventModal
        opened={createModalOpened}
        onClose={() => setCreateModalOpened(false)}
        refreshEvents={fetchEvents}
        setGlobalMessage={setGlobalMessage}
      />
    </Container>
  );
};

export default AdminPanel;

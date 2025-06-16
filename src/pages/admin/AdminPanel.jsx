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
  Grid,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import CreateEventModal from "./CreateEventModal";
import { Link } from "react-router-dom";

const AdminPanel = () => {
  const [events, setEvents] = useState([]);
  const [globalMessage, setGlobalMessage] = useState("");
  const [createModalOpened, setCreateModalOpened] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const isMobile = useMediaQuery("(max-width: 600px)");

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    try {
      setLoadingEvents(true);
      const eventsSnapshot = await getDocs(collection(db, "events"));
      let eventsList = eventsSnapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      }));
      // Ordenar por createdAt descendente (más reciente primero)
      eventsList = eventsList.sort((a, b) => {
        // Si ambos tienen createdAt, comparar por fecha
        if (a.createdAt && b.createdAt) {
          // Si createdAt es un Timestamp de Firestore, usar .toDate()
          const aDate = a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
          const bDate = b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
          return bDate - aDate;
        }
        // Si solo uno tiene createdAt, ese va primero
        if (a.createdAt) return -1;
        if (b.createdAt) return 1;
        // Fallback: comparar por id (asumiendo que id es incremental o por fecha)
        return b.id.localeCompare(a.id);
      });
      setEvents(eventsList);
    } catch (error) {
      console.log(error);
      setGlobalMessage("Error al obtener eventos.");
    } finally {
      setLoadingEvents(false);
    }
  };

  return (
    <Container px={isMobile ? "xs" : "md"}>
      <Title mt={isMobile ? "sm" : "md"} order={isMobile ? 3 : 2}>
        Dashboard de Eventos
      </Title>
      {loadingEvents ? (
        <Center mt="lg">
          <Loader size="lg" />
        </Center>
      ) : (
        <>
          <Button
            mt={isMobile ? "sm" : "md"}
            fullWidth={isMobile}
            onClick={() => setCreateModalOpened(true)}
          >
            Crear Evento
          </Button>
          {globalMessage && (
            <Alert
              mt={isMobile ? "sm" : "md"}
              title="Aviso"
              color="green"
              withCloseButton
              onClose={() => setGlobalMessage("")}
            >
              {globalMessage}
            </Alert>
          )}
          <Stack mt={isMobile ? "sm" : "md"} spacing={isMobile ? "sm" : "md"}>
            <Grid gutter={isMobile ? "sm" : "md"}>
              {events.map((event) => (
                <Grid.Col
                  key={event.id}
                  span={isMobile ? 12 : 6}
                  // Puedes ajustar el span para tablets si lo deseas
                >
                  <Card shadow="sm" p={isMobile ? "md" : "lg"} withBorder>
                    <Card.Section>
                      {event.eventImage && (
                        <Image
                          src={event.eventImage}
                          alt={event.eventName}
                          height={isMobile ? 120 : 160}
                          fit="cover"
                        />
                      )}
                    </Card.Section>
                    <Group
                      position={isMobile ? "center" : "apart"}
                      mt={isMobile ? "sm" : "md"}
                      spacing={isMobile ? "xs" : "md"}
                      noWrap={isMobile}
                      align={isMobile ? "center" : "flex-start"}
                    >
                      <div>
                        <Title order={isMobile ? 5 : 4}>{event.eventName}</Title>
                        <Text size="sm" color="dimmed">
                          ID: {event.id}
                        </Text>
                      </div>
                      <Button
                        component={Link}
                        to={`/admin/event/${event.id}`}
                        size={isMobile ? "xs" : "md"}
                        fullWidth={isMobile}
                        mt={isMobile ? "xs" : 0}
                      >
                        Administrar Evento
                      </Button>
                    </Group>
                  </Card>
                </Grid.Col>
              ))}
            </Grid>
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

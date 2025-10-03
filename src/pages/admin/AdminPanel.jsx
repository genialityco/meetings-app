import { useState, useEffect, useCallback } from "react";
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
import { collection, getDocs, query } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import CreateEventModal from "./CreateEventModal";
import { Link } from "react-router-dom";

const AdminPanel = () => {
  const [events, setEvents] = useState([]);
  const [globalMessage, setGlobalMessage] = useState("");
  const [createModalOpened, setCreateModalOpened] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const isMobile = useMediaQuery("(max-width: 600px)");

  const fetchEvents = useCallback(async () => {
    try {
      setLoadingEvents(true);

      // Consulta ya ordenada por createdAt descendente
      const q = query(collection(db, "events"));
      const snap = await getDocs(q);

      const eventsList = snap.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      }));

      setEvents(eventsList);
    } catch (error) {
      console.error(error);
      setGlobalMessage("Error al obtener eventos.");
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const formatDate = (value) => {
    if (!value) return null;
    const d =
      typeof value.toDate === "function"
        ? value.toDate()
        : value instanceof Date
        ? value
        : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString("es-CO", { timeZone: "America/Bogota" });
  };

  return (
    <Container fluid>
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
                <Grid.Col key={event.id} span={isMobile ? 12 : 6}>
                  <Card shadow="sm" p={isMobile ? "md" : "lg"} withBorder>
                    <Card.Section>
                      {event.eventImage ? (
                        <Image
                          src={event.eventImage}
                          alt={event.eventName || "Evento"}
                          height={isMobile ? 120 : 160}
                          fit="cover"
                        />
                      ) : (
                        <Center style={{ height: isMobile ? 120 : 160 }}>
                          <Text size="sm" c="dimmed">
                            Sin imagen
                          </Text>
                        </Center>
                      )}
                    </Card.Section>

                    <Group
                      justify={isMobile ? "center" : "space-between"}
                      mt={isMobile ? "sm" : "md"}
                      gap={isMobile ? "xs" : "md"}
                      wrap={isMobile ? "wrap" : "nowrap"}
                      align={isMobile ? "center" : "flex-start"}
                    >
                      <div style={{ minWidth: 0 }}>
                        <Title order={isMobile ? 5 : 4} lineClamp={1}>
                          {event.eventName || "Evento sin título"}
                        </Title>
                        <Text size="sm" c="dimmed">
                          ID: {event.id}
                        </Text>
                        {formatDate(event.createdAt) && (
                          <Text size="xs" c="dimmed">
                            Creado: {formatDate(event.createdAt)}
                          </Text>
                        )}
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

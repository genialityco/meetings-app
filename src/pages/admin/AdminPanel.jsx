import { useState, useEffect, useCallback, useContext } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
  Badge,
  Modal,
  Switch,
} from "@mantine/core";
import { IconUserPlus, IconTrash, IconArrowLeft, IconCalendarEvent } from "@tabler/icons-react";
import { useMediaQuery } from "@mantine/hooks";
import { collection, getDocs, query, where, doc, updateDoc, deleteDoc, getDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import CreateEventModal from "./CreateEventModal";
import { Link } from "react-router-dom";
import { AdminAuthContext } from "../../context/AdminAuthContext";

const AdminPanel = () => {
  const { orgId } = useParams();
  const navigate = useNavigate();
  const { adminUser, isSuperAdmin } = useContext(AdminAuthContext);
  const [events, setEvents] = useState([]);
  const [organization, setOrganization] = useState(null);
  const [globalMessage, setGlobalMessage] = useState("");
  const [createModalOpened, setCreateModalOpened] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Estado para modal de confirmación de eliminación
  const [deleteEvent, setDeleteEvent] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const isMobile = useMediaQuery("(max-width: 600px)");

  const fetchEvents = useCallback(async () => {
    if (!adminUser) return;
    try {
      setLoadingEvents(true);

      // Si existe orgId, buscar la organización
      if (orgId) {
        const orgDoc = await getDoc(doc(db, "organizations", orgId));
        if (orgDoc.exists()) {
          const orgData = orgDoc.data();
          if (!isSuperAdmin && !(orgData.owners || []).includes(adminUser.uid)) {
            setGlobalMessage("No tienes permiso para ver esta organización.");
            setEvents([]);
            setLoadingEvents(false);
            return;
          }
          setOrganization({ id: orgDoc.id, ...orgData });
        } else {
          setGlobalMessage("Organización no encontrada.");
          setEvents([]);
          setLoadingEvents(false);
          return;
        }
      }

      // Filtrar por orgId si existe
      let conditions = [];
      if (orgId) {
        conditions.push(where("organizationId", "==", orgId));
      } else {
        if (!isSuperAdmin) {
          conditions.push(where("owners", "array-contains", adminUser.uid));
        }
      }

      const q = query(collection(db, "events"), ...conditions);
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
  }, [adminUser, isSuperAdmin, orgId]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const formatDate = (value) => {
    if (!value) return null;
    
    // Si es un string YYYY-MM-DD
    if (typeof value === "string" && value.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year, month, day] = value.split("-").map(Number);
      const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
      return `${day} de ${months[month - 1]} de ${year}`;
    }
    
    const d =
      typeof value.toDate === "function"
        ? value.toDate()
        : value instanceof Date
        ? value
        : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString("es-CO", { timeZone: "America/Bogota" });
  };

  // ── Eliminar evento ───────────────────────────────────────────────────────
  const confirmDeleteEvent = async () => {
    if (!deleteEvent) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, "events", deleteEvent.id));
      setGlobalMessage(`Evento "${deleteEvent.eventName}" eliminado.`);
      setDeleteEvent(null);
      fetchEvents();
    } catch (err) {
      console.error(err);
      setGlobalMessage("Error al eliminar el evento.");
    } finally {
      setDeleting(false);
    }
  };

  // ── Cambiar estado del evento ─────────────────────────────────────────────
  const toggleEventStatus = async (event) => {
    try {
      const currentEnabled = event.config?.registrationEnabled ?? true;
      const newEnabled = !currentEnabled;
      
      await updateDoc(doc(db, "events", event.id), { 
        status: newEnabled ? "abierto" : "cerrado",
        "config.registrationEnabled": newEnabled 
      });
      fetchEvents();
    } catch (err) {
      console.error(err);
      setGlobalMessage("Error al actualizar el estado del evento.");
    }
  };

  return (
    <Container fluid>
      <Group align="center" mt={isMobile ? "sm" : "md"} mb="md">
        <Button variant="subtle" onClick={() => navigate("/admin")} px={0} mr="sm">
          <IconArrowLeft size={24} />
        </Button>
        <Title order={isMobile ? 3 : 2}>
          {orgId && organization ? `Eventos: ${organization.name}` : "Todos los Eventos"}
        </Title>
      </Group>

      {loadingEvents ? (
        <Center mt="lg">
          <Loader size="lg" />
        </Center>
      ) : (
        <>
          {orgId && (
            <Button
              mt={isMobile ? "sm" : "md"}
              fullWidth={isMobile}
              onClick={() => setCreateModalOpened(true)}
            >
              Crear Evento en Organización
            </Button>
          )}

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

          {events.length === 0 ? (
            <Text c="dimmed" ta="center" mt="xl">
              No hay eventos disponibles.
            </Text>
          ) : (
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
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <Title order={isMobile ? 5 : 4} lineClamp={1}>
                          {event.eventName || "Evento sin título"}
                        </Title>
                        
                        <Group mt="xs" mb="xs" gap="xs">
                          <Badge color="blue" variant="light">
                            {event.eventType || "Rueda de negocios"}
                          </Badge>
                          <Badge color={(event.config?.registrationEnabled ?? true) ? "green" : "red"} variant="dot">
                            {(event.config?.registrationEnabled ?? true) ? "ABIERTO" : "CERRADO"}
                          </Badge>
                        </Group>

                        <Text size="sm" c="dimmed">
                          ID: {event.id}
                        </Text>
                        
                        {(event.config?.eventDates && event.config.eventDates.length > 0) ? (
                          <Group gap="xs" mt={6}>
                            <IconCalendarEvent size={18} style={{ color: "var(--mantine-color-blue-6)" }} />
                            <Text size="sm" fw={700} c="dark">
                              {event.config.eventDates.map(d => formatDate(d)).join(" y ")}
                            </Text>
                          </Group>
                        ) : event.config?.eventDate ? (
                          <Group gap="xs" mt={6}>
                            <IconCalendarEvent size={18} style={{ color: "var(--mantine-color-blue-6)" }} />
                            <Text size="sm" fw={700} c="dark">
                              {formatDate(event.config.eventDate)}
                            </Text>
                          </Group>
                        ) : null}

                        {formatDate(event.createdAt) && (
                          <Text size="xs" c="dimmed" mt={4}>
                            Creado: {formatDate(event.createdAt)}
                          </Text>
                        )}
                        
                        <Group mt="sm">
                          <Switch
                            label={(event.config?.registrationEnabled ?? true) ? "Abierto" : "Cerrado"}
                            checked={(event.config?.registrationEnabled ?? true)}
                            onChange={() => toggleEventStatus(event)}
                            size="sm"
                          />
                        </Group>
                      </div>

                      <Stack gap="xs" align={isMobile ? "stretch" : "flex-end"}>
                        <Button
                          onClick={() => navigate(`/admin/event/${event.id}`)}
                          size={isMobile ? "xs" : "md"}
                          fullWidth={isMobile}
                        >
                          Administrar Evento
                        </Button>
                        <Button
                          variant="subtle"
                          color="red"
                          size="xs"
                          leftSection={<IconTrash size={14} />}
                          fullWidth={isMobile}
                          onClick={() => setDeleteEvent(event)}
                        >
                          Eliminar evento
                        </Button>
                      </Stack>
                    </Group>
                  </Card>
                </Grid.Col>
              ))}
            </Grid>
          </Stack>
          )}
        </>
      )}

      <CreateEventModal
        opened={createModalOpened}
        onClose={() => setCreateModalOpened(false)}
        refreshEvents={fetchEvents}
        setGlobalMessage={setGlobalMessage}
        orgId={orgId}
      />

      {/* Modal confirmación de eliminación */}
      <Modal
        opened={!!deleteEvent}
        onClose={() => setDeleteEvent(null)}
        title="Eliminar evento"
        centered
      >
        <Stack>
          <Text size="sm">
            ¿Estás seguro de que deseas eliminar el evento{" "}
            <strong>{deleteEvent?.eventName}</strong>? Esta acción no se puede deshacer.
          </Text>
          <Text size="xs" c="dimmed">
            Los datos internos del evento (reuniones, agenda, asistentes) permanecerán en
            Firestore pero el evento dejará de aparecer en el panel.
          </Text>
          <Group justify="flex-end" mt="xs">
            <Button variant="subtle" onClick={() => setDeleteEvent(null)}>
              Cancelar
            </Button>
            <Button color="red" onClick={confirmDeleteEvent} loading={deleting}>
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
};

export default AdminPanel;

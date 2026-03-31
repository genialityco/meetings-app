import { useState, useEffect, useCallback, useContext } from "react";
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
  MultiSelect,
} from "@mantine/core";
import { IconLogout, IconUsers, IconUserPlus, IconTrash } from "@tabler/icons-react";
import { useMediaQuery } from "@mantine/hooks";
import { collection, getDocs, query, where, doc, updateDoc, deleteDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import CreateEventModal from "./CreateEventModal";
import AdminsManagementModal from "./AdminsManagementModal";
import { Link } from "react-router-dom";
import { AdminAuthContext } from "../../context/AdminAuthContext";

const AdminPanel = () => {
  const { adminUser, isSuperAdmin, adminProfile, logoutAdmin } = useContext(AdminAuthContext);
  const [events, setEvents] = useState([]);
  const [globalMessage, setGlobalMessage] = useState("");
  const [createModalOpened, setCreateModalOpened] = useState(false);
  const [adminsModalOpened, setAdminsModalOpened] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Estado para modal de confirmación de eliminación
  const [deleteEvent, setDeleteEvent] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Estado para modal de asignación de owners
  const [assignEvent, setAssignEvent] = useState(null);
  const [allAdmins, setAllAdmins] = useState([]);
  const [selectedOwners, setSelectedOwners] = useState([]);
  const [savingOwners, setSavingOwners] = useState(false);

  const isMobile = useMediaQuery("(max-width: 600px)");

  const fetchEvents = useCallback(async () => {
    if (!adminUser) return;
    try {
      setLoadingEvents(true);

      const q = isSuperAdmin
        ? query(collection(db, "events"))
        : query(collection(db, "events"), where("owners", "array-contains", adminUser.uid));
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
  }, [adminUser, isSuperAdmin]);

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

  // ── Asignación de owners ──────────────────────────────────────────────────
  const openAssignOwners = async (event) => {
    try {
      const snap = await getDocs(collection(db, "admins"));
      const adminsList = snap.docs.map((d) => ({
        value: d.id,
        label: `${d.data().displayName} (${d.data().email})`,
      }));
      setAllAdmins(adminsList);
      setSelectedOwners(event.owners || []);
      setAssignEvent(event);
    } catch (err) {
      console.error(err);
      setGlobalMessage("Error al cargar admins.");
    }
  };

  const saveOwners = async () => {
    if (!assignEvent) return;
    setSavingOwners(true);
    try {
      await updateDoc(doc(db, "events", assignEvent.id), { owners: selectedOwners });
      setGlobalMessage(`Owners actualizados para "${assignEvent.eventName}".`);
      setAssignEvent(null);
      fetchEvents();
    } catch (err) {
      console.error(err);
      setGlobalMessage("Error al guardar owners.");
    } finally {
      setSavingOwners(false);
    }
  };

  return (
    <Container fluid>
      <Group justify="space-between" align="center" mt={isMobile ? "sm" : "md"} wrap="wrap" gap="xs">
        <Title order={isMobile ? 3 : 2}>Dashboard de Eventos</Title>
        <Group gap="xs" align="center">
          {adminProfile?.email && (
            <Text size="sm" c="dimmed">{adminProfile.email}</Text>
          )}
          {isSuperAdmin && (
            <Badge color="violet" variant="light">Super Admin</Badge>
          )}
          {isSuperAdmin && (
            <Button
              variant="light"
              size="xs"
              leftSection={<IconUsers size={14} />}
              onClick={() => setAdminsModalOpened(true)}
            >
              Admins
            </Button>
          )}
          <Button
            variant="subtle"
            color="red"
            size="xs"
            leftSection={<IconLogout size={14} />}
            onClick={logoutAdmin}
          >
            Salir
          </Button>
        </Group>
      </Group>

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
                        {isSuperAdmin && event.owners && event.owners.length > 0 && (
                          <Text size="xs" c="dimmed">
                            {event.owners.length} admin(s) asignado(s)
                          </Text>
                        )}
                      </div>

                      <Stack gap="xs" align={isMobile ? "stretch" : "flex-end"}>
                        <Button
                          component={Link}
                          to={`/admin/event/${event.id}`}
                          size={isMobile ? "xs" : "md"}
                          fullWidth={isMobile}
                        >
                          Administrar Evento
                        </Button>
                        {isSuperAdmin && (
                          <Button
                            variant="light"
                            size="xs"
                            leftSection={<IconUserPlus size={14} />}
                            fullWidth={isMobile}
                            onClick={() => openAssignOwners(event)}
                          >
                            Asignar admins
                          </Button>
                        )}
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
        </>
      )}

      <CreateEventModal
        opened={createModalOpened}
        onClose={() => setCreateModalOpened(false)}
        refreshEvents={fetchEvents}
        setGlobalMessage={setGlobalMessage}
      />

      <AdminsManagementModal
        opened={adminsModalOpened}
        onClose={() => setAdminsModalOpened(false)}
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

      {/* Modal asignación de owners */}
      <Modal
        opened={!!assignEvent}
        onClose={() => setAssignEvent(null)}
        title={`Asignar admins — ${assignEvent?.eventName || ""}`}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Selecciona los administradores que podrán gestionar este evento.
          </Text>
          <MultiSelect
            label="Administradores"
            placeholder="Selecciona admins..."
            data={allAdmins}
            value={selectedOwners}
            onChange={setSelectedOwners}
            searchable
            clearable
          />
          <Group justify="flex-end" mt="xs">
            <Button variant="subtle" onClick={() => setAssignEvent(null)}>
              Cancelar
            </Button>
            <Button onClick={saveOwners} loading={savingOwners}>
              Guardar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
};

export default AdminPanel;

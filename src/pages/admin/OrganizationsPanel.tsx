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
  Alert,
  Grid,
  Modal,
  MultiSelect,
} from "@mantine/core";
import { IconBuildingCommunity, IconPlus, IconTrash, IconUserPlus } from "@tabler/icons-react";
import { collection, getDocs, query, where, doc, deleteDoc, addDoc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { Link } from "react-router-dom";
import { AdminAuthContext } from "../../context/AdminAuthContext";
import CreateOrganizationModal from "./CreateOrganizationModal";

const OrganizationsPanel = () => {
  const { adminUser, isSuperAdmin } = useContext(AdminAuthContext);
  const [organizations, setOrganizations] = useState([]);
  const [globalMessage, setGlobalMessage] = useState("");
  const [createModalOpened, setCreateModalOpened] = useState(false);
  const [loadingOrgs, setLoadingOrgs] = useState(false);

  const [deleteOrg, setDeleteOrg] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Estado para asignar owners a la organización
  const [assignOrg, setAssignOrg] = useState(null);
  const [allAdmins, setAllAdmins] = useState([]);
  const [selectedOwners, setSelectedOwners] = useState([]);
  const [savingOwners, setSavingOwners] = useState(false);

  const fetchOrganizations = useCallback(async () => {
    if (!adminUser) return;
    try {
      setLoadingOrgs(true);

      // Si es super admin, ve todas las orgs. Si no, solo las que le pertenecen.
      const q = isSuperAdmin
        ? query(collection(db, "organizations"))
        : query(collection(db, "organizations"), where("owners", "array-contains", adminUser.uid));
      
      const snap = await getDocs(q);

      const orgsList = snap.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      }));

      setOrganizations(orgsList);
    } catch (error) {
      console.error(error);
      setGlobalMessage("Error al obtener organizaciones.");
    } finally {
      setLoadingOrgs(false);
    }
  }, [adminUser, isSuperAdmin]);

  useEffect(() => {
    fetchOrganizations();
  }, [fetchOrganizations]);

  const confirmDeleteOrg = async () => {
    if (!deleteOrg) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, "organizations", deleteOrg.id));
      setGlobalMessage(`Organización "${deleteOrg.name}" eliminada.`);
      setDeleteOrg(null);
      fetchOrganizations();
    } catch (err) {
      console.error(err);
      setGlobalMessage("Error al eliminar la organización.");
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (value) => {
    if (!value) return null;
    const d = typeof value.toDate === "function" ? value.toDate() : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString("es-CO", { timeZone: "America/Bogota" });
  };

  const openAssignOwners = async (org) => {
    try {
      const snap = await getDocs(collection(db, "admins"));
      const adminsList = snap.docs.map((d) => ({
        value: d.id,
        label: `${d.data().displayName} (${d.data().email})`,
      }));
      setAllAdmins(adminsList);
      setSelectedOwners(org.owners || []);
      setAssignOrg(org);
    } catch (err) {
      console.error(err);
      setGlobalMessage("Error al cargar admins.");
    }
  };

  const saveOwners = async () => {
    if (!assignOrg) return;
    setSavingOwners(true);
    try {
      await updateDoc(doc(db, "organizations", assignOrg.id), { owners: selectedOwners });
      setGlobalMessage(`Owners actualizados para la organización "${assignOrg.name}".`);
      setAssignOrg(null);
      fetchOrganizations();
    } catch (err) {
      console.error(err);
      setGlobalMessage("Error al guardar owners.");
    } finally {
      setSavingOwners(false);
    }
  };

  if (loadingOrgs) {
    return (
      <Center style={{ height: "50vh" }}>
        <Loader size="lg" />
      </Center>
    );
  }

  return (
    <Container size="xl" py="xl">
      <Group justify="space-between" mb="xl">
        <Title order={2}>Mis Organizaciones</Title>
        <Group>
          <Button variant="light" component={Link} to="/admin/events" mr="sm">
            Ver Todos los Eventos (Heredados)
          </Button>
          <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateModalOpened(true)}>
            Crear Organización
          </Button>
        </Group>
      </Group>

      {globalMessage && (
        <Alert
          color={globalMessage.includes("Error") ? "red" : "blue"}
          mb="md"
          withCloseButton
          onClose={() => setGlobalMessage("")}
        >
          {globalMessage}
        </Alert>
      )}

      {organizations.length === 0 ? (
        <Text c="dimmed" ta="center" mt="xl">
          No hay organizaciones disponibles.
        </Text>
      ) : (
        <Grid>
          {organizations.map((org) => (
            <Grid.Col key={org.id} span={{ base: 12, sm: 6, md: 4 }}>
              <Card shadow="sm" padding="lg" radius="md" withBorder>
                <Group justify="center" mb="md">
                  <IconBuildingCommunity size={60} color="#228be6" />
                </Group>
                <Title order={4} ta="center" mb="sm">
                  {org.name}
                </Title>
                <Text size="sm" c="dimmed" ta="center" mb="md">
                  Creada: {formatDate(org.createdAt) || "N/A"}
                </Text>

                <Group grow>
                  <Button component={Link} to={`/admin/organization/${org.id}`} variant="light">
                    Ver Eventos
                  </Button>
                  {isSuperAdmin && (
                    <Button
                      variant="subtle"
                      color="blue"
                      onClick={() => openAssignOwners(org)}
                    >
                      <IconUserPlus size={18} />
                    </Button>
                  )}
                  {isSuperAdmin && (
                    <Button
                      variant="subtle"
                      color="red"
                      onClick={() => setDeleteOrg(org)}
                    >
                      <IconTrash size={18} />
                    </Button>
                  )}
                </Group>
              </Card>
            </Grid.Col>
          ))}
        </Grid>
      )}

      {/* Modal de asignación de owners */}
      <Modal
        opened={!!assignOrg}
        onClose={() => setAssignOrg(null)}
        title={`Administrar usuarios: ${assignOrg?.name}`}
        centered
      >
        <Text size="sm" mb="sm">
          Selecciona qué administradores tienen acceso a esta organización.
        </Text>
        <MultiSelect
          data={allAdmins}
          value={selectedOwners}
          onChange={setSelectedOwners}
          placeholder="Seleccionar administradores..."
          searchable
          clearable
        />
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setAssignOrg(null)}>Cancelar</Button>
          <Button onClick={saveOwners} loading={savingOwners}>Guardar</Button>
        </Group>
      </Modal>

      {/* Modal de confirmación para borrar org */}
      <Modal
        opened={!!deleteOrg}
        onClose={() => setDeleteOrg(null)}
        title="Confirmar eliminación"
        centered
      >
        <Text mb="md">
          ¿Estás seguro de que deseas eliminar la organización "<b>{deleteOrg?.name}</b>"?
          Los eventos asociados a esta organización no se borrarán automáticamente a menos que implementemos limpieza.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setDeleteOrg(null)}>
            Cancelar
          </Button>
          <Button color="red" onClick={confirmDeleteOrg} loading={deleting}>
            Eliminar
          </Button>
        </Group>
      </Modal>

      <CreateOrganizationModal
        opened={createModalOpened}
        onClose={() => setCreateModalOpened(false)}
        refreshOrgs={fetchOrganizations}
        setGlobalMessage={setGlobalMessage}
      />
    </Container>
  );
};

export default OrganizationsPanel;

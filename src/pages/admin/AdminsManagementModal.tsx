import { useState, useEffect, useCallback } from "react";
import {
  Modal,
  Stack,
  Title,
  Tabs,
  Table,
  Badge,
  Button,
  Group,
  Text,
  Loader,
  Center,
  Alert,
  ActionIcon,
  Tooltip,
  Divider,
} from "@mantine/core";
import {
  IconCheck,
  IconX,
  IconTrash,
  IconAlertCircle,
  IconUsers,
  IconUserCheck,
} from "@tabler/icons-react";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";

interface AdminRequest {
  uid: string;
  email: string;
  displayName: string;
  status: "pending" | "rejected";
  createdAt: any;
}

interface AdminDoc {
  uid: string;
  email: string;
  displayName: string;
  isSuperAdmin: boolean;
  createdAt: any;
}

interface Props {
  opened: boolean;
  onClose: () => void;
}

const AdminsManagementModal = ({ opened, onClose }: Props) => {
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [admins, setAdmins] = useState<AdminDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; color: string } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Solicitudes pendientes
      const reqSnap = await getDocs(
        query(collection(db, "adminRequests"), where("status", "==", "pending"))
      );
      setRequests(
        reqSnap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<AdminRequest, "uid">) }))
      );

      // Admins actuales
      const admSnap = await getDocs(collection(db, "admins"));
      setAdmins(
        admSnap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<AdminDoc, "uid">) }))
      );
    } catch (err) {
      console.error(err);
      setMessage({ text: "Error al cargar datos.", color: "red" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (opened) fetchData();
  }, [opened, fetchData]);

  const approveRequest = async (req: AdminRequest) => {
    setActionLoading(req.uid);
    setMessage(null);
    try {
      // Crear documento en admins
      await setDoc(doc(db, "admins", req.uid), {
        email: req.email,
        displayName: req.displayName,
        isSuperAdmin: false,
        createdAt: serverTimestamp(),
      });
      // Actualizar solicitud a aprobada
      await updateDoc(doc(db, "adminRequests", req.uid), { status: "approved" });
      setMessage({ text: `Admin "${req.displayName}" aprobado correctamente.`, color: "green" });
      await fetchData();
    } catch (err) {
      console.error(err);
      setMessage({ text: "Error al aprobar la solicitud.", color: "red" });
    } finally {
      setActionLoading(null);
    }
  };

  const rejectRequest = async (req: AdminRequest) => {
    setActionLoading(`reject-${req.uid}`);
    setMessage(null);
    try {
      await updateDoc(doc(db, "adminRequests", req.uid), { status: "rejected" });
      setMessage({ text: `Solicitud de "${req.displayName}" rechazada.`, color: "orange" });
      await fetchData();
    } catch (err) {
      console.error(err);
      setMessage({ text: "Error al rechazar la solicitud.", color: "red" });
    } finally {
      setActionLoading(null);
    }
  };

  const removeAdmin = async (admin: AdminDoc) => {
    if (admin.isSuperAdmin) {
      setMessage({ text: "No se puede eliminar un super-admin.", color: "red" });
      return;
    }
    setActionLoading(`del-${admin.uid}`);
    setMessage(null);
    try {
      await deleteDoc(doc(db, "admins", admin.uid));
      setMessage({ text: `Admin "${admin.displayName}" eliminado.`, color: "orange" });
      await fetchData();
    } catch (err) {
      console.error(err);
      setMessage({ text: "Error al eliminar admin.", color: "red" });
    } finally {
      setActionLoading(null);
    }
  };

  const formatDate = (val: any) => {
    if (!val) return "—";
    const d = typeof val.toDate === "function" ? val.toDate() : new Date(val);
    return d.toLocaleString("es-CO", { timeZone: "America/Bogota" });
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Title order={4}>Gestión de Administradores</Title>}
      size="lg"
    >
      {message && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color={message.color}
          variant="light"
          mb="md"
          withCloseButton
          onClose={() => setMessage(null)}
        >
          {message.text}
        </Alert>
      )}

      {loading ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : (
        <Tabs defaultValue="requests">
          <Tabs.List>
            <Tabs.Tab
              value="requests"
              leftSection={<IconUserCheck size={16} />}
              rightSection={
                requests.length > 0 ? (
                  <Badge size="xs" color="orange" variant="filled">
                    {requests.length}
                  </Badge>
                ) : undefined
              }
            >
              Solicitudes pendientes
            </Tabs.Tab>
            <Tabs.Tab value="admins" leftSection={<IconUsers size={16} />}>
              Administradores ({admins.length})
            </Tabs.Tab>
          </Tabs.List>

          {/* ── Solicitudes pendientes ── */}
          <Tabs.Panel value="requests" pt="md">
            {requests.length === 0 ? (
              <Text c="dimmed" ta="center" py="xl" size="sm">
                No hay solicitudes pendientes.
              </Text>
            ) : (
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Nombre</Table.Th>
                    <Table.Th>Email</Table.Th>
                    <Table.Th>Fecha</Table.Th>
                    <Table.Th>Acciones</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {requests.map((req) => (
                    <Table.Tr key={req.uid}>
                      <Table.Td>{req.displayName}</Table.Td>
                      <Table.Td>{req.email}</Table.Td>
                      <Table.Td>
                        <Text size="xs">{formatDate(req.createdAt)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap="xs">
                          <Tooltip label="Aprobar">
                            <ActionIcon
                              color="green"
                              variant="light"
                              loading={actionLoading === req.uid}
                              onClick={() => approveRequest(req)}
                            >
                              <IconCheck size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Rechazar">
                            <ActionIcon
                              color="red"
                              variant="light"
                              loading={actionLoading === `reject-${req.uid}`}
                              onClick={() => rejectRequest(req)}
                            >
                              <IconX size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Tabs.Panel>

          {/* ── Administradores actuales ── */}
          <Tabs.Panel value="admins" pt="md">
            {admins.length === 0 ? (
              <Text c="dimmed" ta="center" py="xl" size="sm">
                No hay administradores registrados.
              </Text>
            ) : (
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Nombre</Table.Th>
                    <Table.Th>Email</Table.Th>
                    <Table.Th>Rol</Table.Th>
                    <Table.Th>Acciones</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {admins.map((admin) => (
                    <Table.Tr key={admin.uid}>
                      <Table.Td>{admin.displayName}</Table.Td>
                      <Table.Td>{admin.email}</Table.Td>
                      <Table.Td>
                        {admin.isSuperAdmin ? (
                          <Badge color="violet" variant="light">
                            Super Admin
                          </Badge>
                        ) : (
                          <Badge color="blue" variant="light">
                            Admin
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {!admin.isSuperAdmin && (
                          <Tooltip label="Eliminar admin">
                            <ActionIcon
                              color="red"
                              variant="subtle"
                              loading={actionLoading === `del-${admin.uid}`}
                              onClick={() => removeAdmin(admin)}
                            >
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
            <Divider my="md" />
            <Text size="xs" c="dimmed">
              Para crear un admin directamente usa el script{" "}
              <code>node scripts/seed-admin.js</code> con <code>IS_SUPER_ADMIN: false</code>.
            </Text>
          </Tabs.Panel>
        </Tabs>
      )}
    </Modal>
  );
};

export default AdminsManagementModal;

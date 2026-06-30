import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Table,
  Button,
  Loader,
  Text,
  Badge,
  Group,
  Avatar,
  Center,
  Stack,
  Select,
} from "@mantine/core";
import {
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  updateDoc,
  doc,
  getDoc,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";

const statusColors = {
  accepted: "green",
  pending: "yellow",
  rejected: "red",
  cancelled: "gray",
  taken: "grape",
};

const statusLabels = {
  accepted: "Aceptada",
  pending: "Pendiente",
  rejected: "Rechazada",
  cancelled: "Cancelada",
  taken: "Tomada",
};

// La app mezcla "canceled" y "cancelled"; normalizamos para filtrar/colorear consistente.
const normStatus = (s) => {
  const v = (s || "").toLowerCase();
  return v === "canceled" ? "cancelled" : v;
};

const MeetingsListModal = ({ opened, onClose, event, setGlobalMessage }) => {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");

  // Helper para formatear fecha
  const formatDate = (dateStr) => {
    const [year, month, day] = dateStr.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString("es-ES", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  };

  useEffect(() => {
    if (opened && event) {
      fetchMeetings();
      // Inicializar fecha seleccionada con la primera fecha del evento
      const eventDates = event.config?.eventDates || (event.config?.eventDate ? [event.config.eventDate] : []);
      if (eventDates.length > 0 && !selectedDate) {
        setSelectedDate(eventDates[0]);
      }
    }
    // eslint-disable-next-line
  }, [opened, event]);

  const fetchMeetings = async () => {
    try {
      setLoading(true);
      const snapshot = await getDocs(
        collection(db, "events", event.id, "meetings"),
      );
      const list = snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      }));

      // Optimización: en vez de un getDoc por participante de cada reunión (N+1 en serie),
      // se traen los usuarios únicos una sola vez y en paralelo.
      const uniqueIds = [...new Set(list.flatMap((m) => m.participants || []))];
      const userSnaps = await Promise.all(
        uniqueIds.map((pid) => getDoc(doc(db, "users", pid))),
      );
      const usersById = {};
      userSnaps.forEach((snap, i) => {
        usersById[uniqueIds[i]] = snap.exists() ? snap.data() : null;
      });

      const enrichedList = list.map((meeting) => ({
        ...meeting,
        participantsData: (meeting.participants || []).map((pid) => {
          const u = usersById[pid];
          return u
            ? { id: pid, nombre: u.nombre, empresa: u.empresa, avatar: u.photoURL }
            : { id: pid, nombre: "Desconocido", empresa: "" };
        }),
      }));

      setMeetings(enrichedList);
    } catch (error) {
      console.error("Error fetching meetings:", error);
      setGlobalMessage("Error al obtener reuniones.");
    } finally {
      setLoading(false);
    }
  };

  // Eliminar la reunión y liberar su slot de agenda asociado (con confirmación)
  const deleteMeeting = async (meeting) => {
    if (
      !window.confirm(
        "¿Seguro que deseas eliminar esta reunión? Se liberará su slot de agenda.",
      )
    )
      return;
    setDeleting(meeting.id);
    try {
      // Liberar cualquier slot de agenda que apunte a esta reunión
      const agendaSnap = await getDocs(
        query(
          collection(db, "events", event.id, "agenda"),
          where("meetingId", "==", meeting.id),
        ),
      );
      await Promise.all(
        agendaSnap.docs.map((d) =>
          updateDoc(d.ref, { available: true, meetingId: null }),
        ),
      );
      await deleteDoc(doc(db, "events", event.id, "meetings", meeting.id));
      setGlobalMessage("Reunión eliminada y slot liberado.");
      fetchMeetings();
    } catch (error) {
      console.error("Error eliminando reunión:", error);
      setGlobalMessage("Error al eliminar la reunión.");
    }
    setDeleting(null);
  };

  // Obtener fechas del evento
  const eventDates = event?.config?.eventDates || (event?.config?.eventDate ? [event.config.eventDate] : []);
  const isMultiDay = eventDates.length > 1;

  // Opciones de estado: siempre los estándar + cualquier otro que aparezca en los datos.
  const statusOptions = useMemo(() => {
    const standard = ["accepted", "pending", "rejected", "cancelled", "taken"];
    const present = meetings.map((m) => normStatus(m.status)).filter(Boolean);
    const all = [...new Set([...standard, ...present])];
    return [
      { value: "all", label: "Todos los estados" },
      ...all.map((s) => ({ value: s, label: statusLabels[s] || s })),
    ];
  }, [meetings]);

  // Filtrar por fecha seleccionada y por estado
  const filteredMeetings = useMemo(() => {
    return meetings.filter((m) => {
      const dateOk =
        !selectedDate || !m.meetingDate || m.meetingDate === selectedDate;
      const statusOk =
        statusFilter === "all" || normStatus(m.status) === statusFilter;
      return dateOk && statusOk;
    });
  }, [meetings, selectedDate, statusFilter]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={700}>Reuniones - {event?.eventName}</Text>}
      size="xl"
      centered
      radius="md"
      overlayProps={{ blur: 2 }}
    >
      {/* Filtros */}
      <Group mb="md" align="flex-end">
        {isMultiDay && (
          <Select
            label="Seleccionar día"
            placeholder="Escoge un día"
            data={eventDates.map((date) => ({
              value: date,
              label: formatDate(date),
            }))}
            value={selectedDate}
            onChange={setSelectedDate}
            style={{ width: 220 }}
          />
        )}
        <Select
          label="Estado"
          data={statusOptions}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v || "all")}
          style={{ width: 200 }}
        />
        <Text size="sm" c="dimmed" pb={6}>
          {filteredMeetings.length} reunión(es)
        </Text>
      </Group>

      {loading ? (
        <Center style={{ minHeight: 200 }}>
          <Loader size="lg" />
        </Center>
      ) : filteredMeetings.length === 0 ? (
        <Center style={{ minHeight: 120 }}>
          <Text color="dimmed">
            No hay reuniones para los filtros seleccionados.
          </Text>
        </Center>
      ) : (
        <Table highlightOnHover withBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Hora</Table.Th>
              <Table.Th>Mesa</Table.Th>
              <Table.Th>Participantes</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Acciones</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filteredMeetings.map((m) => (
              <Table.Tr key={m.id}>
                <Table.Td>
                  {m.timeSlot ? (
                    <Text fw={600}>{m.timeSlot}</Text>
                  ) : (
                    <Text size="sm" c="dimmed" fs="italic">
                      Sin agendar
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {m.tableAssigned ? (
                    <Badge color="blue" variant="light">
                      Mesa {m.tableAssigned}
                    </Badge>
                  ) : (
                    <Text size="sm" c="dimmed">
                      —
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Stack gap={4}>
                    {m.participantsData?.map((p) => (
                      <Group key={p.id} gap={8}>
                        <Avatar
                          size={26}
                          radius="xl"
                          src={p.avatar}
                          alt={p.nombre}
                        >
                          {p.nombre?.[0] || "?"}
                        </Avatar>
                        <div>
                          <Text size="sm" fw={500}>
                            {p.nombre}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {p.empresa}
                          </Text>
                        </div>
                      </Group>
                    ))}
                  </Stack>
                </Table.Td>
                <Table.Td>
                  <Badge
                    color={statusColors[normStatus(m.status)] || "gray"}
                    variant={normStatus(m.status) === "accepted" ? "filled" : "light"}
                  >
                    {statusLabels[normStatus(m.status)] || m.status || "N/A"}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Button
                    color="red"
                    size="xs"
                    loading={deleting === m.id}
                    onClick={() => deleteMeeting(m)}
                    variant="outline"
                  >
                    Eliminar
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Modal>
  );
};

export default MeetingsListModal;

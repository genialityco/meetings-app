import { useEffect, useState } from "react";
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
} from "@mantine/core";
import {
  collection,
  query,
  getDocs,
  deleteDoc,
  doc,
  getDoc,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";

const statusColors = {
  accepted: "green",
  pending: "yellow",
  rejected: "red",
  canceled: "gray",
};

const MeetingsListModal = ({ opened, onClose, event, setGlobalMessage }) => {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [canceling, setCanceling] = useState(null);

  useEffect(() => {
    if (opened && event) {
      fetchMeetings();
    }
    // eslint-disable-next-line
  }, [opened, event]);

  const fetchMeetings = async () => {
    try {
      setLoading(true);
      const q = query(collection(db, "events", event.id, "meetings"));
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      }));

      // Enriquecer info de participantes
      const enrichedList = [];
      for (const meeting of list) {
        const participantsData = [];
        for (const participantId of meeting.participants || []) {
          const pDoc = await getDoc(doc(db, "users", participantId));
          if (pDoc.exists()) {
            const pData = pDoc.data();
            participantsData.push({
              id: participantId,
              nombre: pData.nombre,
              empresa: pData.empresa,
              avatar: pData.photoURL,
            });
          } else {
            participantsData.push({
              id: participantId,
              nombre: "Desconocido",
              empresa: "",
            });
          }
        }
        enrichedList.push({
          ...meeting,
          participantsData,
        });
      }

      setMeetings(enrichedList);
    } catch (error) {
      console.error("Error fetching meetings:", error);
      setGlobalMessage("Error al obtener reuniones.");
    } finally {
      setLoading(false);
    }
  };

  // Eliminar (con confirmación)
  const cancelMeeting = async (meetingId) => {
    if (!window.confirm("¿Seguro que deseas cancelar esta reunión?")) return;
    setCanceling(meetingId);
    try {
      await deleteDoc(doc(db, "events", event.id, "meetings", meetingId));
      setGlobalMessage("Reunión cancelada (eliminada).");
      fetchMeetings();
    } catch (error) {
      console.error("Error canceling meeting:", error);
      setGlobalMessage("Error al cancelar la reunión.");
    }
    setCanceling(null);
  };

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
      {loading ? (
        <Center style={{ minHeight: 200 }}>
          <Loader size="lg" />
        </Center>
      ) : meetings.length === 0 ? (
        <Center style={{ minHeight: 120 }}>
          <Text color="dimmed">
            No hay reuniones asignadas para este evento.
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
            {meetings.map((m) => (
              <Table.Tr key={m.id}>
                <Table.Td>
                  <Text fw={600}>{m.timeSlot || "--"}</Text>
                </Table.Td>
                <Table.Td>
                  <Badge color="blue" variant="light">
                    Mesa {m.tableAssigned || "-"}
                  </Badge>
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
                    color={statusColors[m.status?.toLowerCase()] || "gray"}
                    variant={m.status === "accepted" ? "filled" : "light"}
                  >
                    {m.status || "N/A"}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  {m.status !== "canceled" && (
                    <Button
                      color="red"
                      size="xs"
                      loading={canceling === m.id}
                      onClick={() => cancelMeeting(m.id)}
                      variant="outline"
                    >
                      Cancelar
                    </Button>
                  )}
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

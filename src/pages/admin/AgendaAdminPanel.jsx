import { useEffect, useState } from "react";
import { Table, Button, Badge, Container, Loader, Title, Alert, Group } from "@mantine/core";
import { collection, query, where, getDocs, updateDoc, doc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { useParams } from "react-router-dom";

const statusColors = {
  available: "gray",
  occupied: "yellow",
  accepted: "green",
  break: "blue",
};

const statusLabels = {
  available: "Disponible",
  occupied: "Ocupado (sin reunión)",
  accepted: "Con reunión",
  break: "Descanso",
};


export default function AgendaAdminPage() {
  const { eventId } = useParams();
  const [agenda, setAgenda] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [globalMessage, setGlobalMessage] = useState("");

  useEffect(() => {
    if (!eventId) return;
    setLoading(true);

    Promise.all([
      getDocs(collection(db, "events", eventId, "agenda")),
      getDocs(collection(db, "events", eventId, "meetings")),
    ]).then(([agendaSnap, meetingsSnap]) => {
      setAgenda(agendaSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setMeetings(meetingsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
  }, [eventId]);

  // --- ACCIONES ---
  const refreshAgenda = async () => {
    const agendaSnap = await getDocs(collection(db, "events", eventId, "agenda"));
    setAgenda(agendaSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  const handleLiberar = async (slotId) => {
    await updateDoc(doc(db, "events", eventId, "agenda", slotId), {
      available: true,
      meetingId: null,
      isBreak: false,
    });
    setGlobalMessage("Slot liberado correctamente.");
    refreshAgenda();
  };

  const handleBloquear = async (slotId) => {
    await updateDoc(doc(db, "events", eventId, "agenda", slotId), {
      isBreak: true,
      available: false,
      meetingId: null,
    });
    setGlobalMessage("Slot bloqueado como descanso.");
    refreshAgenda();
  };

  const handleDesbloquear = async (slotId) => {
    await updateDoc(doc(db, "events", eventId, "agenda", slotId), {
      isBreak: false,
      available: true,
    });
    setGlobalMessage("Slot desbloqueado.");
    refreshAgenda();
  };

  const handleCancelarReunion = async (slot) => {
    if (!slot.meetingId) return;
    await updateDoc(doc(db, "events", eventId, "agenda", slot.id), {
      available: true,
      meetingId: null,
    });
    // Marcar reunión como cancelada si existe
    if (slot.meetingId) {
      await updateDoc(doc(db, "events", eventId, "meetings", slot.meetingId), {
        status: "cancelled",
      });
    }
    setGlobalMessage("Reunión cancelada y slot liberado.");
    refreshAgenda();
  };

  // --- UI ---
  if (loading) return <Loader />;
  return (
    <Container>
      <Title mt="md" mb="md">Admin Agenda — Control de Slots</Title>
      {globalMessage && (
        <Alert color="teal" withCloseButton onClose={() => setGlobalMessage("")}>
          {globalMessage}
        </Alert>
      )}
      <Table striped highlightOnHover withBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Hora</Table.Th>
            <Table.Th>Mesa</Table.Th>
            <Table.Th>Estado</Table.Th>
            <Table.Th>Acción</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {agenda
            .sort((a, b) => (a.startTime > b.startTime ? 1 : -1))
            .map((slot) => {
              const status = slot.isBreak
                ? "break"
                : slot.meetingId
                ? meetings.find((m) => m.id === slot.meetingId && m.status === "accepted")
                  ? "accepted"
                  : "occupied"
                : !slot.available
                ? "occupied"
                : "available";
              return (
                <Table.Tr key={slot.id}>
                  <Table.Td>
                    {slot.startTime} - {slot.endTime}
                  </Table.Td>
                  <Table.Td>{slot.tableNumber}</Table.Td>
                  <Table.Td>
                    <Badge color={statusColors[status]}>{statusLabels[status]}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Group>
                      {status === "occupied" && (
                        <Button size="xs" color="orange" onClick={() => handleLiberar(slot.id)}>
                          Liberar
                        </Button>
                      )}
                      {status === "available" && (
                        <Button size="xs" color="blue" onClick={() => handleBloquear(slot.id)}>
                          Bloquear
                        </Button>
                      )}
                      {status === "break" && (
                        <Button size="xs" color="gray" onClick={() => handleDesbloquear(slot.id)}>
                          Desbloquear
                        </Button>
                      )}
                      {status === "accepted" && (
                        <Button size="xs" color="red" onClick={() => handleCancelarReunion(slot)}>
                          Cancelar reunión
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
        </Table.Tbody>
      </Table>
    </Container>
  );
}

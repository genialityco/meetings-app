import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Container, Title, Text, Group, Button, Loader, Center } from "@mantine/core";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import CheckInTab from "./CheckInTab";

export default function CheckInPage() {
  const { eventId } = useParams();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) return;
    getDoc(doc(db, "events", eventId)).then((snap) => {
      if (snap.exists()) setEvent({ id: snap.id, ...snap.data() });
      setLoading(false);
    });
  }, [eventId]);

  if (loading) return <Center py="xl"><Loader /></Center>;
  if (!event) return <Center py="xl"><Text c="dimmed">Evento no encontrado.</Text></Center>;

  return (
    <Container size="md" py="md">
      <Group justify="space-between" mb="md">
        <div>
          <Title order={3}>Check-In — {event.eventName || eventId}</Title>
          <Text size="sm" c="dimmed">Gestión de asistencia presencial</Text>
        </div>
        <Button variant="default" component={Link} to={`/admin/event/${eventId}`} size="sm">
          ← Volver al evento
        </Button>
      </Group>
      <CheckInTab event={event} />
    </Container>
  );
}

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Container, Paper, Title, Text, Center, Loader, Avatar, Stack, Box } from "@mantine/core";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import QRCode from "qrcode";

export default function BadgePage() {
  const { eventId, userId } = useParams();
  const [user, setUser] = useState<any>(null);
  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");

  useEffect(() => {
    if (!eventId || !userId) return;

    const loadData = async () => {
      try {
        const [userSnap, eventSnap] = await Promise.all([
          getDoc(doc(db, "users", userId)),
          getDoc(doc(db, "events", eventId))
        ]);

        if (userSnap.exists()) setUser(userSnap.data());
        if (eventSnap.exists()) setEvent(eventSnap.data());

        const checkInUrl = `${window.location.origin}/admin/event/${eventId}/checkin/${userId}`;
        const qrUrl = await QRCode.toDataURL(checkInUrl, { width: 250, margin: 2 });
        setQrCodeUrl(qrUrl);
      } catch (e) {
        console.error("Error loading badge data", e);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [eventId, userId]);

  if (loading) {
    return (
      <Center style={{ minHeight: "100vh", background: "#f8f9fa" }}>
        <Loader size="xl" type="bars" />
      </Center>
    );
  }

  if (!user) {
    return (
      <Center style={{ minHeight: "100vh", background: "#f8f9fa" }}>
        <Title order={3} c="dimmed">No se encontró la escarapela.</Title>
      </Center>
    );
  }

  return (
    <Box style={{ minHeight: "100vh", background: "#f8f9fa", padding: "20px" }}>
      <Container size="xs">
        <Paper 
          shadow="xl" 
          radius="lg" 
          p="xl" 
          withBorder
          style={{ 
            overflow: 'hidden', 
            position: 'relative',
            borderTop: `8px solid ${event?.config?.primaryColor || '#10b981'}`
          }}
        >
          <Stack align="center" gap="md">
            {event?.config?.landingTitleImage ? (
              <img 
                src={event.config.landingTitleImage} 
                alt="Event Logo" 
                style={{ maxHeight: 80, maxWidth: "100%", objectFit: "contain" }} 
              />
            ) : event?.eventImage ? (
              <img 
                src={event.eventImage} 
                alt="Event Logo" 
                style={{ maxHeight: 80, maxWidth: "100%", objectFit: "contain", borderRadius: 8 }} 
              />
            ) : null}
            
            <Title order={2} ta="center" mt="sm">{event?.eventName || "Evento"}</Title>

            <Avatar 
              src={user.photoURL} 
              size={120} 
              radius={120} 
              color="teal"
              mt="md"
            >
              {(user.nombre || "?")[0].toUpperCase()}
            </Avatar>

            <Title order={3} ta="center" mt="sm">{user.nombre}</Title>
            <Text size="lg" fw={500} c="dimmed" ta="center">{user.empresa}</Text>
            {user.cargo && <Text size="sm" c="dimmed" ta="center">{user.cargo}</Text>}
            {user.tipoAsistente && (
              <Text size="md" fw={700} ta="center" mt="xs" tt="uppercase" c={event?.config?.primaryColor || "teal"}>
                {user.tipoAsistente}
              </Text>
            )}

            <Box mt="xl" p="md" style={{ background: "white", borderRadius: "12px", border: "1px solid #eee" }}>
              {qrCodeUrl && <img src={qrCodeUrl} alt="QR Check-in" style={{ display: 'block', margin: '0 auto' }} />}
            </Box>

            <Text size="xs" c="dimmed" ta="center" mt="sm">
              Presenta este código QR en la entrada del evento para realizar tu check-in.
            </Text>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}

import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Container, Title, Text, Center, Loader, Button, Paper } from "@mantine/core";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { IconCheck, IconX } from "@tabler/icons-react";

export default function QuickCheckInPage() {
  const { eventId, userId } = useParams();
  const [status, setStatus] = useState("loading"); // loading, success, error, not-found
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    if (!eventId || !userId) return;

    const doCheckIn = async () => {
      try {
        const userRef = doc(db, "users", userId);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists() || userSnap.data().eventId !== eventId) {
          setStatus("not-found");
          return;
        }

        const userData = userSnap.data();
        setUser(userData);

        if (!userData.checkedIn) {
          await updateDoc(userRef, {
            checkedIn: true,
            checkInTime: new Date()
          });
        }
        
        setStatus("success");
      } catch (err) {
        console.error(err);
        setStatus("error");
      }
    };

    doCheckIn();
  }, [eventId, userId]);

  return (
    <Container size="sm" py="xl">
      <Paper p="xl" radius="md" withBorder ta="center">
        {status === "loading" && (
          <Center py="xl">
            <Loader size="lg" />
          </Center>
        )}

        {status === "success" && (
          <>
            <IconCheck size={64} color="green" style={{ display: 'block', margin: '0 auto' }} />
            <Title order={2} mt="md" c="green">¡Check-In Exitoso!</Title>
            <Text mt="xs" size="xl" fw={700}>{user?.nombre}</Text>
            <Text c="dimmed" size="lg">{user?.empresa}</Text>
            <Text c="dimmed" size="sm" mt="xs">El usuario ha sido registrado como presente en el evento.</Text>
            
            <Button mt="xl" component={Link} to={`/admin/event/${eventId}/checkin`}>
              Ir al Panel de Check-In
            </Button>
          </>
        )}

        {status === "error" && (
          <>
            <IconX size={64} color="red" style={{ display: 'block', margin: '0 auto' }} />
            <Title order={2} mt="md" c="red">Error</Title>
            <Text mt="xs">Ocurrió un error al procesar el check-in.</Text>
            <Button mt="xl" component={Link} to={`/admin/event/${eventId}/checkin`}>
              Volver al Panel
            </Button>
          </>
        )}

        {status === "not-found" && (
          <>
            <IconX size={64} color="orange" style={{ display: 'block', margin: '0 auto' }} />
            <Title order={2} mt="md" c="orange">No encontrado</Title>
            <Text mt="xs">No se encontró al usuario para este evento.</Text>
            <Button mt="xl" component={Link} to={`/admin/event/${eventId}/checkin`}>
              Volver al Panel
            </Button>
          </>
        )}
      </Paper>
    </Container>
  );
}

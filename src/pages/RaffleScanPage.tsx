import { useEffect, useState, useContext } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, getDoc, updateDoc, increment } from "firebase/firestore";
import { db, auth } from "../firebase/firebaseConfig";
import { UserContext } from "../context/UserContext";
import { Container, Paper, Text, Title, Loader, Center, Box, Button, Stack } from "@mantine/core";

type ScanState =
  | { kind: "loading" }
  | { kind: "success"; message: string; points?: number }
  | { kind: "already-claimed" }
  | { kind: "error"; message: string };

export default function RaffleScanPage() {
  const { eventId, meetingId } = useParams<{ eventId: string; meetingId: string }>();
  const navigate = useNavigate();
  const { currentUser, userLoading } = useContext(UserContext);
  const [state, setState] = useState<ScanState>({ kind: "loading" });

  useEffect(() => {
    if (userLoading || !eventId || !meetingId) return;

    const claim = async () => {
      const userId = currentUser?.uid || auth.currentUser?.uid;
      if (!userId) {
        setState({
          kind: "error",
          message: "No tienes una sesión activa. Abre la app del evento e inicia sesión antes de escanear el código.",
        });
        return;
      }

      try {
        const mtgRef = doc(db, "events", eventId, "meetings", meetingId);
        const mtgSnap = await getDoc(mtgRef);
        if (!mtgSnap.exists()) {
          setState({ kind: "error", message: "Esta reunión no existe." });
          return;
        }
        const meeting = mtgSnap.data() as any;

        if (meeting.status !== "accepted") {
          setState({ kind: "error", message: "Esta reunión no está confirmada." });
          return;
        }

        if (meeting.raffleClaimed) {
          setState({ kind: "already-claimed" });
          return;
        }

        const { requesterId, receiverId } = meeting;
        if (userId !== requesterId && userId !== receiverId) {
          setState({ kind: "error", message: "Este código no corresponde a una reunión tuya." });
          return;
        }

        const [reqSnap, recSnap] = await Promise.all([
          getDoc(doc(db, "users", requesterId)),
          getDoc(doc(db, "users", receiverId)),
        ]);
        const reqRole = (reqSnap.data()?.tipoAsistente || "").toLowerCase();
        const recRole = (recSnap.data()?.tipoAsistente || "").toLowerCase();

        const buyerId =
          reqRole === "comprador" ? requesterId : recRole === "comprador" ? receiverId : null;
        const sellerId =
          reqRole === "vendedor" ? requesterId : recRole === "vendedor" ? receiverId : null;

        if (!buyerId || !sellerId) {
          setState({ kind: "error", message: "No se pudo determinar comprador/vendedor para esta reunión." });
          return;
        }

        if (userId === sellerId) {
          setState({ kind: "error", message: "Este código lo debe escanear el comprador, no tú." });
          return;
        }
        if (userId !== buyerId) {
          setState({ kind: "error", message: "Este código no corresponde a una reunión tuya." });
          return;
        }

        await updateDoc(mtgRef, {
          raffleClaimed: true,
          raffleClaimedAt: new Date(),
          raffleClaimedBy: buyerId,
        });
        await updateDoc(doc(db, "users", buyerId), {
          raffleTickets: increment(1),
        });

        const eventSnap = await getDoc(doc(db, "events", eventId));
        const showPoints = eventSnap.data()?.config?.policies?.raffleShowPointsToAttendee === true;
        const newTotal = (reqSnap.id === buyerId ? reqSnap.data()?.raffleTickets : recSnap.data()?.raffleTickets) || 0;

        setState({
          kind: "success",
          message: "¡Punto registrado para el sorteo!",
          points: showPoints ? newTotal + 1 : undefined,
        });
      } catch (e) {
        console.error("Error al reclamar punto de sorteo:", e);
        setState({ kind: "error", message: "Ocurrió un error al registrar el punto. Intenta de nuevo." });
      }
    };

    claim();
  }, [userLoading, eventId, meetingId, currentUser?.uid]);

  return (
    <Container size="xs" py="xl">
      <Paper radius="lg" shadow="md" p="xl" withBorder>
        {state.kind === "loading" && (
          <Stack align="center" gap="md">
            <Loader />
            <Text c="dimmed" size="sm">
              Validando código...
            </Text>
          </Stack>
        )}

        {state.kind === "success" && (
          <Stack align="center" gap="md">
            <Title order={3} ta="center">
              🎉 {state.message}
            </Title>
            {state.points !== undefined && (
              <Text ta="center" size="lg" fw={700}>
                Ahora tienes {state.points} punto{state.points === 1 ? "" : "s"} para el sorteo.
              </Text>
            )}
            <Button onClick={() => navigate(`/dashboard/${eventId}`)}>Ir al dashboard</Button>
          </Stack>
        )}

        {state.kind === "already-claimed" && (
          <Stack align="center" gap="md">
            <Title order={3} ta="center">
              ✅ Ya reclamaste tu punto por esta reunión
            </Title>
            <Button onClick={() => navigate(`/dashboard/${eventId}`)}>Ir al dashboard</Button>
          </Stack>
        )}

        {state.kind === "error" && (
          <Stack align="center" gap="md">
            <Title order={3} ta="center" c="red">
              ⚠️ No se pudo registrar el punto
            </Title>
            <Text ta="center" size="sm">
              {state.message}
            </Text>
            <Button variant="light" onClick={() => navigate(`/dashboard/${eventId}`)}>
              Ir al dashboard
            </Button>
          </Stack>
        )}
      </Paper>
    </Container>
  );
}

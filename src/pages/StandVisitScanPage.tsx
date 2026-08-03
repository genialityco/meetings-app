import { useEffect, useState, useContext } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, auth } from "../firebase/firebaseConfig";
import { UserContext } from "../context/UserContext";
import { Container, Paper, Text, Title, Loader, Button, Stack } from "@mantine/core";
import { resolveCheckInDay, isCheckedInOnDay } from "../utils/eventDays";

type ScanState =
  | { kind: "loading" }
  | { kind: "success"; standName: string }
  | { kind: "already-visited"; standName: string }
  | { kind: "error"; message: string };

export default function StandVisitScanPage() {
  const { eventId, companyNit } = useParams<{ eventId: string; companyNit: string }>();
  const navigate = useNavigate();
  const { currentUser, userLoading } = useContext(UserContext);
  const [state, setState] = useState<ScanState>({ kind: "loading" });

  useEffect(() => {
    if (userLoading || !eventId || !companyNit) return;

    const registerVisit = async () => {
      const userId = currentUser?.uid || auth.currentUser?.uid;
      if (!userId) {
        setState({
          kind: "error",
          message: "No tienes una sesión activa. Abre la app del evento e inicia sesión antes de escanear el código.",
        });
        return;
      }

      const userData = currentUser?.data;

      try {
        const eventSnap = await getDoc(doc(db, "events", eventId));
        if (eventSnap.data()?.config?.policies?.standVisitsEnabled !== true) {
          setState({ kind: "error", message: "Esta función no está habilitada para este evento." });
          return;
        }

        const checkInDay = resolveCheckInDay(eventSnap.data()?.config);
        if (!isCheckedInOnDay(userData, checkInDay)) {
          setState({
            kind: "error",
            message: "Debes hacer check-in en el evento hoy antes de registrar visitas a stands.",
          });
          return;
        }

        const companyRef = doc(db, "events", eventId, "companies", companyNit);
        const companySnap = await getDoc(companyRef);
        if (!companySnap.exists()) {
          setState({ kind: "error", message: "Este stand no existe." });
          return;
        }
        const standName = companySnap.data()?.razonSocial || "este stand";

        if (userData.companyId === companyNit) {
          setState({ kind: "error", message: "No puedes registrar una visita a tu propio stand." });
          return;
        }

        const visitRef = doc(db, "events", eventId, "companies", companyNit, "visits", userId);
        const visitSnap = await getDoc(visitRef);
        if (visitSnap.exists()) {
          setState({ kind: "already-visited", standName });
          return;
        }

        await setDoc(visitRef, {
          attendeeId: userId,
          attendeeName: userData.nombre || "",
          attendeeEmpresa: userData.empresa || userData.company_razonSocial || "",
          visitedAt: new Date(),
        });

        setState({ kind: "success", standName });
      } catch (e) {
        console.error("Error al registrar visita al stand:", e);
        setState({ kind: "error", message: "Ocurrió un error al registrar la visita. Intenta de nuevo." });
      }
    };

    registerVisit();
  }, [userLoading, eventId, companyNit, currentUser?.uid]);

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
              🎉 ¡Visita registrada en {state.standName}!
            </Title>
            <Button onClick={() => navigate(`/dashboard/${eventId}`)}>Ir al dashboard</Button>
          </Stack>
        )}

        {state.kind === "already-visited" && (
          <Stack align="center" gap="md">
            <Title order={3} ta="center">
              ✅ Ya registraste tu visita a {state.standName}
            </Title>
            <Button onClick={() => navigate(`/dashboard/${eventId}`)}>Ir al dashboard</Button>
          </Stack>
        )}

        {state.kind === "error" && (
          <Stack align="center" gap="md">
            <Title order={3} ta="center" c="red">
              ⚠️ No se pudo registrar la visita
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

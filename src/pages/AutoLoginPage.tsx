import { useContext, useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { signInAnonymously } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { Button, Center, Loader, Stack, Text, Title } from "@mantine/core";
import { auth, db } from "../firebase/firebaseConfig";
import { UserContext } from "../context/UserContext";

/**
 * Link de acceso directo: /acceso/:eventId/:userId
 * Inicia la sesión del asistente sin pedir correo ni cédula y lo lleva al
 * dashboard del evento. Sirve para enviarlo por WhatsApp/correo (campañas:
 * variable "Link de acceso directo"). Mismo modelo de sesión que el login por
 * correo y los enlaces de aceptar/rechazar reuniones (loginAsUser).
 */
export default function AutoLoginPage() {
  const { eventId, userId } = useParams<{ eventId: string; userId: string }>();
  const navigate = useNavigate();
  const { loginAsUser } = useContext(UserContext) as any;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!eventId || !userId) {
        setError("El link está incompleto.");
        return;
      }
      try {
        // Las reglas exigen una sesión de Firebase para leer/escribir; en
        // navegadores in-app (WhatsApp) puede no haberla todavía.
        if (!auth.currentUser) await signInAnonymously(auth);
        const snap = await getDoc(doc(db, "users", userId));
        if (cancelled) return;
        if (!snap.exists()) {
          setError("No encontramos tu registro. Puede que el link sea de una inscripción que ya no existe.");
          return;
        }
        const data = snap.data();
        if (data.eventId !== eventId) {
          setError("Este link no corresponde a este evento.");
          return;
        }
        loginAsUser(userId, data);
        navigate(`/dashboard/${eventId}`, { replace: true });
      } catch (e: any) {
        console.error("[AutoLoginPage] Error iniciando sesión:", e);
        if (!cancelled) setError("No pudimos iniciar tu sesión. Intenta de nuevo o ingresa con tu correo.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, userId]);

  if (error) {
    return (
      <Center h="100vh" p="md">
        <Stack align="center" gap="sm" maw={420}>
          <Title order={3} ta="center">
            No pudimos abrir tu acceso
          </Title>
          <Text c="dimmed" ta="center">
            {error}
          </Text>
          {eventId && (
            <Button component={Link} to={`/event/${eventId}?ingresar=1`}>
              Ingresar con mi correo
            </Button>
          )}
        </Stack>
      </Center>
    );
  }

  return (
    <Center h="100vh">
      <Stack align="center" gap="sm">
        <Loader />
        <Text c="dimmed">Ingresando…</Text>
      </Stack>
    </Center>
  );
}

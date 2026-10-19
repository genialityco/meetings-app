import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { signInAnonymously } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { Button, Center, Container, Image, Loader, Paper, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { auth, db } from "../firebase/firebaseConfig";
import CompanySurveyForm from "./dashboard/CompanySurveyForm";
import {
  getCompanySurveyConfig,
  getCompanySurveyKey,
  subscribeCompanySurvey,
  type CompanySurveyChannel,
  type CompanySurveyConfig,
  type CompanySurveyResponse,
} from "../utils/companySurvey";

/**
 * Encuesta de resultados por empresa desde un link: /encuesta-empresa/:eventId/:userId
 * Se envía por WhatsApp (campañas: variable "Link de la encuesta por empresa",
 * $link.encuestaEmpresa) y registra el canal "whatsapp" (o el de ?canal=). No
 * inicia la sesión del asistente: solo responde a nombre de su empresa.
 */
export default function CompanySurveyPage() {
  const { eventId, userId } = useParams<{ eventId: string; userId: string }>();
  const [searchParams] = useSearchParams();
  const channel: CompanySurveyChannel = searchParams.get("canal") === "web" ? "web" : "whatsapp";

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState<any>(null);
  const [event, setEvent] = useState<any>(null);
  const [config, setConfig] = useState<CompanySurveyConfig | null>(null);
  // undefined = cargando
  const [response, setResponse] = useState<CompanySurveyResponse | null | undefined>(undefined);
  const [justAnswered, setJustAnswered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!eventId || !userId) {
        setError("El link está incompleto.");
        setLoading(false);
        return;
      }
      try {
        // Las reglas exigen una sesión de Firebase para escribir; en navegadores
        // in-app (WhatsApp) puede no haberla todavía.
        if (!auth.currentUser) await signInAnonymously(auth);
        const [userSnap, eventSnap] = await Promise.all([
          getDoc(doc(db, "users", userId)),
          getDoc(doc(db, "events", eventId)),
        ]);
        if (cancelled) return;
        const user = userSnap.exists() ? userSnap.data() : null;
        if (!user || !eventSnap.exists() || user.eventId !== eventId) {
          setError("No encontramos tu registro en este evento.");
          return;
        }
        const ev = eventSnap.data();
        if (ev.config?.policies?.companySurveyEnabled !== true) {
          setError("Esta encuesta ya no está disponible.");
          return;
        }
        setUserData(user);
        setEvent(ev);
        setConfig(getCompanySurveyConfig(ev.config?.policies));
      } catch (e) {
        console.error("[CompanySurveyPage]", e);
        if (!cancelled) setError("No pudimos abrir la encuesta. Intenta de nuevo en unos minutos.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, userId]);

  useEffect(() => {
    if (!eventId || !userId || !userData) return;
    return subscribeCompanySurvey(eventId, getCompanySurveyKey(userData, userId), setResponse, () => setResponse(null));
  }, [eventId, userId, userData]);

  const logo = event?.dashboardLogo || event?.eventImage;

  if (loading || (userData && response === undefined)) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  if (error || !config || !userData) {
    return (
      <Center h="100vh" p="md">
        <Stack align="center" gap="sm" maw={420}>
          <Title order={3} ta="center">
            Encuesta no disponible
          </Title>
          <Text c="dimmed" ta="center">
            {error || "No pudimos abrir la encuesta."}
          </Text>
        </Stack>
      </Center>
    );
  }

  return (
    <Container size="sm" py="xl" px="md">
      <Paper withBorder radius="lg" p={{ base: "md", sm: "xl" }}>
        <Stack gap="lg">
          {logo && <Image src={logo} alt="" h={70} fit="contain" />}
          {response ? (
            <Stack align="center" gap="sm" py="md">
              <ThemeIcon size={56} radius="xl" color="green">
                <IconCheck size={32} />
              </ThemeIcon>
              <Title order={3} ta="center">
                ¡Gracias!
              </Title>
              <Text ta="center">
                {justAnswered
                  ? "Tu respuesta quedó registrada."
                  : `${response.respondedByName || "Alguien de tu empresa"} ya respondió esta encuesta${
                      response.companyName ? ` por ${response.companyName}` : ""
                    }. No necesitas hacer nada más.`}
              </Text>
              <Button component={Link} to={`/acceso/${eventId}/${userId}`} variant="light" mt="sm">
                Ir a la plataforma
              </Button>
            </Stack>
          ) : (
            <CompanySurveyForm
              eventId={eventId!}
              uid={userId!}
              userData={userData}
              config={config}
              channel={channel}
              onDone={(r, alreadyAnswered) => {
                setJustAnswered(!alreadyAnswered);
                setResponse(r);
              }}
            />
          )}
        </Stack>
      </Paper>
    </Container>
  );
}

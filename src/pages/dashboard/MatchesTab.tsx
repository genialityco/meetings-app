import {
  Grid,
  Card,
  Group,
  Avatar,
  Title,
  Text,
  Button,
  Badge,
  Stack,
  Divider,
  Paper,
  ThemeIcon,
  Box,
  useMantineTheme,
  Loader,
  Center,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import { useState, useEffect } from "react";
import { IconHeart, IconX, IconCheck, IconSparkles, IconMail, IconPhone, IconBriefcase, IconFileDescription, IconBulb } from "@tabler/icons-react";
import type { Assistant, MeetingContext } from "./types";
import MeetingRequestModal from "./MeetingRequestModal";
import { collection, onSnapshot, query, where, updateDoc, doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";

interface Match {
  id: string;
  userId: string;
  userName: string;
  userCompany: string;
  userRole: string | null;
  userInterest: string | null;
  userPhoto: string | null;
  userEmail: string | null;
  userPhone: string | null;
  userPosition: string | null;
  userDescription: string | null;
  userNeed: string | null;
  affinityScore: number;
  reasons: string[];
  status: "pending" | "meeting_requested" | "dismissed";
  eventId: string;
  createdAt: any;
}

interface MatchesTabProps {
  currentUser: any;
  sendMeetingRequest: (
    id: string,
    phone: string,
    groupId?: string | null,
    context?: MeetingContext,
  ) => Promise<void>;
  solicitarReunionHabilitado: boolean;
  eventId?: string;
  highlightEntityId?: string;
}

export default function MatchesTab({
  currentUser,
  sendMeetingRequest,
  solicitarReunionHabilitado,
  eventId,
  highlightEntityId,
}: MatchesTabProps) {
  const theme = useMantineTheme();
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [modalOpened, setModalOpened] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const myUid = currentUser?.uid;

  // Efecto para hacer scroll y resaltar la card cuando viene de notificación
  useEffect(() => {
    console.log("[MatchesTab] highlightEntityId received:", highlightEntityId);
    console.log("[MatchesTab] Current matches count:", matches.length);
    
    if (highlightEntityId) {
      console.log("[MatchesTab] Setting highlightedId to:", highlightEntityId);
      setHighlightedId(highlightEntityId);
      
      // Esperar más tiempo para asegurar que las cards estén renderizadas
      setTimeout(() => {
        const element = document.getElementById(`match-card-${highlightEntityId}`);
        console.log("[MatchesTab] Looking for element:", `match-card-${highlightEntityId}`, "found:", element);
        
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          console.warn("[MatchesTab] Element not found, available matches:", matches.map(m => m.userId));
        }
      }, 500); // Aumentado de 300ms a 500ms

      // Remover el resaltado después de 8 segundos
      const timer = setTimeout(() => {
        console.log("[MatchesTab] Removing highlight");
        setHighlightedId(null);
      }, 8000);

      return () => clearTimeout(timer);
    } else {
      console.log("[MatchesTab] No highlightEntityId provided");
    }
  }, [highlightEntityId, matches.length]);

  // Cargar matches del usuario
  useEffect(() => {
    if (!myUid || !eventId) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, "users", myUid, "matches"),
      where("eventId", "==", eventId)
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      const matchesData = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as Match[];

      // Ordenar por score de afinidad (mayor primero) y luego por fecha
      matchesData.sort((a, b) => {
        if (b.affinityScore !== a.affinityScore) {
          return b.affinityScore - a.affinityScore;
        }
        const timeA = a.createdAt?.toMillis?.() || 0;
        const timeB = b.createdAt?.toMillis?.() || 0;
        return timeB - timeA;
      });

      setMatches(matchesData);
      setLoading(false);
    });

    return unsubscribe;
  }, [myUid, eventId]);

  const handleDismiss = async (match: Match) => {
    try {
      await updateDoc(doc(db, "users", myUid, "matches", match.id), {
        status: "dismissed",
      });
      showNotification({
        title: "Match descartado",
        message: `Has descartado el match con ${match.userName}`,
        color: "gray",
      });
    } catch (error) {
      console.error("Error dismissing match:", error);
      showNotification({
        title: "Error",
        message: "No se pudo descartar el match",
        color: "red",
      });
    }
  };

  const handleOpenModal = (match: Match) => {
    setSelectedMatch(match);
    setModalOpened(true);
  };

  const handleConfirmMeeting = async (message: string) => {
    if (!selectedMatch) return;

    setLoadingId(selectedMatch.id);
    try {
      // Obtener el teléfono del usuario del match
      const userDocRef = doc(db, "users", selectedMatch.userId);
      const userDocSnap = await getDoc(userDocRef);
      const userData = userDocSnap.data();
      const phone = userData?.telefono || "";

      await sendMeetingRequest(selectedMatch.userId, phone, null, {
        contextNote: message || `Match de ${selectedMatch.affinityScore}% de afinidad`,
      });

      // Actualizar estado del match
      await updateDoc(doc(db, "users", myUid, "matches", selectedMatch.id), {
        status: "meeting_requested",
      });

      showNotification({
        title: "Solicitud enviada",
        message: `Solicitud enviada a ${selectedMatch.userName}${message ? " con tu mensaje personalizado" : ""}.`,
        color: "teal",
      });

      setModalOpened(false);
      setSelectedMatch(null);
    } catch (error) {
      console.error("Error sending meeting request:", error);
      showNotification({
        title: "Error",
        message: "No se pudo enviar la solicitud. Intenta de nuevo.",
        color: "red",
      });
    } finally {
      setLoadingId(null);
    }
  };

  // Filtrar solo matches pendientes
  const pendingMatches = matches.filter((m) => m.status === "pending");

  if (loading) {
    return (
      <Center h={400}>
        <Loader size="lg" />
      </Center>
    );
  }

  if (pendingMatches.length === 0) {
    return (
      <Paper withBorder radius="lg" p="xl">
        <Stack align="center" gap="md">
          <ThemeIcon size={80} radius="xl" variant="light" color="gray">
            <IconHeart size={40} />
          </ThemeIcon>
          <Title order={3} ta="center">
            No tienes matches pendientes
          </Title>
          <Text size="sm" c="dimmed" ta="center" maw={400}>
            Los matches aparecerán aquí cuando se registren personas con alta afinidad contigo (≥70%).
          </Text>
        </Stack>
      </Paper>
    );
  }

  return (
    <>
      <style>
        {`
          @keyframes pulse {
            0%, 100% {
              box-shadow: 0 0 20px rgba(20, 184, 166, 0.4);
            }
            50% {
              box-shadow: 0 0 30px rgba(20, 184, 166, 0.7);
            }
          }
        `}
      </style>
      <Stack gap="md">
        {/* Header con contador */}
        <Paper withBorder radius="lg" p="sm">
          <Group justify="space-between">
            <Group gap="xs">
              <IconSparkles size={20} color={theme.colors.teal[6]} />
              <Text fw={600}>Matches Sugeridos</Text>
            </Group>
            <Badge size="lg" variant="filled" color="teal">
              {pendingMatches.length} {pendingMatches.length === 1 ? "match" : "matches"}
            </Badge>
          </Group>
        </Paper>

        {/* Grid de matches */}
        <Grid gutter="sm">
          {pendingMatches.map((match) => {
            const isLoading = loadingId === match.id;
            const isHighlighted = highlightedId === match.userId;
            
            console.log("[MatchesTab Card]", {
              matchId: match.id,
              matchUserId: match.userId,
              highlightedId,
              isHighlighted,
            });

            return (
              <Grid.Col span={{ base: 12, sm: 6, md: 4, lg: 3 }} key={match.id}>
                <Card
                  id={`match-card-${match.userId}`}
                  withBorder
                  radius="xl"
                  padding="md"
                  shadow="sm"
                  style={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    position: "relative",
                    border: isHighlighted ? "3px solid var(--mantine-color-teal-5)" : undefined,
                    boxShadow: isHighlighted ? "0 0 20px rgba(20, 184, 166, 0.4)" : undefined,
                    animation: isHighlighted ? "pulse 2s ease-in-out 3" : undefined,
                  }}
                >
                  {/* Badge de afinidad */}
                  <Badge
                    variant="gradient"
                    gradient={{ from: "teal", to: "green", deg: 90 }}
                    size="lg"
                    radius="md"
                    leftSection={<IconHeart size={14} />}
                    style={{
                      position: "absolute",
                      top: 10,
                      right: 10,
                      zIndex: 1,
                    }}
                  >
                    {match.affinityScore}% match
                  </Badge>

                  {/* Badge NEW cuando está resaltado */}
                  {isHighlighted && (
                    <Badge
                      variant="filled"
                      color="teal"
                      size="lg"
                      radius="md"
                      style={{
                        position: "absolute",
                        top: 10,
                        left: 10,
                        zIndex: 2,
                        fontWeight: 700,
                      }}
                    >
                      NEW
                    </Badge>
                  )}

                  {/* Header */}
                  <Group wrap="nowrap" align="center" gap="sm" mb="md">
                    <Avatar
                      src={match.userPhoto}
                      alt={`Avatar de ${match.userName}`}
                      radius="xl"
                      size={52}
                    >
                      {(match.userName || "A")[0]?.toUpperCase()}
                    </Avatar>

                    <Box style={{ minWidth: 0, flex: 1 }}>
                      <Title order={6} lineClamp={1}>
                        {match.userName || "Sin nombre"}
                      </Title>
                      <Text size="sm" c="dimmed" lineClamp={1}>
                        {match.userPosition || match.userRole || "Asistente"}
                      </Text>
                      <Text size="sm" c="dimmed" lineClamp={1}>
                        {match.userCompany || "Sin empresa"}
                      </Text>
                    </Box>
                  </Group>

                  <Divider my="sm" />

                  {/* Información de contacto y detalles */}
                  <Stack gap={6} mb="sm">
                    {match.userEmail && (
                      <Group gap={6} wrap="nowrap">
                        <ThemeIcon variant="light" radius="xl" size={22}>
                          <IconMail size={12} />
                        </ThemeIcon>
                        <Text size="xs" lineClamp={1} style={{ minWidth: 0 }}>
                          {match.userEmail}
                        </Text>
                      </Group>
                    )}
                    {match.userPhone && (
                      <Group gap={6} wrap="nowrap">
                        <ThemeIcon variant="light" radius="xl" size={22}>
                          <IconPhone size={12} />
                        </ThemeIcon>
                        <Text size="xs" lineClamp={1}>
                          {match.userPhone}
                        </Text>
                      </Group>
                    )}
                    {match.userDescription && (
                      <Group gap={6} wrap="nowrap" align="flex-start">
                        <ThemeIcon variant="light" radius="xl" size={22}>
                          <IconFileDescription size={12} />
                        </ThemeIcon>
                        <Text size="xs" lineClamp={2} style={{ minWidth: 0 }}>
                          {match.userDescription}
                        </Text>
                      </Group>
                    )}
                    {match.userNeed && (
                      <Group gap={6} wrap="nowrap" align="flex-start">
                        <ThemeIcon variant="light" radius="xl" size={22}>
                          <IconBulb size={12} />
                        </ThemeIcon>
                        <Text size="xs" lineClamp={2} style={{ minWidth: 0 }}>
                          {match.userNeed}
                        </Text>
                      </Group>
                    )}
                  </Stack>

                  <Divider my="sm" />

                  {/* Razones de afinidad */}
                  <Stack gap={6} style={{ flex: 1 }}>
                    <Text size="xs" fw={600} c="dimmed">
                      Por qué son compatibles:
                    </Text>
                    {match.reasons.map((reason, idx) => (
                      <Group key={idx} gap={6} wrap="nowrap">
                        <IconCheck size={14} color={theme.colors.teal[6]} />
                        <Text size="xs" lineClamp={1}>
                          {reason}
                        </Text>
                      </Group>
                    ))}
                  </Stack>

                  {/* Botones de acción */}
                  <Stack gap="xs" mt="md">
                    <Button
                      fullWidth
                      radius="md"
                      size="sm"
                      color="teal"
                      leftSection={<IconHeart size={16} />}
                      onClick={() => handleOpenModal(match)}
                      disabled={!solicitarReunionHabilitado || isLoading}
                      loading={isLoading}
                    >
                      Solicitar reunión
                    </Button>
                    <Button
                      fullWidth
                      radius="md"
                      size="sm"
                      variant="light"
                      color="gray"
                      leftSection={<IconX size={16} />}
                      onClick={() => handleDismiss(match)}
                      disabled={isLoading}
                    >
                      Descartar
                    </Button>
                  </Stack>
                </Card>
              </Grid.Col>
            );
          })}
        </Grid>
      </Stack>

      {/* Modal de solicitud de reunión */}
      <MeetingRequestModal
        opened={modalOpened}
        recipientName={selectedMatch?.userName || ""}
        recipientType="match"
        onCancel={() => {
          setModalOpened(false);
          setSelectedMatch(null);
        }}
        onConfirm={handleConfirmMeeting}
        loading={loadingId === selectedMatch?.id}
      />
    </>
  );
}

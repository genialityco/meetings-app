import {
  Grid,
  Card,
  Group,
  Avatar,
  Title,
  Text,
  Button,
  TextInput,
  Select,
  Alert,
  Stack,
  Divider,
  Paper,
  ActionIcon,
  ThemeIcon,
  Box,
  useMantineTheme,
  Badge,
  Loader,
  Highlight,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import { useState, useMemo, useEffect } from "react";
import {
  IconSearch,
  IconX,
  IconBuildingStore,
  IconBriefcase,
  IconMail,
  IconFileDescription,
  IconTargetArrow,
  IconBulb,
  IconCalendarCheck,
  IconPhone,
  IconId,
  IconUsers,
  IconHeart,
  IconFileTypePdf,
  IconSparkles,
} from "@tabler/icons-react";
import type { Assistant } from "./types";
import { useNavigate, useParams } from "react-router-dom";
import MeetingRequestModal from "./MeetingRequestModal";

interface MeetingContext {
  contextNote?: string;
}

const VECTOR_SEARCH_URL = "https://vectorsearch-6eaymlz5eq-uc.a.run.app";

const FIELD_ICONS: Record<string, any> = {
  empresa: IconBuildingStore,
  cargo: IconBriefcase,
  correo: IconMail,
  telefono: IconPhone,
  descripcion: IconFileDescription,
  interesPrincipal: IconTargetArrow,
  necesidad: IconBulb,
  cedula: IconId,
  tipoAsistente: IconUsers,
};

/** Formatea el valor de un campo para mostrar en card.
 *  - Arrays (multiselect): une con ", " y reemplaza __otro__ por el texto de {field}_otro */
function formatFieldValue(fieldName: string, data: any): string | null {
  const raw = data[fieldName];
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const otroText = data[`${fieldName}_otro`];
    const items = raw
      .filter((v: string) => v !== "__otro__") // Filtrar __otro__
      .map((v: string) => v);
    
    // Si hay texto en el campo _otro, agregarlo
    if (otroText && raw.includes("__otro__")) {
      items.push(otroText);
    }
    
    return items.length > 0 ? items.join(", ") : null;
  }
  return String(raw);
}

interface AttendeesViewProps {
  filteredAssistants: Assistant[];
  showOnlyToday: boolean;
  setShowOnlyToday: (v: any) => void;
  interestOptions: { value: string; label: string }[];
  interestFilter: string | null;
  setInterestFilter: (v: string | null) => void;
  eventConfig: any;
  solicitarReunionHabilitado: boolean;
  sendMeetingRequest: (
    id: string,
    phone: string,
    groupId?: string | null,
    context?: MeetingContext,
  ) => Promise<void>;
  setAvatarModalOpened: (v: boolean) => void;
  setSelectedImage: (v: string | null) => void;
  currentUser: any;
  formFields: any[];
  cardFields: string[];
  affinityScores: Record<string, number>;
  highlightEntityId?: string;
}

function InfoRow({
  icon,
  label,
  value,
  highlightText,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
  highlightText?: string;
}) {
  return (
    <Group gap={8} wrap="nowrap" align="flex-start">
      <ThemeIcon variant="light" radius="xl" size={26}>
        {icon}
      </ThemeIcon>
      <Text size="sm" style={{ minWidth: 0 }}>
        <Text span fw={700}>
          {label}:
        </Text>{" "}
        {value && String(value).trim().length > 0 ? (
          highlightText ? (
            <Highlight highlight={highlightText} component="span" size="sm">
              {value}
            </Highlight>
          ) : (
            value
          )
        ) : (
          "No disponible"
        )}
      </Text>
    </Group>
  );
}

export default function AttendeesView({
  filteredAssistants,
  showOnlyToday,
  setShowOnlyToday,
  interestOptions,
  interestFilter,
  setInterestFilter,
  eventConfig,
  solicitarReunionHabilitado,
  sendMeetingRequest,
  setAvatarModalOpened,
  setSelectedImage,
  currentUser,
  formFields,
  cardFields,
  affinityScores,
  highlightEntityId,
}: AttendeesViewProps) {
  const theme = useMantineTheme();
  const [searchTerm, setSearchTerm] = useState("");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [modalOpened, setModalOpened] = useState(false);
  const [selectedAssistant, setSelectedAssistant] = useState<Assistant | null>(null);
  const [sortBy, setSortBy] = useState<"affinity" | "date">("affinity");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const [vectorResults, setVectorResults] = useState<any[]>([]);
  const [isVectorSearching, setIsVectorSearching] = useState(false);
  const [hasSearchedVector, setHasSearchedVector] = useState(false);

  // Efecto para hacer scroll y resaltar la card cuando viene de notificación
  useEffect(() => {
    if (highlightEntityId) {
      setHighlightedId(highlightEntityId);
      
      // Esperar a que el DOM se renderice
      setTimeout(() => {
        const element = document.getElementById(`assistant-card-${highlightEntityId}`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 300);

      // Remover el resaltado después de 8 segundos
      const timer = setTimeout(() => {
        setHighlightedId(null);
      }, 8000);

      return () => clearTimeout(timer);
    }
  }, [highlightEntityId]);

  const myUid = currentUser?.uid;
  const navigate = useNavigate();
  const { eventId: eventIdFromParams } = useParams<{ eventId: string }>();
  const eventId = currentUser?.eventId || eventIdFromParams;

  // Búsqueda por vectores con debounce
  useEffect(() => {
    const trimmed = searchTerm.trim();
    
    if (!trimmed || trimmed.length < 3) {
      setVectorResults([]);
      setHasSearchedVector(false);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setIsVectorSearching(true);
      
      try {
        const response = await fetch(VECTOR_SEARCH_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: trimmed,
            category: "assistants",
            eventId: eventId,
            limit: 30,
            threshold: 0.3,
          }),
        });

        if (!response.ok) {
          throw new Error("Vector search failed");
        }

        const data = await response.json();

        if (data.results && data.results.length > 0) {
          setVectorResults(data.results);
        } else {
          setVectorResults([]);
        }
      } catch (error) {
        console.error("Vector search error:", error);
        setVectorResults([]);
      } finally {
        setIsVectorSearching(false);
        setHasSearchedVector(true);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [searchTerm, eventId]);

  const maxMeetingsText = useMemo(() => {
    const n = eventConfig?.maxMeetingsPerUser;
    if (n === undefined || n === null) return "∞";
    return String(n);
  }, [eventConfig]);

  const displayedAssistants = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    
    let baseAssistants = filteredAssistants;
    if (showOnlyToday) {
      baseAssistants = baseAssistants.filter((a) => a.connectedToday === true);
    }
    
    if (!term) {
      let results = [...baseAssistants];
      if (sortBy === "affinity") {
        results.sort((a, b) => (affinityScores[b.id] || 0) - (affinityScores[a.id] || 0));
      } else {
        results.sort((a, b) => {
          const timeA = a.createdAt?.toMillis?.() || 0;
          const timeB = b.createdAt?.toMillis?.() || 0;
          return timeB - timeA;
        });
      }
      return results;
    }

    const exactMatches = baseAssistants.filter((a) => {
      return (
        (a.empresa ?? "").toString().toLowerCase().includes(term) ||
        (a.nombre ?? "").toString().toLowerCase().includes(term) ||
        (a.cargo ?? "").toString().toLowerCase().includes(term) ||
        formFields.some((f) =>
          (a[f.name] ?? "").toString().toLowerCase().includes(term)
        )
      );
    });

    let semanticMatches: any[] = [];
    if (vectorResults.length > 0) {
      const exactIds = new Set(exactMatches.map((a) => a.id));
      
      semanticMatches = vectorResults
        .map((v) => {
          const found = baseAssistants.find((a) => a.id === v.id);
          if (found) {
            return {
              ...found,
              _similarity: v.similarity,
              _isSemantic: true,
            };
          }
          return null;
        })
        .filter(Boolean);
        
      semanticMatches = semanticMatches.filter((a) => !exactIds.has(a.id));
    }

    return [...exactMatches, ...semanticMatches];
  }, [filteredAssistants, searchTerm, formFields, showOnlyToday, sortBy, affinityScores, vectorResults]);

  const handleOpenModal = (assistant: Assistant) => {
    setSelectedAssistant(assistant);
    setModalOpened(true);
  };

  const handleConfirmMeeting = async (message: string) => {
    if (!selectedAssistant) return;
    
    setLoadingId(selectedAssistant.id);
    try {
      await sendMeetingRequest(selectedAssistant.id, selectedAssistant.telefono || "", null, {
        contextNote: message || undefined,
      });
      
      showNotification({
        title: "Solicitud enviada",
        message: `Solicitud enviada a ${selectedAssistant.nombre}${message ? ' con tu mensaje personalizado' : ''}.`,
        color: "teal",
      });
      
      setModalOpened(false);
      setSelectedAssistant(null);
    } catch {
      showNotification({
        title: "Error",
        message: "No se pudo enviar la solicitud. Intenta de nuevo.",
        color: "red",
      });
    } finally {
      setLoadingId(null);
    }
  };

  const hasSearch = !!searchTerm.trim();

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
          
          @keyframes fadeOut {
            from {
              opacity: 1;
            }
            to {
              opacity: 0;
            }
          }
        `}
      </style>
    <Stack gap="md">
      {/* Filtros (estilo app) */}
      <Paper withBorder radius="lg" p="sm">
        <Grid gutter="sm" align="center">
          <Grid.Col span={{ base: 12, sm: 7 }}>
            <TextInput
              placeholder="Buscar por cualquier campo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              leftSection={
                isVectorSearching ? (
                  <Loader size={16} />
                ) : vectorResults.length > 0 ? (
                  <IconSparkles size={16} style={{ color: "var(--mantine-color-blue-6)" }} />
                ) : (
                  <IconSearch size={16} />
                )
              }
              rightSection={
                hasSearch ? (
                  <ActionIcon
                    variant="subtle"
                    onClick={() => setSearchTerm("")}
                    aria-label="Limpiar búsqueda"
                  >
                    <IconX size={16} />
                  </ActionIcon>
                ) : null
              }
              radius="md"
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 5 }}>
            <Select
              data={interestOptions}
              placeholder="Filtrar por interés principal"
              value={interestFilter}
              onChange={setInterestFilter}
              clearable
              searchable
              radius="md"
            />
          </Grid.Col>

          <Grid.Col span={{ base: 12 }}>
            <Group justify="space-between" wrap="wrap">
              <Group gap="xs">
                <Button
                  variant={showOnlyToday ? "filled" : "light"}
                  color={theme.primaryColor}
                  size="xs"
                  leftSection={<IconCalendarCheck size={14} />}
                  onClick={() => setShowOnlyToday((v: boolean) => !v)}
                >
                  {showOnlyToday ? "Solo conectados hoy" : "Todos"}
                </Button>
              </Group>

              <Group gap="xs">
                <Button
                  variant={sortBy === "affinity" ? "filled" : "light"}
                  color="teal"
                  size="xs"
                  leftSection={<IconHeart size={14} />}
                  onClick={() => setSortBy("affinity")}
                >
                  Por afinidad
                </Button>
                <Button
                  variant={sortBy === "date" ? "filled" : "light"}
                  color="gray"
                  size="xs"
                  leftSection={<IconCalendarCheck size={14} />}
                  onClick={() => setSortBy("date")}
                >
                  Por fecha
                </Button>
              </Group>

              <Text size="sm" c="dimmed">
                Máximo:{" "}
                <Text span fw={800}>
                  {maxMeetingsText}
                </Text>{" "}
                {eventConfig?.maxMeetingsPerUser === 1
                  ? "reunión"
                  : "reuniones"}
              </Text>
            </Group>
          </Grid.Col>
        </Grid>
      </Paper>

      {/* Alert oportunista */}
      {displayedAssistants.length > 0 && displayedAssistants.length <= 10 && (
        <Alert
          color={theme.primaryColor}
          title="Aún estás entre los primeros"
          styles={{ message: { lineHeight: 1.6 } }}
        >
          Solo hay{" "}
          <strong>
            {displayedAssistants.length} asistente
            {displayedAssistants.length !== 1 ? "s" : ""}
          </strong>{" "}
          registrado{displayedAssistants.length !== 1 ? "s" : ""}. Aprovecha para
          conectar con los pioneros del evento.
        </Alert>
      )}

      {/* Grid */}
      <Grid gutter="sm">
        {displayedAssistants.length > 0 ? (
          displayedAssistants.map((assistant) => {
            const isMine = !!myUid && assistant.id === myUid;
            const disabled =
              !solicitarReunionHabilitado ||
              loadingId === assistant.id ||
              isMine;

            // Verificar si esta card debe ser resaltada (usando el estado temporal)
            const isHighlighted = highlightedId === assistant.id;

            return (
              <Grid.Col
                span={{ base: 12, sm: 6, md: 4, lg: 3 }}
                key={assistant.id}
              >
                <Card
                  id={`assistant-card-${assistant.id}`}
                  withBorder
                  radius="xl"
                  
                  shadow="sm"
                  style={{
                    paddingTop: "25px",
                    paddingRight: "15px",
                    paddingRottom: "15px",
                    paddingLeft: "15px",
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
                      gradient={{ from: 'teal', to: 'green', deg: 90 }}
                      size="sm"
                      radius="md"
                      leftSection={<IconHeart size={12} />}
                      style={{
                        position: "absolute",
                        top: 10,
                        right: 10,
                        zIndex: 1,
                      }}
                    >
                      {affinityScores[assistant.id] || 0}% afinidad
                    </Badge>

                  {/* Badge Búsqueda Inteligente */}
                  {(assistant as any)._isSemantic && (
                    <Badge
                      variant="gradient"
                      gradient={{ from: 'blue', to: 'cyan', deg: 90 }}
                      size="sm"
                      radius="md"
                      leftSection={<IconSparkles size={12} />}
                      style={{
                        position: "absolute",
                        top: 40,
                        right: 10,
                        zIndex: 1,
                      }}
                    >
                      {Math.round(((assistant as any)._similarity || 0) * 100)}% Match IA
                    </Badge>
                  )}

                  {/* Badge NUEVO cuando está resaltado */}
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
                      ¡NUEVO!
                    </Badge>
                  )}

                  {/* Header */}
                  <Group wrap="nowrap" align="center" gap="sm">
                    <Avatar
                      src={assistant.photoURL}
                      alt={`Avatar de ${assistant.nombre}`}
                      radius="xl"
                      size={52}
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        setSelectedImage(assistant.photoURL || null);
                        setAvatarModalOpened(true);
                      }}
                    >
                      {(assistant.nombre || "A")[0]?.toUpperCase()}
                    </Avatar>

                    <Box style={{ minWidth: 0, flex: 1 }}>
                      <Title order={6} lineClamp={1}>
                        <Highlight highlight={searchTerm} component="span">
                          {assistant.nombre || "Sin nombre"}
                        </Highlight>
                      </Title>
                      <Text size="sm" c="dimmed" lineClamp={1} component="div">
                        <Highlight highlight={searchTerm} component="span" size="sm">
                          {assistant.cargo || "Asistente"}
                        </Highlight>
                      </Text>
                      <Text
                        size="sm"
                        c="dimmed"
                        component="div"
                        style={{textDecoration: "underline", cursor: assistant.nitNorm !== "sin-nit" && assistant.eventId ? "pointer" : "default"}}
                        onClick={
                          assistant.nitNorm !== "sin-nit" && assistant.eventId
                            ? () =>
                                navigate(
                                  `/dashboard/${assistant.eventId}/company/${assistant.company_nit}`,
                                )
                            : undefined
                        }
                      >
                        <Highlight highlight={searchTerm} component="span" size="sm">
                          {assistant.empresa || "Sin empresa"}
                        </Highlight>
                      </Text>
                    </Box>
                  </Group>

                  <Divider my="sm" />

                  {/* Body - campos configurables */}
                  <Stack gap={8} style={{ flex: 1, minHeight: 0 }}>
                    {cardFields.map((fieldName) => {
                      const fieldDef = formFields.find(
                        (f: any) => f.name === fieldName,
                      );
                      // Respetar condición showWhen: no mostrar si el asistente no cumple
                      if (fieldDef?.showWhen) {
                        const parentValue = assistant[fieldDef.showWhen.field];
                        const allowed = fieldDef.showWhen.value as string[];
                        if (!parentValue || !allowed.includes(parentValue))
                          return null;
                      }
                      const label = fieldDef?.label || fieldName;

                      // Campos PDF: mostrar botón de descarga
                      if (fieldDef?.type === "pdf") {
                        const pdfUrl = assistant[fieldName];
                        if (!pdfUrl) return null;
                        return (
                          <Group key={fieldName} gap={8} wrap="nowrap">
                            <ThemeIcon variant="light" radius="xl" size={26} color="red">
                              <IconFileTypePdf size={14} />
                            </ThemeIcon>
                            <Button
                              component="a"
                              href={pdfUrl}
                              target="_blank"
                              rel="noreferrer"
                              variant="light"
                              color="red"
                              size="xs"
                              radius="md"
                              leftSection={<IconFileTypePdf size={13} />}
                            >
                              {label}
                            </Button>
                          </Group>
                        );
                      }

                      const Icon =
                        FIELD_ICONS[fieldName] || IconFileDescription;
                      return (
                        <InfoRow
                          key={fieldName}
                          icon={<Icon size={14} />}
                          label={label}
                          value={formatFieldValue(fieldName, assistant)}
                          highlightText={searchTerm}
                        />
                      );
                    })}
                  </Stack>

                  {/* CTA */}
                  <Button
                    mt="md"
                    radius="md"
                    size="sm"
                    fullWidth
                    color={theme.primaryColor}
                    onClick={() => handleOpenModal(assistant)}
                    disabled={disabled}
                    loading={loadingId === assistant.id}
                  >
                    {!solicitarReunionHabilitado
                      ? "Solicitudes deshabilitadas"
                      : isMine
                        ? "Tu perfil"
                        : "Solicitar reunión"}
                  </Button>
                </Card>
              </Grid.Col>
            );
          })
        ) : (
          <Grid.Col span={12}>
            <Paper withBorder radius="lg" p="lg" style={{ textAlign: "center" }}>
              <Text c="dimmed" mb="md">
                No se encontraron asistentes. Intenta ajustar los filtros de
                búsqueda.
              </Text>
              <Button
                variant="light"
                onClick={() => {
                  setSearchTerm("");
                  setInterestFilter(null);
                  setShowOnlyToday(false);
                }}
              >
                Limpiar filtros
              </Button>
            </Paper>
          </Grid.Col>
        )}
      </Grid>

      {/* Modal de solicitud de reunión */}
      <MeetingRequestModal
        opened={modalOpened}
        recipientName={selectedAssistant?.nombre || ""}
        recipientType="asistente"
        onCancel={() => {
          setModalOpened(false);
          setSelectedAssistant(null);
        }}
        onConfirm={handleConfirmMeeting}
        loading={loadingId === selectedAssistant?.id}
      />
    </Stack>
    </>
  );
}

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
  Loader,
  Badge,
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
  IconSparkles,
} from "@tabler/icons-react";
import type { Assistant } from "./types";
import { useNavigate, useParams } from "react-router-dom";

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
    const items = raw.map((v: string) =>
      v === "__otro__" && otroText ? otroText : v,
    );
    return items.join(", ");
  }
  return String(raw);
}

interface AttendeesViewProps {
  filteredAssistants: Assistant[];
  searchTerm: string;
  setSearchTerm: (v: string) => void;
  showOnlyToday: boolean;
  setShowOnlyToday: (v: any) => void;
  interestOptions: { value: string; label: string }[];
  interestFilter: string | null;
  setInterestFilter: (v: string | null) => void;
  eventConfig: any;
  solicitarReunionHabilitado: boolean;
  sendMeetingRequest: (id: string, phone: string) => Promise<void>;
  setAvatarModalOpened: (v: boolean) => void;
  setSelectedImage: (v: string | null) => void;
  currentUser: any;
  formFields: any[];
  cardFields: string[];
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
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
        {value && String(value).trim().length > 0 ? value : "No disponible"}
      </Text>
    </Group>
  );
}

export default function AttendeesView({
  filteredAssistants,
  searchTerm,
  setSearchTerm,
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
}: AttendeesViewProps) {
  const theme = useMantineTheme();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [vectorResults, setVectorResults] = useState<Assistant[]>([]);
  const [isVectorSearching, setIsVectorSearching] = useState(false);
  const [useVectorSearch, setUseVectorSearch] = useState(false);

  const myUid = currentUser?.uid;
  const navigate = useNavigate();
  const { eventId: eventIdFromParams } = useParams<{ eventId: string }>();
  const eventId = currentUser?.eventId || eventIdFromParams;

  const maxMeetingsText = useMemo(() => {
    const n = eventConfig?.maxMeetingsPerUser;
    if (n === undefined || n === null) return "∞";
    return String(n);
  }, [eventConfig]);

  // Búsqueda por vectores con debounce
  useEffect(() => {
    const trimmed = searchTerm.trim();
    
    // Si no hay eventId, no podemos hacer búsqueda
    if (!eventId) {
      setUseVectorSearch(false);
      setVectorResults([]);
      return;
    }
    
    // Si no hay texto de búsqueda, resetear
    if (!trimmed) {
      setUseVectorSearch(false);
      setVectorResults([]);
      return;
    }

    // Si el texto es muy corto, no usar vectores
    if (trimmed.length < 3) {
      setUseVectorSearch(false);
      return;
    }

    // Debounce: esperar 500ms después de que el usuario deje de escribir
    const timeoutId = setTimeout(async () => {
      setIsVectorSearching(true);
      
      try {
        const requestBody = {
          text: trimmed,
          category: "assistants",
          eventId: eventId,
          userId: myUid,
          limit: 50,
          threshold: 0.55,
        };
        
        console.log("Vector search request:", requestBody);
        
        const response = await fetch(VECTOR_SEARCH_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          throw new Error("Vector search failed");
        }

        const data = await response.json();
        console.log("Vector search response:", data);
        
        // Los resultados de vectorSearch ya vienen con todos los campos necesarios
        setVectorResults(data.results as Assistant[]);
        setUseVectorSearch(true);
        
        console.log(`Vector search found ${data.results.length} assistants`);
      } catch (error) {
        console.error("Vector search error:", error);
        // Fallback a búsqueda normal
        setUseVectorSearch(false);
        setVectorResults([]);
      } finally {
        setIsVectorSearching(false);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [searchTerm, eventId, myUid, filteredAssistants]);

  // Aplicar búsqueda por vectores si está activa
  const displayedAssistants = useMemo(() => {
    console.log("=== displayedAssistants useMemo ===");
    console.log("useVectorSearch:", useVectorSearch);
    console.log("searchTerm:", searchTerm);
    console.log("vectorResults.length:", vectorResults.length);
    console.log("filteredAssistants.length:", filteredAssistants.length);
    console.log("interestFilter:", interestFilter);
    console.log("showOnlyToday:", showOnlyToday);
    console.log("currentEventId:", eventId);
    
    // Si NO estamos usando búsqueda por vectores, devolver filteredAssistants
    if (!useVectorSearch || searchTerm.trim().length < 3) {
      console.log("Using filteredAssistants (no vector search)");
      return filteredAssistants;
    }
    
    // Si estamos usando búsqueda por vectores, empezar con vectorResults
    let results = [...vectorResults]; // Crear copia para no mutar el original
    console.log("Starting with vectorResults:", results.length);
    
    // Log de los primeros resultados para debugging
    if (results.length > 0) {
      console.log("First result:", {
        id: results[0].id,
        nombre: results[0].nombre,
        interesPrincipal: results[0].interesPrincipal,
        lastLogin: results[0].lastLogin,
        eventId: results[0].eventId
      });
    }
    
    // Aplicar filtro de interés si existe
    if (interestFilter) {
      const beforeFilter = results.length;
      results = results.filter(a => a.interesPrincipal === interestFilter);
      console.log(`After interest filter (${interestFilter}): ${beforeFilter} -> ${results.length}`);
    }
    
    // Aplicar filtro de "solo hoy" si está activo
    if (showOnlyToday) {
      const beforeFilter = results.length;
      const today = new Date().toISOString().split("T")[0];
      results = results.filter(a => {
        const lastLogin = a.lastLogin;
        if (!lastLogin) {
          console.log(`Filtering out ${a.nombre} - no lastLogin`);
          return false;
        }
        const loginDate = new Date(lastLogin).toISOString().split("T")[0];
        const matches = loginDate === today;
        if (!matches) {
          console.log(`Filtering out ${a.nombre} - lastLogin: ${loginDate}, today: ${today}`);
        }
        return matches;
      });
      console.log(`After showOnlyToday filter: ${beforeFilter} -> ${results.length}`);
    }
    
    console.log("Final displayedAssistants:", results.length);
    console.log("=== End useMemo ===");
    return results;
  }, [useVectorSearch, searchTerm, vectorResults, filteredAssistants, interestFilter, showOnlyToday, eventId]);

  const handleSendMeeting = async (assistant: Assistant) => {
    setLoadingId(assistant.id);
    try {
      await sendMeetingRequest(assistant.id, assistant.telefono || "");
      showNotification({
        title: "Solicitud enviada",
        message: `Solicitud enviada a ${assistant.nombre}, quedará en lista de pendientes por aceptar.`,
        color: "teal",
      });
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
                ) : useVectorSearch ? (
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
                {useVectorSearch && (
                  <Badge size="sm" variant="light" color="blue" leftSection={<IconSparkles size={10} />}>
                    Búsqueda inteligente
                  </Badge>
                )}
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

            return (
              <Grid.Col
                span={{ base: 12, sm: 6, md: 4, lg: 3 }}
                key={assistant.id}
              >
                <Card
                  withBorder
                  radius="xl"
                  padding="md"
                  shadow="sm"
                  style={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
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
                        {assistant.nombre || "Sin nombre"}
                      </Title>
                      <Text size="sm" c="dimmed" lineClamp={1}>
                        {assistant.cargo || "Asistente"}
                      </Text>
                      <Text
                        size="sm"
                        c="dimmed"
                        style={{textDecoration: "underline"}}
                        onClick={
                          assistant.nitNorm !== "sin-nit" && assistant.eventId
                            ? () =>
                                navigate(
                                  `/dashboard/${assistant.eventId}/company/${assistant.company_nit}`,
                                )
                            : undefined
                        }
                      >
                        {assistant.empresa || "Sin empresa"}
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
                      const Icon =
                        FIELD_ICONS[fieldName] || IconFileDescription;
                      return (
                        <InfoRow
                          key={fieldName}
                          icon={<Icon size={14} />}
                          label={label}
                          value={formatFieldValue(fieldName, assistant)}
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
                    onClick={() => handleSendMeeting(assistant)}
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
            <Paper withBorder radius="lg" p="lg">
              <Text c="dimmed">
                No se encontraron asistentes. Intenta ajustar los filtros de
                búsqueda.
              </Text>
            </Paper>
          </Grid.Col>
        )}
      </Grid>
    </Stack>
  );
}

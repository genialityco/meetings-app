import {
  Grid,
  Card,
  Group,
  Avatar,
  Title,
  Text,
  Button,
  TextInput,
  Badge,
  Stack,
  Divider,
  Box,
  Image,
  Paper,
  ActionIcon,
  ScrollArea,
  UnstyledButton,
  ThemeIcon,
  useMantineTheme,
  rem,
  Loader,
  Tooltip,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import { useState, useMemo, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  IconSearch,
  IconX,
  IconId,
  IconBriefcase,
  IconMail,
  IconTargetArrow,
  IconBulb,
  IconUsers,
  IconBuildingStore,
  IconFileDescription,
  IconPhone,
  IconSparkles,
  IconCircleCheck,
  IconCalendarEvent,
  IconInfoCircle,
} from "@tabler/icons-react";
import type { Assistant, Company, EventPolicies, MeetingContext } from "./types";
import MeetingRequestModal from "./MeetingRequestModal";
import { getTableLabel } from "./meetingSlotEngine";
import { isCheckedInOnDay, resolveCheckInDay } from "../../utils/eventDays";

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
  const raw = data?.[fieldName];
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const otroText = data[`${fieldName}_otro`];
    const items = raw.map((v: string) =>
      v === "__otro__" && otroText ? otroText : v
    );
    return items.join(", ");
  }
  return String(raw);
}

/** Texto del badge de reunión ya agendada con la empresa: hora (y día si el evento es multi-día). */
function meetingBadgeLabel(m: any, eventConfig: any): string {
  const time = String(m.timeSlot || "").split(" - ")[0];
  const multiDay = (eventConfig?.eventDates?.length || 0) > 1;
  if (multiDay && m.meetingDate) {
    const [, month, day] = String(m.meetingDate).split("-").map(Number);
    if (day && month) return `Reunión ${day}/${month} ${time}`.trim();
  }
  return time ? `Reunión ${time}` : "Reunión agendada";
}

interface CompaniesViewProps {
  filteredAssistants: Assistant[];
  companies: Company[];
  policies: EventPolicies;
  eventConfig?: any;
  solicitarReunionHabilitado: boolean;
  // Punto de entrada único para reuniones desde esta vista: sin advisorId, la
  // solicitud va a la empresa (compartida o menor-carga); con advisorId, es una
  // solicitud directa a esa persona (mismo flujo que cualquier solicitud individual).
  sendMeetingRequestToCompany?: (
    companyNit: string,
    context?: MeetingContext,
    advisorId?: string,
  ) => Promise<{ deferred: boolean } | void>;
  setAvatarModalOpened: (v: boolean) => void;
  setSelectedImage: (v: string | null) => void;
  currentUser: any;
  formFields: any[];
  cardFields: string[];
  affinityScores: Record<string, number>;
  highlightEntityId?: string;
  acceptedMeetings?: any[];
  participantsInfo?: Record<string, any>;
  myStandVisits?: Set<string>;
}

export default function CompaniesView({
  filteredAssistants,
  companies,
  policies,
  eventConfig,
  solicitarReunionHabilitado,
  sendMeetingRequestToCompany,
  setAvatarModalOpened,
  setSelectedImage,
  currentUser,
  formFields,
  cardFields,
  affinityScores,
  highlightEntityId,
  acceptedMeetings,
  participantsInfo,
  myStandVisits,
}: CompaniesViewProps) {
  const theme = useMantineTheme();
  const navigate = useNavigate();
  const { eventId } = useParams();

  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [loadingCompany, setLoadingCompany] = useState<string | null>(null);
  const [selectedAssistantPerCompany, setSelectedAssistantPerCompany] =
    useState<Record<string, string | null>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [modalOpened, setModalOpened] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<{ assistant: Assistant; companyNit: string } | null>(null);
  const [companyModalOpened, setCompanyModalOpened] = useState(false);
  const [selectedCompanyRequest, setSelectedCompanyRequest] = useState<{ empresa: string; companyNit: string } | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const [vectorResults, setVectorResults] = useState<any[]>([]);
  const [isVectorSearching, setIsVectorSearching] = useState(false);
  const [hasSearchedVector, setHasSearchedVector] = useState(false);

  const myUid = currentUser?.uid;

  // Día de check-in vigente ("hoy" si es un día válido del evento, si no el primero),
  // para el indicador de presencia en la lista de representantes.
  const checkInDay = resolveCheckInDay(eventConfig, null);

  // Efecto para hacer scroll y resaltar la card cuando viene de notificación
  useEffect(() => {
    if (highlightEntityId) {
      setHighlightedId(highlightEntityId);
      
      setTimeout(() => {
        const element = document.getElementById(`company-card-${highlightEntityId}`);
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

  // Map para evitar companies.find repetitivo
  const companiesByNit = useMemo(() => {
    const map = new Map<string, Company>();
    (companies || []).forEach((c) => {
      if (c?.nitNorm) map.set(c.nitNorm, c);
    });
    return map;
  }, [companies]);

  // Agrupar asistentes por empresa
  const companiesData = useMemo(() => {
    const grouped = new Map<string, Assistant[]>();

    filteredAssistants.forEach((assistant) => {
      let companyKey = assistant.companyId;
      
      if (policies.groupByRazonSocial) {
         companyKey = assistant.company_razonSocial || assistant.empresa || companyKey;
      }

      companyKey = companyKey || (() => {
          const nitField = Object.keys(assistant).find((k) =>
            k.startsWith("custom_nit_"),
          );
          return nitField && (assistant as any)[nitField]
            ? String((assistant as any)[nitField])
                .split("-")[0]
                .toLowerCase()
            // Sin NIT/empresa: clave única por asistente para no mezclar
            // asistentes sin empresa entre sí en una sola tarjeta falsa.
            : `sin-empresa-${assistant.id}`;
        })();

      // Convert to string to avoid object keys issues if undefined
      const keyString = String(companyKey);

      if (!grouped.has(keyString)) grouped.set(keyString, []);
      grouped.get(keyString)!.push(assistant);
    });

    return Array.from(grouped.entries()).map(([keyStr, asistentes]) => {
      // Find the companyDoc by NIT just in case, but if grouped by razonSocial, it might not match perfectly by keyStr if it's not a NIT.
      // We look up by NIT using the first assistant's companyId
      const nitForLookup = asistentes[0]?.companyId || keyStr;
      const companyDoc = companiesByNit.get(nitForLookup);
      
      const empresa =
        policies.groupByRazonSocial ? keyStr : (companyDoc?.razonSocial || asistentes[0]?.empresa?.trim() || "Sin empresa");

      return {
        nit: keyStr, // Used as ID
        nitLookup: nitForLookup, // NIT real del doc de empresa (puede diferir de keyStr con groupByRazonSocial)
        empresa,
        logoUrl: companyDoc?.logoUrl || null,
        fixedTable: companyDoc?.fixedTable || null,
        asistentes,
        // Cualquier miembro de la empresa cuenta como "asesor" para la solicitud
        // dirigida a la empresa, sin importar su tipoAsistente (ver getCompanyAdvisors).
        hasAdvisor: asistentes.length > 0,
        similarity: undefined as number | undefined,
      };
    });
  }, [filteredAssistants, companiesByNit, policies.groupByRazonSocial]);

  // Reunión aceptada ya existente con cada empresa (por NIT o razón social),
  // para el badge "Reunión hh:mm" de la tarjeta.
  const meetingsByCompany = useMemo(() => {
    const map = new Map<string, any>();
    (acceptedMeetings || []).forEach((m: any) => {
      const otherId = m.requesterId === myUid ? m.receiverId : m.requesterId;
      const other = participantsInfo?.[otherId];
      const keys = new Set<string>();
      if (m.companyId) keys.add(String(m.companyId));
      const otherCompany = other?.companyId;
      if (otherCompany) keys.add(String(otherCompany));
      if (policies.groupByRazonSocial) {
        const razon = other?.company_razonSocial || other?.empresa;
        if (razon) keys.add(String(razon));
      }
      keys.forEach((k) => {
        if (!map.has(k)) map.set(k, m);
      });
    });
    return map;
  }, [acceptedMeetings, participantsInfo, myUid, policies.groupByRazonSocial]);

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
            category: "companies",
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

  // Filtrar por búsqueda
  const filtered = useMemo(() => {
    const t = searchTerm.trim().toLowerCase();
    
    if (!t) {
      let results = [...companiesData];
      results.sort((a, b) => {
        const avgAffinityA = a.asistentes.length > 0
          ? a.asistentes.reduce((sum, assistant) => sum + (affinityScores[assistant.id] || 0), 0) / a.asistentes.length
          : 0;
        const avgAffinityB = b.asistentes.length > 0
          ? b.asistentes.reduce((sum, assistant) => sum + (affinityScores[assistant.id] || 0), 0) / b.asistentes.length
          : 0;
        return avgAffinityB - avgAffinityA;
      });
      return results;
    }

    const exactMatches = companiesData.filter(
      (c) =>
        c.empresa.toLowerCase().includes(t) ||
        c.nit.includes(t) ||
        c.asistentes.some((a) =>
          (a.nombre || "").toLowerCase().includes(t) ||
          (a.cargo || "").toLowerCase().includes(t)
        )
    );

    let semanticMatches: any[] = [];
    if (vectorResults.length > 0) {
      const exactIds = new Set(exactMatches.map((c) => c.nit));
      
      semanticMatches = vectorResults
        .map((v) => {
          const found = companiesData.find((c) => c.nit === v.nitNorm || c.nit === v.id);
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
        
      semanticMatches = semanticMatches.filter((c) => !exactIds.has(c.nit));
    }

    return [...exactMatches, ...semanticMatches];
  }, [companiesData, searchTerm, vectorResults, affinityScores]);

  const handleOpenModal = async (assistant: Assistant, companyNit: string) => {
    // Con "sin aceptación" (requester_picks), se salta el modal de mensaje: se
    // va directo al selector de horario (SlotModal, en Dashboard.tsx), que ya
    // incluye el mensaje opcional en el mismo paso.
    if (policies.schedulingMode === "requester_picks" && sendMeetingRequestToCompany) {
      setLoadingId(assistant.id);
      try {
        await sendMeetingRequestToCompany(companyNit, {}, assistant.id);
      } catch {
        showNotification({ title: "Error", message: "No se pudo iniciar la solicitud.", color: "red" });
      } finally {
        setLoadingId(null);
      }
      return;
    }
    setSelectedMeeting({ assistant, companyNit });
    setModalOpened(true);
  };

  const handleConfirmMeeting = async (message: string) => {
    if (!selectedMeeting || !sendMeetingRequestToCompany) return;

    const { assistant, companyNit } = selectedMeeting;
    setLoadingId(assistant.id);

    try {
      const result = await sendMeetingRequestToCompany(
        companyNit,
        { contextNote: message || `Reunión desde vista de empresa: ${assistant.empresa || ""}` },
        assistant.id,
      );

      if (!(result && (result as any).deferred)) {
        showNotification({
          title: "Solicitud enviada",
          message: `Solicitud enviada a ${assistant.nombre}${message ? ' con tu mensaje personalizado' : ''}.`,
          color: "teal",
        });
      }

      setModalOpened(false);
      setSelectedMeeting(null);
    } catch {
      showNotification({
        title: "Error",
        message: "No se pudo enviar la solicitud.",
        color: "red",
      });
    } finally {
      setLoadingId(null);
    }
  };

  const handleSelectAssistant = (companyKey: string, assistantId: string) => {
    setSelectedAssistantPerCompany((prev) => ({
      ...prev,
      [companyKey]: prev[companyKey] === assistantId ? null : assistantId,
    }));
  };

  const handleOpenCompanyModal = async (empresa: string, companyNit: string) => {
    if (policies.schedulingMode === "requester_picks" && sendMeetingRequestToCompany) {
      setLoadingCompany(empresa);
      try {
        await sendMeetingRequestToCompany(companyNit, {});
      } catch {
        showNotification({ title: "Error", message: "No se pudo iniciar la solicitud.", color: "red" });
      } finally {
        setLoadingCompany(null);
      }
      return;
    }
    setSelectedCompanyRequest({ empresa, companyNit });
    setCompanyModalOpened(true);
  };

  const handleConfirmCompanyMeeting = async (message: string) => {
    if (!selectedCompanyRequest || !sendMeetingRequestToCompany) return;

    const { empresa, companyNit } = selectedCompanyRequest;
    setLoadingCompany(empresa);

    try {
      const result = await sendMeetingRequestToCompany(companyNit, {
        contextNote: message || `Reunión con empresa: ${empresa}`,
      });

      if (!(result && (result as any).deferred)) {
        showNotification({
          title: "Solicitud enviada",
          message: `Se envió la solicitud de reunión a ${empresa}.`,
          color: "teal",
        });
      }

      setCompanyModalOpened(false);
      setSelectedCompanyRequest(null);
    } catch {
      showNotification({
        title: "Error",
        message: "No se pudo enviar la solicitud a la empresa.",
        color: "red",
      });
    } finally {
      setLoadingCompany(null);
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

          .company-card {
            transition: box-shadow 150ms ease, transform 150ms ease;
          }
          .company-card:hover {
            box-shadow: var(--mantine-shadow-md);
            transform: translateY(-2px);
          }
          .company-card .company-title:hover {
            color: var(--mantine-primary-color-filled);
          }
        `}
      </style>
    <Stack gap="md">
      {/* Search bar estilo “top” */}
      <Paper withBorder radius="lg" p="sm">
        <Group gap="xs">
          <TextInput
            placeholder="Buscar empresa o representante..."
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
                  aria-label="Limpiar"
                >
                  <IconX size={16} />
                </ActionIcon>
              ) : null
            }
            radius="md"
            style={{ flex: 1 }}
          />
        </Group>
      </Paper>

      <Grid gutter="sm">
        {filtered.length > 0 ? (
          filtered.map(({ nit, nitLookup, empresa, logoUrl, fixedTable, asistentes, hasAdvisor, _similarity, _isSemantic }: any) => {
            const companyKey = nit; // clave estable
            const selectedId = selectedAssistantPerCompany[companyKey];

            const visited =
              policies.standVisitsEnabled === true &&
              !!(myStandVisits?.has(nitLookup) || myStandVisits?.has(nit));
            const companyMeeting =
              meetingsByCompany.get(nit) || (nitLookup ? meetingsByCompany.get(nitLookup) : undefined);

            // si no hay seleccionado, por defecto el primero
            const selectedAssistant =
              asistentes.find((a) => a.id === selectedId) || asistentes[0];

            // Verificar si tiene similarity score (viene de búsqueda por vectores)
            const hasSimilarity = _isSemantic && typeof _similarity === 'number';
            const similarityScore = hasSimilarity ? Math.round(_similarity * 100) : null;

            // Verificar si esta card debe ser resaltada (usando el estado temporal)
            const isHighlighted = highlightedId === nit;

            return (
              <Grid.Col span={{ base: 12, md: 6, lg: 4 }} key={companyKey}>
                <Card
                  id={`company-card-${nit}`}
                  className="company-card"
                  withBorder
                  radius="xl"
                  padding="md"
                  shadow="sm"
                  style={{
                    height: "100%",
                    position: "relative",
                    border: isHighlighted ? "3px solid var(--mantine-color-teal-5)" : undefined,
                    boxShadow: isHighlighted ? "0 0 20px rgba(20, 184, 166, 0.4)" : undefined,
                    animation: isHighlighted ? "pulse 2s ease-in-out 3" : undefined,
                  }}
                >
                  {/* Badge de concordancia */}
                  {hasSimilarity && (
                    <Badge
                      variant="gradient"
                      gradient={{ from: 'blue', to: 'cyan', deg: 90 }}
                      size="sm"
                      radius="md"
                      style={{
                        position: "absolute",
                        top: 40,
                        right: 16,
                        zIndex: 1,
                      }}
                    >
                      {similarityScore}% match
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

                  {/* HEADER tipo imagen: columna 1 = logo grande + nombre/nit, columna 2 = info */}
                  <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
                    <Stack gap={6} align="center" style={{ flex: "1 1 50%", minWidth: 0 }}>
                      <Box
                        onClick={
                          nit !== "sin-nit" && eventId
                            ? () => navigate(`/dashboard/${eventId}/company/${nit}`)
                            : undefined
                        }
                        style={{
                          width: "100%",
                          aspectRatio: "1 / 1",
                          borderRadius: "var(--mantine-radius-xl)",
                          overflow: "hidden",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: nit !== "sin-nit" ? "pointer" : undefined,
                          backgroundColor: logoUrl
                            ? undefined
                            : `var(--mantine-color-${theme.primaryColor}-6)`,
                        }}
                      >
                        {logoUrl ? (
                          <Image src={logoUrl} alt={empresa} w="100%" h="100%" fit="contain" />
                        ) : (
                          <Text size="40px" fw={700} c="white">
                            {empresa?.[0]?.toUpperCase()}
                          </Text>
                        )}
                      </Box>

                      <Box style={{ minWidth: 0, width: "100%", textAlign: "left" }}>
                        <Title
                          order={5}
                          lineClamp={2}
                          className="company-title"
                          style={{
                            letterSpacing: rem(0.2),
                            cursor: nit !== "sin-nit" ? "pointer" : undefined,
                            textDecoration: nit !== "sin-nit" ? "underline" : undefined,
                            textDecorationColor: "var(--mantine-color-dimmed)",
                            transition: "color 120ms ease",
                          }}
                          onClick={
                            nit !== "sin-nit" && eventId
                              ? () => navigate(`/dashboard/${eventId}/company/${nit}`)
                              : undefined
                          }
                        >
                          {empresa}
                        </Title>
                      </Box>
                    </Stack>

                    <Stack gap={6} align="flex-end" style={{ flex: "1 1 50%" }}>
                      <Badge
                        variant="light"
                        color={theme.primaryColor}
                        radius="xl"
                        style={{
                          cursor: nit !== "sin-nit" && eventId ? "pointer" : undefined,
                        }}
                        onClick={
                          nit !== "sin-nit" && eventId
                            ? () => navigate(`/dashboard/${eventId}/company/${nit}`)
                            : undefined
                        }
                      >
                        <Group gap={6} wrap="nowrap">
                          <IconUsers size={14} />
                          <span>
                            {asistentes.length}{" "}
                            {asistentes.length !== 1 ? "asistentes" : "asistente"}
                          </span>
                        </Group>
                      </Badge>

                      {fixedTable && (
                        <Badge variant="light" color="green" radius="xl">
                          {getTableLabel(fixedTable, eventConfig?.tableNames)}
                        </Badge>
                      )}

                      {visited && (
                        <Badge
                          variant="light"
                          color="teal"
                          radius="xl"
                          leftSection={<IconCircleCheck size={12} />}
                        >
                          Visitado
                        </Badge>
                      )}

                      {companyMeeting && (
                        <Badge
                          variant="light"
                          color="blue"
                          radius="xl"
                          leftSection={<IconCalendarEvent size={12} />}
                        >
                          {meetingBadgeLabel(companyMeeting, eventConfig)}
                        </Badge>
                      )}
                    </Stack>
                  </Group>

                  <Divider my="md" />

                  {/* Lista de reps (compacta y bonita) */}
                  {(
                    <Stack gap="xs">
                      <Text size="xs" c="dimmed" fw={600}>
                        Representantes
                      </Text>

                      <ScrollArea  type="auto" >
                        <Stack gap={8} pr="xs">
                          {asistentes.map((a) => {
                            const active = selectedAssistant?.id === a.id;

                            return (
                              <UnstyledButton
                                key={a.id}
                                onClick={() => handleSelectAssistant(companyKey, a.id)}
                                style={{
                                  width: "100%",
                                  borderRadius: theme.radius.md,
                                  padding: rem(10),
                                  transition: "background 120ms ease, box-shadow 120ms ease",
                                  background: active
                                    ? `var(--mantine-color-${theme.primaryColor}-0)`
                                    : "transparent",
                                  border: active
                                    ? `1.5px solid var(--mantine-color-${theme.primaryColor}-4)`
                                    : "1.5px solid transparent",
                                }}
                              >
                                <Group gap="sm" wrap="nowrap">
                                  <Avatar
                                    src={a.photoURL}
                                    radius="xl"
                                    size={32}
                                    color={active ? theme.primaryColor : "gray"}
                                  >
                                    {(a.nombre || "A")[0]?.toUpperCase()}
                                  </Avatar>
                                  <Box style={{ minWidth: 0, flex: 1 }}>
                                    <Text size="sm" fw={600} lineClamp={1}>
                                      {a.nombre || "Sin nombre"}
                                    </Text>
                                    <Text size="xs" c="dimmed" lineClamp={1}>
                                      {a.cargo || "Representante"}
                                    </Text>
                                  </Box>
                                  {/* Indicador de presencia: solo se marca cuando SÍ hizo
                                      check-in, para no ensuciar la lista con un badge
                                      negativo en cada representante ausente. */}
                                  {isCheckedInOnDay(a, checkInDay) && (
                                    <Tooltip label="Hizo check-in, está en el evento" withArrow>
                                      <ThemeIcon size={16} radius="xl" color="green" variant="filled" style={{ flexShrink: 0 }}>
                                        <IconCircleCheck size={11} />
                                      </ThemeIcon>
                                    </Tooltip>
                                  )}
                                </Group>
                              </UnstyledButton>
                            );
                          })}
                        </Stack>
                      </ScrollArea>
                    </Stack>
                  )}

                  {/* Detalle del representante - campos configurables */}
                  <Stack gap={8} mt="md">
                    {cardFields.map((fieldName) => {
                      const fieldDef = formFields.find((f: any) => f.name === fieldName);
                      // Respetar condición showWhen: no mostrar si el representante no cumple
                      if (fieldDef?.showWhen) {
                        const parentValue = selectedAssistant?.[fieldDef.showWhen.field];
                        const allowed = fieldDef.showWhen.value as string[];
                        if (!parentValue || !allowed.includes(parentValue)) return null;
                      }
                      const label = fieldDef?.label || fieldName;
                      const Icon = FIELD_ICONS[fieldName] || IconFileDescription;
                      const value = formatFieldValue(fieldName, selectedAssistant);
                      return (
                        <Group key={fieldName} gap={8} wrap="nowrap">
                          <ThemeIcon variant="light" color={theme.primaryColor} radius="xl" size={26}>
                            <Icon size={14} />
                          </ThemeIcon>
                          <Text size="sm" style={{ minWidth: 0 }}>
                            <Text span fw={700}>{label}: </Text>
                            {value && value.trim().length > 0 ? value : "No disponible"}
                          </Text>
                        </Group>
                      );
                    })}
                  </Stack>

                  {/* Ver más info de la empresa */}
                  {nit !== "sin-nit" && eventId && (
                    <Button
                      fullWidth
                      mt="md"
                      radius="md"
                      variant="outline"
                      color={theme.primaryColor}
                      leftSection={<IconInfoCircle size={16} />}
                      onClick={() => navigate(`/dashboard/${eventId}/company/${nit}`)}
                    >
                      Ver más info de la empresa
                    </Button>
                  )}

                  {/* CTA grande abajo: oculto si solo hay un representante, ya que
                      en ese caso "Solicitar reunión a la empresa" cubre el mismo caso. */}
                  {asistentes.length > 1 && (
                    <Button
                      fullWidth
                      mt="md"
                      radius="md"
                      size="md"
                      color={theme.primaryColor}
                      onClick={() => handleOpenModal(selectedAssistant, nit)}
                      disabled={
                        !solicitarReunionHabilitado ||
                        loadingId === selectedAssistant?.id ||
                        selectedAssistant?.id === myUid
                      }
                      loading={loadingId === selectedAssistant?.id}
                    >
                      {!solicitarReunionHabilitado
                        ? "Solicitudes deshabilitadas"
                        : selectedAssistant?.id === myUid
                          ? "Tu perfil"
                          : `Solicitar reunión a ${selectedAssistant?.nombre || "..."}`}
                    </Button>
                  )}

                  {/* CTA de solicitud dirigida a la empresa (cualquier asesor la puede reclamar).
                      Oculto si la empresa no tiene ningún vendedor registrado: sin eso, no hay
                      a quién enviarle la solicitud. */}
                  {nit !== "sin-nit" && sendMeetingRequestToCompany && hasAdvisor && (
                    <Button
                      fullWidth
                      mt="xs"
                      radius="md"
                      variant="light"
                      color={theme.primaryColor}
                      onClick={() => handleOpenCompanyModal(empresa, nit)}
                      disabled={
                        !solicitarReunionHabilitado ||
                        loadingCompany === empresa ||
                        asistentes.some((a) => a.id === myUid)
                      }
                      loading={loadingCompany === empresa}
                    >
                      Solicitar reunión a la empresa
                    </Button>
                  )}
                </Card>
              </Grid.Col>
            );
          })
        ) : (
          <Grid.Col span={12}>
            <Text c="dimmed">No se encontraron empresas para este evento.</Text>
          </Grid.Col>
        )}
      </Grid>

      {/* Modal de solicitud de reunión */}
      <MeetingRequestModal
        opened={modalOpened}
        recipientName={selectedMeeting?.assistant.nombre || ""}
        recipientType="empresa"
        contextInfo={selectedMeeting?.assistant.empresa}
        onCancel={() => {
          setModalOpened(false);
          setSelectedMeeting(null);
        }}
        onConfirm={handleConfirmMeeting}
        loading={loadingId === selectedMeeting?.assistant.id}
      />

      {/* Modal de solicitud dirigida a la empresa */}
      <MeetingRequestModal
        opened={companyModalOpened}
        recipientName={selectedCompanyRequest?.empresa || ""}
        recipientType="empresa"
        onCancel={() => {
          setCompanyModalOpened(false);
          setSelectedCompanyRequest(null);
        }}
        onConfirm={handleConfirmCompanyMeeting}
        loading={loadingCompany === selectedCompanyRequest?.empresa}
      />
    </Stack>
    </>
  );
}

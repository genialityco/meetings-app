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
} from "@tabler/icons-react";
import type { Assistant, Company, EventPolicies, MeetingContext } from "./types";
import MeetingRequestModal from "./MeetingRequestModal";

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

interface CompaniesViewProps {
  filteredAssistants: Assistant[];
  companies: Company[];
  policies: EventPolicies;
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

export default function CompaniesView({
  filteredAssistants,
  companies,
  policies,
  solicitarReunionHabilitado,
  sendMeetingRequest,
  setAvatarModalOpened,
  setSelectedImage,
  currentUser,
  formFields,
  cardFields,
  affinityScores,
  highlightEntityId,
}: CompaniesViewProps) {
  const theme = useMantineTheme();
  const navigate = useNavigate();
  const { eventId } = useParams();

  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [loadingCompany, setLoadingCompany] = useState<string | null>(null);
  const [selectedAssistantPerCompany, setSelectedAssistantPerCompany] =
    useState<Record<string, string | null>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [vectorResults, setVectorResults] = useState<Company[]>([]);
  const [isVectorSearching, setIsVectorSearching] = useState(false);
  const [useVectorSearch, setUseVectorSearch] = useState(false);
  const [modalOpened, setModalOpened] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<{ assistant: Assistant; companyNit: string } | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const myUid = currentUser?.uid;

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
      const companyKey =
        assistant.companyId ||
        assistant.company_nit ||
        (() => {
          const nitField = Object.keys(assistant).find((k) =>
            k.startsWith("custom_nit_"),
          );
          return nitField && (assistant as any)[nitField]
            ? String((assistant as any)[nitField])
                .split("-")[0]
                .toLowerCase()
            : "sin-nit";
        })();

      if (!grouped.has(companyKey)) grouped.set(companyKey, []);
      grouped.get(companyKey)!.push(assistant);
    });

    return Array.from(grouped.entries()).map(([nit, asistentes]) => {
      const companyDoc = companiesByNit.get(nit);
      const empresa =
        companyDoc?.razonSocial ||
        asistentes[0]?.empresa?.trim() ||
        "Sin empresa";

      return {
        nit,
        empresa,
        logoUrl: companyDoc?.logoUrl || null,
        fixedTable: companyDoc?.fixedTable || null,
        asistentes,
        similarity: undefined as number | undefined, // Add similarity field
      };
    });
  }, [filteredAssistants, companiesByNit]);

  // Filtrar por búsqueda
  const filtered = useMemo(() => {
    let results: typeof companiesData = [];
    
    // Si estamos usando búsqueda por vectores
    if (useVectorSearch && searchTerm.trim().length >= 3) {
      // Mapear resultados de vectores a companiesData, preservando similarity
      results = vectorResults
        .map(vectorCompany => {
          const companyData = companiesData.find(c => c.nit === vectorCompany.nitNorm);
          if (companyData) {
            return {
              ...companyData,
              similarity: (vectorCompany as any).similarity, // Preservar similarity
            };
          }
          return null;
        })
        .filter(Boolean) as typeof companiesData;
    } else {
      // Búsqueda tradicional
      const t = searchTerm.toLowerCase().trim();
      if (!t) {
        results = companiesData;
      } else {
        results = companiesData.filter(
          (c) =>
            c.empresa.toLowerCase().includes(t) ||
            c.nit.includes(t) ||
            c.asistentes.some((a) =>
              (a.nombre || "").toLowerCase().includes(t),
            ),
        );
      }
    }
    
    // Ordenar por afinidad promedio de los asistentes de la empresa (si no hay búsqueda por vectores)
    if (!useVectorSearch) {
      results.sort((a, b) => {
        // Calcular afinidad promedio de los asistentes de cada empresa
        const avgAffinityA = a.asistentes.length > 0
          ? a.asistentes.reduce((sum, assistant) => sum + (affinityScores[assistant.id] || 0), 0) / a.asistentes.length
          : 0;
        const avgAffinityB = b.asistentes.length > 0
          ? b.asistentes.reduce((sum, assistant) => sum + (affinityScores[assistant.id] || 0), 0) / b.asistentes.length
          : 0;
        return avgAffinityB - avgAffinityA; // Mayor afinidad primero
      });
    }
    
    return results;
  }, [companiesData, searchTerm, useVectorSearch, vectorResults, affinityScores]);

  // Búsqueda por vectores con debounce
  useEffect(() => {
    const trimmed = searchTerm.trim();
    
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
        const response = await fetch(VECTOR_SEARCH_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: trimmed,
            category: "companies",
            eventId: eventId,
            limit: 50,
            threshold: 0.3,
          }),
        });

        if (!response.ok) {
          throw new Error("Vector search failed");
        }

        const data = await response.json();
        setVectorResults(data.results);
        setUseVectorSearch(true);
        
        console.log(`Vector search found ${data.results.length} companies`);
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
  }, [searchTerm, eventId]);

  const handleOpenModal = (assistant: Assistant, companyNit: string) => {
    setSelectedMeeting({ assistant, companyNit });
    setModalOpened(true);
  };

  const handleConfirmMeeting = async (message: string) => {
    if (!selectedMeeting) return;
    
    const { assistant, companyNit } = selectedMeeting;
    setLoadingId(assistant.id);
    
    try {
      await sendMeetingRequest(assistant.id, assistant.telefono || "", null, {
        companyId: companyNit,
        contextNote: message || `Reunión desde vista de empresa: ${assistant.empresa || ""}`,
      });
      
      showNotification({
        title: "Solicitud enviada",
        message: `Solicitud enviada a ${assistant.nombre}${message ? ' con tu mensaje personalizado' : ''}.`,
        color: "teal",
      });
      
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

  const handleSendMeetingToAllCompany = async (
    empresa: string,
    asistentes: Assistant[],
    companyNit: string,
  ) => {
    setLoadingCompany(empresa);
    const groupId = `mtg_${Date.now()}`;
    let successCount = 0;

    try {
      for (const assistant of asistentes) {
        try {
          await sendMeetingRequest(assistant.id, assistant.telefono || "", groupId, {
            companyId: companyNit,
            contextNote: `Reunión con empresa: ${empresa}`,
          });
          successCount++;
        } catch {
          // continue
        }
      }

      if (successCount > 0) {
        showNotification({
          title: "Solicitudes enviadas",
          message: `Se enviaron ${successCount} solicitud${
            successCount !== 1 ? "es" : ""
          }.`,
          color: "teal",
        });
      }
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
                  aria-label="Limpiar"
                >
                  <IconX size={16} />
                </ActionIcon>
              ) : null
            }
            radius="md"
            style={{ flex: 1 }}
          />
          {useVectorSearch && (
            <Badge size="sm" variant="light" color="blue" leftSection={<IconSparkles size={10} />}>
              Búsqueda inteligente
            </Badge>
          )}
        </Group>
      </Paper>

      <Grid gutter="sm">
        {filtered.length > 0 ? (
          filtered.map(({ nit, empresa, logoUrl, fixedTable, asistentes, similarity }) => {
            const companyKey = nit; // clave estable
            const selectedId = selectedAssistantPerCompany[companyKey];

            // si no hay seleccionado, por defecto el primero
            const selectedAssistant =
              asistentes.find((a) => a.id === selectedId) || asistentes[0];

            const isMulti = asistentes.length > 1;

            // Verificar si tiene similarity score (viene de búsqueda por vectores)
            const hasSimilarity = typeof similarity === 'number';
            const similarityScore = hasSimilarity ? Math.round(similarity * 100) : null;

            // Verificar si esta card debe ser resaltada (usando el estado temporal)
            const isHighlighted = highlightedId === nit;

            return (
              <Grid.Col span={{ base: 12, md: 6, lg: 4 }} key={companyKey}>
                <Card 
                  id={`company-card-${nit}`}
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
                        top: 10,
                        right: 10,
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

                  {/* HEADER tipo imagen */}
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                      {logoUrl ? (
                        <Image
                          src={logoUrl}
                          alt={empresa}
                          w={42}
                          h={42}
                          radius="xl"
                          fit="contain"
                        />
                      ) : (
                        <Avatar radius="xl" size={42} color={theme.primaryColor}>
                          {empresa?.[0]?.toUpperCase()}
                        </Avatar>
                      )}

                      <Box style={{ minWidth: 0 }}>
                        <Title
                          order={5}
                          lineClamp={2}
                          style={{
                            letterSpacing: rem(0.2),
                            cursor: nit !== "sin-nit" ? "pointer" : undefined,
                            textDecoration: nit !== "sin-nit" ? "underline" : undefined,
                            textDecorationColor: "var(--mantine-color-dimmed)",
                          }}
                          onClick={
                            nit !== "sin-nit" && eventId
                              ? () => navigate(`/dashboard/${eventId}/company/${nit}`)
                              : undefined
                          }
                        >
                          {empresa}
                        </Title>
                        <Group gap={6} mt={2}>
                          <ThemeIcon
                            variant="light"
                            color={theme.primaryColor}
                            size={18}
                            radius="md"
                          >
                            <IconId size={12} />
                          </ThemeIcon>
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            NIT: {nit !== "sin-nit" ? nit : "No disponible"}
                          </Text>
                        </Group>
                      </Box>
                    </Group>

                    <Stack gap={6} align="flex-end">
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

                      {policies?.tableMode === "fixed" && fixedTable && (
                        <Badge variant="light" color="green" radius="xl">
                          Mesa: {fixedTable}
                        </Badge>
                      )}
                    </Stack>
                  </Group>

                  {/* Descripción corta */}
                  {!!(asistentes?.[0]?.descripcion || "").trim() && (
                    <>
                      <Text mt="sm" c="dimmed" size="sm">
                        {asistentes[0]?.descripcion}
                      </Text>
                    </>
                  )}

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
                                  <Box style={{ minWidth: 0 }}>
                                    <Text size="sm" fw={600} lineClamp={1}>
                                      {a.nombre || "Sin nombre"}
                                    </Text>
                                    <Text size="xs" c="dimmed" lineClamp={1}>
                                      {a.cargo || "Representante"}
                                    </Text>
                                  </Box>
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

                  {/* CTA grande abajo */}
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

                  {/* CTA “a todos” opcional (si hay varios) */}
                  {isMulti && (
                    <Button
                      fullWidth
                      mt="xs"
                      radius="md"
                      variant="light"
                      color={theme.primaryColor}
                      onClick={() => handleSendMeetingToAllCompany(empresa, asistentes, nit)}
                      disabled={!solicitarReunionHabilitado || loadingCompany === empresa}
                      loading={loadingCompany === empresa}
                    >
                      Solicitar a todos ({asistentes.length})
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
    </Stack>
    </>
  );
}

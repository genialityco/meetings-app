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
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import { useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  IconSearch,
  IconX,
  IconId,
  IconBriefcase,
  IconMail,
  IconTargetArrow,
  IconBulb,
  IconClock,
  IconUsers,
} from "@tabler/icons-react";
import type { Assistant, Company, EventPolicies, MeetingContext } from "./types";

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
}: CompaniesViewProps) {
  const theme = useMantineTheme();
  const navigate = useNavigate();
  const { eventId } = useParams();

  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [loadingCompany, setLoadingCompany] = useState<string | null>(null);
  const [selectedAssistantPerCompany, setSelectedAssistantPerCompany] =
    useState<Record<string, string | null>>({});
  const [searchTerm, setSearchTerm] = useState("");

  const myUid = currentUser?.uid;

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
      };
    });
  }, [filteredAssistants, companiesByNit]);

  // Filtrar por búsqueda
  const filtered = useMemo(() => {
    const t = searchTerm.toLowerCase().trim();
    if (!t) return companiesData;
    return companiesData.filter(
      (c) =>
        c.empresa.toLowerCase().includes(t) ||
        c.nit.includes(t) ||
        c.asistentes.some((a) =>
          (a.nombre || "").toLowerCase().includes(t),
        ),
    );
  }, [companiesData, searchTerm]);

  const handleSelectAssistant = (companyKey: string, assistantId: string) => {
    setSelectedAssistantPerCompany((prev) => ({
      ...prev,
      [companyKey]: prev[companyKey] === assistantId ? null : assistantId,
    }));
  };

  const handleSendMeeting = async (assistant: Assistant, companyNit: string) => {
    setLoadingId(assistant.id);
    try {
      await sendMeetingRequest(assistant.id, assistant.telefono || "", null, {
        companyId: companyNit,
        contextNote: `Reunión desde vista de empresa: ${assistant.empresa || ""}`,
      });
      showNotification({
        title: "Solicitud enviada",
        message: `Solicitud enviada a ${assistant.nombre}.`,
        color: "teal",
      });
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
    <Stack gap="md">
      {/* Search bar estilo “top” */}
      <Paper withBorder radius="lg" p="sm">
        <TextInput
          placeholder="Buscar empresa o representante..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          leftSection={<IconSearch size={16} />}
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
        />
      </Paper>

      <Grid gutter="sm">
        {filtered.length > 0 ? (
          filtered.map(({ nit, empresa, logoUrl, fixedTable, asistentes }) => {
            const companyKey = nit; // clave estable
            const selectedId = selectedAssistantPerCompany[companyKey];

            // si no hay seleccionado, por defecto el primero
            const selectedAssistant =
              asistentes.find((a) => a.id === selectedId) || asistentes[0];

            const isMulti = asistentes.length > 1;

            return (
              <Grid.Col span={{ base: 12, md: 6, lg: 4 }} key={companyKey}>
                <Card withBorder radius="xl" padding="md" shadow="sm" style={{ height: "100%" }}>
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
                      <Text mt="sm" c="dimmed" size="sm" lineClamp={2}>
                        {asistentes[0]?.descripcion}
                      </Text>
                    </>
                  )}

                  <Divider my="md" />

                  {/* Lista de reps (compacta y bonita) */}
                  {isMulti && (
                    <Stack gap="xs">
                      <Text size="xs" c="dimmed" fw={600}>
                        Representantes
                      </Text>

                      <ScrollArea h={170} type="auto">
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

                  {/* Detalle tipo “lista de info” como en imagen */}
                  <Stack gap={8} mt="md">
                    <Group gap={8} wrap="nowrap">
                      <ThemeIcon variant="light" color={theme.primaryColor} radius="xl" size={26}>
                        <IconBriefcase size={14} />
                      </ThemeIcon>
                      <Text size="sm" style={{ minWidth: 0 }}>
                        <Text span fw={700}>Cargo: </Text>
                        {selectedAssistant?.cargo || "No disponible"}
                      </Text>
                    </Group>

                    <Group gap={8} wrap="nowrap">
                      <ThemeIcon variant="light" color={theme.primaryColor} radius="xl" size={26}>
                        <IconMail size={14} />
                      </ThemeIcon>
                      <Text size="sm" style={{ minWidth: 0 }} lineClamp={1}>
                        <Text span fw={700}>Correo: </Text>
                        {selectedAssistant?.correo || "No disponible"}
                      </Text>
                    </Group>

                    <Group gap={8} wrap="nowrap">
                      <ThemeIcon variant="light" color={theme.primaryColor} radius="xl" size={26}>
                        <IconTargetArrow size={14} />
                      </ThemeIcon>
                      <Text size="sm" style={{ minWidth: 0 }} lineClamp={1}>
                        <Text span fw={700}>Interés principal: </Text>
                        {selectedAssistant?.interesPrincipal || "No especificado"}
                      </Text>
                    </Group>

                    <Group gap={8} wrap="nowrap">
                      <ThemeIcon variant="light" color={theme.primaryColor} radius="xl" size={26}>
                        <IconBulb size={14} />
                      </ThemeIcon>
                      <Text size="sm" style={{ minWidth: 0 }} lineClamp={1}>
                        <Text span fw={700}>Necesidad: </Text>
                        {selectedAssistant?.necesidad || "No especificada"}
                      </Text>
                    </Group>

                    {/* Si tienes lastSeen o algo similar, úsalo aquí.
                        Mientras tanto dejo fallback para que no rompa */}
                    <Group gap={8} wrap="nowrap">
                      <ThemeIcon variant="light" color={theme.primaryColor} radius="xl" size={26}>
                        <IconClock size={14} />
                      </ThemeIcon>
                      <Text size="sm" style={{ minWidth: 0 }} lineClamp={1}>
                        <Text span fw={700}>Última conexión: </Text>
                        {(selectedAssistant as any)?.lastSeen || "No registrada"}
                      </Text>
                    </Group>
                  </Stack>

                  {/* CTA grande abajo */}
                  <Button
                    fullWidth
                    mt="md"
                    radius="md"
                    size="md"
                    color={theme.primaryColor}
                    onClick={() => handleSendMeeting(selectedAssistant, nit)}
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
    </Stack>
  );
}

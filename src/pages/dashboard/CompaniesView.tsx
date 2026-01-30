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
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import { useState, useMemo } from "react";
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
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [loadingCompany, setLoadingCompany] = useState<string | null>(null);
  const [selectedAssistantPerCompany, setSelectedAssistantPerCompany] =
    useState<Record<string, string | null>>({});
  const [searchTerm, setSearchTerm] = useState("");

  const myUid = currentUser?.uid;

  // Agrupar asistentes por empresa (companyId / company_nit / fallback custom_nit_*)
  const companiesData = useMemo(() => {
    const grouped = new Map<string, Assistant[]>();

    filteredAssistants.forEach((assistant) => {
      const companyKey =
        assistant.companyId ||
        assistant.company_nit ||
        (() => {
          const nitField = Object.keys(assistant).find((k) => k.startsWith("custom_nit_"));
          return nitField && assistant[nitField]
            ? String(assistant[nitField]).split("-")[0].toLowerCase()
            : "sin-nit";
        })();

      if (!grouped.has(companyKey)) {
        grouped.set(companyKey, []);
      }
      grouped.get(companyKey)!.push(assistant);
    });

    return Array.from(grouped.entries()).map(([nit, asistentes]) => {
      const companyDoc = companies.find((c) => c.nitNorm === nit);
      return {
        nit,
        empresa: companyDoc?.razonSocial || asistentes[0]?.empresa?.trim() || "Sin empresa",
        logoUrl: companyDoc?.logoUrl || null,
        fixedTable: companyDoc?.fixedTable || null,
        asistentes,
      };
    });
  }, [filteredAssistants, companies]);

  // Filtrar por búsqueda
  const filtered = useMemo(() => {
    const t = searchTerm.toLowerCase().trim();
    if (!t) return companiesData;
    return companiesData.filter(
      (c) =>
        c.empresa.toLowerCase().includes(t) ||
        c.nit.includes(t) ||
        c.asistentes.some((a) => (a.nombre || "").toLowerCase().includes(t)),
    );
  }, [companiesData, searchTerm]);

  const handleSelectAssistant = (company: string, assistantId: string) => {
    setSelectedAssistantPerCompany((prev) => ({
      ...prev,
      [company]: prev[company] === assistantId ? null : assistantId,
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
          // continue with remaining
        }
      }
      if (successCount > 0) {
        showNotification({
          title: "Solicitudes enviadas",
          message: `Se enviaron ${successCount} solicitud${successCount !== 1 ? "es" : ""}.`,
          color: "teal",
        });
      }
    } finally {
      setLoadingCompany(null);
    }
  };

  return (
    <>
      <TextInput
        placeholder="Buscar empresa o representante..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        mb="md"
      />

      <Grid>
        {filtered.length > 0 ? (
          filtered.map(({ nit, empresa, logoUrl, fixedTable, asistentes }) => {
            const selectedAssistantId = selectedAssistantPerCompany[empresa];
            const selectedAssistant = asistentes.find((a) => a.id === selectedAssistantId);

            return (
              <Grid.Col span={{ xs: 12, md: 6, lg: 4 }} key={nit}>
                <Card shadow="sm" p="lg" withBorder style={{ height: "100%" }}>
                  {/* Header */}
                  <Group justify="space-between" mb="md">
                    <Group gap="sm">
                      {logoUrl ? (
                        <Image
                          src={logoUrl}
                          alt={empresa}
                          w={40}
                          h={40}
                          radius="sm"
                          fit="contain"
                        />
                      ) : (
                        <Avatar radius="sm" size="md" color="blue">
                          {empresa[0]?.toUpperCase()}
                        </Avatar>
                      )}
                      <Box>
                        <Title order={5}>{empresa.toUpperCase()}</Title>
                        <Text size="xs" c="dimmed">NIT: {nit !== "sin-nit" ? nit : "No disponible"}</Text>
                      </Box>
                    </Group>
                    <Badge color="blue" variant="light">
                      {asistentes.length} representante{asistentes.length !== 1 ? "s" : ""}
                    </Badge>
                  </Group>

                  {policies?.tableMode === "fixed" && fixedTable && (
                    <Badge color="green" variant="light" mb="sm">
                      Mesa: {fixedTable}
                    </Badge>
                  )}

                  <Divider mb="md" />
                  <Text mb="md" c="dimmed" size="sm" lineClamp={3}>
                    {asistentes[0]?.descripcion || ""}
                  </Text>

                  {/* Solicitar a todos */}
                  {asistentes.length > 1 && (
                    <Button
                      fullWidth
                      mb="md"
                      variant="filled"
                      color="dark"
                      onClick={() => handleSendMeetingToAllCompany(empresa, asistentes, nit)}
                      disabled={!solicitarReunionHabilitado || loadingCompany === empresa}
                      loading={loadingCompany === empresa}
                    >
                      {solicitarReunionHabilitado
                        ? `Solicitar reunión con todos (${asistentes.length})`
                        : "Solicitudes deshabilitadas"}
                    </Button>
                  )}

                  {/* Lista de representantes */}
                  <Stack gap="xs" mb="md" style={{ maxHeight: 210, overflowY: "auto" }}>
                    {asistentes.map((assistant) => (
                      <Box
                        key={assistant.id}
                        p="sm"
                        style={{
                          cursor: "pointer",
                          borderRadius: 8,
                          border: selectedAssistantId === assistant.id ? "2px solid #228be6" : "1px solid #e9ecef",
                          backgroundColor: selectedAssistantId === assistant.id ? "#f8f9fa" : "transparent",
                          transition: "all 0.2s ease",
                        }}
                        onClick={() => handleSelectAssistant(empresa, assistant.id)}
                      >
                        <Group gap="sm">
                          <Avatar src={assistant.photoURL} alt={assistant.nombre} size="sm" radius="xl">
                            {!assistant.photoURL && assistant.nombre && assistant.nombre[0]}
                          </Avatar>
                          <div style={{ flex: 1 }}>
                            <Text size="sm" fw={500}>{assistant.nombre}</Text>
                            <Text size="xs" c="dimmed">{assistant.cargo || ""}</Text>
                          </div>
                        </Group>
                      </Box>
                    ))}
                  </Stack>

                  {/* Detalle de asistente seleccionado */}
                  {selectedAssistant && (
                    <>
                      <Divider mb="md" />
                      <Box p="md" style={{ backgroundColor: "#f8f9fa", borderRadius: 8 }}>
                        <Group justify="center" mb="md">
                          <Avatar
                            src={selectedAssistant.photoURL}
                            alt={selectedAssistant.nombre}
                            size="lg"
                            radius="xl"
                            style={{ cursor: "pointer" }}
                            onClick={() => {
                              setSelectedImage(selectedAssistant.photoURL || null);
                              setAvatarModalOpened(true);
                            }}
                          >
                            {!selectedAssistant.photoURL && selectedAssistant.nombre && selectedAssistant.nombre[0]}
                          </Avatar>
                        </Group>
                        <Title order={6} mb="sm" style={{ textAlign: "center" }}>
                          {selectedAssistant.nombre}
                        </Title>
                        <Stack gap="xs">
                          {selectedAssistant.cargo && (
                            <Text size="sm"><strong>Cargo:</strong> {selectedAssistant.cargo}</Text>
                          )}
                          <Text size="sm"><strong>Correo:</strong> {selectedAssistant.correo || "No disponible"}</Text>
                          <Text size="sm"><strong>Interés:</strong> {selectedAssistant.interesPrincipal || "No especificado"}</Text>
                          <Text size="sm"><strong>Necesidad:</strong> {selectedAssistant.necesidad || "No especificada"}</Text>
                        </Stack>
                        <Button
                          fullWidth
                          mt="md"
                          onClick={() => handleSendMeeting(selectedAssistant, nit)}
                          disabled={
                            !solicitarReunionHabilitado ||
                            loadingId === selectedAssistant.id ||
                            selectedAssistant.id === myUid
                          }
                          loading={loadingId === selectedAssistant.id}
                        >
                          {solicitarReunionHabilitado ? "Solicitar reunión" : "Solicitudes deshabilitadas"}
                        </Button>
                      </Box>
                    </>
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
    </>
  );
}

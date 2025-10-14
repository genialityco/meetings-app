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
  Badge,
  Stack,
  Divider,
  Box,
  Alert,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import React, { useEffect, useState, useMemo } from "react";
import { Assistant } from "./types";

export default function AssistantsTab({
  filteredAssistants,
  searchTerm,
  setSearchTerm,
  showOnlyToday,
  setShowOnlyToday,
  eventConfig,
  solicitarReunionHabilitado,
  sendMeetingRequest,
  setAvatarModalOpened,
  setSelectedImage,
  interestOptions,
  interestFilter,
  setInterestFilter,
}) {
  const [loadingId, setLoadingId] = useState(null);
  const [loadingCompany, setLoadingCompany] = useState(null);
  const [viewMode, setViewMode] = useState("companies");
  const [selectedAssistantPerCompany, setSelectedAssistantPerCompany] = useState({});

  // Agrupar asistentes por empresa
  const companiesData = useMemo(() => {
    const grouped = new Map();

    filteredAssistants.forEach((assistant) => {
      const company = assistant.empresa?.trim().toLowerCase() || "Sin empresa";

      if (!grouped.has(company)) {
        grouped.set(company, []);
      }
      grouped.get(company).push(assistant);
    });

    return Array.from(grouped.entries()).map(([empresa, asistentes]) => ({
      empresa,
      asistentes,
    }));
  }, [filteredAssistants]);

  const handleSendMeeting = async (assistant) => {
    setLoadingId(assistant.id);
    try {
      await sendMeetingRequest(assistant.id, assistant.telefono);
      showNotification({
        title: "Solicitud enviada",
        message: `Solicitud enviada a ${assistant.nombre}, quedará en lista de pendientes por aceptar.`,
        color: "teal",
      });
    } catch (e) {
      showNotification({
        title: "Error",
        message: "No se pudo enviar la solicitud. Intenta de nuevo.",
        color: "red",
      });
    } finally {
      setLoadingId(null);
    }
  };

  const handleSendMeetingToAllCompany = async (empresa, asistentes) => {
    setLoadingCompany(empresa);
    
    let successCount = 0;
    let errorCount = 0;

    try {
      // Enviar solicitudes a todos los asistentes de la empresa
      for (const assistant of asistentes) {
        try {
          await sendMeetingRequest(assistant.id, assistant.telefono);
          successCount++;
        } catch (error) {
          errorCount++;
          console.error(`Error enviando solicitud a ${assistant.nombre}:`, error);
        }
      }

      if (successCount > 0) {
        showNotification({
          title: "Solicitudes enviadas",
          message: `Se enviaron ${successCount} solicitud${successCount !== 1 ? 'es' : ''} exitosamente${errorCount > 0 ? `. ${errorCount} fallaron.` : '.'}`,
          color: errorCount > 0 ? "yellow" : "teal",
        });
      } else {
        showNotification({
          title: "Error",
          message: "No se pudo enviar ninguna solicitud. Intenta de nuevo.",
          color: "red",
        });
      }
    } finally {
      setLoadingCompany(null);
    }
  };

  const handleSelectAssistant = (company, assistantId) => {
    setSelectedAssistantPerCompany((prev) => ({
      ...prev,
      [company]: prev[company] === assistantId ? null : assistantId,
    }));
  };

  useEffect(() => {
    console.log("Filtered Assistants:", filteredAssistants);
  }, [filteredAssistants]);

  const renderCardView = () => (
    <>
      {filteredAssistants.length > 0 && filteredAssistants.length < 10 && (
        <Alert
          mb="md"
          color="blue"
          title="🎉 ¡Aún estás entre los primeros!"
          styles={{
            message: { lineHeight: 1.6 }
          }}
        >
          Solo hay <strong>{filteredAssistants.length} asistente{filteredAssistants.length !== 1 ? "s" : ""}</strong> registrado{filteredAssistants.length !== 1 ? "s" : ""}.{" "}
          Aprovecha esta oportunidad para conectar con los pioneros del evento y obtener <strong>máxima visibilidad</strong> en el directorio.{" "}
          Los primeros en llegar, son los primeros en destacar.
        </Alert>
      )}

      <Grid>
        {filteredAssistants.length > 0 ? (
          filteredAssistants.map((assistant) => (
            <Grid.Col
              span={{ xs: 12, sm: 6, md: 4 }}
              key={assistant.id}
              style={{ height: 400 }}
            >
              <Card
                shadow="sm"
                p="lg"
                style={{
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <Group justify="center" mb="md">
                  <Avatar
                    src={assistant.photoURL}
                    alt={`Avatar de ${assistant.nombre}`}
                    radius="50%"
                    size="xl"
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      setSelectedImage(assistant.photoURL);
                      setAvatarModalOpened(true);
                    }}
                  >
                    {!assistant.photoURL &&
                      assistant.nombre &&
                      assistant.nombre[0]}
                  </Avatar>
                </Group>
                <Title order={5} mb={4} style={{ textAlign: "center" }}>
                  📛 {assistant.nombre}
                </Title>
                <div
                  style={{
                    flex: 1,
                    overflowY: "auto",
                    minHeight: 0,
                    marginBottom: 8,
                  }}
                >
                  <Text size="sm">
                    🏢 <strong>Empresa:</strong> {assistant.empresa}
                  </Text>
                  {assistant.cargo && (
                    <Text size="sm">
                      🏷 <strong>Cargo:</strong> {assistant.cargo}
                    </Text>
                  )}
                  <Text size="sm">
                    📧 <strong>Correo:</strong>{" "}
                    {assistant.correo || "No disponible"}
                  </Text>
                  <Text size="sm">
                    📝 <strong>Descripción:</strong>{" "}
                    {assistant.descripcion || "No especificada"}
                  </Text>
                  <Text size="sm">
                    🎯 <strong>Interés Principal:</strong>{" "}
                    {assistant.interesPrincipal || "No especificado"}
                  </Text>
                  <Text size="sm">
                    🔍 <strong>Necesidad:</strong>{" "}
                    {assistant.necesidad || "No especificada"}
                  </Text>
                  <Text size="sm">
                    🕓 <strong>Última conexión:</strong>{" "}
                    {assistant.lastConnectionDateTime || "No registrada"}
                  </Text>
                </div>
                <Group mt="auto">
                  <Button
                    mt="sm"
                    onClick={() => handleSendMeeting(assistant)}
                    disabled={!solicitarReunionHabilitado || loadingId === assistant.id}
                    loading={loadingId === assistant.id}
                    fullWidth
                  >
                    {solicitarReunionHabilitado
                      ? "Solicitar reunión"
                      : "Solicitudes deshabilitadas"}
                  </Button>
                </Group>
              </Card>
            </Grid.Col>
          ))
        ) : (
          <Text mt={20} style={{ whiteSpace: "pre-line", lineHeight: 1.8 }}>
            🌟 <strong>¡Eres el primero en dar el paso!</strong>{"\n\n"}
            En <strong>Gen.Networking</strong> valoramos a quienes se anticipan, porque son los que abren camino y marcan la diferencia.{"\n"}
            Por ser de los primeros, tu perfil tendrá <strong>posición destacada en el directorio</strong> y <strong>prioridad en las reuniones</strong>.{"\n"}
            Muy pronto te avisaremos cuando más participantes se unan, para que empieces a <strong>conectar</strong> y <strong>generar nuevas oportunidades</strong>.{"\n"}
            Si necesitas ayuda, escríbenos a WhatsApp: <strong>+57 300 216 2757</strong>.{"\n"}
            🙌 Gracias por ser quien da el primer paso — <strong>la red comienza contigo.</strong>
          </Text>
        )}
      </Grid>
    </>
  );

  const renderCompanyView = () => (
    <Grid>
      {companiesData.length > 0 ? (
        companiesData.map(({ empresa, asistentes }: { empresa: string; asistentes: Assistant[] }) => {
          const selectedAssistantId = selectedAssistantPerCompany[empresa];
          const selectedAssistant = asistentes.find(a => a.id === selectedAssistantId);

          return (
            <Grid.Col span={{ xs: 12, md: 6, lg: 4 }} key={empresa}>
              <Card shadow="sm" p="lg" withBorder style={{ height: "100%" }}>
                {/* Header de la empresa */}
                <Group justify="space-between" mb="md">
                  <Box>
                    <Title order={4}>🏢 {empresa.toUpperCase()}</Title>
                    <Text size="sm">
                      <strong>NIT:</strong>{" "}
                      {Object.keys(asistentes[0]).find(key => key.startsWith('custom_nit_'))
                        ? asistentes[0][Object.keys(asistentes[0]).find(key => key.startsWith('custom_nit_')) || '']
                        : "No disponible"}
                    </Text>
                  </Box>
                  <Badge color="blue" variant="light">
                    {asistentes.length} asistente{asistentes.length !== 1 ? "s" : ""}
                  </Badge>
                </Group>

                <Divider mb="md" />
                <Text
                  mb="md"
                  c="dimmed"
                  size="md"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {asistentes[0].descripcion || ""}
                </Text>

                {/* Botón para solicitar a todos */}
                {asistentes.length > 1 && (
                  <Button
                    fullWidth
                    mb="md"
                    variant="dark"
                    color="blue"
                    onClick={() => handleSendMeetingToAllCompany(empresa, asistentes)}
                    disabled={!solicitarReunionHabilitado || loadingCompany === empresa}
                    loading={loadingCompany === empresa}
                  >
                    {solicitarReunionHabilitado
                      ? `Solicitar reunión con todos (${asistentes.length})`
                      : "Solicitudes deshabilitadas"}
                  </Button>
                )}

                {/* Lista de asistentes */}
                <Stack gap="xs" mb="md" style={{ maxHeight: 210, overflowY: "auto" }}>
                  {asistentes.map((assistant) => (
                    <Box
                      key={assistant.id}
                      p="sm"
                      style={{
                        cursor: "pointer",
                        borderRadius: 8,
                        border: selectedAssistantId === assistant.id
                          ? "2px solid #228be6"
                          : "1px solid #e9ecef",
                        backgroundColor: selectedAssistantId === assistant.id
                          ? "#f8f9fa"
                          : "transparent",
                        transition: "all 0.2s ease",
                      }}
                      onClick={() => handleSelectAssistant(empresa, assistant.id)}
                    >
                      <Group gap="sm">
                        <Avatar
                          src={assistant.photoURL}
                          alt={assistant.nombre}
                          size="sm"
                          radius="xl"
                        >
                          {!assistant.photoURL &&
                            assistant.nombre &&
                            assistant.nombre[0]}
                        </Avatar>
                        <div style={{ flex: 1 }}>
                          <Text size="sm" fw={500}>
                            {assistant.nombre}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {assistant?.cargo || ""}
                          </Text>
                        </div>
                      </Group>
                    </Box>
                  ))}
                </Stack>

                {/* Detalles del asistente seleccionado */}
                {selectedAssistant && (
                  <>
                    <Divider mb="md" />
                    <Box
                      p="md"
                      style={{
                        backgroundColor: "#f8f9fa",
                        borderRadius: 8,
                      }}
                    >
                      <Group justify="center" mb="md">
                        <Avatar
                          src={selectedAssistant.photoURL}
                          alt={selectedAssistant.nombre}
                          size="lg"
                          radius="xl"
                          style={{ cursor: "pointer" }}
                          onClick={() => {
                            setSelectedImage(selectedAssistant.photoURL);
                            setAvatarModalOpened(true);
                          }}
                        >
                          {!selectedAssistant.photoURL &&
                            selectedAssistant.nombre &&
                            selectedAssistant.nombre[0]}
                        </Avatar>
                      </Group>

                      <Title order={6} mb="sm" style={{ textAlign: "center" }}>
                        {selectedAssistant.nombre}
                      </Title>

                      <Stack gap="xs">
                        {selectedAssistant.cargo && (
                          <Text size="sm">
                            🏷 <strong>Cargo:</strong> {selectedAssistant.cargo}
                          </Text>
                        )}
                        <Text size="sm">
                          📧 <strong>Correo:</strong>{" "}
                          {selectedAssistant.correo || "No disponible"}
                        </Text>

                        <Text size="sm">
                          🎯 <strong>Interés Principal:</strong>{" "}
                          {selectedAssistant.interesPrincipal || "No especificado"}
                        </Text>
                        <Text size="sm">
                          🔍 <strong>Necesidad:</strong>{" "}
                          {selectedAssistant.necesidad || "No especificada"}
                        </Text>
                        <Text size="sm">
                          🕓 <strong>Última conexión:</strong>{" "}
                          {selectedAssistant.lastConnectionDateTime || "No registrada"}
                        </Text>
                      </Stack>

                      <Button
                        fullWidth
                        mt="md"
                        onClick={() => handleSendMeeting(selectedAssistant)}
                        disabled={!solicitarReunionHabilitado || loadingId === selectedAssistant.id}
                        loading={loadingId === selectedAssistant.id}
                      >
                        {solicitarReunionHabilitado
                          ? "Solicitar reunión"
                          : "Solicitudes deshabilitadas"}
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
          <Text mt={20} style={{ whiteSpace: "pre-line", lineHeight: 1.8 }}>
            🌟 <strong>¡Eres el primero en dar el paso!</strong>{"\n\n"}
            En <strong>Gen.Networking</strong> valoramos a quienes se anticipan, porque son los que abren camino y marcan la diferencia.{"\n"}
            Por ser de los primeros, tu perfil tendrá <strong>posición destacada en el directorio</strong> y <strong>prioridad en las reuniones</strong>.{"\n"}
            Muy pronto te avisaremos cuando más participantes se unan, para que empieces a <strong>conectar</strong> y <strong>generar nuevas oportunidades</strong>.{"\n"}
            Si necesitas ayuda, escríbenos a WhatsApp: <strong>+57 300 216 2757</strong>.{"\n"}
            🙌 Gracias por ser quien da el primer paso — <strong>la red comienza contigo.</strong>
          </Text>
        </Grid.Col>
      )}
    </Grid>
  );

  return (
    <>
      <Group grow mb="md">
        <TextInput
          placeholder="Buscar por cualquier campo..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <Select
          data={interestOptions}
          placeholder="Filtrar por interés principal"
          value={interestFilter}
          onChange={setInterestFilter}
          clearable
          searchable
        />
        <Select
          data={[
            { value: "cards", label: "Vista de asistentes" },
            { value: "companies", label: "Vista por empresa" },
          ]}
          placeholder="Modo de visualización"
          value={viewMode}
          onChange={setViewMode}
        />
      </Group>

      <Group mb="md">
        <Button
          variant={showOnlyToday ? "filled" : "outline"}
          color="blue"
          size="xs"
          onClick={() => setShowOnlyToday((v) => !v)}
        >
          {showOnlyToday
            ? "Mostrar todos los asistentes"
            : "Mostrar solo conectados hoy"}
        </Button>
      </Group>

      <Text mb="md">
        Máximo, puedes agendar{" "}
        <strong>{eventConfig?.maxMeetingsPerUser ?? "∞"}</strong> {eventConfig?.maxMeetingsPerUser === 1 ? "reunión" : "reuniones"}.
      </Text>

      {viewMode === "cards" ? renderCardView() : renderCompanyView()}
    </>
  );
}
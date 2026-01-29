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
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import { useState } from "react";
import type { Assistant } from "./types";

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
}: AttendeesViewProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

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
      </Group>

      <Group mb="md">
        <Button
          variant={showOnlyToday ? "filled" : "outline"}
          color="blue"
          size="xs"
          onClick={() => setShowOnlyToday((v: boolean) => !v)}
        >
          {showOnlyToday
            ? "Mostrar todos los asistentes"
            : "Mostrar solo conectados hoy"}
        </Button>
      </Group>

      <Text mb="md">
        Máximo, puedes agendar{" "}
        <strong>{eventConfig?.maxMeetingsPerUser ?? "\u221E"}</strong>{" "}
        {eventConfig?.maxMeetingsPerUser === 1 ? "reunión" : "reuniones"}.
      </Text>

      {filteredAssistants.length > 0 && filteredAssistants.length <= 10 && (
        <Alert mb="md" color="blue" title="Aún estás entre los primeros"
          styles={{ message: { lineHeight: 1.6 } }}>
          Solo hay{" "}
          <strong>
            {filteredAssistants.length} asistente
            {filteredAssistants.length !== 1 ? "s" : ""}
          </strong>{" "}
          registrado{filteredAssistants.length !== 1 ? "s" : ""}. Aprovecha esta
          oportunidad para conectar con los pioneros del evento.
        </Alert>
      )}

      <Grid>
        {filteredAssistants.length > 0 ? (
          filteredAssistants.map((assistant) => (
            <Grid.Col span={{ xs: 12, sm: 6, md: 4 }} key={assistant.id} style={{ height: 400 }}>
              <Card shadow="sm" p="lg" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                <Group justify="center" mb="md">
                  <Avatar
                    src={assistant.photoURL}
                    alt={`Avatar de ${assistant.nombre}`}
                    radius="50%"
                    size="xl"
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      setSelectedImage(assistant.photoURL || null);
                      setAvatarModalOpened(true);
                    }}
                  >
                    {!assistant.photoURL && assistant.nombre && assistant.nombre[0]}
                  </Avatar>
                </Group>
                <Title order={5} mb={4} style={{ textAlign: "center" }}>
                  {assistant.nombre}
                </Title>
                <div style={{ flex: 1, overflowY: "auto", minHeight: 0, marginBottom: 8 }}>
                  <Text size="sm"><strong>Empresa:</strong> {assistant.empresa}</Text>
                  {assistant.cargo && (
                    <Text size="sm"><strong>Cargo:</strong> {assistant.cargo}</Text>
                  )}
                  <Text size="sm"><strong>Correo:</strong> {assistant.correo || "No disponible"}</Text>
                  <Text size="sm"><strong>Descripción:</strong> {assistant.descripcion || "No especificada"}</Text>
                  <Text size="sm"><strong>Interés:</strong> {assistant.interesPrincipal || "No especificado"}</Text>
                  <Text size="sm"><strong>Necesidad:</strong> {assistant.necesidad || "No especificada"}</Text>
                </div>
                <Group mt="auto">
                  <Button
                    mt="sm"
                    onClick={() => handleSendMeeting(assistant)}
                    disabled={!solicitarReunionHabilitado || loadingId === assistant.id}
                    loading={loadingId === assistant.id}
                    fullWidth
                  >
                    {solicitarReunionHabilitado ? "Solicitar reunión" : "Solicitudes deshabilitadas"}
                  </Button>
                </Group>
              </Card>
            </Grid.Col>
          ))
        ) : (
          <Grid.Col span={12}>
            <Text mt={20} c="dimmed">
              No se encontraron asistentes. Intenta ajustar los filtros de búsqueda.
            </Text>
          </Grid.Col>
        )}
      </Grid>
    </>
  );
}

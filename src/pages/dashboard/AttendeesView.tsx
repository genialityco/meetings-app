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
  rem,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import { useState, useMemo } from "react";
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
} from "@tabler/icons-react";
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
      <Text size="sm" style={{ minWidth: 0 }} lineClamp={2}>
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
}: AttendeesViewProps) {
  const theme = useMantineTheme();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const myUid = currentUser?.uid;

  const maxMeetingsText = useMemo(() => {
    const n = eventConfig?.maxMeetingsPerUser;
    if (n === undefined || n === null) return "∞";
    return String(n);
  }, [eventConfig]);

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
              leftSection={<IconSearch size={16} />}
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
              <Button
                variant={showOnlyToday ? "filled" : "light"}
                color={theme.primaryColor}
                size="xs"
                leftSection={<IconCalendarCheck size={14} />}
                onClick={() => setShowOnlyToday((v: boolean) => !v)}
              >
                {showOnlyToday ? "Solo conectados hoy" : "Todos"}
              </Button>

              <Text size="sm" c="dimmed">
                Máximo: <Text span fw={800}>{maxMeetingsText}</Text>{" "}
                {eventConfig?.maxMeetingsPerUser === 1 ? "reunión" : "reuniones"}
              </Text>
            </Group>
          </Grid.Col>
        </Grid>
      </Paper>

      {/* Alert oportunista */}
      {filteredAssistants.length > 0 && filteredAssistants.length <= 10 && (
        <Alert
          color={theme.primaryColor}
          title="Aún estás entre los primeros"
          styles={{ message: { lineHeight: 1.6 } }}
        >
          Solo hay{" "}
          <strong>
            {filteredAssistants.length} asistente
            {filteredAssistants.length !== 1 ? "s" : ""}
          </strong>{" "}
          registrado{filteredAssistants.length !== 1 ? "s" : ""}. Aprovecha para
          conectar con los pioneros del evento.
        </Alert>
      )}

      {/* Grid */}
      <Grid gutter="sm">
        {filteredAssistants.length > 0 ? (
          filteredAssistants.map((assistant) => {
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
                        {assistant.empresa ? ` • ${assistant.empresa}` : ""}
                      </Text>
                    </Box>
                  </Group>

                  <Divider my="sm" />

                  {/* Body */}
                  <Stack gap={8} style={{ flex: 1, minHeight: 0 }}>
                    <InfoRow
                      icon={<IconBuildingStore size={14} />}
                      label="Empresa"
                      value={assistant.empresa || "No especificada"}
                    />
                    {assistant.cargo && (
                      <InfoRow
                        icon={<IconBriefcase size={14} />}
                        label="Cargo"
                        value={assistant.cargo}
                      />
                    )}
                    <InfoRow
                      icon={<IconMail size={14} />}
                      label="Correo"
                      value={assistant.correo}
                    />
                    <InfoRow
                      icon={<IconFileDescription size={14} />}
                      label="Descripción"
                      value={assistant.descripcion || "No especificada"}
                    />
                    <InfoRow
                      icon={<IconTargetArrow size={14} />}
                      label="Interés"
                      value={assistant.interesPrincipal || "No especificado"}
                    />
                    <InfoRow
                      icon={<IconBulb size={14} />}
                      label="Necesidad"
                      value={assistant.necesidad || "No especificada"}
                    />
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
                No se encontraron asistentes. Intenta ajustar los filtros de búsqueda.
              </Text>
            </Paper>
          </Grid.Col>
        )}
      </Grid>
    </Stack>
  );
}

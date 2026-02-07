// Dashboard/RequestsTab.tsx
"use client";

import {
  Tabs,
  Stack,
  Card,
  Text,
  Button,
  Group,
  Badge,
  Avatar,
  Title,
  Divider,
  ThemeIcon,
  Box,
  Paper,
  Grid,
  useMantineTheme,
} from "@mantine/core";
import {
  IconBuildingStore,
  IconBriefcase,
  IconMail,
  IconPhone,
  IconFileDescription,
  IconTargetArrow,
  IconBulb,
  IconCheck,
  IconX,
  IconBrandWhatsapp,
  IconSend,
  IconClock,
  IconTable,
  IconUsers,
  IconNote,
} from "@tabler/icons-react";
import { Assistant, Meeting } from "./types";

interface RequestsTabProps {
  pendingRequests: Meeting[];
  acceptedRequests: Meeting[];
  rejectedRequests: Meeting[];
  takenRequests: Meeting[];
  sentRequests: Meeting[];
  sentRejectedRequests: Meeting[];
  assistants: Assistant[];
  updateMeetingStatus: (meetingId: string, status: string) => void;
  sendWhatsAppMessage: (participant: Assistant) => void;
  cancelSentMeeting: (meetingId: string, action: string) => void;
  prepareSlotSelection: (meetingId: string) => void;
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

function RequestCard({
  user,
  request,
  actions,
  statusBadge,
}: {
  user: Assistant | undefined;
  request: Meeting;
  actions?: React.ReactNode;
  statusBadge?: React.ReactNode;
}) {
  const theme = useMantineTheme();

  if (!user) {
    return (
      <Card withBorder radius="xl" padding="md" shadow="sm">
        <Group justify="center" py="md">
          <Text c="dimmed" size="sm">Cargando información...</Text>
        </Group>
      </Card>
    );
  }

  return (
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
          src={user.photoURL}
          radius="xl"
          size={52}
          color={theme.primaryColor}
        >
          {(user.nombre || "U")[0]?.toUpperCase()}
        </Avatar>

        <Box style={{ minWidth: 0, flex: 1 }}>
          <Title order={6} lineClamp={1}>
            {user.nombre || "Sin nombre"}
          </Title>
          <Text size="sm" c="dimmed" lineClamp={1}>
            {user.cargo || "Asistente"}
            {user.empresa ? ` • ${user.empresa}` : ""}
          </Text>
        </Box>
      </Group>

      <Divider my="sm" />

      {/* Info rows */}
      <Stack gap={8} style={{ flex: 1 }}>
        <InfoRow
          icon={<IconBuildingStore size={14} />}
          label="Empresa"
          value={user.empresa}
        />
        <InfoRow
          icon={<IconMail size={14} />}
          label="Correo"
          value={user.correo}
        />
        <InfoRow
          icon={<IconPhone size={14} />}
          label="Teléfono"
          value={user.telefono}
        />
        <InfoRow
          icon={<IconTargetArrow size={14} />}
          label="Interés"
          value={user.interesPrincipal}
        />
        <InfoRow
          icon={<IconBulb size={14} />}
          label="Necesidad"
          value={user.necesidad}
        />
      </Stack>

      {request.contextNote && (
        <Badge variant="light" color="grape" size="sm" mt="xs" radius="md">
          <Group gap={4} wrap="nowrap">
            <IconNote size={12} />
            {request.contextNote}
          </Group>
        </Badge>
      )}

      {statusBadge && <Box mt="xs">{statusBadge}</Box>}

      {/* Actions */}
      {actions && (
        <Stack gap="xs" mt="auto" pt="sm">
          <Divider />
          {actions}
        </Stack>
      )}
    </Card>
  );
}

export default function RequestsTab({
  pendingRequests,
  acceptedRequests,
  rejectedRequests,
  sentRequests,
  sentRejectedRequests = [],
  takenRequests,
  assistants,
  updateMeetingStatus,
  sendWhatsAppMessage,
  cancelSentMeeting,
  prepareSlotSelection,
}: RequestsTabProps) {
  const theme = useMantineTheme();
  const findUser = (id: string) => assistants.find((u) => u.id === id);

  return (
    <Tabs defaultValue="pendientes" radius="md">
      <Tabs.List grow>
        <Tabs.Tab value="pendientes">
          <Group gap={4} wrap="nowrap">
            Pendientes
            {pendingRequests.length > 0 && (
              <Badge size="sm" variant="filled" color="red" circle>
                {pendingRequests.length}
              </Badge>
            )}
          </Group>
        </Tabs.Tab>
        <Tabs.Tab value="aceptadas">
          Aceptadas ({acceptedRequests.length})
        </Tabs.Tab>
        <Tabs.Tab value="rechazadas">
          Rechazadas ({rejectedRequests.length + sentRejectedRequests.length})
        </Tabs.Tab>
        <Tabs.Tab value="enviadas">
          Enviadas ({sentRequests.length})
        </Tabs.Tab>
        <Tabs.Tab value="taken">
          Otras solicitudes de la empresa ({takenRequests.length})
        </Tabs.Tab>
      </Tabs.List>

      {/* Pendientes */}
      <Tabs.Panel value="pendientes" pt="md">
        <Grid gutter="sm">
          {pendingRequests.length > 0 ? (
            pendingRequests.map((request) => {
              const requester = findUser(request.requesterId);
              return (
                <Grid.Col span={{ base: 12, sm: 6, lg: 4 }} key={request.id}>
                  <RequestCard
                    user={requester}
                    request={request}
                    actions={
                      <Group grow gap="xs">
                        <Button
                          color="green"
                          size="compact-sm"
                          radius="md"
                          leftSection={<IconCheck size={14} />}
                          onClick={() => prepareSlotSelection(request.id)}
                        >
                          Aceptar
                        </Button>
                        <Button
                          color="red"
                          variant="light"
                          size="compact-sm"
                          radius="md"
                          leftSection={<IconX size={14} />}
                          onClick={() => updateMeetingStatus(request.id, "rejected")}
                        >
                          Rechazar
                        </Button>
                        <Button
                          variant="light"
                          color="green"
                          size="compact-sm"
                          radius="md"
                          leftSection={<IconBrandWhatsapp size={14} />}
                          onClick={() => sendWhatsAppMessage(requester as Assistant)}
                        >
                          WhatsApp
                        </Button>
                      </Group>
                    }
                  />
                </Grid.Col>
              );
            })
          ) : (
            <Grid.Col span={12}>
              <Paper withBorder radius="lg" p="lg">
                <Text c="dimmed" ta="center">
                  No tienes solicitudes de reunión pendientes.
                </Text>
              </Paper>
            </Grid.Col>
          )}
        </Grid>
      </Tabs.Panel>

      {/* Aceptadas */}
      <Tabs.Panel value="aceptadas" pt="md">
        <Grid gutter="sm">
          {acceptedRequests.length > 0 ? (
            acceptedRequests.map((request) => {
              const requester = findUser(request.requesterId);
              return (
                <Grid.Col span={{ base: 12, sm: 6, lg: 4 }} key={request.id}>
                  <RequestCard
                    user={requester}
                    request={request}
                    statusBadge={
                      <Group gap="xs">
                        {request.timeSlot && (
                          <Badge variant="light" color={theme.primaryColor} radius="md" size="sm">
                            <Group gap={4} wrap="nowrap">
                              <IconClock size={12} />
                              {request.timeSlot}
                            </Group>
                          </Badge>
                        )}
                        {request.tableAssigned && (
                          <Badge variant="light" color="orange" radius="md" size="sm">
                            <Group gap={4} wrap="nowrap">
                              <IconTable size={12} />
                              Mesa {request.tableAssigned}
                            </Group>
                          </Badge>
                        )}
                      </Group>
                    }
                  />
                </Grid.Col>
              );
            })
          ) : (
            <Grid.Col span={12}>
              <Paper withBorder radius="lg" p="lg">
                <Text c="dimmed" ta="center">
                  No tienes solicitudes aceptadas.
                </Text>
              </Paper>
            </Grid.Col>
          )}
        </Grid>
      </Tabs.Panel>

      {/* Rechazadas */}
      <Tabs.Panel value="rechazadas" pt="md">
        <Grid gutter="sm">
          {/* Solicitudes que el usuario rechazó (él es receptor) */}
          {rejectedRequests.map((request) => {
            const requester = findUser(request.requesterId);
            return (
              <Grid.Col span={{ base: 12, sm: 6, lg: 4 }} key={request.id}>
                <RequestCard
                  user={requester}
                  request={request}
                  statusBadge={
                    <Badge variant="light" color="red" radius="md" size="sm">
                      Rechazaste la reunión
                    </Badge>
                  }
                />
              </Grid.Col>
            );
          })}
          {/* Solicitudes que le rechazaron al usuario (él es solicitante) */}
          {sentRejectedRequests.map((request) => {
            const receiver = findUser(request.receiverId);
            return (
              <Grid.Col span={{ base: 12, sm: 6, lg: 4 }} key={request.id}>
                <RequestCard
                  user={receiver}
                  request={request}
                  statusBadge={
                    <Badge variant="light" color="red" radius="md" size="sm">
                      Tu solicitud fue rechazada
                    </Badge>
                  }
                />
              </Grid.Col>
            );
          })}
          {rejectedRequests.length === 0 && sentRejectedRequests.length === 0 && (
            <Grid.Col span={12}>
              <Paper withBorder radius="lg" p="lg">
                <Text c="dimmed" ta="center">
                  No tienes solicitudes rechazadas.
                </Text>
              </Paper>
            </Grid.Col>
          )}
        </Grid>
      </Tabs.Panel>

      {/* Enviadas */}
      <Tabs.Panel value="enviadas" pt="md">
        <Grid gutter="sm">
          {sentRequests.length > 0 ? (
            sentRequests.map((request) => {
              const receiver = findUser(request.receiverId);
              return (
                <Grid.Col span={{ base: 12, sm: 6, lg: 4 }} key={request.id}>
                  <RequestCard
                    user={receiver}
                    request={request}
                    statusBadge={
                      <Badge variant="light" color="blue" radius="md" size="sm">
                        <Group gap={4} wrap="nowrap">
                          <IconSend size={12} />
                          Pendiente de respuesta
                        </Group>
                      </Badge>
                    }
                    actions={
                      <Button
                        color="red"
                        variant="light"
                        size="compact-sm"
                        radius="md"
                        fullWidth
                        leftSection={<IconX size={14} />}
                        onClick={() => cancelSentMeeting(request.id, "cancel")}
                      >
                        Cancelar solicitud
                      </Button>
                    }
                  />
                </Grid.Col>
              );
            })
          ) : (
            <Grid.Col span={12}>
              <Paper withBorder radius="lg" p="lg">
                <Text c="dimmed" ta="center">
                  No tienes solicitudes enviadas pendientes.
                </Text>
              </Paper>
            </Grid.Col>
          )}
        </Grid>
      </Tabs.Panel>

      {/* Otras solicitudes de la empresa */}
      <Tabs.Panel value="taken" pt="md">
        <Grid gutter="sm">
          {takenRequests.length > 0 ? (
            takenRequests.map((request) => {
              const requester = findUser(request.requesterId);
              return (
                <Grid.Col span={{ base: 12, sm: 6, lg: 4 }} key={request.id}>
                  <RequestCard
                    user={requester}
                    request={request}
                    statusBadge={
                      <Badge variant="light" color="blue" radius="md" size="sm">
                        <Group gap={4} wrap="nowrap">
                          <IconUsers size={12} />
                          Tomada por otro asistente
                        </Group>
                      </Badge>
                    }
                  />
                </Grid.Col>
              );
            })
          ) : (
            <Grid.Col span={12}>
              <Paper withBorder radius="lg" p="lg">
                <Text c="dimmed" ta="center">
                  No tienes solicitudes.
                </Text>
              </Paper>
            </Grid.Col>
          )}
        </Grid>
      </Tabs.Panel>
    </Tabs>
  );
}

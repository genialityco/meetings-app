import { Card, Group, Button, Collapse, Box, Grid, Avatar, Text, ActionIcon } from "@mantine/core";
import { CheckIcon } from "@mantine/core";
import { BiX } from "react-icons/bi";
import { FaWhatsapp } from "react-icons/fa";
import { useState } from "react";

export default function PendingRequestsSection({
  pendingRequests,
  assistants,
  onAccept,
  onReject,
  prepareSlotSelectionLoading,
  sendWhatsAppMessage
}) {
  const [pendingVisible, setPendingVisible] = useState(true);

  return (
    <Card shadow="sm" mb="md">
      <Group justify="space-between">
        <Text fw={500}>Solicitudes Reuniones Pendientes ({pendingRequests.length})</Text>
        <Button
          variant="subtle"
          size="xs"
          onClick={() => setPendingVisible((v) => !v)}
        >
          {pendingVisible ? "Ocultar" : "Mostrar"}
        </Button>
      </Group>
      <Collapse in={pendingVisible} mt="sm">
        <Box >
          <Grid gutter="md">
            {pendingRequests.length > 0 ? (
              pendingRequests.map((req) => {
                const requester = assistants.find((a) => a.id === req.requesterId);
                return (
                  <Grid.Col span={{ base: 12, md: 6, lg: 3 }} key={req.id}>
                    <Card shadow="xs" p="sm" style={{ minWidth: 260, flex: "0 0 auto" }}>
                      <Grid>
                        <Grid.Col span={6}>
                          <Group align="center" p="sm" mb="xs">
                            <Avatar src={requester?.photoURL} radius="xl" />
                            <Text fw={500}>{requester?.nombre}</Text>
                          </Group>
                          <Text size="xs">🏢 {requester?.empresa}</Text>
                          <Text size="xs">🏷 {requester?.cargo}</Text>
                          <Text size="xs">✉️ {requester?.contacto?.correo || "No disponible"}</Text>
                          <Text size="xs">📞 {requester?.contacto?.telefono || "No disponible"}</Text>
                          <Text size="xs">📝 {requester?.descripcion || "No especificada"}</Text>
                          <Text size="xs">🎯 {requester?.interesPrincipal || "No especificado"}</Text>
                          <Text size="xs">🔍 {requester?.necesidad || "No especificada"}</Text>
                        </Grid.Col>
                        <Grid.Col span={6}>
                          <Group justify="center" mt="sm">
                            <ActionIcon
                              size="sm"
                              variant="light"
                              color="green"
                              loading={prepareSlotSelectionLoading}
                              onClick={() => onAccept(req.id, false)}
                            >
                              <CheckIcon size={18} />
                            </ActionIcon>
                            <ActionIcon
                              size="sm"
                              variant="light"
                              color="red"
                              onClick={() => onReject(req.id, "rejected")}
                            >
                              <BiX size={18} />
                            </ActionIcon>
                            <ActionIcon
                              size="sm"
                              variant="light"
                              color="teal"
                              onClick={() => sendWhatsAppMessage(requester)}
                            >
                              <FaWhatsapp size={18} />
                            </ActionIcon>
                          </Group>
                        </Grid.Col>
                      </Grid>
                    </Card>
                  </Grid.Col>
                );
              })
            ) : (
              <Text c="dimmed" ta="center" mt="md">
                No hay solicitudes pendientes
              </Text>
            )}
          </Grid>
        </Box>
      </Collapse>
    </Card>
  );
}

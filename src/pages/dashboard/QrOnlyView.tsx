import { useEffect, useState } from "react";
import { Paper, Stack, Avatar, Title, Text, Box, Center, Loader, Badge, Group } from "@mantine/core";
import { IconUserCheck, IconClock } from "@tabler/icons-react";
import QRCode from "qrcode";
import { getEventDayKeys, formatDayLabel, isCheckedInOnDay } from "../../utils/eventDays";

/**
 * Vista de dashboard usada cuando la política qrOnlyModeEnabled está activa:
 * reemplaza todas las demás pestañas (reuniones, asistentes, empresas...) y
 * deja únicamente el QR de asistencia del usuario, igual al de BadgePage,
 * pero embebido en el dashboard en vez de requerir navegar a /badge.
 */
export default function QrOnlyView({ dashboard }: { dashboard: any }) {
  const { uid, currentUser, eventConfig, eventName, eventImage } = dashboard;
  const data = currentUser?.data || {};
  const [qrCodeUrl, setQrCodeUrl] = useState("");

  useEffect(() => {
    if (!uid) return;
    QRCode.toDataURL(uid, { width: 260, margin: 2 })
      .then(setQrCodeUrl)
      .catch((e) => console.error("Error generando QR", e));
  }, [uid]);

  const dayKeys = getEventDayKeys(eventConfig);

  return (
    <Center mt="xl">
      <Paper shadow="xl" radius="lg" p="xl" withBorder maw={420} w="100%">
        <Stack align="center" gap="md">
          {(eventConfig?.landingTitleImage || eventImage) && (
            <img
              src={eventConfig?.landingTitleImage || eventImage}
              alt={eventName}
              style={{ maxHeight: 70, maxWidth: "100%", objectFit: "contain" }}
            />
          )}

          <Title order={3} ta="center">{eventName || "Evento"}</Title>

          <Avatar src={data.photoURL} size={100} radius={100} color="teal">
            {(data.nombre || "?")[0]?.toUpperCase()}
          </Avatar>

          <Title order={4} ta="center">{data.nombre}</Title>
          {data.empresa && (
            <Text size="md" c="dimmed" ta="center">{data.empresa}</Text>
          )}

          <Box mt="md" p="md" style={{ background: "white", borderRadius: 12, border: "1px solid #eee" }}>
            {qrCodeUrl ? (
              <img src={qrCodeUrl} alt="QR de asistencia" style={{ display: "block", margin: "0 auto" }} />
            ) : (
              <Loader size="sm" />
            )}
          </Box>

          <Text size="sm" c="dimmed" ta="center">
            Presenta este código QR en la entrada del evento para realizar tu check-in.
          </Text>

          {dayKeys.length > 0 && (
            <Group gap="xs" justify="center" mt="xs">
              {dayKeys.map((day, idx) => {
                const checkedIn = isCheckedInOnDay(data, day);
                return (
                  <Badge
                    key={day}
                    size="lg"
                    radius="md"
                    variant={checkedIn ? "filled" : "outline"}
                    color={checkedIn ? "teal" : "gray"}
                    leftSection={checkedIn ? <IconUserCheck size={14} /> : <IconClock size={14} />}
                  >
                    {formatDayLabel(day, idx)}
                  </Badge>
                );
              })}
            </Group>
          )}
        </Stack>
      </Paper>
    </Center>
  );
}

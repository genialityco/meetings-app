import { Card, Group, Loader, Paper, SimpleGrid, Skeleton, Stack, Text } from "@mantine/core";

/** Tarjeta "fantasma" con la forma de las tarjetas de asistente/empresa/producto */
function CardSkeleton() {
  return (
    <Card withBorder radius="lg" padding="md">
      <Group wrap="nowrap" gap="sm" mb="md">
        <Skeleton height={48} circle />
        <Stack gap={8} style={{ flex: 1 }}>
          <Skeleton height={12} width="70%" radius="xl" />
          <Skeleton height={10} width="45%" radius="xl" />
        </Stack>
      </Group>
      <Stack gap={8}>
        <Skeleton height={8} radius="xl" />
        <Skeleton height={8} radius="xl" />
        <Skeleton height={8} width="80%" radius="xl" />
      </Stack>
      <Skeleton height={34} radius="md" mt="lg" />
    </Card>
  );
}

/** Rejilla de tarjetas cargando, con un texto que dice qué se está cargando */
export function CardGridSkeleton({ label, count = 6 }: { label?: string; count?: number }) {
  return (
    <Stack gap="sm" aria-busy="true" aria-live="polite">
      {label && <LoadingLabel label={label} />}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        {Array.from({ length: count }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </SimpleGrid>
    </Stack>
  );
}

/** Lista de filas cargando (agenda, solicitudes) */
export function ListSkeleton({ label, rows = 5 }: { label?: string; rows?: number }) {
  return (
    <Stack gap="xs" aria-busy="true" aria-live="polite">
      {label && <LoadingLabel label={label} />}
      {Array.from({ length: rows }, (_, i) => (
        <Group key={i} wrap="nowrap" gap="sm">
          <Skeleton height={14} width={44} radius="xl" />
          <Paper withBorder radius="md" p="xs" style={{ flex: 1 }}>
            <Group wrap="nowrap" gap="sm">
              <Skeleton height={34} circle />
              <Stack gap={6} style={{ flex: 1 }}>
                <Skeleton height={10} width="55%" radius="xl" />
                <Skeleton height={8} width="35%" radius="xl" />
              </Stack>
            </Group>
          </Paper>
        </Group>
      ))}
    </Stack>
  );
}

/** Spinner pequeño + texto: deja claro QUÉ se está cargando */
export function LoadingLabel({ label }: { label: string }) {
  return (
    <Group gap="xs" c="dimmed">
      <Loader size={14} />
      <Text size="sm" c="dimmed">
        {label}
      </Text>
    </Group>
  );
}

/** Esqueleto del dashboard completo mientras llega la configuración del evento
 * (evita que se pinten por un instante pestañas que el evento no tiene habilitadas) */
export function DashboardSkeleton() {
  return (
    <Stack mt="md" gap="md" aria-busy="true">
      <Skeleton height={40} radius="xl" />
      <CardGridSkeleton label="Cargando el evento…" count={6} />
    </Stack>
  );
}

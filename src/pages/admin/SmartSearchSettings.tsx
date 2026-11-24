import { useEffect, useState } from "react";
import { Alert, Button, Group, Loader, Stack, Switch, Text } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { runSmartSearchReindex, type SmartSearchIndexStatus } from "../../utils/smartSearch";

interface Props {
  eventId: string;
  enabled: boolean;
  explanationsEnabled: boolean;
  onEnabledChange: (value: boolean) => void;
  onExplanationsChange: (value: boolean) => void;
  /** La política guardada (no la del formulario): el índice solo se construye con ella activa */
  savedEnabled: boolean;
}

const line = (label: string, s?: SmartSearchIndexStatus["companies"]) =>
  s ? `${label}: ${s.indexed} de ${s.total} indexados${s.pending ? ` (${s.pending} pendientes)` : ""}` : null;

/**
 * Interruptores de la búsqueda inteligente + estado del índice y botón para construirlo. Los
 * triggers solo mantienen el índice de eventos con la política guardada, así que al activarla por
 * primera vez (o si algo quedó pendiente) se construye desde aquí.
 */
export default function SmartSearchSettings({
  eventId,
  enabled,
  explanationsEnabled,
  onEnabledChange,
  onExplanationsChange,
  savedEnabled,
}: Props) {
  const [status, setStatus] = useState<SmartSearchIndexStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      setStatus(await runSmartSearchReindex(eventId, true));
    } catch (err: any) {
      setError(err?.message || "No se pudo consultar el índice");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (savedEnabled && eventId) check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedEnabled, eventId]);

  const reindex = async () => {
    setIndexing(true);
    setError(null);
    try {
      await runSmartSearchReindex(eventId, false);
      setStatus(await runSmartSearchReindex(eventId, true));
    } catch (err: any) {
      setError(err?.message || "No se pudo construir el índice");
    } finally {
      setIndexing(false);
    }
  };

  const pending = (status?.companies?.pending || 0) + (status?.attendees?.pending || 0);

  return (
    <Stack gap="sm">
      <Switch
        label="Búsqueda inteligente en Empresas y Asistentes"
        description="Encuentra empresas y personas por lo que ofrecen o buscan aunque no usen las mismas palabras (ej. “empaques” encuentra “bolsas plásticas”). Usa la descripción, productos, sector y representantes; combina con la búsqueda exacta por nombre."
        checked={enabled}
        onChange={(e) => onEnabledChange(e.currentTarget.checked)}
      />
      {enabled && (
        <Stack gap="sm" pl="xl">
          <Switch
            label="“¿Por qué este resultado?”"
            description="En los resultados que aparecen solo por significado, la IA explica en una frase la relación con lo buscado (se genera al hacer clic)."
            checked={explanationsEnabled}
            onChange={(e) => onExplanationsChange(e.currentTarget.checked)}
          />
          {!savedEnabled ? (
            <Text size="xs" c="dimmed">Guarda las políticas para construir el índice de búsqueda.</Text>
          ) : (
            <Stack gap={6}>
              <Group gap="xs">
                {checking ? (
                  <Loader size={14} />
                ) : status ? (
                  <Stack gap={0}>
                    <Text size="xs">{line("Empresas", status.companies)}</Text>
                    <Text size="xs">{line("Asistentes", status.attendees)}</Text>
                  </Stack>
                ) : null}
              </Group>
              <Group gap="xs">
                <Button
                  size="xs"
                  variant={pending ? "filled" : "light"}
                  leftSection={<IconRefresh size={14} />}
                  loading={indexing}
                  disabled={checking}
                  onClick={reindex}
                >
                  {pending ? "Construir índice" : "Actualizar índice"}
                </Button>
                <Button size="xs" variant="subtle" onClick={check} disabled={checking || indexing}>
                  Ver estado
                </Button>
              </Group>
              {indexing && (
                <Text size="xs" c="dimmed">
                  Indexando… con muchos registros puede tardar varios minutos. Puedes cerrar este panel: el
                  proceso sigue en el servidor.
                </Text>
              )}
              <Text size="xs" c="dimmed">
                Después se mantiene solo: los cambios en empresas, productos y perfiles se reindexan automáticamente.
              </Text>
            </Stack>
          )}
          {error && (
            <Alert color="red" variant="light" p="xs">
              <Text size="xs">{error}</Text>
            </Alert>
          )}
        </Stack>
      )}
    </Stack>
  );
}

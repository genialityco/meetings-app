import { useEffect, useState } from "react";
import { Anchor, Box, Group, Skeleton, Stack, Text } from "@mantine/core";
import { IconSparkles } from "@tabler/icons-react";
import { fetchSearchSummary, normalizeSearchText, type SmartSearchKind } from "../utils/smartSearch";

/** Cuántos de los primeros resultados se resumen (mismo tope que el servidor) */
export const SUMMARY_MAX_RESULTS = 12;

interface Props {
  eventId: string;
  kind: SmartSearchKind;
  /** Consulta a la que corresponden los resultados (useSmartSearch().query) */
  query: string;
  /** Ids de índice de los primeros resultados, en el orden en que se muestran */
  ids: string[];
}

// Resúmenes ya pedidos en esta sesión (promesa, para no duplicar llamadas en curso)
const cache = new Map<string, Promise<string>>();

function getSummary(eventId: string, kind: SmartSearchKind, query: string, ids: string[]) {
  const key = JSON.stringify([eventId, kind, normalizeSearchText(query), ids]);
  let p = cache.get(key);
  if (!p) {
    p = fetchSearchSummary(eventId, kind, query, ids);
    p.catch(() => cache.delete(key)); // un fallo no queda guardado: "Reintentar" vuelve a pedirlo
    cache.set(key, p);
  }
  return p;
}

// Un cambio de filtro cambia los ids: se espera a que la lista se quede quieta antes de pedirlo
const SETTLE_MS = 350;

/**
 * Lectura general de los resultados de una búsqueda inteligente, arriba de la lista: qué tipo de
 * empresas/personas aparecieron y cómo se relacionan con lo buscado (Gemini, con caché de 24 h en
 * el servidor y en memoria aquí). Complementa el "¿Por qué aparece?" de cada tarjeta.
 */
export default function SmartSearchSummary({ eventId, kind, query, ids }: Props) {
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [text, setText] = useState("");
  const [attempt, setAttempt] = useState(0);
  const idsKey = ids.join("|");

  useEffect(() => {
    if (!query || !idsKey) return;
    let cancelled = false; // otra búsqueda / otros filtros mientras llegaba: ya no aplica
    setState("loading");
    const timer = setTimeout(() => {
      getSummary(eventId, kind, query, idsKey.split("|"))
        .then((t) => {
          if (cancelled) return;
          setText(t);
          setState("done");
        })
        .catch(() => {
          if (!cancelled) setState("error");
        });
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [eventId, kind, query, idsKey, attempt]);

  if (!query || !idsKey) return null;

  return (
    <Box
      role="status"
      style={{
        background: "linear-gradient(135deg, var(--mantine-color-violet-0), var(--mantine-color-blue-0))",
        border: "1px solid var(--mantine-color-violet-2)",
        borderLeft: "4px solid var(--mantine-color-violet-5)",
        borderRadius: "var(--mantine-radius-md)",
        padding: "12px 14px",
      }}
    >
      <Group gap={6} wrap="nowrap" mb={6}>
        <IconSparkles size={16} color="var(--mantine-color-violet-6)" style={{ flexShrink: 0 }} />
        <Text size="sm" fw={700} c="violet.8">
          Resumen de los resultados para “{query}”
        </Text>
      </Group>
      {state === "done" ? (
        <Text size="sm" c="dark.7" lh={1.5}>
          {text}
        </Text>
      ) : state === "error" ? (
        <Text size="xs" c="dimmed">
          No se pudo generar el resumen.{" "}
          <Anchor component="button" type="button" size="xs" onClick={() => setAttempt((n) => n + 1)}>
            Reintentar
          </Anchor>
        </Text>
      ) : (
        <Stack gap={7} py={2} aria-label="Analizando los resultados…">
          <Skeleton height={10} radius="xl" />
          <Skeleton height={10} radius="xl" />
          <Skeleton height={10} width="60%" radius="xl" />
        </Stack>
      )}
    </Box>
  );
}

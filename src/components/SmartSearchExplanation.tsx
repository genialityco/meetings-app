import { useEffect, useRef, useState } from "react";
import { Anchor, Box, Group, Skeleton, Stack, Text } from "@mantine/core";
import { IconSparkles } from "@tabler/icons-react";
import { fetchSearchExplanation, normalizeSearchText, type SmartSearchKind } from "../utils/smartSearch";

interface Props {
  eventId: string;
  kind: SmartSearchKind;
  id: string;
  /** Consulta a la que corresponde el resultado (useSmartSearch().query), no el texto que se está escribiendo */
  query: string;
}

// Explicaciones ya pedidas en esta sesión (promesa, para no duplicar llamadas en curso): volver a
// la misma búsqueda, cambiar de vista o re-renderizar no vuelve a llamar a Gemini.
const cache = new Map<string, Promise<string>>();

// Pocas llamadas a la vez: una búsqueda puede traer muchos resultados por significado y se
// prioriza lo que el usuario está viendo (se piden al entrar en pantalla).
const MAX_CONCURRENT = 3;
let running = 0;
const queue: Array<() => void> = [];
function withLimit<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      running++;
      task()
        .then(resolve, reject)
        .finally(() => {
          running--;
          queue.shift()?.();
        });
    };
    if (running < MAX_CONCURRENT) run();
    else queue.push(run);
  });
}

function getExplanation(eventId: string, kind: SmartSearchKind, id: string, query: string) {
  const key = JSON.stringify([eventId, kind, id, normalizeSearchText(query)]);
  let p = cache.get(key);
  if (!p) {
    p = withLimit(() => fetchSearchExplanation(eventId, kind, id, query));
    p.catch(() => cache.delete(key)); // un fallo no queda guardado: "Reintentar" vuelve a pedirla
    cache.set(key, p);
  }
  return p;
}

const BOX_STYLE = {
  background: "var(--mantine-color-violet-0)",
  borderLeft: "3px solid var(--mantine-color-violet-5)",
  borderRadius: "var(--mantine-radius-sm)",
  padding: "8px 10px",
} as const;

/**
 * "¿Por qué aparece?" en un resultado que aparece solo por significado (sin nada resaltado que lo
 * justifique). Se pide sola cuando la tarjeta entra en pantalla (Gemini, con caché de 24 h en el
 * servidor y en memoria aquí), sin que el usuario tenga que hacer clic.
 */
export default function SmartSearchExplanation({ eventId, kind, id, query }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [text, setText] = useState("");
  const [attempt, setAttempt] = useState(0);

  // Solo se pide cuando la tarjeta está en pantalla (o a punto de estarlo)
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible, query]);

  useEffect(() => {
    if (!visible || !query) return;
    let cancelled = false; // otra búsqueda mientras llegaba: la respuesta ya no aplica
    setState("loading");
    getExplanation(eventId, kind, id, query)
      .then((t) => {
        if (cancelled) return;
        setText(t);
        setState("done");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [visible, eventId, kind, id, query, attempt]);

  if (!query) return null;

  return (
    <Box ref={ref} style={BOX_STYLE}>
      <Group gap={6} wrap="nowrap" mb={4}>
        <IconSparkles size={14} color="var(--mantine-color-violet-6)" style={{ flexShrink: 0 }} />
        <Text size="xs" fw={700} c="violet.7">
          ¿Por qué aparece?
        </Text>
      </Group>
      {state === "done" ? (
        <Text size="sm" c="dark.7" lh={1.4}>
          {text}
        </Text>
      ) : state === "error" ? (
        <Text size="xs" c="dimmed">
          No se pudo generar la explicación.{" "}
          <Anchor component="button" type="button" size="xs" onClick={() => setAttempt((n) => n + 1)}>
            Reintentar
          </Anchor>
        </Text>
      ) : (
        <Stack gap={6} py={2} aria-label="Analizando…">
          <Skeleton height={9} radius="xl" />
          <Skeleton height={9} width="70%" radius="xl" />
        </Stack>
      )}
    </Box>
  );
}

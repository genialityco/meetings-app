import { useEffect, useState } from "react";
import { Anchor, Group, Loader, Paper, Text } from "@mantine/core";
import { IconSparkles } from "@tabler/icons-react";
import { fetchSearchExplanation, type SmartSearchKind } from "../utils/smartSearch";

interface Props {
  eventId: string;
  kind: SmartSearchKind;
  id: string;
  query: string;
}

/**
 * "¿Por qué este resultado?" en un resultado que aparece solo por significado (sin nada resaltado
 * que lo justifique). La explicación se pide al hacer clic, no al mostrar la lista: cada una es una
 * llamada a Gemini (con caché en el servidor).
 */
export default function SmartSearchExplanation({ eventId, kind, id, query }: Props) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [text, setText] = useState("");

  // Otra búsqueda: la explicación anterior ya no aplica.
  useEffect(() => {
    setState("idle");
    setText("");
  }, [query, id]);

  const load = async () => {
    setState("loading");
    try {
      setText(await fetchSearchExplanation(eventId, kind, id, query));
      setState("done");
    } catch {
      setState("error");
    }
  };

  if (state === "idle") {
    return (
      <Anchor component="button" type="button" size="xs" onClick={load} style={{ alignSelf: "flex-start" }}>
        <Group gap={4} wrap="nowrap">
          <IconSparkles size={13} />
          ¿Por qué este resultado?
        </Group>
      </Anchor>
    );
  }
  if (state === "loading") {
    return (
      <Group gap={6}>
        <Loader size={12} />
        <Text size="xs" c="dimmed">Analizando…</Text>
      </Group>
    );
  }
  if (state === "error") {
    return (
      <Text size="xs" c="dimmed">
        No se pudo generar la explicación.{" "}
        <Anchor component="button" type="button" size="xs" onClick={load}>Reintentar</Anchor>
      </Text>
    );
  }
  return (
    <Paper p={8} radius="sm" bg="var(--mantine-color-violet-0)">
      <Group gap={6} wrap="nowrap" align="flex-start">
        <IconSparkles size={14} color="var(--mantine-color-violet-6)" style={{ flexShrink: 0, marginTop: 2 }} />
        <Text size="xs" c="dark.6">{text}</Text>
      </Group>
    </Paper>
  );
}

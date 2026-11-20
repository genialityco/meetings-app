import { Stack, Text, Title } from "@mantine/core";
import {
  resolveWelcomeMessage,
  splitBold,
  splitParagraphs,
  type RegistrationWelcomeConfig,
  type WelcomeVariant,
} from "../utils/registrationWelcome";

/** Mensaje de bienvenida sobre el formulario de registro (Landing). */
export default function RegistrationWelcome({
  config,
  variant,
  isUpdate = false,
  compact = false,
}: {
  config?: RegistrationWelcomeConfig | null;
  variant: WelcomeVariant;
  /** El asistente ya existe y está actualizando sus datos */
  isUpdate?: boolean;
  compact?: boolean;
}) {
  if (isUpdate) {
    return (
      <Text ta="center" c="dimmed">
        Actualiza tu información antes de continuar.
      </Text>
    );
  }

  const { title, text } = resolveWelcomeMessage(config, variant);
  const paragraphs = splitParagraphs(text);

  return (
    <Stack gap={compact ? 6 : 8} align="center" ta="center" maw={720} mx="auto">
      {title && (
        <Title order={3} fz={compact ? "lg" : "xl"} style={{ lineHeight: 1.2 }}>
          {title}
        </Title>
      )}
      {paragraphs.map((p, i) => (
        <Text key={i} size={compact ? "sm" : "md"} c="dimmed">
          {splitBold(p).map((chunk, j) =>
            chunk.bold ? (
              <Text key={j} span fw={700} c="var(--mantine-color-text)">
                {chunk.text}
              </Text>
            ) : (
              <span key={j}>{chunk.text}</span>
            ),
          )}
        </Text>
      ))}
    </Stack>
  );
}

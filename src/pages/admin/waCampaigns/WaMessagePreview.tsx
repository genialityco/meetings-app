import { Box, Image, Paper, Stack, Text } from "@mantine/core";
import { renderTemplatePreview } from "../../../utils/waCampaigns";

type Preview = ReturnType<typeof renderTemplatePreview>;

/** Vista previa aproximada de cómo se verá la plantilla en WhatsApp */
export default function WaMessagePreview({ preview }: { preview: Preview }) {
  return (
    <Box p="md" style={{ background: "#e5ddd5", borderRadius: 8 }}>
      <Paper p="sm" radius="md" maw={380} shadow="xs" style={{ background: "#fff" }}>
        <Stack gap={6}>
          {preview.headerFormat === "IMAGE" && preview.headerMediaUrl && (
            <Image src={preview.headerMediaUrl} radius="sm" mah={180} fit="cover" alt="Encabezado" />
          )}
          {preview.headerFormat && preview.headerFormat !== "TEXT" && !preview.headerMediaUrl && (
            <Box p="lg" bg="gray.2" style={{ borderRadius: 4 }}>
              <Text size="xs" c="dimmed" ta="center">
                [{preview.headerFormat}]
              </Text>
            </Box>
          )}
          {preview.headerText && (
            <Text fw={700} size="sm">
              {preview.headerText}
            </Text>
          )}
          <Text size="sm" style={{ whiteSpace: "pre-wrap", color: "#111" }}>
            {preview.body}
          </Text>
          {preview.footer && (
            <Text size="xs" c="dimmed">
              {preview.footer}
            </Text>
          )}
        </Stack>
      </Paper>
      {preview.buttons.map((b, i) => (
        <Paper key={i} mt={4} p={6} radius="md" maw={380} ta="center" style={{ background: "#fff" }}>
          <Text size="sm" c="blue">
            {b}
          </Text>
        </Paper>
      ))}
    </Box>
  );
}

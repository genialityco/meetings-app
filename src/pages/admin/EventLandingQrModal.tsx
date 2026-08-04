import { useState } from "react";
import { Modal, Button, Stack, Text, Box, Loader, Center, CopyButton, ActionIcon, Tooltip, Group } from "@mantine/core";
import { IconQrcode, IconCopy, IconCheck, IconDownload } from "@tabler/icons-react";
import QRCode from "qrcode";

interface EventLandingQrModalProps {
  eventId: string;
}

/**
 * Botón + modal para que el admin muestre/descargue el QR fijo de la landing
 * del evento (mismo patrón que StandVisitQrModal.tsx / RaffleQrModal.tsx). El
 * QR codifica siempre /event/:eventId, así que no cambia entre aperturas: sirve
 * para imprimir o compartir una sola vez.
 */
export default function EventLandingQrModal({ eventId }: EventLandingQrModalProps) {
  const [opened, setOpened] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const landingUrl = `${window.location.origin}/event/${eventId}`;

  const handleOpen = async () => {
    setOpened(true);
    if (qrCodeUrl) return;
    setLoading(true);
    try {
      const qrUrl = await QRCode.toDataURL(landingUrl, { width: 300, margin: 2 });
      setQrCodeUrl(qrUrl);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!qrCodeUrl) return;
    const link = document.createElement("a");
    link.href = qrCodeUrl;
    link.download = `qr-evento-${eventId}.png`;
    link.click();
  };

  return (
    <>
      <Button
        variant="default"
        leftSection={<IconQrcode size={16} />}
        onClick={handleOpen}
      >
        Código QR
      </Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title="Código QR de la landing" centered>
        <Stack align="center" gap="md">
          <Text size="sm" ta="center" c="dimmed">
            Este código es fijo: siempre apunta a la página de registro/landing del evento. Puedes imprimirlo o compartirlo para que los asistentes se registren o accedan al evento.
          </Text>
          {loading || !qrCodeUrl ? (
            <Center h={300} w={300}>
              <Loader />
            </Center>
          ) : (
            <Box p="md" style={{ background: "white", borderRadius: 12, border: "1px solid #eee" }}>
              <img src={qrCodeUrl} alt="Código QR de la landing del evento" style={{ display: "block" }} />
            </Box>
          )}
          <Text size="xs" c="dimmed" ta="center" style={{ wordBreak: "break-all" }}>
            {landingUrl}
          </Text>
          <Group gap="xs">
            <CopyButton value={landingUrl} timeout={2000}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? "Copiado" : "Copiar enlace"} withArrow>
                  <ActionIcon variant="light" color={copied ? "teal" : "gray"} onClick={copy}>
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
            <Tooltip label="Descargar QR" withArrow>
              <ActionIcon variant="light" color="gray" onClick={handleDownload} disabled={!qrCodeUrl}>
                <IconDownload size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

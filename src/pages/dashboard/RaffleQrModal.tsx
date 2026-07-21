import { useState } from "react";
import { Modal, Button, Badge, Stack, Text, Box, Loader, Center } from "@mantine/core";
import { IconQrcode, IconTicket } from "@tabler/icons-react";
import QRCode from "qrcode";

interface RaffleQrModalProps {
  eventId: string;
  meetingId: string;
  claimed?: boolean;
}

/**
 * Botón + modal para que el vendedor muestre el QR de sorteo de una reunión
 * aceptada. El comprador lo escanea con la cámara de su teléfono; el QR
 * codifica un enlace a /raffle-scan/:eventId/:meetingId (misma idea que el
 * QR de check-in de BadgePage.tsx).
 */
export default function RaffleQrModal({ eventId, meetingId, claimed }: RaffleQrModalProps) {
  const [opened, setOpened] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [loading, setLoading] = useState(false);

  if (claimed) {
    return (
      <Badge color="teal" variant="light" size="lg" leftSection={<IconTicket size={14} />}>
        Punto registrado
      </Badge>
    );
  }

  const handleOpen = async () => {
    setOpened(true);
    if (qrCodeUrl) return;
    setLoading(true);
    try {
      const scanUrl = `${window.location.origin}/raffle-scan/${eventId}/${meetingId}`;
      const qrUrl = await QRCode.toDataURL(scanUrl, { width: 250, margin: 2 });
      setQrCodeUrl(qrUrl);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="light"
        color="grape"
        leftSection={<IconQrcode size={16} />}
        onClick={handleOpen}
      >
        Mostrar código QR
      </Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title="Código de sorteo" centered>
        <Stack align="center" gap="md">
          <Text size="sm" ta="center" c="dimmed">
            Pide al comprador que escanee este código con la cámara de su teléfono para registrar su punto del sorteo.
          </Text>
          {loading || !qrCodeUrl ? (
            <Center h={250} w={250}>
              <Loader />
            </Center>
          ) : (
            <Box p="md" style={{ background: "white", borderRadius: 12, border: "1px solid #eee" }}>
              <img src={qrCodeUrl} alt="Código QR de sorteo" style={{ display: "block" }} />
            </Box>
          )}
        </Stack>
      </Modal>
    </>
  );
}

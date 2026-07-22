import { useState } from "react";
import { Modal, Button, Stack, Text, Box, Loader, Center } from "@mantine/core";
import { IconQrcode } from "@tabler/icons-react";
import QRCode from "qrcode";

interface StandVisitQrModalProps {
  eventId: string;
  companyNit: string;
}

/**
 * Botón + modal para que el representante del stand muestre el QR fijo de
 * visitas. Cualquier asistente lo escanea con la cámara de su teléfono; el QR
 * codifica un enlace a /stand-visit/:eventId/:companyNit (misma idea que el
 * QR de sorteo de RaffleQrModal.tsx). A diferencia del QR de sorteo, este es
 * reutilizable: la deduplicación ocurre del lado de quien escanea, no aquí.
 */
export default function StandVisitQrModal({ eventId, companyNit }: StandVisitQrModalProps) {
  const [opened, setOpened] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const handleOpen = async () => {
    setOpened(true);
    if (qrCodeUrl) return;
    setLoading(true);
    try {
      const scanUrl = `${window.location.origin}/stand-visit/${eventId}/${companyNit}`;
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
        Mostrar código QR del stand
      </Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title="Código de visita al stand" centered>
        <Stack align="center" gap="md">
          <Text size="sm" ta="center" c="dimmed">
            Pide al asistente que escanee este código con la cámara de su teléfono para registrar su visita a tu stand.
          </Text>
          {loading || !qrCodeUrl ? (
            <Center h={250} w={250}>
              <Loader />
            </Center>
          ) : (
            <Box p="md" style={{ background: "white", borderRadius: 12, border: "1px solid #eee" }}>
              <img src={qrCodeUrl} alt="Código QR de visita al stand" style={{ display: "block" }} />
            </Box>
          )}
        </Stack>
      </Modal>
    </>
  );
}

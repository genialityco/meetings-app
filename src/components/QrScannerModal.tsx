import { useEffect, useRef, useState, useId } from "react";
import { Modal, Text, Loader, Center, Stack, Alert } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";

interface QrScannerModalProps {
  opened: boolean;
  onClose: () => void;
  onDecode: (text: string) => void;
  title?: string;
  hint?: string;
}

// Ventana para ignorar el mismo código re-leído en frames consecutivos
// mientras sigue dentro de cuadro (la cámara permanece activa entre escaneos
// para poder pasar varias credenciales seguidas sin cerrar el modal).
const DEBOUNCE_MS = 2000;

export default function QrScannerModal({
  opened,
  onClose,
  onDecode,
  title = "Escanear código QR",
  hint = "Apunta la cámara al código QR de la credencial.",
}: QrScannerModalProps) {
  const elementId = useId().replace(/:/g, "");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const onDecodeRef = useRef(onDecode);
  onDecodeRef.current = onDecode;

  useEffect(() => {
    if (!opened) return;
    setError(null);
    setStarting(true);

    // Import dinámico: html5-qrcode pesa ~100 kB gzip y solo se necesita con el
    // modal abierto — así no se carga con el dashboard de eventos que no escanean.
    let scanner: any = null;
    let cancelled = false;
    let lastDecoded: { text: string; time: number } | null = null;

    import("html5-qrcode")
      .then(({ Html5Qrcode }) => {
        if (cancelled) return;
        scanner = new Html5Qrcode(elementId);
        return scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText: string) => {
            const now = Date.now();
            if (lastDecoded && lastDecoded.text === decodedText && now - lastDecoded.time < DEBOUNCE_MS) {
              return;
            }
            lastDecoded = { text: decodedText, time: now };
            onDecodeRef.current(decodedText);
          },
          () => {
            // Ignorar errores de decodificación por frame (normal mientras enfoca)
          }
        );
      })
      .then(() => {
        if (!cancelled) setStarting(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setStarting(false);
        setError(
          err?.name === "NotAllowedError"
            ? "Debes permitir el acceso a la cámara para escanear."
            : "No se pudo iniciar la cámara. Verifica que el dispositivo tenga una disponible."
        );
      });

    return () => {
      cancelled = true;
      if (scanner) {
        scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => {});
      }
    };
  }, [opened, elementId]);

  return (
    <Modal opened={opened} onClose={onClose} title={title} centered size="sm" keepMounted>
      <Stack align="center" gap="sm">
        {error ? (
          <Alert color="red" icon={<IconAlertCircle size={16} />} title="No se pudo escanear">
            {error}
          </Alert>
        ) : (
          <>
            {starting && (
              <Center py="md">
                <Loader size="sm" />
              </Center>
            )}
            <div id={elementId} style={{ width: "100%" }} />
            <Text size="xs" c="dimmed" ta="center">
              {hint}
            </Text>
          </>
        )}
      </Stack>
    </Modal>
  );
}

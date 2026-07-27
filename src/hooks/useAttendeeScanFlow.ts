import { useCallback, useState } from "react";
import { showNotification } from "@mantine/notifications";
import { parseAttendeeQrUrl } from "../utils/qrScan";

export interface ScanLookupResult<T> {
  attendee: T;
  alreadyDoneMessage?: string;
}

interface UseAttendeeScanFlowOptions<T> {
  /** Busca y valida al asistente escaneado; NO debe escribir nada todavía. */
  lookup: (userId: string, scannedEventId: string | null) => Promise<ScanLookupResult<T> | { error: string }>;
  /** Confirma la acción (check-in, registrar visita, etc.) sobre el asistente ya revisado. */
  confirm: (attendee: T) => Promise<{ message: string } | { error: string }>;
}

/**
 * Estado compartido para el patrón "escanear -> mostrar info -> confirmar
 * acción -> mensaje de éxito -> seguir escaneando", usado tanto por el check-in
 * (CheckInTab.jsx) como por el registro de visitas a stand (MyCompanyTab.tsx).
 * Los errores de lookup no cierran el escáner (se puede reintentar de una);
 * un lookup exitoso sí lo cierra para mostrar la tarjeta de revisión.
 */
export function useAttendeeScanFlow<T = any>({ lookup, confirm }: UseAttendeeScanFlowOptions<T>) {
  const [scannerOpened, setScannerOpened] = useState(false);
  const [reviewing, setReviewing] = useState<ScanLookupResult<T> | null>(null);
  const [confirming, setConfirming] = useState(false);

  const handleDecode = useCallback(
    async (text: string) => {
      const parsed = parseAttendeeQrUrl(text);
      if (!parsed) {
        showNotification({ title: "Código no reconocido", message: "Este QR no es una credencial válida.", color: "red" });
        return;
      }
      const result = await lookup(parsed.userId, parsed.eventId);
      if ("error" in result) {
        showNotification({ title: "No se pudo procesar", message: result.error, color: "red" });
        return;
      }
      setScannerOpened(false);
      setReviewing(result);
    },
    [lookup],
  );

  const closeReview = useCallback(() => {
    setReviewing(null);
    setScannerOpened(true);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!reviewing) return;
    setConfirming(true);
    try {
      const result = await confirm(reviewing.attendee);
      if ("error" in result) {
        showNotification({ title: "No se pudo registrar", message: result.error, color: "red" });
        return;
      }
      showNotification({ title: "Listo", message: result.message, color: "teal" });
      setReviewing(null);
      setScannerOpened(true);
    } finally {
      setConfirming(false);
    }
  }, [reviewing, confirm]);

  return {
    scannerOpened,
    setScannerOpened,
    reviewing,
    confirming,
    handleDecode,
    handleConfirm,
    closeReview,
  };
}

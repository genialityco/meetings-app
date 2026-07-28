/**
 * Extrae {eventId, userId} de un texto de QR escaneado. La credencial actual
 * (BadgePage.tsx) codifica solo el uid del asistente como texto plano (no un
 * enlace) — por eso eventId viene null en ese caso, y el llamador debe validar
 * el evento comparando contra su propia lista de asistentes. Se conservan los
 * patrones de enlace (/admin/event/:eventId/checkin/:userId, /badge/:eventId/:userId)
 * para credenciales ya impresas antes de este cambio.
 */
export function parseAttendeeQrUrl(text: string): { eventId: string | null; userId: string } | null {
  if (!text) return null;
  const patterns = [
    /\/admin\/event\/([^/]+)\/checkin\/([^/?#]+)/,
    /\/badge\/([^/]+)\/([^/?#]+)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return { eventId: decodeURIComponent(match[1]), userId: decodeURIComponent(match[2]) };
    }
  }
  const trimmed = text.trim();
  if (/^[A-Za-z0-9_-]{10,64}$/.test(trimmed)) {
    return { eventId: null, userId: trimmed };
  }
  return null;
}

/**
 * Extrae {eventId, companyNit} del QR fijo de un stand (StandVisitQrModal.tsx),
 * que codifica un enlace a /stand-visit/:eventId/:companyNit. Permite que el
 * asistente escanee el QR del stand desde dentro de la app (sesión garantizada)
 * en vez de depender de la cámara nativa del teléfono.
 */
export function parseStandVisitQrUrl(text: string): { eventId: string; companyNit: string } | null {
  if (!text) return null;
  const match = text.match(/\/stand-visit\/([^/]+)\/([^/?#]+)/);
  if (!match) return null;
  return { eventId: decodeURIComponent(match[1]), companyNit: decodeURIComponent(match[2]) };
}

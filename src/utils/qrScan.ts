/**
 * Extrae {eventId, userId} de un texto de QR escaneado. Los QR de credencial
 * (BadgePage.tsx) apuntan a /admin/event/:eventId/checkin/:userId o a
 * /badge/:eventId/:userId — cualquiera de los dos formatos sirve como
 * identificador de asistente, sin importar quién escanee ni para qué.
 */
export function parseAttendeeQrUrl(text: string): { eventId: string; userId: string } | null {
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
  return null;
}

/**
 * Extrae {eventId, userId} de un texto de QR escaneado. La credencial actual
 * (BadgePage.tsx) codifica un link a la página de "visita de perfil" del asistente
 * (la empresa si tiene una asociada, si no su propia escarapela) con el uid como
 * query param `visitante` — así, escaneada con la cámara nativa de un celular abre
 * esa página, pero el escáner del admin (este parser) sigue pudiendo sacar el uid
 * para hacer la búsqueda/check-in normal. Se conservan los patrones de enlace viejos
 * (/admin/event/:eventId/checkin/:userId, /badge/:eventId/:userId) y el uid como
 * texto plano sin link (eventId null, el llamador valida el evento) para credenciales
 * ya impresas antes de estos cambios.
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
  const companyVisitMatch = text.match(/\/dashboard\/([^/]+)\/company\/[^/?#]+\?[^#]*\bvisitante=([^&#]+)/);
  if (companyVisitMatch) {
    return { eventId: decodeURIComponent(companyVisitMatch[1]), userId: decodeURIComponent(companyVisitMatch[2]) };
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

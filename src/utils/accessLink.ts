/**
 * Link de acceso directo de un asistente: abre AutoLoginPage (/acceso/:eventId/:userId),
 * que inicia su sesión sin pedir correo y lo lleva al dashboard del evento.
 * `origin` es el dominio público de la app (VITE_PUBLIC_APP_URL) para que un link
 * generado desde localhost o un preview no apunte a ese dominio.
 */
export const getAccessOrigin = () =>
  ((import.meta.env.VITE_PUBLIC_APP_URL as string) || window.location.origin).replace(/\/+$/, "");

export const buildAccessLink = (eventId: string, userId: string, origin = getAccessOrigin()) =>
  `${origin}/acceso/${encodeURIComponent(eventId)}/${encodeURIComponent(userId)}`;

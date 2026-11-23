// Link al dashboard abierto en "Mis reuniones" → Agenda, en el día de una reunión
// y con esa reunión resaltada. Lo leen TabsPanel (abre la vista) y CalendarTab
// (selecciona el día y hace scroll a la reunión).

export const AGENDA_MEETING_PARAM = "agendaMeeting";
export const AGENDA_DATE_PARAM = "agendaDate";

export interface AgendaFocus {
  meetingId?: string;
  date?: string;
  /** Cambia en cada petición para re-disparar el foco aunque sea la misma reunión */
  _k: number;
}

/** Ruta relativa al dashboard del evento con el foco en la reunión. */
export function buildAgendaLink(
  eventId: string,
  meeting: { id?: string; meetingDate?: string } | null | undefined,
): string {
  const params = new URLSearchParams();
  if (meeting?.id) params.set(AGENDA_MEETING_PARAM, meeting.id);
  if (meeting?.meetingDate) params.set(AGENDA_DATE_PARAM, meeting.meetingDate);
  const qs = params.toString();
  return `/dashboard/${eventId}${qs ? `?${qs}` : ""}`;
}

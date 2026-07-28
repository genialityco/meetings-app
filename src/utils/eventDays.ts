/** Clave usada como único "día" para eventos sin eventDates/eventDate configurados. */
export const DEFAULT_CHECKIN_DAY = "unico";

/** Lista de fechas (YYYY-MM-DD) del evento, a partir de event.config. */
export function getEventDayKeys(eventConfig: any): string[] {
  if (eventConfig?.eventDates?.length) return eventConfig.eventDates;
  if (eventConfig?.eventDate) return [String(eventConfig.eventDate).trim()];
  return [];
}

/** Elige el día de check-in por defecto: el día preferido si es válido, si no
 * el de hoy si coincide con algún día del evento, si no el primer día. */
export function resolveCheckInDay(eventConfig: any, preferredDate?: string | null): string {
  const days = getEventDayKeys(eventConfig);
  if (days.length === 0) return DEFAULT_CHECKIN_DAY;
  if (preferredDate && days.includes(preferredDate)) return preferredDate;
  const today = new Date().toISOString().slice(0, 10);
  if (days.includes(today)) return today;
  return days[0];
}

export function isCheckedInOnDay(attendee: any, day: string | null | undefined): boolean {
  if (!day) return false;
  return !!attendee?.checkIns?.[day];
}

export function formatDayLabel(day: string, index: number): string {
  if (day === DEFAULT_CHECKIN_DAY) return "Día único";
  const parts = day.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return `Día ${index + 1}`;
  const [y, m, d] = parts;
  const date = new Date(y, m - 1, d);
  const label = date.toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" });
  return `Día ${index + 1} — ${label}`;
}

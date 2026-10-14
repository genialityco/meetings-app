/** Clave usada como único "día" para eventos sin eventDates/eventDate configurados. */
export const DEFAULT_CHECKIN_DAY = "unico";

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria local del dispositivo. No usar
 * toISOString(): está en UTC, y en Colombia (UTC-5) desde las 7:00 pm ya devuelve
 * el día siguiente. */
export function getTodayKey(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

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
  const today = getTodayKey();
  if (days.includes(today)) return today;
  return days[0];
}

export function isCheckedInOnDay(attendee: any, day: string | null | undefined): boolean {
  if (!day) return false;
  return !!attendee?.checkIns?.[day];
}

/** Un día queda "bloqueado" para editar (solo consulta) si ya pasó respecto a hoy.
 * El día único de eventos sin fechas nunca se bloquea. */
export function isPastCheckInDay(day: string | null | undefined): boolean {
  if (!day || day === DEFAULT_CHECKIN_DAY) return false;
  const today = getTodayKey();
  return day < today;
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

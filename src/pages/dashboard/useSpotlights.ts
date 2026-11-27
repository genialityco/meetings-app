import { useEffect, useMemo, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import {
  type Spotlight,
  spotlightsCol,
  isSpotlightLive,
  presentedToday,
  hasSpotlightEnded,
  spotlightEndsMs,
  spotlightStartedMs,
} from "../../utils/spotlight";

export interface SpotlightsState {
  /** En vivo ahora (normalmente uno), en el orden en que se activaron */
  live: Spotlight[];
  /** Terminados hoy, el más reciente primero */
  presentedToday: Spotlight[];
  /** Ids (uid / companyId) que ya se presentaron en cualquier día del evento */
  presentedTargetIds: Set<string>;
  all: Spotlight[];
}

/** Suscripción en tiempo real a los destacados del evento (colección pequeña: decenas de docs) */
export function useSpotlights(eventId?: string): SpotlightsState {
  const [all, setAll] = useState<Spotlight[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!eventId) return;
    return onSnapshot(
      spotlightsCol(eventId),
      (snap) => setAll(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Spotlight)),
      (err) => console.error("Error cargando destacados:", err),
    );
  }, [eventId]);

  // Apagado automático: se re-evalúa justo cuando vence el próximo destacado con límite
  const nextEnd = useMemo(() => {
    const ends = all
      .filter((s) => isSpotlightLive(s, now))
      .map(spotlightEndsMs)
      .filter((ms): ms is number => ms != null);
    return ends.length ? Math.min(...ends) : null;
  }, [all, now]);

  useEffect(() => {
    if (nextEnd == null) return;
    const t = setTimeout(() => setNow(Date.now()), Math.max(0, nextEnd - Date.now()) + 250);
    return () => clearTimeout(t);
  }, [nextEnd]);

  // Un snapshot nuevo también refresca "now" (ej. el admin activó uno)
  useEffect(() => setNow(Date.now()), [all]);

  return useMemo(() => {
    const live = all
      .filter((s) => isSpotlightLive(s, now))
      .sort((a, b) => spotlightStartedMs(a) - spotlightStartedMs(b));
    const today = all
      .filter((s) => presentedToday(s, now))
      .sort((a, b) => spotlightStartedMs(b) - spotlightStartedMs(a));
    const presentedTargetIds = new Set(all.filter((s) => hasSpotlightEnded(s, now)).map((s) => s.targetId));
    return { live, presentedToday: today, presentedTargetIds, all };
  }, [all, now]);
}

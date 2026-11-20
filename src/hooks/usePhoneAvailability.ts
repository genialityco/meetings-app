import { useCallback, useEffect, useRef, useState } from "react";
import { checkPhoneAvailability, type PhoneAvailability } from "../utils/phoneLogin";
import { toWhatsAppNumber } from "../utils/phoneUtils";

export type PhoneCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available" }
  | ({ status: "registered" } & Extract<PhoneAvailability, { registered: true }>)
  /** La consulta falló: no se bloquea el registro por un error de red */
  | { status: "error" };

const DEBOUNCE_MS = 600;

/**
 * Consulta (con debounce y cache por número) si el teléfono ya está registrado en el
 * evento por otro asistente. Solo consulta cuando el número es válido para WhatsApp.
 * `verifyNow` repite la consulta sin esperar el debounce (para el submit).
 */
export function usePhoneAvailability(
  eventId: string | undefined,
  phone: string | undefined,
  currentUserId?: string | null,
) {
  const [state, setState] = useState<PhoneCheckState>({ status: "idle" });
  const cache = useRef(new Map<string, PhoneCheckState>());
  const normalized = phone ? toWhatsAppNumber(phone) : "";

  const run = useCallback(
    async (num: string): Promise<PhoneCheckState> => {
      if (!eventId || !num) return { status: "idle" };
      const key = `${eventId}|${currentUserId || ""}|${num}`;
      const cached = cache.current.get(key);
      if (cached) return cached;
      try {
        const r = await checkPhoneAvailability(eventId, num, currentUserId);
        const next: PhoneCheckState = r.registered ? { status: "registered", ...r } : { status: "available" };
        cache.current.set(key, next);
        return next;
      } catch (e) {
        console.error("[usePhoneAvailability] Error consultando teléfono:", e);
        return { status: "error" };
      }
    },
    [eventId, currentUserId],
  );

  useEffect(() => {
    if (!normalized) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "checking" });
    const t = setTimeout(async () => {
      const next = await run(normalized);
      if (!cancelled) setState(next);
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [normalized, run]);

  const verifyNow = useCallback(async () => {
    const next = await run(normalized);
    setState(next);
    return next;
  }, [normalized, run]);

  return { state, verifyNow };
}

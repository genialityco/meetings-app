import { useEffect, useState } from "react";
import {
  fetchSmartSearch,
  MIN_SEARCH_LENGTH,
  normalizeSearchText,
  type SmartSearchKind,
} from "../utils/smartSearch";

const DEBOUNCE_MS = 400;

export interface SmartSearchState {
  /** Coseno de los más cercanos (vacío sin búsqueda, mientras carga o si falló) */
  scores: Map<string, number>;
  /** Puntaje mínimo para que algo cuente como resultado por significado */
  cutoff: number;
  loading: boolean;
  /** La búsqueda por significado falló: la vista sigue funcionando con la exacta */
  failed: boolean;
  /** Consulta a la que corresponden `scores` (mientras se escribe, el texto del buscador ya es otro) */
  query: string;
}

const EMPTY: SmartSearchState = { scores: new Map(), cutoff: 1, loading: false, failed: false, query: "" };

/**
 * Puntajes por significado de la búsqueda (Cloud Function smartSearch) para la vista de empresas o
 * de asistentes. Con debounce y cancelando la consulta anterior al seguir escribiendo.
 */
export function useSmartSearch(
  eventId: string | undefined,
  kind: SmartSearchKind,
  term: string,
  enabled: boolean,
): SmartSearchState {
  const [state, setState] = useState<SmartSearchState>(EMPTY);
  const query = term.trim();
  const active = enabled && !!eventId && normalizeSearchText(query).length >= MIN_SEARCH_LENGTH;

  useEffect(() => {
    if (!active || !eventId) {
      setState(EMPTY);
      return;
    }
    const controller = new AbortController();
    // Mientras se escribe se mantienen los puntajes anteriores (la lista no salta) y se marca carga.
    setState((prev) => ({ ...prev, loading: true, failed: false }));
    const timer = setTimeout(async () => {
      try {
        const { scores, cutoff } = await fetchSmartSearch(eventId, kind, query, controller.signal);
        if (!controller.signal.aborted) setState({ scores, cutoff, loading: false, failed: false, query });
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("smartSearch error:", err);
        setState({ ...EMPTY, failed: true });
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, eventId, kind, query]);

  return active ? state : EMPTY;
}

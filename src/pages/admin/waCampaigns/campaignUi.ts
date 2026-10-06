export const CAMPAIGN_STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: "Incompleta", color: "gray" },
  queued: { label: "En cola", color: "blue" },
  running: { label: "Enviando", color: "teal" },
  paused: { label: "Pausada", color: "yellow" },
  completed: { label: "Completada", color: "green" },
};

export const formatTs = (ts: any) => (ts?.toDate ? ts.toDate().toLocaleString("es-CO") : "-");

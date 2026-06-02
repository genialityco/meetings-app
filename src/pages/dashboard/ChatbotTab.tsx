import { Card, Box } from "@mantine/core";

export default function ChatbotTab({
  currentUser,
  eventId,
}: {
  currentUser: any;
  eventId?: string;
  sendMeetingRequest?: any;
  solicitarReunionHabilitado?: any;
}) {
  const userId = currentUser?.uid || "";
  const userName = encodeURIComponent(currentUser?.data?.nombre || "Usuario");
  
  // Usar la URL de entorno o fallback a localhost
  const WIDGET_URL = import.meta.env.VITE_AI_PROXY_URL 
    ? `${import.meta.env.VITE_AI_PROXY_URL}/widget/networking`
    : "http://localhost:8001/widget/networking";
    
  const apiKey = "HAszbuE3RyxZPCd15SolY61DsOm9Z3ylPOEOOPtT_p0";

  const iframeSrc = `${WIDGET_URL}?api_key=${apiKey}&user_id=${userId}&user_name=${userName}&event_id=${eventId || ""}`;

  return (
    <Card shadow="sm" radius="lg" withBorder h="80vh" padding={0} style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box style={{ flex: 1, width: "100%", height: "100%" }}>
        <iframe
          src={iframeSrc}
          width="100%"
          height="100%"
          frameBorder="0"
          allow="clipboard-write"
          title="Asistente Virtual"
          style={{ display: "block" }}
        />
      </Box>
    </Card>
  );
}

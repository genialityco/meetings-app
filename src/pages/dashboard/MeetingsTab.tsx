// Dashboard/MeetingsTab.tsx
import { Stack, Card, Text, Group, Button, Collapse } from "@mantine/core";
import { Assistant, Meeting, ParticipantInfo } from "./types";

interface MeetingsTabProps {
  acceptedMeetings: Meeting[];
  participantsInfo: { [userId: string]: ParticipantInfo };
  uid: string;
  expandedMeetingId: string | null;
  setExpandedMeetingId: (id: string | null) => void;
  downloadVCard: (participant: Assistant) => void;
  sendWhatsAppMessage: (participant: Assistant) => void;
  prepareSlotSelection: (meetingId: string, isEdit?: boolean) => void;
}

export default function MeetingsTab({
  acceptedMeetings,
  participantsInfo,
  uid,
  expandedMeetingId,
  setExpandedMeetingId,
  downloadVCard,
  sendWhatsAppMessage,
  prepareSlotSelection,
}: MeetingsTabProps) {
  return (
    <Stack>
      {acceptedMeetings.length > 0 ? (
        acceptedMeetings
          .slice()
          .sort((a, b) => {
            // Ordena por hora de inicio
            const [aStart] = (a.timeSlot || "").split(" - ");
            const [bStart] = (b.timeSlot || "").split(" - ");
            const [aH, aM] = aStart ? aStart.split(":").map(Number) : [0, 0];
            const [bH, bM] = bStart ? bStart.split(":").map(Number) : [0, 0];
            return aH * 60 + aM - (bH * 60 + bM);
          })
          .map((meeting) => {
            const otherUserId =
              meeting.requesterId === uid
                ? meeting.receiverId
                : meeting.requesterId;
            const participant = participantsInfo[otherUserId];
            return (
              <Card key={meeting.id} shadow="sm" p="lg">
                <Text>
                  <strong>Reunión con:</strong>{" "}
                  {participant ? participant.empresa : "Cargando..."}
                </Text>
                <Text>
                  <strong>Horario:</strong> {meeting.timeSlot || "Por asignar"}
                </Text>
                <Text>
                  <strong>Mesa:</strong>{" "}
                  {meeting.tableAssigned || "Por asignar"}
                </Text>
                <Collapse in={expandedMeetingId === meeting.id} mt="sm">
                  {participant && (
                    <>
                      <Text size="sm">
                        🏢 <strong>Empresa:</strong> {participant.empresa}
                      </Text>
                                            <Text size="sm">
                        🏢 <strong>Asistente:</strong> {participant.nombre}
                      </Text>
                      <Text size="sm">
                        🏷 <strong>Cargo:</strong> {participant.cargo}
                      </Text>
                      <Text size="sm">
                        📧 <strong>Correo:</strong>{" "}
                        {participant.correo || "No disponible"}
                      </Text>
                      <Text size="sm">
                        📞 <strong>Teléfono:</strong>{" "}
                        {participant.telefono || "No disponible"}
                      </Text>
                      <Text size="sm">
                        📝 <strong>Descripción:</strong>{" "}
                        {participant.descripcion || "No especificada"}
                      </Text>
                      <Text size="sm">
                        🎯 <strong>Interés Principal:</strong>{" "}
                        {participant.interesPrincipal || "No especificado"}
                      </Text>
                      <Text size="sm">
                        🔍 <strong>Necesidad:</strong>{" "}
                        {participant.necesidad || "No especificada"}
                      </Text>
                    </>
                  )}
                </Collapse>
                {participant && (
                  <Group mt="sm">
                    <Button
                      variant="outline"
                      onClick={() => downloadVCard(participant)}
                    >
                      Agregar a Contactos
                    </Button>
                    <Button
                      variant="outline"
                      color="green"
                      onClick={() => sendWhatsAppMessage(participant)}
                    >
                      Enviar WhatsApp
                    </Button>
                    <Button
                      variant="subtle"
                      onClick={() =>
                        setExpandedMeetingId(
                          expandedMeetingId === meeting.id ? null : meeting.id
                        )
                      }
                    >
                      {expandedMeetingId === meeting.id
                        ? "Ocultar info"
                        : "Ver más info"}
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => prepareSlotSelection(meeting.id, true)}
                    >
                      Editar hora
                    </Button>
                  </Group>
                )}
              </Card>
            );
          })
      ) : (
        <Text>No tienes reuniones aceptadas.</Text>
      )}
    </Stack>
  );
}

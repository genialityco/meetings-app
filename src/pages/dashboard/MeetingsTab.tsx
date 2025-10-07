import { useState, useContext } from "react";
import {
  Stack,
  Card,
  Text,
  Group,
  Button,
  Collapse,
  Modal,
  TextInput,
  Textarea,
  Loader,
} from "@mantine/core";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig"; // Ajusta el path
import { UserContext } from "../../context/UserContext";
import { showNotification } from "@mantine/notifications";

export default function MeetingsTab({
  acceptedMeetings,
  participantsInfo,
  uid,
  expandedMeetingId,
  setExpandedMeetingId,
  downloadVCard,
  sendWhatsAppMessage,
  prepareSlotSelection,
  loadingMeetings,
  cancelMeeting,
}) {
  const { currentUser } = useContext(UserContext);

  // Modal y encuesta
  const [surveyModal, setSurveyModal] = useState({
    open: false,
    meeting: null,
  });
  const [surveyValue, setSurveyValue] = useState("");
  const [surveyComments, setSurveyComments] = useState("");
  const [savingSurvey, setSavingSurvey] = useState(false);
  const [userSurveys, setUserSurveys] = useState({}); // meetingId: {value, comments}
  const [loadingSurvey, setLoadingSurvey] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);

  // Abrir modal, carga datos o limpia
  const handleOpenSurvey = async (meeting) => {
    setSurveyModal({ open: true, meeting });
    setLoadingSurvey(true);
    try {
      const surveyDoc = await getDoc(
        doc(db, "meetingSurveys", `${meeting.id}_${currentUser.uid}`)
      );
      if (surveyDoc.exists()) {
        const data = surveyDoc.data();
        setSurveyValue(data.value || "");
        setSurveyComments(data.comments || "");
        setUserSurveys((prev) => ({ ...prev, [meeting.id]: data }));
      } else {
        setSurveyValue("");
        setSurveyComments("");
      }
    } catch (err) {
      setSurveyValue("");
      setSurveyComments("");
    }
    setLoadingSurvey(false);
  };

  // Guardar solo si no existe respuesta previa
  const handleSaveSurvey = async () => {
    setSavingSurvey(true);
    try {
      const meeting = surveyModal.meeting;
      const myId = currentUser.uid;
      const myInfo = participantsInfo[myId] || currentUser.data;
      const otherId =
        meeting.requesterId === myId ? meeting.receiverId : meeting.requesterId;
      const otherInfo = participantsInfo[otherId];

      await setDoc(doc(db, "meetingSurveys", `${meeting.id}_${myId}`), {
        meetingId: meeting.id,
        userId: myId, // quien responde
        userName: myInfo?.nombre || "",
        userEmpresa: myInfo?.empresa || "",
        otherUserId: otherId,
        otherUserName: otherInfo?.nombre || "",
        otherUserEmpresa: otherInfo?.empresa || "",
        value: surveyValue,
        comments: surveyComments,
        createdAt: new Date(),
      });
      setUserSurveys((prev) => ({
        ...prev,
        [meeting.id]: {
          value: surveyValue,
          comments: surveyComments,
        },
      }));
      setSurveyModal({ open: false, meeting: null });
    } catch (err) {
      alert("Error guardando la encuesta");
    }
    setSavingSurvey(false);
  };

  async function findSlotIdForMeeting(eventId, tableAssigned, timeSlot) {
    const q = query(
      collection(db, "agenda"),
      where("eventId", "==", eventId),
      where("tableNumber", "==", Number(tableAssigned)),
      where("startTime", "==", timeSlot.split(" - ")[0]),
      where("endTime", "==", timeSlot.split(" - ")[1])
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      return snap.docs[0].id;
    }
    return null;
  }

  const handleCancelMeeting = async (meeting) => {
    if (!window.confirm("¿Seguro que deseas cancelar esta reunión?")) return;
    setCancellingId(meeting.id);
    try {
      // Buscar slotId usando tableAssigned y timeSlot
      const slotId = await findSlotIdForMeeting(
        meeting.eventId,
        meeting.tableAssigned,
        meeting.timeSlot
      );
      await cancelMeeting({ ...meeting, slotId });
      showNotification({
        title: "Reunión cancelada",
        message: "Se notificó a ambos participantes.",
        color: "teal",
      });
    } catch (err) {
      alert("Error al cancelar la reunión");
      console.error("Error en handleCancelMeeting:", err);
    } finally {
      setCancellingId(null);
    }
  };

  if (loadingMeetings) {
    return <Text>Cargando reuniones...</Text>;
  }

  // ¿Ya respondió el usuario esta encuesta?
  const surveyExists = (meetingId) => !!userSurveys[meetingId];

  return (
    <>
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
                <Card key={meeting.id} shadow="sm" p="lg" mb="sm">
                  <Text>
                    <strong>Reunión con:</strong>{" "}
                    {participant ? participant.empresa : "Cargando..."}
                  </Text>
                  <Text>
                    <strong>Asistente:</strong>{" "}
                    {participant ? participant.nombre : "Cargando..."}
                  </Text>
                  <Text>
                    <strong>Horario:</strong>{" "}
                    {meeting.timeSlot || "Por asignar"}
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
                      {/* Encuesta: solo botón para abrir modal */}
                      <Button
                        color={surveyExists(meeting.id) ? "gray" : "violet"}
                        variant={
                          surveyExists(meeting.id) ? "outline" : "filled"
                        }
                        onClick={() => handleOpenSurvey(meeting)}
                      >
                        {surveyExists(meeting.id)
                          ? "Ver encuesta"
                          : "Llenar encuesta"}
                      </Button>
                      <Button
                        variant="outline"
                        color="red"
                        loading={cancellingId === meeting.id}
                        onClick={() => handleCancelMeeting(meeting)}
                        disabled={cancellingId === meeting.id}
                      >
                        Cancelar reunión
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

      {/* Modal de encuesta */}
      <Modal
        opened={surveyModal.open}
        onClose={() => setSurveyModal({ open: false, meeting: null })}
        title="Encuesta de reunión"
      >
        {loadingSurvey ? (
          <Loader />
        ) : surveyExists(surveyModal.meeting?.id) ? (
          <>
            <Text fw={700} mb="md">
              Tus respuestas de encuesta
            </Text>
            <Text mb="xs">
              <b>Valor estimado:</b>{" "}
              {userSurveys[surveyModal.meeting.id]?.value}
            </Text>
            <Text>
              <b>Comentarios:</b>{" "}
              {userSurveys[surveyModal.meeting.id]?.comments}
            </Text>
          </>
        ) : (
          <>
            <TextInput
              label="Estimado valor del negocio"
              value={surveyValue}
              onChange={(e) => setSurveyValue(e.currentTarget.value)}
              mb="md"
              required
            />
            <Textarea
              label="Comentarios"
              value={surveyComments}
              onChange={(e) => setSurveyComments(e.currentTarget.value)}
              mb="md"
              minRows={3}
              required
            />
            <Group mt="md" grow>
              <Button
                variant="outline"
                onClick={() => setSurveyModal({ open: false, meeting: null })}
              >
                Cancelar
              </Button>
              <Button
                loading={savingSurvey}
                onClick={handleSaveSurvey}
                disabled={!surveyValue}
              >
                Guardar
              </Button>
            </Group>
          </>
        )}
      </Modal>
    </>
  );
}

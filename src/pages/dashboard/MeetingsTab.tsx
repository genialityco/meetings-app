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
  Badge,
  Avatar,
  Title,
  Divider,
  ThemeIcon,
  Box,
  Paper,
  Grid,
  useMantineTheme,
} from "@mantine/core";
import {
  IconClock,
  IconTable,
  IconBuildingStore,
  IconUser,
  IconBriefcase,
  IconMail,
  IconPhone,
  IconFileDescription,
  IconTargetArrow,
  IconBulb,
  IconAddressBook,
  IconBrandWhatsapp,
  IconChevronDown,
  IconChevronUp,
  IconClipboardCheck,
  IconX,
  IconNote,
} from "@tabler/icons-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { UserContext } from "../../context/UserContext";
import { showNotification } from "@mantine/notifications";

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
}) {
  return (
    <Group gap={8} wrap="nowrap" align="flex-start">
      <ThemeIcon variant="light" radius="xl" size={26}>
        {icon}
      </ThemeIcon>
      <Text size="sm" style={{ minWidth: 0 }} lineClamp={2}>
        <Text span fw={700}>
          {label}:
        </Text>{" "}
        {value && String(value).trim().length > 0 ? value : "No disponible"}
      </Text>
    </Group>
  );
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
  loadingMeetings,
  cancelMeeting,
}) {
  const { currentUser } = useContext(UserContext);
  const theme = useMantineTheme();

  const [surveyModal, setSurveyModal] = useState({
    open: false,
    meeting: null,
  });
  const [surveyValue, setSurveyValue] = useState("");
  const [surveyComments, setSurveyComments] = useState("");
  const [savingSurvey, setSavingSurvey] = useState(false);
  const [userSurveys, setUserSurveys] = useState({});
  const [loadingSurvey, setLoadingSurvey] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);

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
        userId: myId,
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
      collection(db, "events", eventId, "agenda"),
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
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    );
  }

  const surveyExists = (meetingId) => !!userSurveys[meetingId];

  return (
    <>
      <Grid gutter="sm">
        {acceptedMeetings.length > 0 ? (
          acceptedMeetings
            .slice()
            .sort((a, b) => {
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
              const isExpanded = expandedMeetingId === meeting.id;

              return (
                <Grid.Col span={{ base: 12, sm: 6, lg: 4 }} key={meeting.id}>
                  <Card
                    withBorder
                    radius="xl"
                    padding="md"
                    shadow="sm"
                    style={{
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    {/* Header */}
                    <Group wrap="nowrap" align="center" gap="sm">
                      <Avatar
                        src={participant?.photoURL}
                        radius="xl"
                        size={52}
                        color={theme.primaryColor}
                      >
                        {(participant?.nombre || "R")[0]?.toUpperCase()}
                      </Avatar>

                      <Box style={{ minWidth: 0, flex: 1 }}>
                        <Title order={6} lineClamp={1}>
                          {participant?.empresa || "Cargando..."}
                        </Title>
                        <Text size="sm" c="dimmed" lineClamp={1}>
                          {participant?.nombre || "Cargando..."}
                          {participant?.cargo ? ` • ${participant.cargo}` : ""}
                        </Text>
                      </Box>
                    </Group>

                    <Divider my="sm" />

                    {/* Slot info */}
                    <Stack gap={8}>
                      <InfoRow
                        icon={<IconClock size={14} />}
                        label="Horario"
                        value={meeting.timeSlot || "Por asignar"}
                      />
                      <InfoRow
                        icon={<IconTable size={14} />}
                        label="Mesa"
                        value={
                          meeting.tableAssigned
                            ? String(meeting.tableAssigned)
                            : "Por asignar"
                        }
                      />
                    </Stack>

                    {meeting.contextNote && (
                      <Badge
                        variant="light"
                        color="grape"
                        size="sm"
                        mt="xs"
                        radius="md"
                      >
                        <Group gap={4} wrap="nowrap">
                          <IconNote size={12} />
                          {meeting.contextNote}
                        </Group>
                      </Badge>
                    )}

                    {/* Expandable details */}
                    <Collapse in={isExpanded} mt="sm">
                      {participant && (
                        <Paper withBorder radius="lg" p="sm" bg="gray.0">
                          <Stack gap={8}>
                            <InfoRow
                              icon={<IconBuildingStore size={14} />}
                              label="Empresa"
                              value={participant.empresa}
                            />
                            <InfoRow
                              icon={<IconBriefcase size={14} />}
                              label="Cargo"
                              value={participant.cargo}
                            />
                            <InfoRow
                              icon={<IconMail size={14} />}
                              label="Correo"
                              value={participant.correo}
                            />
                            <InfoRow
                              icon={<IconPhone size={14} />}
                              label="Teléfono"
                              value={participant.telefono}
                            />
                            <InfoRow
                              icon={<IconFileDescription size={14} />}
                              label="Descripción"
                              value={participant.descripcion}
                            />
                            <InfoRow
                              icon={<IconTargetArrow size={14} />}
                              label="Interés"
                              value={participant.interesPrincipal}
                            />
                            <InfoRow
                              icon={<IconBulb size={14} />}
                              label="Necesidad"
                              value={participant.necesidad}
                            />
                          </Stack>
                        </Paper>
                      )}
                    </Collapse>

                    {/* Actions */}
                    {participant && (
                      <Stack gap="xs" mt="auto" pt="sm">
                        <Button
                          variant="subtle"
                          size="compact-sm"
                          fullWidth
                          rightSection={
                            isExpanded ? (
                              <IconChevronUp size={14} />
                            ) : (
                              <IconChevronDown size={14} />
                            )
                          }
                          onClick={() =>
                            setExpandedMeetingId(isExpanded ? null : meeting.id)
                          }
                        >
                          {isExpanded ? "Ocultar info" : "Ver más info"}
                        </Button>

                        <Divider />

                        <Group grow gap="xs">
                          <Button
                            variant="light"
                            size="compact-sm"
                            radius="md"
                            leftSection={<IconAddressBook size={14} />}
                            onClick={() => downloadVCard(participant)}
                          >
                            Contacto
                          </Button>
                          <Button
                            variant="light"
                            size="compact-sm"
                            radius="md"
                            color="green"
                            leftSection={<IconBrandWhatsapp size={14} />}
                            onClick={() => sendWhatsAppMessage(participant)}
                          >
                            WhatsApp
                          </Button>
                        </Group>

                        <Group grow gap="xs">
                          <Button
                            size="compact-sm"
                            radius="md"
                            color={surveyExists(meeting.id) ? "gray" : "violet"}
                            variant={
                              surveyExists(meeting.id) ? "light" : "filled"
                            }
                            leftSection={<IconClipboardCheck size={14} />}
                            onClick={() => handleOpenSurvey(meeting)}
                          >
                            {surveyExists(meeting.id)
                              ? "Ver encuesta"
                              : "Encuesta"}
                          </Button>
                          <Button
                            size="compact-sm"
                            radius="md"
                            variant="light"
                            color="red"
                            leftSection={<IconX size={14} />}
                            loading={cancellingId === meeting.id}
                            onClick={() => handleCancelMeeting(meeting)}
                            disabled={cancellingId === meeting.id}
                          >
                            Cancelar
                          </Button>
                        </Group>
                      </Stack>
                    )}
                  </Card>
                </Grid.Col>
              );
            })
        ) : (
          <Grid.Col span={12}>
            <Paper withBorder radius="lg" p="lg">
              <Text c="dimmed" ta="center">
                No tienes reuniones aceptadas.
              </Text>
            </Paper>
          </Grid.Col>
        )}
      </Grid>

      {/* Modal de encuesta */}
      <Modal
        opened={surveyModal.open}
        onClose={() => setSurveyModal({ open: false, meeting: null })}
        title="Encuesta de reunión"
        radius="lg"
      >
        {loadingSurvey ? (
          <Group justify="center" py="md">
            <Loader />
          </Group>
        ) : surveyExists(surveyModal.meeting?.id) ? (
          <Stack gap="md">
            <Text fw={700}>Tus respuestas de encuesta</Text>
            <Paper withBorder radius="md" p="sm">
              <Text size="sm">
                <Text span fw={600}>Valor estimado:</Text>{" "}
                {userSurveys[surveyModal.meeting.id]?.value}
              </Text>
            </Paper>
            <Paper withBorder radius="md" p="sm">
              <Text size="sm">
                <Text span fw={600}>Comentarios:</Text>{" "}
                {userSurveys[surveyModal.meeting.id]?.comments}
              </Text>
            </Paper>
          </Stack>
        ) : (
          <Stack gap="md">
            <TextInput
              label="Estimado valor del negocio"
              value={surveyValue}
              onChange={(e) => setSurveyValue(e.currentTarget.value)}
              required
              radius="md"
            />
            <Textarea
              label="Comentarios"
              value={surveyComments}
              onChange={(e) => setSurveyComments(e.currentTarget.value)}
              minRows={3}
              required
              radius="md"
            />
            <Group mt="xs" grow>
              <Button
                variant="default"
                radius="md"
                onClick={() => setSurveyModal({ open: false, meeting: null })}
              >
                Cancelar
              </Button>
              <Button
                loading={savingSurvey}
                onClick={handleSaveSurvey}
                disabled={!surveyValue}
                radius="md"
              >
                Guardar
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}

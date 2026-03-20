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
  Select,
  Skeleton,
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
  IconCalendarOff,
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
import { trackEvent } from "../../utils/analytics";
import { DEFAULT_SURVEY_FIELDS } from "../../pages/admin/ConfigureSurveyModal";

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
  cancelledMeetings = [],
  participantsInfo,
  uid,
  expandedMeetingId,
  setExpandedMeetingId,
  downloadVCard,
  sendWhatsAppMessage,
  prepareSlotSelection,
  loadingMeetings,
  cancelMeeting,
  eventConfig,
  globalDateFilter,
  setGlobalDateFilter,
  policies,
}) {
  const { currentUser } = useContext(UserContext);
  const theme = useMantineTheme();

  // Survey fields: default or custom per role
  const surveyMode = policies?.surveyMode || "default";
  const myRole = (currentUser?.data?.tipoAsistente || "").toLowerCase();

  const surveyFields: any[] = (() => {
    if (surveyMode === "custom") {
      const cfg = eventConfig?.surveyConfig;
      if (myRole === "vendedor" && cfg?.vendedorFields?.length) return cfg.vendedorFields;
      if (myRole === "comprador" && cfg?.compradorFields?.length) return cfg.compradorFields;
      // fallback: try any configured fields
      return cfg?.compradorFields || cfg?.vendedorFields || DEFAULT_SURVEY_FIELDS;
    }
    return DEFAULT_SURVEY_FIELDS;
  })();

  // Check if survey is blocked for current user's role
  const surveyBlocked = (() => {
    const blocked = policies?.surveyBlockedFor || "none";
    if (blocked === "ambos") return true;
    if (blocked === "compradores" && myRole === "comprador") return true;
    if (blocked === "vendedores" && myRole === "vendedor") return true;
    return false;
  })();

  // Multi-day event dates
  const eventDates = eventConfig?.eventDates || (eventConfig?.eventDate ? [eventConfig.eventDate] : []);
  const isMultiDay = eventDates.length > 1;

  // Format date for display - parse ISO date without timezone conversion
  const formatDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString("es-ES", { 
      weekday: "short", 
      day: "numeric", 
      month: "short" 
    });
  };

  const [surveyModal, setSurveyModal] = useState({
    open: false,
    meeting: null,
  });
  const [surveyValues, setSurveyValues] = useState<Record<string, string>>({});
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
        // Load all field values dynamically
        const vals: Record<string, string> = {};
        surveyFields.forEach((f) => { vals[f.name] = data[f.name] || ""; });
        setSurveyValues(vals);
        setUserSurveys((prev) => ({ ...prev, [meeting.id]: data }));
      } else {
        setSurveyValues({});
      }
    } catch (err) {
      setSurveyValues({});
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

      const payload: any = {
        meetingId: meeting.id,
        userId: myId,
        userName: myInfo?.nombre || "",
        userEmpresa: myInfo?.empresa || "",
        otherUserId: otherId,
        otherUserName: otherInfo?.nombre || "",
        otherUserEmpresa: otherInfo?.empresa || "",
        createdAt: new Date(),
        // legacy fields for backwards compat
        value: surveyValues["value"] || "",
        comments: surveyValues["comments"] || "",
        // all dynamic fields
        ...surveyValues,
      };

      await setDoc(doc(db, "meetingSurveys", `${meeting.id}_${myId}`), payload);
      setUserSurveys((prev) => ({ ...prev, [meeting.id]: payload }));
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
    
    // Track meeting cancellation
    trackEvent({
      name: "meeting_cancelled",
      params: {
        meeting_id: meeting.id,
        reason: "user_cancelled_accepted_meeting",
      },
    });
    
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
      <Grid gutter="sm">
        {Array.from({ length: 3 }).map((_, i) => (
          <Grid.Col span={{ base: 12, sm: 6, lg: 4 }} key={i}>
            <Card withBorder radius="xl" padding="md" shadow="sm">
              <Group wrap="nowrap" align="center" gap="sm" mb="sm">
                <Skeleton height={44} width={44} circle />
                <Stack gap={6} style={{ flex: 1 }}>
                  <Skeleton height={14} width="60%" radius="sm" />
                  <Skeleton height={12} width="40%" radius="sm" />
                </Stack>
              </Group>
              <Skeleton height={1} mb="sm" />
              <Stack gap={6}>
                <Skeleton height={12} width="50%" radius="sm" />
                <Skeleton height={12} width="40%" radius="sm" />
              </Stack>
              <Skeleton height={30} mt="md" radius="md" />
            </Card>
          </Grid.Col>
        ))}
      </Grid>
    );
  }

  const surveyExists = (meetingId) => !!userSurveys[meetingId];

  return (
    <>
      {/* Selector de día para eventos multi-día */}
      {isMultiDay && (
        <Group mb="md">
          <Select
            label="Filtrar por día"
            placeholder="Todos los días"
            data={[
              { value: "", label: "Todos los días" },
              ...eventDates.map((date: string) => ({
                value: date,
                label: formatDate(date),
              })),
            ]}
            value={globalDateFilter || ""}
            onChange={(value) => setGlobalDateFilter(value || null)}
            clearable
            style={{ width: 250 }}
          />
        </Group>
      )}

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
                      {meeting.meetingDate && (() => {
                        const [year, month, day] = meeting.meetingDate.split("-").map(Number);
                        const date = new Date(year, month - 1, day);
                        return (
                          <InfoRow
                            icon={<IconClock size={14} />}
                            label="Día"
                            value={date.toLocaleDateString("es-ES", {
                              weekday: "short",
                              day: "numeric",
                              month: "short",
                            })}
                          />
                        );
                      })()}
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
                            disabled={surveyBlocked}
                            title={surveyBlocked ? "Encuesta no disponible para tu perfil" : undefined}
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
                            disabled={cancellingId === meeting.id || !!policies?.cancelMeetingDisabled}
                            title={policies?.cancelMeetingDisabled ? "La cancelación de reuniones está deshabilitada" : undefined}
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

      {/* Reuniones canceladas */}
      {cancelledMeetings.length > 0 && (
        <Stack mt="xl" gap="sm">
          <Divider
            label={
              <Group gap={6}>
                <IconCalendarOff size={16} />
                <Text fw={600} size="sm">
                  Canceladas ({cancelledMeetings.length})
                </Text>
              </Group>
            }
            labelPosition="left"
          />
          <Grid gutter="sm">
            {cancelledMeetings.map((meeting) => {
              const otherUserId =
                meeting.requesterId === uid
                  ? meeting.receiverId
                  : meeting.requesterId;
              const participant = participantsInfo[otherUserId];

              return (
                <Grid.Col span={{ base: 12, sm: 6, lg: 4 }} key={meeting.id}>
                  <Card
                    withBorder
                    radius="xl"
                    padding="md"
                    shadow="sm"
                    style={{ opacity: 0.7 }}
                  >
                    <Group wrap="nowrap" align="center" gap="sm">
                      <Avatar
                        src={participant?.photoURL}
                        radius="xl"
                        size={44}
                        color="gray"
                      >
                        {(participant?.nombre || "R")[0]?.toUpperCase()}
                      </Avatar>
                      <Box style={{ minWidth: 0, flex: 1 }}>
                        <Title order={6} lineClamp={1}>
                          {participant?.empresa || "—"}
                        </Title>
                        <Text size="sm" c="dimmed" lineClamp={1}>
                          {participant?.nombre || "—"}
                        </Text>
                      </Box>
                      <Badge color="red" variant="light" size="sm">
                        Cancelada
                      </Badge>
                    </Group>

                    {meeting.timeSlot && (
                      <>
                        <Divider my="xs" />
                        <Stack gap={4}>
                          {meeting.meetingDate && (() => {
                            const [year, month, day] = meeting.meetingDate.split("-").map(Number);
                            const date = new Date(year, month - 1, day);
                            return (
                              <Group gap={6}>
                                <IconClock size={14} color="gray" />
                                <Text size="xs" c="dimmed">
                                  {date.toLocaleDateString("es-ES", {
                                    weekday: "short",
                                    day: "numeric",
                                    month: "short",
                                  })}
                                </Text>
                              </Group>
                            );
                          })()}
                          <Group gap={6}>
                            <IconClock size={14} color="gray" />
                            <Text size="xs" c="dimmed">
                              {meeting.timeSlot}
                            </Text>
                            {meeting.tableAssigned && (
                              <>
                                <Text size="xs" c="dimmed">•</Text>
                                <IconTable size={14} color="gray" />
                                <Text size="xs" c="dimmed">
                                  Mesa {meeting.tableAssigned}
                                </Text>
                              </>
                            )}
                          </Group>
                        </Stack>
                      </>
                    )}
                  </Card>
                </Grid.Col>
              );
            })}
          </Grid>
        </Stack>
      )}

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
            {surveyFields.map((field) => (
              <Paper key={field.name} withBorder radius="md" p="sm">
                <Text size="sm">
                  <Text span fw={600}>{field.label}:</Text>{" "}
                  {userSurveys[surveyModal.meeting?.id]?.[field.name] || "-"}
                </Text>
              </Paper>
            ))}
          </Stack>
        ) : (
          <Stack gap="md">
            {surveyFields.map((field) => {
              const val = surveyValues[field.name] || "";
              const onChange = (v: string) =>
                setSurveyValues((prev) => ({ ...prev, [field.name]: v }));

              if (field.type === "textarea") {
                return (
                  <Textarea
                    key={field.name}
                    label={field.label}
                    value={val}
                    onChange={(e) => onChange(e.currentTarget.value)}
                    minRows={3}
                    required={field.required}
                    radius="md"
                  />
                );
              }
              if (field.type === "select" && field.options?.length) {
                return (
                  <Select
                    key={field.name}
                    label={field.label}
                    value={val}
                    onChange={(v) => onChange(v || "")}
                    data={field.options.map((o: string) => ({ value: o, label: o }))}
                    required={field.required}
                    radius="md"
                  />
                );
              }
              if (field.type === "rating") {
                return (
                  <Select
                    key={field.name}
                    label={field.label}
                    value={val}
                    onChange={(v) => onChange(v || "")}
                    data={["1", "2", "3", "4", "5"].map((n) => ({ value: n, label: `${n} ⭐` }))}
                    required={field.required}
                    radius="md"
                  />
                );
              }
              // text / number
              return (
                <TextInput
                  key={field.name}
                  label={field.label}
                  value={val}
                  onChange={(e) => onChange(e.currentTarget.value)}
                  type={field.type === "number" ? "number" : "text"}
                  required={field.required}
                  radius="md"
                />
              );
            })}
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
                disabled={surveyFields.filter((f) => f.required).some((f) => !surveyValues[f.name])}
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

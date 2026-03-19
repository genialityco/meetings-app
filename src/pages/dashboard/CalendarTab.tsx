import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Paper,
  Title,
  Table,
  Badge,
  Modal,
  Stack,
  Text,
  Group,
  Avatar,
  Divider,
  ThemeIcon,
  Box,
  Select,
  ScrollArea,
  Checkbox,
  Menu,
  ActionIcon,
  Tooltip,
  Button,
} from "@mantine/core";
import {
  IconClock,
  IconTable,
  IconUser,
  IconBuildingStore,
  IconMail,
  IconPhone,
  IconCalendar,
  IconLock,
  IconLockOpen,
  IconDots,
} from "@tabler/icons-react";
import { doc, updateDoc, collection, query, where, getDocs, addDoc, deleteDoc, onSnapshot, getDoc, setDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { showNotification } from "@mantine/notifications";
import { DEFAULT_SURVEY_FIELDS } from "../admin/ConfigureSurveyModal";

interface CalendarTabProps {
  acceptedMeetings: any[];
  cancelledMeetings: any[];
  pendingRequests: any[];
  sentRequests: any[];
  participantsInfo: any;
  uid: string;
  eventConfig: any;
  eventId: string;
  currentUser?: any;
  policies?: any;
}

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
      <Text size="sm" style={{ minWidth: 0 }}>
        <Text span fw={700}>
          {label}:
        </Text>{" "}
        {value && String(value).trim().length > 0 ? value : "No disponible"}
      </Text>
    </Group>
  );
}

export default function CalendarTab({
  acceptedMeetings,
  cancelledMeetings,
  pendingRequests,
  sentRequests,
  participantsInfo,
  uid,
  eventConfig,
  eventId,
  currentUser,
  policies,
}: CalendarTabProps) {
  const [selectedMeeting, setSelectedMeeting] = useState<any>(null);
  const [modalOpened, setModalOpened] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [agendaSlots, setAgendaSlots] = useState<any[]>([]);
  const [blockedSlots, setBlockedSlots] = useState<any[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [surveys, setSurveys] = useState<{ [meetingId: string]: any[] }>({});
  const [surveyModal, setSurveyModal] = useState<{ meetingId: string; responses: any[] } | null>(null);

  // Survey config
  const surveyMode = policies?.surveyMode || "default";
  const myRole = (currentUser?.data?.tipoAsistente || "").toLowerCase();
  const surveyFields: any[] = (() => {
    if (surveyMode === "custom") {
      const cfg = eventConfig?.surveyConfig;
      if (!cfg) return DEFAULT_SURVEY_FIELDS;
      if (myRole === "vendedor" && cfg?.vendedorFields?.length) return cfg.vendedorFields;
      if (myRole === "comprador" && cfg?.compradorFields?.length) return cfg.compradorFields;
      return cfg?.compradorFields || cfg?.vendedorFields || DEFAULT_SURVEY_FIELDS;
    }
    return DEFAULT_SURVEY_FIELDS;
  })();
  const surveyBlocked = (() => {
    const blocked = policies?.surveyBlockedFor || "none";
    if (blocked === "ambos") return true;
    if (blocked === "compradores" && myRole === "comprador") return true;
    if (blocked === "vendedores" && myRole === "vendedor") return true;
    return false;
  })();

  const [surveyEditModal, setSurveyEditModal] = useState<{ open: boolean; meeting: any | null }>({ open: false, meeting: null });
  const [surveyValues, setSurveyValues] = useState<Record<string, string>>({});
  const [savingSurvey, setSavingSurvey] = useState(false);
  const [userSurveys, setUserSurveys] = useState<Record<string, any>>({});
  const [loadingSurvey, setLoadingSurvey] = useState(false);
  
  // Filtros de visualización
  const [showAccepted, setShowAccepted] = useState(true);
  const [showPending, setShowPending] = useState(true);
  const [showCancelled, setShowCancelled] = useState(false);

  // Obtener fechas del evento
  const eventDates = eventConfig?.eventDates || (eventConfig?.eventDate ? [eventConfig.eventDate] : []);
  const isMultiDay = eventDates.length > 1;

  // Usar la fecha seleccionada o la primera fecha disponible
  const currentDate = selectedDate || eventDates[0] || "";

  // Cargar slots bloqueados del usuario
  const loadBlockedSlots = useCallback(async () => {
    if (!uid || !eventId || !currentDate) return [];
    
    try {
      const blockedQuery = query(
        collection(db, "users", uid, "blockedSlots"),
        where("eventId", "==", eventId),
        where("date", "==", currentDate)
      );
      const blockedSnap = await getDocs(blockedQuery);
      return blockedSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (error) {
      console.error("Error loading blocked slots:", error);
      return [];
    }
  }, [uid, eventId, currentDate]);

  // Cargar slots de la agenda y bloqueados
  const loadAgendaSlots = useCallback(async () => {
    if (!eventId || !currentDate) return;
    
    setLoadingSlots(true);
    try {
      const agendaQuery = query(
        collection(db, "events", eventId, "agenda"),
        where("date", "==", currentDate)
      );
      const agendaSnap = await getDocs(agendaQuery);
      const slots = agendaSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setAgendaSlots(slots);
    } catch (error) {
      console.error("Error loading agenda slots:", error);
      showNotification({
        title: "Error",
        message: "No se pudieron cargar los slots de la agenda",
        color: "red",
      });
    } finally {
      setLoadingSlots(false);
    }
  }, [eventId, currentDate]);

  // Cargar slots cuando cambia la fecha
  useEffect(() => {
    const loadData = async () => {
      await loadAgendaSlots();
      const blocked = await loadBlockedSlots();
      setBlockedSlots(blocked);
    };
    loadData();
  }, [loadAgendaSlots, loadBlockedSlots]);

  // Cargar encuestas del usuario para sus reuniones aceptadas
  useEffect(() => {
    if (!uid || acceptedMeetings.length === 0) return;
    const meetingIds = acceptedMeetings.map((m) => m.id);
    const unsub = onSnapshot(collection(db, "meetingSurveys"), (snap) => {
      const map: { [meetingId: string]: any[] } = {};
      const userMap: Record<string, any> = {};
      snap.docs.forEach((d) => {
        const data = { id: d.id, ...d.data() };
        if (meetingIds.includes((data as any).meetingId)) {
          const mid = (data as any).meetingId;
          if (!map[mid]) map[mid] = [];
          map[mid].push(data);
          // Si es la encuesta del usuario actual, pre-cargar en userSurveys
          if ((data as any).userId === uid) {
            userMap[mid] = data;
          }
        }
      });
      setSurveys(map);
      setUserSurveys((prev) => ({ ...prev, ...userMap }));
    });
    return () => unsub();
  }, [uid, acceptedMeetings.length]);

  const handleOpenSurvey = async (meeting: any) => {
    setSurveyEditModal({ open: true, meeting });
    setLoadingSurvey(true);
    try {
      const surveyDoc = await getDoc(doc(db, "meetingSurveys", `${meeting.id}_${uid}`));
      if (surveyDoc.exists()) {
        const data = surveyDoc.data();
        const vals: Record<string, string> = {};
        surveyFields.forEach((f) => { vals[f.name] = data[f.name] || ""; });
        setSurveyValues(vals);
        setUserSurveys((prev) => ({ ...prev, [meeting.id]: data }));
      } else {
        setSurveyValues({});
      }
    } catch {
      setSurveyValues({});
    }
    setLoadingSurvey(false);
  };

  const handleSaveSurvey = async () => {
    setSavingSurvey(true);
    try {
      const meeting = surveyEditModal.meeting;
      const myInfo = participantsInfo[uid] || currentUser?.data || {};
      const otherPid = meeting.participants?.find((p: string) => p !== uid);
      const otherInfo = participantsInfo[otherPid] || {};
      const payload: Record<string, any> = {
        meetingId: meeting.id,
        userId: uid,
        userName: myInfo.nombre || "",
        userEmpresa: myInfo.empresa || "",
        otherUserId: otherPid || "",
        otherUserName: otherInfo.nombre || "",
        otherUserEmpresa: otherInfo.empresa || "",
        createdAt: new Date(),
        value: surveyValues["value"] || "",
        comments: surveyValues["comments"] || "",
        ...surveyValues,
      };
      await setDoc(doc(db, "meetingSurveys", `${meeting.id}_${uid}`), payload);
      setUserSurveys((prev) => ({ ...prev, [meeting.id]: payload }));
      setSurveyEditModal({ open: false, meeting: null });
    } catch {
      alert("Error guardando la encuesta");
    }
    setSavingSurvey(false);
  };

  const surveyExists = (meetingId: string) => !!userSurveys[meetingId];

  // Bloquear slot
  const handleBlockSlot = async (time: string) => {
    const slot = agendaSlots.find(
      (s) => s.startTime === time && s.available
    );
    
    if (!slot) {
      showNotification({
        title: "Error",
        message: "No se encontró un slot disponible para bloquear",
        color: "red",
      });
      return;
    }

    try {
      // Agregar a la subcolección de slots bloqueados del usuario
      await addDoc(collection(db, "users", uid, "blockedSlots"), {
        eventId,
        date: currentDate,
        startTime: slot.startTime,
        endTime: slot.endTime,
        tableNumber: slot.tableNumber,
        slotId: slot.id,
        createdAt: new Date(),
      });
      
      showNotification({
        title: "Éxito",
        message: "Franja bloqueada correctamente",
        color: "green",
      });
      
      // Recargar datos
      const blocked = await loadBlockedSlots();
      setBlockedSlots(blocked);
    } catch (error) {
      console.error("Error blocking slot:", error);
      showNotification({
        title: "Error",
        message: "No se pudo bloquear la franja",
        color: "red",
      });
    }
  };

  // Desbloquear slot
  const handleUnblockSlot = async (time: string) => {
    const blockedSlot = blockedSlots.find(
      (s) => s.startTime === time
    );
    
    if (!blockedSlot) {
      showNotification({
        title: "Error",
        message: "No se encontró un slot bloqueado",
        color: "red",
      });
      return;
    }

    try {
      // Eliminar de la subcolección
      await deleteDoc(doc(db, "users", uid, "blockedSlots", blockedSlot.id));
      
      showNotification({
        title: "Éxito",
        message: "Franja desbloqueada correctamente",
        color: "green",
      });
      
      // Recargar datos
      const blocked = await loadBlockedSlots();
      setBlockedSlots(blocked);
    } catch (error) {
      console.error("Error unblocking slot:", error);
      showNotification({
        title: "Error",
        message: "No se pudo desbloquear la franja",
        color: "red",
      });
    }
  };

  // Formatear fecha para display
  const formatDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  };

  const formatDateShort = (dateStr: string) => {
    const [year, month, day] = dateStr.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString("es-ES", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  };

  // Obtener configuración del día seleccionado
  const dayConfig = eventConfig?.dailyConfig?.[currentDate] || {
    startTime: eventConfig?.startTime || "08:00",
    endTime: eventConfig?.endTime || "18:00",
  };

  // Generar slots de tiempo por segmentos, respetando breaks
  const generateTimeSlots = (
    start: string,
    end: string,
    duration: number,
    breakTime: number = 0,
    breakBlocks: { start: string; end: string }[] = []
  ): string[] => {
    const toMin = (hhmm: string) => {
      const [h, m] = hhmm.split(":").map(Number);
      return h * 60 + m;
    };
    const toHHMM = (min: number) =>
      `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

    const blockLength = duration + breakTime;

    const sortedBreaks = [...breakBlocks]
      .filter((b) => b.start && b.end)
      .map((b) => ({ start: toMin(b.start), end: toMin(b.end) }))
      .sort((a, b) => a.start - b.start);

    const segments: [number, number][] = [];
    let segStart = toMin(start);
    const dayEnd = toMin(end);
    for (const br of sortedBreaks) {
      if (br.start > segStart) segments.push([segStart, br.start]);
      segStart = br.end;
    }
    if (segStart < dayEnd) segments.push([segStart, dayEnd]);

    const slots: string[] = [];
    for (const [segBegin, segEnd] of segments) {
      const total = Math.floor((segEnd - segBegin) / blockLength);
      for (let i = 0; i < total; i++) {
        slots.push(toHHMM(segBegin + i * blockLength));
      }
    }
    return slots;
  };

  const timeSlots = useMemo(() => {
    return generateTimeSlots(
      dayConfig.startTime,
      dayConfig.endTime,
      eventConfig?.meetingDuration || 30,
      eventConfig?.breakTime || 0,
      dayConfig.breakBlocks || eventConfig?.breakBlocks || []
    );
  }, [dayConfig, eventConfig?.meetingDuration, eventConfig?.breakTime, eventConfig?.breakBlocks]);

  // Combinar todas las reuniones y solicitudes con filtros
  const allMeetings = useMemo(() => {
    const meetings: any[] = [];

    // Reuniones aceptadas
    if (showAccepted) {
      acceptedMeetings.forEach((m) => {
        if (!m.meetingDate || m.meetingDate === currentDate) {
          meetings.push({ ...m, type: "accepted" });
        }
      });
    }

    // Reuniones canceladas
    if (showCancelled) {
      cancelledMeetings.forEach((m) => {
        if (!m.meetingDate || m.meetingDate === currentDate) {
          meetings.push({ ...m, type: "cancelled" });
        }
      });
    }

    // Solicitudes pendientes recibidas
    if (showPending) {
      pendingRequests.forEach((m) => {
        if (!m.meetingDate || m.meetingDate === currentDate) {
          meetings.push({ ...m, type: "pending-received" });
        }
      });
    }

    // Solicitudes pendientes enviadas
    if (showPending) {
      sentRequests.forEach((m) => {
        if (!m.meetingDate || m.meetingDate === currentDate) {
          meetings.push({ ...m, type: "pending-sent" });
        }
      });
    }

    return meetings;
  }, [acceptedMeetings, cancelledMeetings, pendingRequests, sentRequests, currentDate, showAccepted, showPending, showCancelled]);

  // Crear matriz de reuniones por hora
  const meetingsByTime = useMemo(() => {
    const map: { [key: string]: any[] } = {};
    
    allMeetings.forEach((meeting) => {
      if (meeting.timeSlot) {
        const [startTime] = meeting.timeSlot.split(" - ");
        if (!map[startTime]) {
          map[startTime] = [];
        }
        map[startTime].push(meeting);
      }
    });

    return map;
  }, [allMeetings]);

  // Obtener color según tipo de reunión
  const getStatusColor = (type: string) => {
    switch (type) {
      case "accepted":
        return "green";
      case "cancelled":
        return "red";
      case "pending-received":
        return "yellow";
      case "pending-sent":
        return "blue";
      default:
        return "gray";
    }
  };

  const getStatusLabel = (type: string) => {
    switch (type) {
      case "accepted":
        return "Aceptada";
      case "cancelled":
        return "Cancelada";
      case "pending-received":
        return "Pendiente (recibida)";
      case "pending-sent":
        return "Pendiente (enviada)";
      default:
        return "Desconocido";
    }
  };

  const handleMeetingClick = (meeting: any) => {
    setSelectedMeeting(meeting);
    setModalOpened(true);
  };

  const getOtherParticipant = (meeting: any) => {
    const otherId = meeting.requesterId === uid ? meeting.receiverId : meeting.requesterId;
    return participantsInfo[otherId];
  };

  return (
    <>
      <Stack gap="md">
        {/* Controles superiores */}
        <Group justify="space-between" wrap="wrap">
          {/* Selector de día para eventos multi-día */}
          {isMultiDay && (
            <Select
              label="Seleccionar día"
              placeholder="Escoge un día"
              data={eventDates.map((date: string) => ({
                value: date,
                label: formatDateShort(date),
              }))}
              value={selectedDate || eventDates[0]}
              onChange={setSelectedDate}
              style={{ width: 250 }}
            />
          )}

          {/* Filtros de visualización */}
          <Group gap="md">
            <Checkbox
              label="Aceptadas"
              checked={showAccepted}
              onChange={(e) => setShowAccepted(e.currentTarget.checked)}
              color="green"
            />
            <Checkbox
              label="Pendientes"
              checked={showPending}
              onChange={(e) => setShowPending(e.currentTarget.checked)}
              color="yellow"
            />
            <Checkbox
              label="Canceladas"
              checked={showCancelled}
              onChange={(e) => setShowCancelled(e.currentTarget.checked)}
              color="red"
            />
          </Group>
        </Group>

        <Paper withBorder radius="md" p="md">
          <Title order={4} mb="md">
            Agenda - {formatDate(currentDate)}
          </Title>

          {/* Leyenda */}
          <Group gap="xs" mb="md">
            {showAccepted && <Badge color="green" variant="light">Aceptada</Badge>}
            {showPending && (
              <>
                <Badge color="yellow" variant="light">Pendiente (recibida)</Badge>
                <Badge color="blue" variant="light">Pendiente (enviada)</Badge>
              </>
            )}
            {showCancelled && <Badge color="red" variant="light">Cancelada</Badge>}
          </Group>

          <ScrollArea>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ minWidth: 100 }}>Hora</Table.Th>
                  <Table.Th>Reuniones</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {timeSlots.map((time) => {
                  const meetings = meetingsByTime[time] || [];
                  const isBlocked = blockedSlots.some((s) => s.startTime === time);
                  const hasAvailableSlot = agendaSlots.some(
                    (s) => s.startTime === time && s.available && !s.isBreak
                  );
                  
                  return (
                    <Table.Tr key={time}>
                      <Table.Td>
                        <Text fw={600} size="sm">
                          {time}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {isBlocked ? (
                          <Group gap="xs">
                            <Badge
                              color="gray"
                              variant="filled"
                              leftSection={<IconLock size={12} />}
                            >
                              Bloqueado por ti
                            </Badge>
                            <Menu position="bottom-start" shadow="md">
                              <Menu.Target>
                                <ActionIcon variant="subtle" color="gray" size="sm">
                                  <IconDots size={16} />
                                </ActionIcon>
                              </Menu.Target>
                              <Menu.Dropdown>
                                <Menu.Item
                                  leftSection={<IconLockOpen size={14} />}
                                  onClick={() => handleUnblockSlot(time)}
                                >
                                  Desbloquear franja
                                </Menu.Item>
                              </Menu.Dropdown>
                            </Menu>
                          </Group>
                        ) : meetings.length === 0 ? (
                          <Group gap="xs">
                            <Text c="dimmed" size="sm">
                              Sin reuniones
                            </Text>
                            {hasAvailableSlot && (
                              <Menu position="bottom-start" shadow="md">
                                <Menu.Target>
                                  <ActionIcon variant="subtle" color="gray" size="sm">
                                    <IconDots size={16} />
                                  </ActionIcon>
                                </Menu.Target>
                                <Menu.Dropdown>
                                  <Menu.Item
                                    leftSection={<IconLock size={14} />}
                                    onClick={() => handleBlockSlot(time)}
                                  >
                                    Bloquear franja
                                  </Menu.Item>
                                </Menu.Dropdown>
                              </Menu>
                            )}
                          </Group>
                        ) : (
                          <Group gap="xs">
                            {meetings.map((meeting, idx) => {
                              const participant = getOtherParticipant(meeting);
                              return (
                                <Group key={idx} gap={4} wrap="nowrap">
                                  <Badge
                                    color={getStatusColor(meeting.type)}
                                    variant="filled"
                                    style={{ cursor: "pointer" }}
                                    onClick={() => handleMeetingClick(meeting)}
                                  >
                                    {participant?.nombre || "Cargando..."}
                                    {meeting.tableAssigned && ` - Mesa ${meeting.tableAssigned}`}
                                  </Badge>
                                  {meeting.type === "accepted" && (
                                    <>
                                      <Tooltip label={surveyExists(meeting.id) ? "Ver/editar encuesta" : "Llenar encuesta"} withArrow>
                                        <Button
                                          size="compact-xs"
                                          color={surveyExists(meeting.id) ? "violet" : "gray"}
                                          variant={surveyExists(meeting.id) ? "filled" : "outline"}
                                          px={6}
                                          disabled={surveyBlocked}
                                          onClick={() => handleOpenSurvey(meeting)}
                                        >
                                          📋 {surveyExists(meeting.id) ? "Ver/editar encuesta" : "Llenar encuesta"}
                                        </Button>
                                      </Tooltip>
                                    </>
                                  )}
                                </Group>
                              );
                            })}
                          </Group>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>
      </Stack>

      {/* Modal encuesta */}
      <Modal
        opened={surveyEditModal.open}
        onClose={() => setSurveyEditModal({ open: false, meeting: null })}
        title="Encuesta de reunión"
        radius="lg"
      >
        {loadingSurvey ? (
          <Group justify="center" py="md"><Text size="sm" c="dimmed">Cargando...</Text></Group>
        ) : surveyExists(surveyEditModal.meeting?.id) ? (
          <Stack gap="md">
            <Text fw={700}>Tus respuestas de encuesta</Text>
            {surveyFields.map((field: any) => (
              <Paper key={field.name} withBorder radius="md" p="sm">
                <Text size="sm">
                  <Text span fw={600}>{field.label}:</Text>{" "}
                  {userSurveys[surveyEditModal.meeting?.id]?.[field.name] || "-"}
                </Text>
              </Paper>
            ))}
            <Group mt="xs" grow>
              <Button variant="default" radius="md" onClick={() => setSurveyEditModal({ open: false, meeting: null })}>
                Cerrar
              </Button>
              <Button radius="md" onClick={() => setUserSurveys((prev) => { const n = { ...prev }; delete n[surveyEditModal.meeting?.id]; return n; })}>
                Editar
              </Button>
            </Group>
          </Stack>
        ) : (
          <Stack gap="md">
            {surveyFields.map((field: any) => {
              const val = surveyValues[field.name] || "";
              const onChange = (v: string) => setSurveyValues((prev) => ({ ...prev, [field.name]: v }));
              if (field.type === "textarea") {
                return <textarea key={field.name} placeholder={field.label} value={val} onChange={(e) => onChange(e.currentTarget.value)} style={{ width: "100%", minHeight: 80, borderRadius: 8, padding: 8, border: "1px solid #ced4da" }} />;
              }
              if ((field.type === "select" || field.type === "rating") && field.options?.length) {
                return (
                  <Select key={field.name} label={field.label} value={val} onChange={(v) => onChange(v || "")}
                    data={field.type === "rating" ? ["1","2","3","4","5"].map((n) => ({ value: n, label: `${n} ⭐` })) : field.options.map((o: string) => ({ value: o, label: o }))}
                    required={field.required} radius="md" />
                );
              }
              if (field.type === "rating") {
                return <Select key={field.name} label={field.label} value={val} onChange={(v) => onChange(v || "")} data={["1","2","3","4","5"].map((n) => ({ value: n, label: `${n} ⭐` }))} required={field.required} radius="md" />;
              }
              return (
                <Box key={field.name}>
                  <Text size="sm" fw={500} mb={4}>{field.label}{field.required && " *"}</Text>
                  <input value={val} onChange={(e) => onChange(e.currentTarget.value)} type={field.type === "number" ? "number" : "text"} style={{ width: "100%", borderRadius: 8, padding: "8px 12px", border: "1px solid #ced4da", fontSize: 14 }} />
                </Box>
              );
            })}
            <Group mt="xs" grow>
              <Button variant="default" radius="md" onClick={() => setSurveyEditModal({ open: false, meeting: null })}>Cancelar</Button>
              <Button loading={savingSurvey} onClick={handleSaveSurvey}
                disabled={surveyFields.filter((f: any) => f.required).some((f: any) => !surveyValues[f.name])}
                radius="md">
                Guardar
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* Modal de detalles de reunión */}
      <Modal
        opened={modalOpened}
        onClose={() => setModalOpened(false)}
        title={<Text fw={700}>Detalles de la Reunión</Text>}
        size="md"
        centered
        radius="md"
      >
        {selectedMeeting && (() => {
          const participant = getOtherParticipant(selectedMeeting);
          return (
            <Stack gap="md">
              {/* Estado */}
              <Group justify="center">
                <Badge
                  color={getStatusColor(selectedMeeting.type)}
                  variant="filled"
                  size="lg"
                >
                  {getStatusLabel(selectedMeeting.type)}
                </Badge>
              </Group>

              <Divider />

              {/* Información del participante */}
              {participant && (
                <Box>
                  <Group gap="sm" mb="md">
                    <Avatar
                      src={participant.photoURL}
                      radius="xl"
                      size={60}
                    >
                      {(participant.nombre || "U")[0]?.toUpperCase()}
                    </Avatar>
                    <div>
                      <Title order={5}>{participant.nombre}</Title>
                      <Text size="sm" c="dimmed">
                        {participant.empresa}
                      </Text>
                    </div>
                  </Group>

                  <Stack gap="xs">
                    <InfoRow
                      icon={<IconBuildingStore size={14} />}
                      label="Empresa"
                      value={participant.empresa}
                    />
                    <InfoRow
                      icon={<IconUser size={14} />}
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
                  </Stack>
                </Box>
              )}

              <Divider />

              {/* Información de la reunión */}
              <Stack gap="xs">
                {selectedMeeting.meetingDate && (
                  <InfoRow
                    icon={<IconCalendar size={14} />}
                    label="Día"
                    value={formatDate(selectedMeeting.meetingDate)}
                  />
                )}
                <InfoRow
                  icon={<IconClock size={14} />}
                  label="Horario"
                  value={selectedMeeting.timeSlot || "Por asignar"}
                />
                <InfoRow
                  icon={<IconTable size={14} />}
                  label="Mesa"
                  value={
                    selectedMeeting.tableAssigned
                      ? String(selectedMeeting.tableAssigned)
                      : "Por asignar"
                  }
                />
              </Stack>

              {selectedMeeting.contextNote && (
                <>
                  <Divider />
                  <Box>
                    <Text size="sm" fw={600} mb="xs">
                      Mensaje:
                    </Text>
                    <Paper withBorder p="sm" bg="gray.0">
                      <Text size="sm">{selectedMeeting.contextNote}</Text>
                    </Paper>
                  </Box>
                </>
              )}
            </Stack>
          );
        })()}
      </Modal>
    </>
  );
}

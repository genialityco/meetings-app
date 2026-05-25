import { useState, useEffect, useMemo } from "react";
import {
  Container,
  Title,
  Text,
  Flex,
  Table,
  Card,
  Tabs,
  ScrollArea,
  Divider,
  Badge,
  Chip,
  Alert,
  TextInput,
  Textarea,
  NumberInput,
  Select,
  Popover,
  Menu,
  Button,
  Checkbox,
  Modal,
  Stack,
  Paper,
  Tooltip,
  ActionIcon,
  Loader,
  Group,
  Pagination,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { db } from "../../firebase/firebaseConfig";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  updateDoc,
  runTransaction,
  setDoc,
} from "firebase/firestore";
import { DEFAULT_SURVEY_FIELDS } from "./ConfigureSurveyModal";
import { useParams } from "react-router-dom";
import QuickMeetingModal from "./QuickMeetingModal";
import EditMeetingModal from "./EditMeetingModal";
import EditFreeMeetingModal from "./EditFreeMeetingModal";
import CreateFreeMeetingModal from "./CreateFreeMeetingModal";
import { useDashboardData } from "../dashboard/useDashboardData";
import {
  IconClipboard,
  IconClipboardCheck,
  IconPhone,
  IconX,
  IconPencil,
  IconPlus,
  IconInfoCircle,
  IconCopy,
} from "@tabler/icons-react";

// ----------- UTILIDADES -----------

const generateTimeSlots = (
  start,
  end,
  meetingDuration,
  breakTime,
  breakBlocks = [],
) => {
  const toMin = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const toHHMM = (min) =>
    `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

  const blockLength = meetingDuration + breakTime;

  // Dividir el día en segmentos separados por los breaks
  const sortedBreaks = [...breakBlocks]
    .filter((b) => b.start && b.end)
    .map((b) => ({ start: toMin(b.start), end: toMin(b.end) }))
    .sort((a, b) => a.start - b.start);

  const segments = [];
  let segStart = toMin(start);
  const dayEnd = toMin(end);
  for (const br of sortedBreaks) {
    if (br.start > segStart) segments.push([segStart, br.start]);
    segStart = br.end;
  }
  if (segStart < dayEnd) segments.push([segStart, dayEnd]);

  // Generar slots dentro de cada segmento
  const slots = [];
  for (const [segBegin, segEnd] of segments) {
    const total = Math.floor((segEnd - segBegin) / blockLength);
    for (let i = 0; i < total; i++) {
      slots.push(toHHMM(segBegin + i * blockLength));
    }
  }
  return slots;
};

const slotOverlapsBreakBlock = (
  slotStart,
  meetingDuration,
  breakBlocks = [],
) => {
  const [h, m] = slotStart.split(":").map(Number);
  const slotStartMin = h * 60 + m;
  const slotEndMin = slotStartMin + meetingDuration;
  return breakBlocks.some((block) => {
    const [sh, sm] = block.start.split(":").map(Number);
    const [eh, em] = block.end.split(":").map(Number);
    const blockStartMin = sh * 60 + sm;
    const blockEndMin = eh * 60 + em;
    return (
      (slotStartMin >= blockStartMin && slotStartMin < blockEndMin) ||
      (slotEndMin > blockStartMin && slotEndMin <= blockEndMin) ||
      (slotStartMin <= blockStartMin && slotEndMin >= blockEndMin)
    );
  });
};

const statusLabels = {
  available: { label: "Disponible", color: "white" },
  occupied: { label: "Ocupado", color: "yellow" },
  break: { label: "Descanso", color: "blue" },
  accepted: { label: "Reservada", color: "white" },
};

function StatusBadge({ status }) {
  const st = statusLabels[status] || statusLabels.available;
  return (
    <Badge color={st.color} variant="light" radius="sm" size="sm">
      {st.label}
    </Badge>
  );
}

// Componente para actualizar el checkbox instantáneamente en UI antes de que Firestore lo procese
function OptimisticCheckbox({ checked, onChange, label, size, color, onClick }) {
  const [localChecked, setLocalChecked] = useState(checked);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (!isUpdating) setLocalChecked(checked);
  }, [checked, isUpdating]);

  const handleChange = async (e) => {
    const newVal = e.currentTarget.checked;
    setLocalChecked(newVal);
    setIsUpdating(true);
    try {
      await onChange(e, !checked);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Checkbox
      size={size}
      label={label}
      checked={localChecked}
      onChange={handleChange}
      onClick={onClick}
      color={color}
    />
  );
}

function ParticipantsChips({ participants }) {
  return (
    <Flex gap="xs" wrap="wrap">
      {participants.map((p, i) => (
        <Chip
          key={i}
          checked
          size="xs"
          radius="sm"
          color="teal"
          style={{ pointerEvents: "none" }}
        >
          {p}
        </Chip>
      ))}
    </Flex>
  );
}

function ParticipantPopover({ width = 320, trigger, children }) {
  const [opened, setOpened] = useState(false);
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={width}
      withArrow
      withinPortal
      closeOnClickOutside
    >
      <Popover.Target>
        <div
          onClick={(e) => {
            e.stopPropagation();
            setOpened((o) => !o);
          }}
          style={{ cursor: "pointer" }}
        >
          {trigger}
        </div>
      </Popover.Target>
      <Popover.Dropdown onClick={(e) => e.stopPropagation()}>
        {children}
      </Popover.Dropdown>
    </Popover>
  );
}

function FreeMeetingsList({
  freeMeetings,
  participantsInfo,
  getAffinityScore,
  toggleMeetingCompleted,
  surveys,
  openSurveyModal,
  openUserSurveyModal,
  openFillSurveyModal,
  getSurveyStatus,
  openEditModal,
  onCancelFreeMeeting,
}) {
  return (
    <Stack gap={4} mt={4}>
      {freeMeetings.map((fm) => {
        const p0 = fm.participants?.[0];
        const p1 = fm.participants?.[1];
        const affinity = p0 && p1 ? getAffinityScore(p0, p1) : null;
        const ss = getSurveyStatus(fm.id, fm.participants);
        return (
          <Paper
            key={fm.id}
            withBorder
            p={6}
            radius="sm"
            style={{
              borderLeft: "3px solid var(--mantine-color-teal-5)",
              background: "var(--mantine-color-teal-0)",
            }}
          >
            <Group justify="space-between" wrap="nowrap" mb={4}>
              <Group gap={4}>
                <Badge size="xs" color="teal" variant="light">
                  Libre
                </Badge>
                {affinity && (
                  <Badge size="xs" variant="light" color="green">
                    {affinity.score}%
                  </Badge>
                )}
              </Group>
              <Group gap={4}>
                <OptimisticCheckbox
                  size="xs"
                  label="Realizada"
                  checked={!!fm.completed}
                  onChange={(e) => toggleMeetingCompleted(fm.id, fm.completed, e)}
                  onClick={(e) => e.stopPropagation()}
                  color="green"
                />
                <Tooltip label="Editar reunión libre" withArrow>
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color="blue"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (openEditModal) openEditModal(fm);
                    }}
                  >
                    <IconPencil size={11} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Cancelar reunión libre" withArrow>
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color="red"
                    onClick={(e) =>
                      onCancelFreeMeeting && onCancelFreeMeeting(fm.id, e)
                    }
                  >
                    <IconX size={11} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label={ss.label} withArrow>
                  <Badge
                    color={ss.color}
                    variant={ss.count > 0 ? "filled" : "outline"}
                    size="xs"
                    style={{ cursor: ss.count > 0 ? "pointer" : "default" }}
                    onClick={(e) => ss.count > 0 && openSurveyModal(fm.id, e)}
                  >
                    📋 {ss.count}/{ss.total}
                  </Badge>
                </Tooltip>
                <ParticipantPopover
                  width={340}
                  trigger={
                    <Tooltip label="Ver información de participantes" withArrow>
                      <ActionIcon size="xs" variant="subtle" color="gray">
                        <IconInfoCircle size={13} />
                      </ActionIcon>
                    </Tooltip>
                  }
                >
                  <b>Reunión libre — Participantes:</b>
                  {fm.participants?.map((pid, idx) => {
                    const info = participantsInfo[pid];
                    if (!info) return <div key={pid}>{pid}</div>;
                    const otherPid = fm.participants.find((p) => p !== pid);
                    const aff = otherPid
                      ? getAffinityScore(pid, otherPid)
                      : null;
                    return (
                      <div key={pid} style={{ marginBottom: 8 }}>
                        <Text size="sm" fw={600}>
                          {info.empresa}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {info.nombre}
                        </Text>
                        <Text size="xs">
                          <span style={{ color: "#6c6c6c" }}>Tel: </span>
                          {info.telefono || <i>No registrado</i>}
                        </Text>
                        <Text size="xs">
                          <span style={{ color: "#6c6c6c" }}>
                            Intención llamada:{" "}
                          </span>
                          {info.intencionLlamada || <i>No especificada</i>}
                        </Text>
                        <Text size="xs">
                          <span style={{ color: "#6c6c6c" }}>
                            Descripción:{" "}
                          </span>
                          {info.descripcion || <i>No especificada</i>}
                        </Text>
                        <Text size="xs">
                          <span style={{ color: "#6c6c6c" }}>Necesidad: </span>
                          {info.necesidad || <i>No especificada</i>}
                        </Text>
                        {idx === 0 && aff && (
                          <div
                            style={{
                              marginTop: 6,
                              padding: "5px 8px",
                              backgroundColor: "#e6fcf5",
                              borderRadius: 4,
                            }}
                          >
                            <Text size="xs" fw={600} c="teal">
                              Afinidad: {aff.score}%
                            </Text>
                            {aff.reasons?.length > 0 && (
                              <Text size="xs" c="dimmed" mt={2}>
                                {aff.reasons.join(", ")}
                              </Text>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </ParticipantPopover>
              </Group>
            </Group>
            <Stack gap={3}>
              {fm.participants?.map((pid) => {
                const info = participantsInfo[pid];
                const hasSurvey = (surveys[fm.id] || []).some(
                  (r) => r.userId === pid,
                );
                return (
                  <Group
                    key={pid}
                    gap={4}
                    wrap="nowrap"
                    style={{ minWidth: 0 }}
                  >
                    <Tooltip
                      label={hasSurvey ? "Ver encuesta" : "Llenar encuesta"}
                      withArrow
                    >
                      <ActionIcon
                        size="xs"
                        variant={hasSurvey ? "filled" : "light"}
                        color={hasSurvey ? "green" : "gray"}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (hasSurvey) openUserSurveyModal(fm.id, pid, e);
                          else openFillSurveyModal(fm.id, pid, fm, e);
                        }}
                      >
                        {hasSurvey ? (
                          <IconClipboardCheck size={11} />
                        ) : (
                          <IconClipboard size={11} />
                        )}
                      </ActionIcon>
                    </Tooltip>
                    {info?.telefono ? (
                      <>
                        <Tooltip label={`Llamar: ${info.telefono}${info.intencionLlamada ? ` · Intención: ${info.intencionLlamada}` : ""}`} withArrow multiline w={240}>
                          <ActionIcon size="xs" variant="subtle" color="blue" onClick={(e) => { e.stopPropagation(); window.open(`tel:${info.telefono}`); }}>
                            <IconPhone size={11} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Copiar número" withArrow>
                          <ActionIcon size="xs" variant="subtle" color="gray" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(info.telefono); }}>
                            <IconCopy size={11} />
                          </ActionIcon>
                        </Tooltip>
                      </>
                    ) : (
                      <Tooltip label="Sin teléfono" withArrow>
                        <ActionIcon size="xs" variant="subtle" color="gray" disabled>
                          <IconPhone size={11} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text size="xs" fw={600} c="teal" truncate>
                        {info ? info.empresa : pid}
                      </Text>
                      {info && (
                        <Text size="xs" c="dimmed" truncate>
                          {info.nombre}
                        </Text>
                      )}
                    </div>
                  </Group>
                );
              })}
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
}

function getAvailableUsersForSlot(assistants, meetings, slot, meeting = null) {
  if (!slot || !slot.startTime) return [];
  const occupiedIds = new Set();
  meetings.forEach((m) => {
    if (
      (!meeting || m.id !== meeting.id) &&
      m.timeSlot &&
      m.timeSlot.startsWith(slot.startTime)
    ) {
      m.participants.forEach((pid) => occupiedIds.add(pid));
    }
  });
  const allowedIds = meeting?.participants || [];
  return assistants.filter(
    (a) => !occupiedIds.has(a.id) || allowedIds.includes(a.id),
  );
}

function haySolapamiento(slotA, slotB) {
  if (!slotA || !slotB) return false;
  const [aStart, aEnd] = slotA.split(" - ").map((t) => t.trim());
  const [bStart, bEnd] = slotB.split(" - ").map((t) => t.trim());
  function toMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }
  const aStartMin = toMinutes(aStart);
  const aEndMin = toMinutes(aEnd);
  const bStartMin = toMinutes(bStart);
  const bEndMin = toMinutes(bEnd);
  return aStartMin < bEndMin && bStartMin < aEndMin;
}

function getColor(status) {
  switch (status) {
    case "available":
      return "#d3d3d3";
    case "occupied":
      return "#ffa500";
    case "accepted":
      return "#4caf50";
    case "break":
      return "#90caf9";
    default:
      return "#d3d3d3";
  }
}

// ----------- COMPONENTE PRINCIPAL -----------

const MatrixPage = () => {
  const { eventId } = useParams();
  const dashboard = useDashboardData(eventId);

  const [config, setConfig] = useState(null);
  const [agenda, setAgenda] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [participantsInfo, setParticipantsInfo] = useState({});
  const [asistentes, setAsistentes] = useState([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [selectedTableFilter, setSelectedTableFilter] = useState("");
  const [quickModal, setQuickModal] = useState({
    opened: false,
    slotsDisponibles: [],
    defaultUser: null,
  });

  const [editModal, setEditModal] = useState({
    opened: false,
    meeting: null,
    slot: null,
    lockedUserId: null,
  });

  const [editFreeMeetingModal, setEditFreeMeetingModal] = useState({
    opened: false,
    meeting: null,
  });

  // Modal para reunión libre (sin reservar slot)
  const [freeMeetingModal, setFreeMeetingModal] = useState({
    opened: false,
    asistente: null,
    timeSlot: "",
    meetingDate: null,
    tableNumber: null,
  });
  const [creatingFree, setCreatingFree] = useState(false);

  const [creatingMeeting, setCreatingMeeting] = useState(false);
  const [globalMessage, setGlobalMessage] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(userSearch, 300);

  const [mesasPage, setMesasPage] = useState(1);
  const [usuariosPage, setUsuariosPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const [selectedDate, setSelectedDate] = useState(null);
  const [affinityScores, setAffinityScores] = useState({});
  // surveys: { [meetingId]: SurveyResponse[] }
  const [surveys, setSurveys] = useState({});
  const [surveyModal, setSurveyModal] = useState({
    opened: false,
    meetingId: null,
    responses: [],
  });

  // Modal para llenar/editar encuesta de un asistente desde la matriz
  const [fillSurveyModal, setFillSurveyModal] = useState({
    opened: false,
    meetingId: null,
    userId: null,
    meetingData: null,
  });
  const [fillSurveyValues, setFillSurveyValues] = useState({});
  const [fillSurveyLoading, setFillSurveyLoading] = useState(false);
  const [fillSurveySaving, setFillSurveySaving] = useState(false);

  // Carga configuración evento
  useEffect(() => {
    if (!eventId) return;
    (async () => {
      const ref = doc(db, "events", eventId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        setConfig(data);
        // Inicializar fecha seleccionada con la primera fecha del evento
        const eventDates =
          data.config?.eventDates ||
          (data.config?.eventDate ? [data.config.eventDate] : []);
        if (eventDates.length > 0 && !selectedDate) {
          setSelectedDate(eventDates[0]);
        }
      }
    })();
  }, [eventId]);

  // Suscripción a agenda
  useEffect(() => {
    if (!config) return;
    const q = query(
      collection(db, "events", eventId, "agenda"),
      orderBy("startTime"),
    );
    return onSnapshot(q, (snap) => {
      setAgenda(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [config, eventId]);

  // Suscripción a reuniones aceptadas y pendientes
  useEffect(() => {
    if (!config) return;
    const q = query(
      collection(db, "events", eventId, "meetings"),
      where("status", "in", ["accepted", "pending"]),
    );
    return onSnapshot(q, (snap) => {
      setMeetings(
        snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })),
      );
    });
  }, [config, eventId]);

  // Carga asistentes
  useEffect(() => {
    if (!eventId) return;
    (async () => {
      const snap = await getDocs(
        query(collection(db, "users"), where("eventId", "==", eventId)),
      );
      const loaded = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setAsistentes(loaded);
    })();
  }, [eventId]);

  // Map para info rápida
  useEffect(() => {
    if (asistentes.length === 0) return;
    const users = {};
    asistentes.forEach((a) => (users[a.id] = a));
    setParticipantsInfo(users);
  }, [asistentes]);

  // pendingMeetings derivado del listener principal (evita segundo onSnapshot)
  const pendingMeetings = useMemo(
    () => meetings.filter((m) => m.status === "pending"),
    [meetings],
  );

  // Cargar scores de afinidad de todos los usuarios
  useEffect(() => {
    if (!eventId || asistentes.length === 0) return;

    const loadAffinityScores = async () => {
      const scores = {};

      // Cargar afinidad para cada usuario
      for (const user of asistentes) {
        try {
          const affinitySnap = await getDocs(
            collection(db, "users", user.id, "affinityScores"),
          );

          affinitySnap.docs.forEach((doc) => {
            const data = doc.data();
            if (data.targetUserId && typeof data.score === "number") {
              // Crear clave única para el par de usuarios (ordenada para ser simétrica)
              const key = [user.id, data.targetUserId].sort().join("_");
              scores[key] = {
                score: data.score,
                reasons: data.reasons || [],
              };
            }
          });
        } catch (error) {
          console.error(`Error loading affinity for user ${user.id}:`, error);
        }
      }

      setAffinityScores(scores);
    };

    loadAffinityScores();
  }, [eventId, asistentes]);

  // Cargar encuestas del evento
  const meetingIdsKey = useMemo(
    () =>
      meetings
        .map((m) => m.id)
        .sort()
        .join(","),
    [meetings],
  );

  useEffect(() => {
    if (!eventId || !meetingIdsKey) return;
    const meetingIds = meetingIdsKey.split(",").filter(Boolean);
    if (meetingIds.length === 0) return;
    const q = query(collection(db, "meetingSurveys"));
    const unsub = onSnapshot(q, (snap) => {
      const map = {};
      snap.docs.forEach((d) => {
        const data = { id: d.id, ...d.data() };
        if (meetingIds.includes(data.meetingId)) {
          if (!map[data.meetingId]) map[data.meetingId] = [];
          map[data.meetingId].push(data);
        }
      });
      setSurveys(map);
    });
    return () => unsub();
  }, [eventId, meetingIdsKey]);

  // Memoize timeSlots - derivar de los slots reales en Firestore para incluir expansiones
  const timeSlots = useMemo(() => {
    if (!config || !selectedDate) return [];

    // Obtener horarios únicos de los slots reales de la agenda para el día seleccionado
    const agendaForDate = agenda.filter(
      (s) => !s.date || s.date === selectedDate,
    );
    const fromFirestore = [
      ...new Set(agendaForDate.map((s) => s.startTime)),
    ].sort();

    if (fromFirestore.length > 0) return fromFirestore;

    // Fallback: calcular desde config si aún no hay slots en Firestore
    const dayConfig = config.config.dailyConfig?.[selectedDate] || {
      startTime: config.config.startTime,
      endTime: config.config.endTime,
      breakBlocks: config.config.breakBlocks || [],
    };
    return generateTimeSlots(
      dayConfig.startTime,
      dayConfig.endTime,
      config.config.meetingDuration,
      config.config.breakTime,
      dayConfig.breakBlocks || [],
    );
  }, [config, selectedDate, agenda]);

  // Lookup O(1) para índice de timeSlot — evita indexOf en cada render de fila
  const timeSlotIndexMap = useMemo(
    () => Object.fromEntries(timeSlots.map((t, i) => [t, i])),
    [timeSlots],
  );

  // Genera lista de filas para la tabla: slots reales + filas de descanso intercaladas
  const slotsWithBreaks = useMemo(() => {
    if (!config || !selectedDate || timeSlots.length === 0)
      return timeSlots.map((s) => ({ type: "slot", time: s }));

    const dayConfig = config.config.dailyConfig?.[selectedDate] || {
      breakBlocks: config.config.breakBlocks || [],
    };
    const breakBlocks = (dayConfig.breakBlocks || []).filter(
      (b) => b.start && b.end,
    );

    const toMin = (hhmm) => {
      const [h, m] = hhmm.split(":").map(Number);
      return h * 60 + m;
    };

    const rows = [];
    let breakIdx = 0;
    const sortedBreaks = [...breakBlocks].sort(
      (a, b) => toMin(a.start) - toMin(b.start),
    );

    for (const slot of timeSlots) {
      const slotMin = toMin(slot);
      // Insertar breaks que ocurren antes de este slot
      while (
        breakIdx < sortedBreaks.length &&
        toMin(sortedBreaks[breakIdx].start) <= slotMin
      ) {
        const br = sortedBreaks[breakIdx];
        rows.push({
          type: "break",
          label: br.label || "Descanso",
          start: br.start,
          end: br.end,
        });
        breakIdx++;
      }
      rows.push({ type: "slot", time: slot });
    }
    // Breaks al final del día
    while (breakIdx < sortedBreaks.length) {
      const br = sortedBreaks[breakIdx];
      rows.push({
        type: "break",
        label: br.label || "Descanso",
        start: br.start,
        end: br.end,
      });
      breakIdx++;
    }
    return rows;
  }, [config, selectedDate, timeSlots]);

  // Memoize matriz por mesas - filtrar por fecha seleccionada
  // Mapa name -> label de todos los campos de surveyConfig
  const surveyFieldLabels = useMemo(() => {
    const map = {};
    const sc = config?.config?.surveyConfig;
    if (!sc) return map;
    [...(sc.compradorFields || []), ...(sc.vendedorFields || [])].forEach(
      (f) => {
        if (f.name) map[f.name] = f.label || f.name;
      },
    );
    return map;
  }, [config]);

  const memoMatrix = useMemo(() => {
    if (!config || !selectedDate) return [];
    const { numTables, meetingDuration } = config.config;

    const dayConfig = config.config.dailyConfig?.[selectedDate] || {
      breakBlocks: config.config.breakBlocks || [],
    };

    const baseMatrix = Array.from({ length: numTables }, () =>
      timeSlots.map(() => ({
        status: "available",
        participants: [],
        freeMeetings: [],
      })),
    );

    const agendaDelDia = agenda.filter(
      (slot) => !slot.date || slot.date === selectedDate,
    );

    agendaDelDia.forEach((slot) => {
      const tIdx = slot.tableNumber - 1;
      const sIdx = timeSlots.indexOf(slot.startTime);
      if (tIdx >= 0 && tIdx < numTables && sIdx >= 0) {
        baseMatrix[tIdx][sIdx] = {
          status: slot.available ? "available" : "occupied",
          participants: [],
          freeMeetings: [],
        };
      }
    });

    const meetingsDelDia = meetings.filter(
      (mtg) => !mtg.meetingDate || mtg.meetingDate === selectedDate,
    );

    // Primero las reuniones normales (no libres)
    meetingsDelDia.forEach((mtg) => {
      if (mtg.status !== "accepted" || !mtg.timeSlot || mtg.isExternal) return;
      const [startTime] = mtg.timeSlot.split(" - ");
      const tIdx = Number(mtg.tableAssigned) - 1;
      const sIdx = timeSlotIndexMap[startTime];
      if (tIdx >= 0 && tIdx < numTables && sIdx !== undefined && sIdx >= 0) {
        baseMatrix[tIdx][sIdx] = {
          status: "accepted",
          participants: mtg.participants.map((id) =>
            participantsInfo[id]
              ? `${participantsInfo[id].empresa} (${participantsInfo[id].nombre})`
              : id,
          ),
          meetingId: mtg.id,
          meetingData: mtg,
          freeMeetings: baseMatrix[tIdx][sIdx].freeMeetings || [],
        };
      }
    });

    // Luego las reuniones libres — se agregan a freeMeetings de la celda correspondiente por hora
    meetingsDelDia.forEach((mtg) => {
      if (mtg.status !== "accepted" || !mtg.timeSlot || !mtg.isExternal) return;
      const startTime = mtg.timeSlot.split(" - ")[0].trim();
      const sIdx = timeSlotIndexMap[startTime];
      if (sIdx === undefined || sIdx < 0) return;
      // Agregar a todas las mesas que coincidan con tableAssigned, o a la primera si no tiene mesa
      const tIdx = mtg.tableAssigned ? Number(mtg.tableAssigned) - 1 : 0;
      if (tIdx >= 0 && tIdx < numTables) {
        if (!baseMatrix[tIdx][sIdx].freeMeetings)
          baseMatrix[tIdx][sIdx].freeMeetings = [];
        baseMatrix[tIdx][sIdx].freeMeetings.push(mtg);
      }
    });

    return baseMatrix;
  }, [config, agenda, meetings, participantsInfo, timeSlots, selectedDate]);

  // Memoize matriz por usuarios - filtrar por fecha seleccionada
  const memoMatrixUsuarios = useMemo(() => {
    if (!config || asistentes.length === 0 || !selectedDate) return [];

    // Filtrar reuniones por fecha
    const meetingsDelDia = meetings.filter(
      (mtg) => !mtg.meetingDate || mtg.meetingDate === selectedDate,
    );

    // Optimización: Crear un mapa de reuniones por usuario y por slot para evitar O(N) dentro de O(N^2)
    const userMeetingLookup = {};
    meetingsDelDia.forEach((m) => {
      if (!m.timeSlot || m.isExternal) return;
      const start = m.timeSlot.split(" - ")[0].trim();
      m.participants.forEach((pid) => {
        if (!userMeetingLookup[pid]) userMeetingLookup[pid] = {};
        userMeetingLookup[pid][start] = m;
      });
    });

    return asistentes.map((user) => {
      const userMeetings = userMeetingLookup[user.id] || {};
      const row = timeSlots.map((slot) => {
        const mtg = userMeetings[slot];

        if (mtg && mtg.status === "accepted") {
          return {
            status: "accepted",
            table: mtg.tableAssigned,
            meetingId: mtg.id,
            completed: mtg.completed ?? false,
            participants: mtg.participants.filter((pid) => pid !== user.id),
          };
        } else if (mtg && mtg.status === "pending") {
          return {
            status: "pending",
            table: mtg.tableAssigned,
            participants: mtg.participants.filter((pid) => pid !== user.id),
          };
        }
        return { status: "available" };
      });
      return { asistente: user, row };
    });
  }, [config, asistentes, meetings, timeSlots, selectedDate]);

  // Filtrado por mesas y búsqueda — retorna { table, originalIdx }[] para preservar número de mesa
  const filteredMatrix = useMemo(() => {
    const indexed = memoMatrix.map((table, idx) => ({
      table,
      originalIdx: idx,
    }));

    const matchesAssistant = (assistant) => {
      if (!debouncedSearch || debouncedSearch.trim() === "") return true;
      const searchTerm = debouncedSearch.toLowerCase();
      return [
        "nombre",
        "empresa",
        "company_razonSocial",
        "razonSocial",
        "telefono",
        "correo",
        "email",
      ].some((field) =>
        (assistant?.[field] || "")
          .toString()
          .toLowerCase()
          .includes(searchTerm),
      );
    };

    return indexed.filter(({ table, originalIdx }) => {
      if (
        selectedTableFilter &&
        String(originalIdx + 1) !== selectedTableFilter
      )
        return false;
      if (!debouncedSearch || debouncedSearch.trim() === "") return true;
      return table.some((cell) => {
        const meetingMatch = (cell.meetingData?.participants || []).some(
          (pid) => {
            const assistant = participantsInfo[pid];
            return assistant && matchesAssistant(assistant);
          },
        );
        const freeMatch = (cell.freeMeetings || []).some((mtg) =>
          (mtg.participants || []).some((pid) => {
            const assistant = participantsInfo[pid];
            return assistant && matchesAssistant(assistant);
          }),
        );
        return meetingMatch || freeMatch;
      });
    });
  }, [memoMatrix, participantsInfo, debouncedSearch, selectedTableFilter]);

  const filteredMatrixUsuarios = useMemo(
    () =>
      memoMatrixUsuarios.filter(({ asistente }) => {
        const searchTerm = (debouncedSearch || "").toLowerCase();
        const matchesSearch =
          !searchTerm ||
          (asistente.nombre || "").toLowerCase().includes(searchTerm) ||
          (
            asistente.empresa ||
            asistente.company_razonSocial ||
            asistente.razonSocial ||
            ""
          )
            .toLowerCase()
            .includes(searchTerm) ||
          (asistente.correo || asistente.email || "")
            .toLowerCase()
            .includes(searchTerm) ||
          (asistente.telefono || "").toLowerCase().includes(searchTerm);
        const matchesType =
          !typeFilter ||
          (asistente.tipoAsistente || "").toLowerCase() ===
            typeFilter.toLowerCase();

        return matchesSearch && matchesType;
      }),
    [memoMatrixUsuarios, debouncedSearch, typeFilter],
  );

  useEffect(() => { setMesasPage(1); }, [debouncedSearch, selectedTableFilter, selectedDate]);
  useEffect(() => { setUsuariosPage(1); }, [debouncedSearch, typeFilter, selectedDate]);

  const paginatedMesas = useMemo(() => 
    filteredMatrix.slice((mesasPage - 1) * ITEMS_PER_PAGE, mesasPage * ITEMS_PER_PAGE),
  [filteredMatrix, mesasPage]);

  const paginatedUsuarios = useMemo(() => 
    filteredMatrixUsuarios.slice((usuariosPage - 1) * ITEMS_PER_PAGE, usuariosPage * ITEMS_PER_PAGE),
  [filteredMatrixUsuarios, usuariosPage]);

  // --------- FILTRAR SLOTS DISPONIBLES PARA EDICIÓN ---------
  const slotsDisponiblesParaEdicion = useMemo(() => {
    if (!editModal.meeting || !editModal.slot) return [];

    return agenda.filter((slotItem) => {
      const isSameTime = slotItem.startTime === editModal.slot.startTime;
      const isAvailable = slotItem.available;
      const isCurrentTable =
        slotItem.tableNumber === Number(editModal.meeting.tableAssigned);
      return isSameTime && (isAvailable || isCurrentTable);
    });
  }, [agenda, editModal.meeting, editModal.slot]);
  //------------------------------------------------------------

  // ------------ FUNCIONES DE CREACION, EDICIÓN, CANCELACIÓN, INTERCAMBIO ------------
  const handleQuickCreateMeeting = async ({
    user1,
    user2,
    slot,
    checkDuplicates,
    onDuplicateFound,
  }) => {
    setCreatingMeeting(true);
    try {
      const meetingDate = slot.date || selectedDate;

      // Verificar duplicados si está activo
      if (checkDuplicates) {
        const existingSnap = await getDocs(
          query(
            collection(db, "events", eventId, "meetings"),
            where("status", "==", "accepted"),
            where("participants", "array-contains", user1),
          ),
        );
        const alreadyMet = existingSnap.docs.some((d) => {
          const m = d.data();
          const sameDay =
            !meetingDate || !m.meetingDate || m.meetingDate === meetingDate;
          return sameDay && (m.participants || []).includes(user2);
        });
        if (alreadyMet) {
          if (onDuplicateFound) onDuplicateFound();
          setCreatingMeeting(false);
          return;
        }
      }
      const meetingRef = await addDoc(
        collection(db, "events", eventId, "meetings"),
        {
          eventId,
          requesterId: user1,
          receiverId: user2,
          status: "accepted",
          createdAt: new Date(),
          timeSlot: `${slot.startTime} - ${slot.endTime}`,
          tableAssigned: slot.tableNumber.toString(),
          participants: [user1, user2],
        },
      );
      await updateDoc(doc(db, "events", eventId, "agenda", slot.id), {
        available: false,
        meetingId: meetingRef.id,
      });

      // --- Notificar a ambos participantes ---
      const receiver = asistentes.find((a) => a.id === user2);
      const requester = asistentes.find((a) => a.id === user1);
      const slotStr = `${slot.startTime} - ${slot.endTime}`;
      const mesa = slot.tableNumber;

      if (receiver && requester) {
        // WhatsApp
        dashboard.sendMeetingAcceptedWhatsapp(receiver.telefono, requester, {
          timeSlot: slotStr,
          tableAssigned: mesa,
          meetingDate: meetingDate,
        });
        dashboard.sendMeetingAcceptedWhatsapp(requester.telefono, receiver, {
          timeSlot: slotStr,
          tableAssigned: mesa,
          meetingDate: meetingDate,
        });
        // SMS
        dashboard.sendSms(
          `¡Tu reunión ha sido aceptada!\nCon: ${requester.nombre}\nEmpresa: ${requester.empresa}\nHorario: ${slotStr}\nMesa: ${mesa}`,
          receiver.telefono,
        );
        dashboard.sendSms(
          `¡Tu reunión ha sido aceptada!\nCon: ${receiver.nombre}\nEmpresa: ${receiver.empresa}\nHorario: ${slotStr}\nMesa: ${mesa}`,
          requester.telefono,
        );
      }

      setGlobalMessage("¡Reunión creada correctamente!");
      setQuickModal({ opened: false, slot: null, defaultUser: null });
    } catch (e) {
      setGlobalMessage("Error creando la reunión.");
      console.error(e);
    }
    setCreatingMeeting(false);
  };

  const handleEditMeeting = async ({
    meetingId,
    user1,
    user2,
    slot,
    checkDuplicates,
    onDuplicateFound,
  }) => {
    setCreatingMeeting(true);

    try {
      // Verificar duplicados si está activo
      if (checkDuplicates) {
        const meetingDate = slot.date || selectedDate;
        const existingSnap = await getDocs(
          query(
            collection(db, "events", eventId, "meetings"),
            where("status", "==", "accepted"),
            where("participants", "array-contains", user1),
          ),
        );
        const alreadyMet = existingSnap.docs.some((d) => {
          if (d.id === meetingId) return false; // ignorar la reunión actual
          const m = d.data();
          const sameDay =
            !meetingDate || !m.meetingDate || m.meetingDate === meetingDate;
          return sameDay && (m.participants || []).includes(user2);
        });
        if (alreadyMet) {
          if (onDuplicateFound) onDuplicateFound();
          setCreatingMeeting(false);
          return;
        }
      }

      // Buscar reuniones aceptadas que tengan conflicto con el nuevo slot para user1 y user2
      const reunionesAceptadas = meetings.filter(
        (m) => m.status === "accepted" && m.id !== meetingId,
      );

      const nuevoSlotStr = `${slot.startTime} - ${slot.endTime}`;

      const hayConflicto = (userId) =>
        reunionesAceptadas.some(
          (m) =>
            m.participants.includes(userId) &&
            haySolapamiento(m.timeSlot, nuevoSlotStr),
        );

      if (checkDuplicates) {
        if (hayConflicto(user1)) {
          setGlobalMessage(
            `El participante 1 no está disponible en el horario seleccionado.`,
          );
          setCreatingMeeting(false);
          return;
        }
        if (hayConflicto(user2)) {
          setGlobalMessage(
            `El participante 2 no está disponible en el horario seleccionado.`,
          );
          setCreatingMeeting(false);
          return;
        }
      }

      // Obtener la reunión actual para liberar su slot anterior
      const meetingActual = meetings.find((m) => m.id === meetingId);

      if (!meetingActual) {
        setGlobalMessage("Reunión no encontrada.");
        setCreatingMeeting(false);
        return;
      }

      // Buscar slot agenda actual (para liberar)
      const slotActual = agenda.find(
        (s) =>
          s.meetingId === meetingId &&
          s.tableNumber === Number(meetingActual.tableAssigned) &&
          s.startTime === meetingActual.timeSlot.split(" - ")[0],
      );

      // Determinar si el nuevo slot ya está ocupado por OTRA reunión
      // Si checkDuplicates es falso, se pudo haber seleccionado un slot ocupado
      const isTargetSlotOccupied =
        !slot.available && slot.meetingId !== meetingId;

      // Actualizar reunión con nuevos datos
      const updateData = {
        participants: [user1, user2],
        requesterId: user1,
        receiverId: user2,
        timeSlot: nuevoSlotStr,
        tableAssigned: slot.tableNumber.toString(),
      };

      if (isTargetSlotOccupied) {
        updateData.isExternal = true;
        updateData.motivoMatch = "Libre";
        updateData.razonMatch = "Reunión convertida a libre por solapamiento";
      } else {
        updateData.isExternal = false;
        if (meetingActual.isExternal) {
          updateData.motivoMatch = "Manual";
          updateData.razonMatch = "Convertida a normal desde matriz";
        }
      }

      await updateDoc(
        doc(db, "events", eventId, "meetings", meetingId),
        updateData,
      );

      // Liberar slot anterior si existe y no es el mismo que el nuevo
      if (slotActual && slotActual.id !== slot.id) {
        await updateDoc(doc(db, "events", eventId, "agenda", slotActual.id), {
          available: true,
          meetingId: null,
        });
      }

      // Marcar nuevo slot como ocupado SOLO si no lo convertimos a reunión libre
      if (!isTargetSlotOccupied) {
        await updateDoc(doc(db, "events", eventId, "agenda", slot.id), {
          available: false,
          meetingId,
        });
      }

      // Opcional: notificar a ambos participantes (como haces en creación)
      const receiver = asistentes.find((a) => a.id === user2);
      const requester = asistentes.find((a) => a.id === user1);
      const mesa = slot.tableNumber;
      const meetingDate = slot.date || selectedDate;

      if (receiver && requester) {
        dashboard.sendMeetingAcceptedWhatsapp(receiver.telefono, requester, {
          timeSlot: nuevoSlotStr,
          tableAssigned: mesa,
          meetingDate: meetingDate,
        });
        dashboard.sendMeetingAcceptedWhatsapp(requester.telefono, receiver, {
          timeSlot: nuevoSlotStr,
          tableAssigned: mesa,
          meetingDate: meetingDate,
        });
        dashboard.sendSms(
          `¡Tu reunión ha sido actualizada!\nCon: ${requester.nombre}\nEmpresa: ${requester.empresa}\nHorario: ${nuevoSlotStr}\nMesa: ${mesa}`,
          receiver.telefono,
        );
        dashboard.sendSms(
          `¡Tu reunión ha sido actualizada!\nCon: ${receiver.nombre}\nEmpresa: ${receiver.empresa}\nHorario: ${nuevoSlotStr}\nMesa: ${mesa}`,
          requester.telefono,
        );
      }

      setGlobalMessage("¡Reunión actualizada correctamente!");
      setEditModal({ opened: false, meeting: null, slot: null });
    } catch (e) {
      setGlobalMessage("Error actualizando la reunión.");
      console.error(e);
    }

    setCreatingMeeting(false);
  };

  // ----------- CANCEL Y AGENDAR PENDIENTE EN SLOTS SOLO DEL USUARIO -----------
  const handleCancelMeeting = async (meetingId, slotId) => {
    setCreatingMeeting(true);
    console.log("[handleCancelMeeting] Iniciando cancelación:", {
      meetingId,
      slotId,
    });

    try {
      const cancelledMeeting = meetings.find((m) => m.id === meetingId);
      if (!cancelledMeeting) {
        console.error(
          "[handleCancelMeeting] No se encontró la reunión a cancelar:",
          meetingId,
        );
        throw new Error("No se encontró la reunión a cancelar.");
      }
      console.log(
        "[handleCancelMeeting] Reunión a cancelar:",
        cancelledMeeting,
      );

      // Notifica por WhatsApp y SMS a todos los participantes
      for (const participantId of cancelledMeeting.participants) {
        const participant = asistentes.find((a) => a.id === participantId);
        const otherId = cancelledMeeting.participants.find(
          (id) => id !== participantId,
        );
        const other = asistentes.find((a) => a.id === otherId);
        try {
          if (participant) {
            console.log(
              `[handleCancelMeeting] Notificando a participante (${participantId}):`,
              participant,
            );
            // WhatsApp
            dashboard.sendMeetingCancelledWhatsapp(
              participant.telefono,
              other,
              {
                timeSlot: cancelledMeeting.timeSlot,
                tableAssigned: cancelledMeeting.tableAssigned,
                meetingDate: cancelledMeeting.meetingDate || selectedDate,
              },
            );
            // // SMS
            // dashboard.sendSms(
            //   `¡Tu reunión ha sido cancelada!\nCon: ${other?.nombre || ""}\nEmpresa: ${other?.empresa || ""}\nHorario: ${cancelledMeeting.timeSlot}\nMesa: ${cancelledMeeting.tableAssigned}`,
            //   participant.telefono
            // );
          }
        } catch (error) {
          console.error(
            `[handleCancelMeeting] Error notificando a ${participantId} (${participant?.nombre}):`,
            error,
          );
        }
      }

      // 1. Marca la reunión como cancelada
      console.log(
        "[handleCancelMeeting] Marcando reunión como cancelada en Firestore...",
      );
      await updateDoc(doc(db, "events", eventId, "meetings", meetingId), {
        status: "cancelled",
      });

      // 2. Libera el slot
      if (slotId) {
        console.log("[handleCancelMeeting] Liberando slot en agenda:", slotId);
        await updateDoc(doc(db, "events", eventId, "agenda", slotId), {
          available: true,
          meetingId: null,
        });
      }

      // 3. Busca solicitudes pendientes y re-agenda en el slot liberado
      const userId = cancelledMeeting.participants[0];
      const slotLiberado = agenda.find((s) => s.id === slotId);

      const pendientesRecibidas = pendingMeetings.filter(
        (req) => req.receiverId === userId,
      );
      console.log(
        "[handleCancelMeeting] Pendientes recibidas para el usuario:",
        pendientesRecibidas,
      );

      // Excluye la reunión cancelada en el array de aceptadas
      const reunionesAceptadas = meetings.filter(
        (m) => m.status === "accepted" && m.id !== meetingId,
      );

      const slotStr = slotLiberado
        ? `${slotLiberado.startTime} - ${slotLiberado.endTime}`
        : null;

      if (slotLiberado && slotStr) {
        for (const solicitud of pendientesRecibidas) {
          const requesterId = solicitud.requesterId;
          const solicitanteOcupado = reunionesAceptadas.some(
            (m) =>
              m.participants.includes(requesterId) &&
              haySolapamiento(m.timeSlot, slotStr),
          );
          const receiverOcupado = reunionesAceptadas.some(
            (m) =>
              m.participants.includes(userId) &&
              haySolapamiento(m.timeSlot, slotStr),
          );

          if (!solicitanteOcupado && !receiverOcupado) {
            console.log(
              `[handleCancelMeeting] Agendando solicitud pendiente (ID: ${solicitud.id}) en el slot liberado.`,
            );
            // Acepta la solicitud pendiente
            await updateDoc(
              doc(db, "events", eventId, "meetings", solicitud.id),
              {
                status: "accepted",
                timeSlot: slotStr,
                tableAssigned: slotLiberado.tableNumber.toString(),
              },
            );
            await updateDoc(
              doc(db, "events", eventId, "agenda", slotLiberado.id),
              {
                available: false,
                meetingId: solicitud.id,
              },
            );

            // Notifica a ambas partes por WhatsApp y SMS
            const receiver = asistentes.find((a) => a.id === userId);
            const requester = asistentes.find((a) => a.id === requesterId);
            const meetingDate = slotLiberado.date || selectedDate;

            if (receiver && requester) {
              console.log(
                `[handleCancelMeeting] Notificando a ambas partes por WhatsApp/SMS...`,
              );
              // WhatsApp
              dashboard.sendMeetingAcceptedWhatsapp(
                receiver.telefono,
                requester,
                {
                  timeSlot: slotStr,
                  tableAssigned: slotLiberado.tableNumber,
                  meetingDate: meetingDate,
                },
              );
              dashboard.sendMeetingAcceptedWhatsapp(
                requester.telefono,
                receiver,
                {
                  timeSlot: slotStr,
                  tableAssigned: slotLiberado.tableNumber,
                  meetingDate: meetingDate,
                },
              );
              // SMS
              dashboard.sendSms(
                `¡Tu reunión ha sido aceptada!\nCon: ${requester.nombre}\nEmpresa: ${requester.empresa}\nHorario: ${slotStr}\nMesa: ${slotLiberado.tableNumber}`,
                receiver.telefono,
              );
              dashboard.sendSms(
                `¡Tu reunión ha sido aceptada!\nCon: ${receiver.nombre}\nEmpresa: ${receiver.empresa}\nHorario: ${slotStr}\nMesa: ${slotLiberado.tableNumber}`,
                requester.telefono,
              );
            }

            setGlobalMessage(
              "¡Solicitud pendiente agendada automáticamente en el slot liberado!",
            );
            setEditModal({ opened: false, meeting: null, slot: null });
            setCreatingMeeting(false);
            console.log(
              "[handleCancelMeeting] Finalizó, solicitud re-agendada correctamente.",
            );
            return;
          }
        }
      }

      setGlobalMessage("¡Reunión cancelada!");
      setEditModal({ opened: false, meeting: null, slot: null });
      setCreatingMeeting(false);
      console.log(
        "[handleCancelMeeting] Finalizó, reunión cancelada sin reasignar slot.",
      );
    } catch (e) {
      setGlobalMessage("Error cancelando la reunión.");
      setCreatingMeeting(false);
      console.error("[handleCancelMeeting] Error general:", e);
    }
  };

  const toggleMeetingCompleted = async (meetingId, currentValue, e) => {
    e.stopPropagation();
    try {
      await updateDoc(doc(db, "events", eventId, "meetings", meetingId), {
        completed: !currentValue,
      });
    } catch (err) {
      console.error("Error toggling completed:", err);
    }
  };

  const handleCancelFreeMeeting = async (meetingId, e) => {
    e.stopPropagation();
    try {
      await updateDoc(doc(db, "events", eventId, "meetings", meetingId), {
        status: "cancelled",
      });
    } catch (err) {
      console.error("Error cancelando reunión libre:", err);
    }
  };

  const handleCancelFreeMeetingById = async (meetingId) => {
    try {
      await updateDoc(doc(db, "events", eventId, "meetings", meetingId), {
        status: "cancelled",
      });
      setEditFreeMeetingModal({ opened: false, meeting: null });
    } catch (err) {
      console.error("Error cancelando reunión libre:", err);
    }
  };

  const handleUpdateFreeMeeting = async ({
    meetingId,
    user1,
    user2,
    timeSlot,
  }) => {
    setCreatingMeeting(true);
    try {
      await updateDoc(doc(db, "events", eventId, "meetings", meetingId), {
        participants: [user1, user2],
        requesterId: user1,
        receiverId: user2,
        timeSlot: timeSlot || "—",
      });
      setGlobalMessage("Reunión libre actualizada correctamente.");
      setEditFreeMeetingModal({ opened: false, meeting: null });
    } catch (e) {
      setGlobalMessage("Error actualizando la reunión libre.");
      console.error(e);
    }
    setCreatingMeeting(false);
  };

  const openSurveyModal = (meetingId, e) => {
    e.stopPropagation();
    const responses = surveys[meetingId] || [];
    setSurveyModal({ opened: true, meetingId, responses });
  };

  const handleCreateFreeMeeting = async ({
    user1,
    user2,
    timeSlot,
    checkDuplicates,
    onDuplicateFound,
  }) => {
    setCreatingFree(true);
    try {
      const meetingDate = freeMeetingModal.meetingDate || selectedDate || null;

      if (checkDuplicates) {
        const existingSnap = await getDocs(
          query(
            collection(db, "events", eventId, "meetings"),
            where("status", "==", "accepted"),
            where("participants", "array-contains", user1),
          ),
        );
        const alreadyMet = existingSnap.docs.some((d) => {
          const m = d.data();
          const sameDay =
            !meetingDate || !m.meetingDate || m.meetingDate === meetingDate;
          return sameDay && (m.participants || []).includes(user2);
        });
        if (alreadyMet) {
          if (onDuplicateFound) onDuplicateFound();
          setCreatingFree(false);
          return;
        }
      }

      await addDoc(collection(db, "events", eventId, "meetings"), {
        eventId,
        requesterId: user1,
        receiverId: user2,
        participants: [user1, user2],
        status: "accepted",
        isExternal: true,
        timeSlot: timeSlot || "—",
        tableAssigned: freeMeetingModal.tableNumber
          ? String(freeMeetingModal.tableNumber)
          : "",
        meetingDate,
        motivoMatch: "Libre",
        razonMatch: "Reunión libre creada desde la matriz",
        isNotificated: false,
        createdAt: new Date(),
      });
      setGlobalMessage("Reunión libre creada correctamente.");
      setFreeMeetingModal({
        opened: false,
        asistente: null,
        timeSlot: "",
        meetingDate: null,
        tableNumber: null,
      });
    } catch (e) {
      setGlobalMessage("Error creando la reunión libre.");
      console.error(e);
    } finally {
      setCreatingFree(false);
    }
  };

  const openUserSurveyModal = (meetingId, userId, e) => {
    e.stopPropagation();
    const responses = (surveys[meetingId] || []).filter(
      (r) => r.userId === userId,
    );
    setSurveyModal({ opened: true, meetingId, responses });
  };

  // Obtiene los campos de encuesta según configuración del evento y rol del usuario
  const getSurveyFieldsForUser = (userId) => {
    const surveyMode = config?.config?.policies?.surveyMode || "default";
    if (surveyMode === "custom") {
      const cfg = config?.config?.surveyConfig;
      const userInfo = participantsInfo[userId];
      const role = (userInfo?.tipoAsistente || "").toLowerCase();
      if (role === "vendedor" && cfg?.vendedorFields?.length)
        return cfg.vendedorFields;
      if (role === "comprador" && cfg?.compradorFields?.length)
        return cfg.compradorFields;
      return (
        cfg?.compradorFields || cfg?.vendedorFields || DEFAULT_SURVEY_FIELDS
      );
    }
    return DEFAULT_SURVEY_FIELDS;
  };

  const openFillSurveyModal = async (meetingId, userId, meetingData, e) => {
    e.stopPropagation();
    setFillSurveyModal({ opened: true, meetingId, userId, meetingData });
    setFillSurveyLoading(true);
    try {
      const surveyDoc = await getDoc(
        doc(db, "meetingSurveys", `${meetingId}_${userId}`),
      );
      const fields = getSurveyFieldsForUser(userId);
      if (surveyDoc.exists()) {
        const data = surveyDoc.data();
        const vals = {};
        fields.forEach((f) => {
          vals[f.name] = data[f.name] ?? "";
        });
        setFillSurveyValues(vals);
      } else {
        const vals = {};
        fields.forEach((f) => {
          vals[f.name] = "";
        });
        setFillSurveyValues(vals);
      }
    } catch {
      setFillSurveyValues({});
    }
    setFillSurveyLoading(false);
  };

  const handleSaveFillSurvey = async () => {
    const { meetingId, userId, meetingData } = fillSurveyModal;
    setFillSurveySaving(true);
    try {
      const userInfo = participantsInfo[userId] || {};
      const otherUserId = meetingData?.participants?.find((p) => p !== userId);
      const otherInfo = participantsInfo[otherUserId] || {};
      const payload = {
        meetingId,
        userId,
        userName: userInfo.nombre || "",
        userEmpresa: userInfo.empresa || "",
        otherUserId: otherUserId || "",
        otherUserName: otherInfo.nombre || "",
        otherUserEmpresa: otherInfo.empresa || "",
        createdAt: new Date(),
        value: fillSurveyValues["value"] || "",
        comments: fillSurveyValues["comments"] || "",
        ...fillSurveyValues,
        filledByAdmin: true,
      };
      await setDoc(
        doc(db, "meetingSurveys", `${meetingId}_${userId}`),
        payload,
      );
      // Actualizar surveys localmente
      setSurveys((prev) => {
        const existing = (prev[meetingId] || []).filter(
          (r) => r.userId !== userId,
        );
        return {
          ...prev,
          [meetingId]: [
            ...existing,
            { ...payload, id: `${meetingId}_${userId}` },
          ],
        };
      });
      setFillSurveyModal({
        opened: false,
        meetingId: null,
        userId: null,
        meetingData: null,
      });
    } catch (err) {
      console.error(err);
      alert("Error guardando la encuesta");
    }
    setFillSurveySaving(false);
  };

  // Retorna { count, total, color, label } para el badge de encuesta
  const getSurveyStatus = (meetingId, participants) => {
    const responses = surveys[meetingId] || [];
    const total = participants?.length || 2;
    const count = responses.length;
    if (count === 0)
      return {
        count,
        total,
        color: "red",
        label: "Ninguno ha diligenciado la encuesta",
      };
    if (count < total)
      return {
        count,
        total,
        color: "orange",
        label: `Falta encuesta de ${total - count} participante(s)`,
      };
    return {
      count,
      total,
      color: "green",
      label: "Ambos han diligenciado la encuesta",
    };
  };

  const handleSwapMeetings = async (meetingA, slotA, meetingB, slotB) => {
    setCreatingMeeting(true);
    try {
      await runTransaction(db, async (transaction) => {
        transaction.update(
          doc(db, "events", eventId, "meetings", meetingA.id),
          {
            timeSlot: meetingB.timeSlot,
            tableAssigned: meetingB.tableAssigned,
          },
        );
        transaction.update(
          doc(db, "events", eventId, "meetings", meetingB.id),
          {
            timeSlot: meetingA.timeSlot,
            tableAssigned: meetingA.tableAssigned,
          },
        );
        transaction.update(doc(db, "events", eventId, "agenda", slotA.id), {
          meetingId: meetingB.id,
        });
        transaction.update(doc(db, "events", eventId, "agenda", slotB.id), {
          meetingId: meetingA.id,
        });
      });

      setGlobalMessage("¡Reuniones intercambiadas exitosamente!");
    } catch (e) {
      setGlobalMessage("Error intercambiando reuniones.");
      console.error(e);
    }
    setCreatingMeeting(false);
  };

  // Helper color
  function getColor(status) {
    switch (status) {
      case "available":
        return "#d3d3d3";
      case "occupied":
        return "#ffa500";
      case "accepted":
        return "#82c485ff";
      case "break":
        return "#90caf9";
      default:
        return "#d3d3d3";
    }
  }

  // Helper para formatear fecha
  const formatDate = (dateStr) => {
    const [year, month, day] = dateStr.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString("es-ES", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  };

  // Helper para obtener score de afinidad entre dos usuarios
  const getAffinityScore = (userId1, userId2) => {
    if (!userId1 || !userId2) return null;
    const key = [userId1, userId2].sort().join("_");
    return affinityScores[key] || null;
  };

  // Obtener fechas del evento
  const eventDates =
    config?.config?.eventDates ||
    (config?.config?.eventDate ? [config.config.eventDate] : []);
  const isMultiDay = eventDates.length > 1;

  return (
    <Container fluid>
      <Title order={2} mt="md" mb="md" align="center">
        Operación Mesas — {config?.eventName || "Evento"}
      </Title>

      {/* Selector de día para eventos multi-día */}
      {isMultiDay && (
        <Flex justify="center" mb="md">
          <Select
            label="Seleccionar día"
            placeholder="Escoge un día"
            data={eventDates.map((date) => ({
              value: date,
              label: formatDate(date),
            }))}
            value={selectedDate}
            onChange={setSelectedDate}
            style={{ width: "100%", maxWidth: 280 }}
          />
        </Flex>
      )}

      <Flex justify="center" mb="md" px="md">
        <TextInput
          placeholder="Buscar asistente por nombre, empresa o teléfono"
          value={userSearch}
          onChange={(e) => setUserSearch(e.currentTarget.value)}
          style={{ width: "100%", maxWidth: 520 }}
          clearable
        />
      </Flex>

      <Tabs defaultValue="mesas">
        <Tabs.List>
          <Tabs.Tab value="mesas">Por Mesas</Tabs.Tab>
          <Tabs.Tab value="usuarios">Por Usuarios</Tabs.Tab>
        </Tabs.List>

        {/* Panel Mesas */}
        <Tabs.Panel value="mesas" pt="md">
          <Flex gap="md" mb="md" wrap="wrap" align="center">
            <Select
              placeholder="Todas las mesas"
              value={selectedTableFilter}
              onChange={setSelectedTableFilter}
              data={memoMatrix.map((_, i) => ({
                value: String(i + 1),
                label: `Mesa ${i + 1}`,
              }))}
              style={{ maxWidth: 200 }}
              clearable
            />
          </Flex>
          <ScrollArea>
            <Flex gap="lg" justify="center" align="flex-start" wrap="wrap">
              {paginatedMesas.map(({ table, originalIdx: ti }) => (
                <Card
                  key={ti}
                  shadow="sm"
                  radius="md"
                  padding="xs"
                  style={{
                    maxWidth: 680,
                    width: "100%",
                    background: "#f9fafb",
                    border: "1px solid #e5e7eb",
                    boxShadow: "0 2px 8px #0001",
                  }}
                >
                  <Group justify="space-between" mb="xs" align="center">
                    <Title order={5} style={{ letterSpacing: 0.5 }}>
                      Mesa {ti + 1}
                    </Title>
                  </Group>
                  <Divider mb="sm" />
                  <ScrollArea>
                  <Table
                    striped
                    highlightOnHover
                    horizontalSpacing="xs"
                    verticalSpacing={8}
                    style={{ borderRadius: 12, overflow: "hidden", minWidth: 200 }}
                  >
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th
                          style={{
                            fontSize: 11,
                            color: "#6b7280",
                            fontWeight: 600,
                            width: 30,
                            padding: "1px 1px"
                          }}
                        >
                          Hora
                        </Table.Th>
                        <Table.Th
                          style={{
                            fontSize: 11,
                            color: "#6b7280",
                            fontWeight: 600,
                            padding: "1px 1px"
                          }}
                        >
                          Estado / Participantes
                        </Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {slotsWithBreaks.map((row, ri) => {
                        if (row.type === "break") {
                          return (
                            <Table.Tr
                              key={`break-${ri}`}
                              style={{ backgroundColor: "#90caf9" }}
                            >
                              <Table.Td
                                style={{
                                  fontWeight: 600,
                                  fontSize: 11,
                                  color: "#1565c0",
                                  whiteSpace: "nowrap",
                                  padding: "1px 1px"
                                }}
                              >
                                {row.start} - {row.end}
                              </Table.Td>
                              <Table.Td style={{ padding: "1px 1px" }}>
                                <Badge color="blue" variant="light" size="sm">
                                  {row.label}
                                </Badge>
                              </Table.Td>
                            </Table.Tr>
                          );
                        }
                        const si = timeSlotIndexMap[row.time] ?? -1;
                        const cell =
                          si >= 0
                            ? table[si]
                            : { status: "available", participants: [] };
                        return (
                          <Table.Tr
                            key={`${ti}-${si}`}
                            style={{ borderRadius: 5 }}
                          >
                            <Table.Td
                              style={{
                                fontWeight: 600,
                                fontSize: 10,
                                color: "#21252cff",
                                whiteSpace: "nowrap",
                                padding: "2px"
                              }}
                            >
                              <Stack gap={1} align="center">
                                {timeSlots[si]}
                                <Menu
                                  withinPortal
                                  position="bottom-start"
                                  shadow="md"
                                  width={170}
                                >
                                  <Menu.Target>
                                    <ActionIcon
                                      size="xs"
                                      variant="light"
                                      color="teal"
                                    >
                                      <IconPlus size={10} />
                                    </ActionIcon>
                                  </Menu.Target>
                                  <Menu.Dropdown>
                                    <Menu.Label>Crear reunión</Menu.Label>
                                    <Menu.Item
                                      disabled={cell.status !== "available"}
                                      onClick={() => {
                                        const slotEncontrado = agenda.find(
                                          (s) =>
                                            s.tableNumber === ti + 1 &&
                                            s.startTime === timeSlots[si],
                                        );
                                        setQuickModal({
                                          opened: true,
                                          slot: slotEncontrado
                                            ? { ...slotEncontrado }
                                            : null,
                                          slotsDisponibles: slotEncontrado
                                            ? [slotEncontrado]
                                            : [],
                                          defaultUser: null,
                                        });
                                      }}
                                    >
                                      ⚡ Cita rápida
                                    </Menu.Item>
                                    <Menu.Item
                                      onClick={() =>
                                        setFreeMeetingModal({
                                          opened: true,
                                          asistente: null,
                                          timeSlot: timeSlots[si],
                                          meetingDate: selectedDate,
                                          tableNumber: ti + 1,
                                        })
                                      }
                                    >
                                      👥 Reunión libre
                                    </Menu.Item>
                                  </Menu.Dropdown>
                                </Menu>
                              </Stack>
                            </Table.Td>
                            <Table.Td style={{ padding: "1px" }}>
                              {cell.status === "accepted" ? (
                                (() => {
                                  const p0 =
                                    cell.meetingData?.participants?.[0];
                                  const p1 =
                                    cell.meetingData?.participants?.[1];
                                  const affinity =
                                    p0 && p1 ? getAffinityScore(p0, p1) : null;
                                  const ss = getSurveyStatus(
                                    cell.meetingId,
                                    cell.meetingData?.participants,
                                  );
                                  return (
                                    <Stack gap={4}>
                                      <Paper
                                        p={8}
                                        radius="md"
                                        style={{
                                          border: "1px solid #e5e7eb",
                                          borderLeft: "3px solid #4caf50",
                                          background: "#fff",
                                        }}
                                      >
                                        <Stack gap={6}>
                                          {/* Fila 1: estado + acciones */}
                                          <Group
                                            justify="space-between"
                                            wrap="wrap"
                                          >
                                            <Group gap={5}>
                                              <StatusBadge
                                                status={cell.status}
                                              />
                                              {affinity && (
                                                <Badge
                                                  size="xs"
                                                  variant="light"
                                                  color="green"
                                                >
                                                  {affinity.score}%
                                                </Badge>
                                              )}
                                            </Group>
                                            <Group gap={4}>
                                              <OptimisticCheckbox
                                                size="xs"
                                                label="Realizada"
                                                checked={!!cell.meetingData?.completed}
                                                onChange={(e) => toggleMeetingCompleted(cell.meetingId, cell.meetingData?.completed, e)}
                                                onClick={(e) => e.stopPropagation()}
                                                color="green"
                                              />
                                              <Tooltip
                                                label="Editar reunión"
                                                withArrow
                                              >
                                                <ActionIcon
                                                  size="xs"
                                                  variant="subtle"
                                                  color="blue"
                                                  onClick={() => {
                                                    const [startTime, endTime] =
                                                      cell.meetingData.timeSlot.split(
                                                        " - ",
                                                      );
                                                    setEditModal({
                                                      opened: true,
                                                      meeting: cell.meetingData,
                                                      slot: {
                                                        tableNumber:
                                                          cell.meetingData
                                                            .tableAssigned,
                                                        startTime,
                                                        endTime,
                                                        id: agenda.find(
                                                          (s) =>
                                                            s.tableNumber ===
                                                              Number(
                                                                cell.meetingData
                                                                  .tableAssigned,
                                                              ) &&
                                                            s.startTime ===
                                                              startTime,
                                                        )?.id,
                                                      },
                                                      lockedUserId: null,
                                                    });
                                                  }}
                                                >
                                                  <IconPencil size={11} />
                                                </ActionIcon>
                                              </Tooltip>
                                              <Tooltip
                                                label={ss.label}
                                                withArrow
                                              >
                                                <Badge
                                                  color={ss.color}
                                                  variant={
                                                    ss.count > 0
                                                      ? "filled"
                                                      : "outline"
                                                  }
                                                  size="xs"
                                                  style={{
                                                    cursor:
                                                      ss.count > 0
                                                        ? "pointer"
                                                        : "default",
                                                  }}
                                                  onClick={(e) =>
                                                    ss.count > 0 &&
                                                    openSurveyModal(
                                                      cell.meetingId,
                                                      e,
                                                    )
                                                  }
                                                >
                                                  📋 {ss.count}/{ss.total}
                                                </Badge>
                                              </Tooltip>
                                              <ParticipantPopover
                                                width={340}
                                                trigger={
                                                  <Tooltip
                                                    label="Ver información de participantes"
                                                    withArrow
                                                  >
                                                    <ActionIcon
                                                      size="xs"
                                                      variant="subtle"
                                                      color="gray"
                                                    >
                                                      <IconInfoCircle
                                                        size={13}
                                                      />
                                                    </ActionIcon>
                                                  </Tooltip>
                                                }
                                              >
                                                <b>Participantes:</b>
                                                {cell.meetingData?.participants?.map(
                                                  (pid, idx) => {
                                                    const info =
                                                      participantsInfo[pid];
                                                    if (!info)
                                                      return (
                                                        <div key={pid}>
                                                          {pid}
                                                        </div>
                                                      );
                                                    const otherPid =
                                                      cell.meetingData.participants.find(
                                                        (p) => p !== pid,
                                                      );
                                                    const aff = otherPid
                                                      ? getAffinityScore(
                                                          pid,
                                                          otherPid,
                                                        )
                                                      : null;
                                                    return (
                                                      <div
                                                        key={pid}
                                                        style={{
                                                          marginBottom: 8,
                                                        }}
                                                      >
                                                        <Text
                                                          size="sm"
                                                          fw={600}
                                                        >
                                                          {info.empresa}
                                                        </Text>
                                                        <Text
                                                          size="xs"
                                                          c="dimmed"
                                                        >
                                                          {info.nombre}
                                                        </Text>
                                                        <Text size="xs">
                                                          <span
                                                            style={{
                                                              color: "#6c6c6c",
                                                            }}
                                                          >
                                                            Tel:{" "}
                                                          </span>
                                                          {info.telefono || (
                                                            <i>No registrado</i>
                                                          )}
                                                        </Text>
                                                        <Text size="xs">
                                                          <span
                                                            style={{
                                                              color: "#6c6c6c",
                                                            }}
                                                          >
                                                            Intención
                                                            llamada:{" "}
                                                          </span>
                                                          {info.intencionLlamada || (
                                                            <i>
                                                              No especificada
                                                            </i>
                                                          )}
                                                        </Text>
                                                        <Text size="xs">
                                                          <span
                                                            style={{
                                                              color: "#6c6c6c",
                                                            }}
                                                          >
                                                            Descripción:{" "}
                                                          </span>
                                                          {info.descripcion || (
                                                            <i>
                                                              No especificada
                                                            </i>
                                                          )}
                                                        </Text>
                                                        <Text size="xs">
                                                          <span
                                                            style={{
                                                              color: "#6c6c6c",
                                                            }}
                                                          >
                                                            Necesidad:{" "}
                                                          </span>
                                                          {info.necesidad || (
                                                            <i>
                                                              No especificada
                                                            </i>
                                                          )}
                                                        </Text>
                                                        {idx === 0 && aff && (
                                                          <div
                                                            style={{
                                                              marginTop: 6,
                                                              padding:
                                                                "5px 8px",
                                                              backgroundColor:
                                                                "#e7f5ff",
                                                              borderRadius: 4,
                                                            }}
                                                          >
                                                            <Text
                                                              size="xs"
                                                              fw={600}
                                                              c="blue"
                                                            >
                                                              Afinidad:{" "}
                                                              {aff.score}%
                                                            </Text>
                                                            {aff.reasons
                                                              ?.length > 0 && (
                                                              <Text
                                                                size="xs"
                                                                c="dimmed"
                                                                mt={2}
                                                              >
                                                                {aff.reasons.join(
                                                                  ", ",
                                                                )}
                                                              </Text>
                                                            )}
                                                          </div>
                                                        )}
                                                      </div>
                                                    );
                                                  },
                                                )}
                                              </ParticipantPopover>
                                            </Group>
                                          </Group>

                                          {/* Fila 2: participantes */}
                                          <Stack gap={3}>
                                            {cell.meetingData?.participants?.map(
                                              (pid) => {
                                                const info =
                                                  participantsInfo[pid];
                                                const hasSurvey = (
                                                  surveys[cell.meetingId] || []
                                                ).some((r) => r.userId === pid);
                                                return (
                                                  <Group
                                                    key={pid}
                                                    gap={4}
                                                    wrap="nowrap"
                                                    style={{ minWidth: 0 }}
                                                  >
                                                    <Tooltip
                                                      label={
                                                        hasSurvey
                                                          ? "Ver encuesta"
                                                          : "Llenar encuesta"
                                                      }
                                                      withArrow
                                                    >
                                                      <ActionIcon
                                                        size="xs"
                                                        variant={
                                                          hasSurvey
                                                            ? "filled"
                                                            : "light"
                                                        }
                                                        color={
                                                          hasSurvey
                                                            ? "green"
                                                            : "gray"
                                                        }
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          if (hasSurvey)
                                                            openUserSurveyModal(
                                                              cell.meetingId,
                                                              pid,
                                                              e,
                                                            );
                                                          else
                                                            openFillSurveyModal(
                                                              cell.meetingId,
                                                              pid,
                                                              cell.meetingData,
                                                              e,
                                                            );
                                                        }}
                                                      >
                                                        {hasSurvey ? (
                                                          <IconClipboardCheck
                                                            size={11}
                                                          />
                                                        ) : (
                                                          <IconClipboard
                                                            size={11}
                                                          />
                                                        )}
                                                      </ActionIcon>
                                                    </Tooltip>
                                                    {info?.telefono ? (
                                                      <>
                                                        <Tooltip label={`Llamar: ${info.telefono}${info.intencionLlamada ? ` · Intención: ${info.intencionLlamada}` : ""}`} withArrow multiline w={240}>
                                                          <ActionIcon size="xs" variant="subtle" color="blue" onClick={(e) => { e.stopPropagation(); window.open(`tel:${info.telefono}`); }}>
                                                            <IconPhone size={11} />
                                                          </ActionIcon>
                                                        </Tooltip>
                                                        <Tooltip label="Copiar número" withArrow>
                                                          <ActionIcon size="xs" variant="subtle" color="gray" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(info.telefono); }}>
                                                            <IconCopy size={11} />
                                                          </ActionIcon>
                                                        </Tooltip>
                                                      </>
                                                    ) : (
                                                      <Tooltip label="Sin teléfono" withArrow>
                                                        <ActionIcon size="xs" variant="subtle" color="gray" disabled>
                                                          <IconPhone size={11} />
                                                        </ActionIcon>
                                                      </Tooltip>
                                                    )}
                                                    <div
                                                      style={{
                                                        flex: 1,
                                                        minWidth: 0,
                                                      }}
                                                    >
                                                      <Text
                                                        size="xs"
                                                        fw={600}
                                                        truncate
                                                        style={{
                                                          color: "#064175ff",
                                                        }}
                                                      >
                                                        {info
                                                          ? info.empresa
                                                          : pid}
                                                      </Text>
                                                      {info && (
                                                        <Text
                                                          size="xs"
                                                          c="dimmed"
                                                          truncate
                                                        >
                                                          {info.nombre}
                                                        </Text>
                                                      )}
                                                    </div>
                                                  </Group>
                                                );
                                              },
                                            )}
                                          </Stack>
                                        </Stack>
                                      </Paper>
                                      {/* Reuniones libres en este slot/mesa */}
                                      {(cell.freeMeetings || []).length > 0 && (
                                        <FreeMeetingsList
                                          freeMeetings={cell.freeMeetings}
                                          participantsInfo={participantsInfo}
                                          getAffinityScore={getAffinityScore}
                                          toggleMeetingCompleted={
                                            toggleMeetingCompleted
                                          }
                                          surveys={surveys}
                                          openSurveyModal={openSurveyModal}
                                          openUserSurveyModal={
                                            openUserSurveyModal
                                          }
                                          openFillSurveyModal={
                                            openFillSurveyModal
                                          }
                                          getSurveyStatus={getSurveyStatus}
                                          onCancelFreeMeeting={
                                            handleCancelFreeMeeting
                                          }
                                          openEditModal={(fm) => {
                                            if (fm.isExternal) {
                                              setEditFreeMeetingModal({
                                                opened: true,
                                                meeting: fm,
                                              });
                                              return;
                                            }
                                            const [startTime, endTime] =
                                              fm.timeSlot.split(" - ");
                                            setEditModal({
                                              opened: true,
                                              meeting: fm,
                                              slot: {
                                                tableNumber: fm.tableAssigned,
                                                startTime,
                                                endTime,
                                                id:
                                                  agenda.find(
                                                    (s) =>
                                                      s.tableNumber ===
                                                        Number(
                                                          fm.tableAssigned,
                                                        ) &&
                                                      s.startTime === startTime,
                                                  )?.id || "",
                                              },
                                              lockedUserId: null,
                                            });
                                          }}
                                        />
                                      )}
                                    </Stack>
                                  );
                                })()
                              ) : (
                                <Stack gap={4}>
                                  <Paper
                                    p={8}
                                    radius="md"
                                    style={{
                                      border: "1px solid #e5e7eb",
                                      borderLeft: "3px solid #9ca3af",
                                      background: "#fff",
                                    }}
                                  >
                                    <StatusBadge status={cell.status} />
                                  </Paper>
                                  {(cell.freeMeetings || []).length > 0 && (
                                    <FreeMeetingsList
                                      freeMeetings={cell.freeMeetings}
                                      participantsInfo={participantsInfo}
                                      getAffinityScore={getAffinityScore}
                                      toggleMeetingCompleted={
                                        toggleMeetingCompleted
                                      }
                                      surveys={surveys}
                                      openSurveyModal={openSurveyModal}
                                      openUserSurveyModal={openUserSurveyModal}
                                      openFillSurveyModal={openFillSurveyModal}
                                      getSurveyStatus={getSurveyStatus}
                                      onCancelFreeMeeting={
                                        handleCancelFreeMeeting
                                      }
                                      openEditModal={(fm) => {
                                        if (fm.isExternal) {
                                          setEditFreeMeetingModal({
                                            opened: true,
                                            meeting: fm,
                                          });
                                          return;
                                        }
                                        const [startTime, endTime] =
                                          fm.timeSlot.split(" - ");
                                        setEditModal({
                                          opened: true,
                                          meeting: fm,
                                          slot: {
                                            tableNumber: fm.tableAssigned,
                                            startTime,
                                            endTime,
                                            id:
                                              agenda.find(
                                                (s) =>
                                                  s.tableNumber ===
                                                    Number(fm.tableAssigned) &&
                                                  s.startTime === startTime,
                                              )?.id || "",
                                          },
                                          lockedUserId: null,
                                        });
                                      }}
                                    />
                                  )}
                                </Stack>
                              )}
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                  </ScrollArea>
                </Card>
              ))}
            </Flex>
            {filteredMatrix.length > ITEMS_PER_PAGE && (
              <Flex justify="center" mt="xl" mb="md">
                <Pagination total={Math.ceil(filteredMatrix.length / ITEMS_PER_PAGE)} value={mesasPage} onChange={setMesasPage} />
              </Flex>
            )}
          </ScrollArea>
        </Tabs.Panel>

        {/* Panel Usuarios */}
        <Tabs.Panel value="usuarios" pt="md">
          <Flex gap="md" mb="md" wrap="wrap">
            <Select
              placeholder="Filtrar por tipo"
              value={typeFilter}
              onChange={setTypeFilter}
              data={[
                { value: "", label: "Todos" },
                { value: "comprador", label: "Comprador" },
                { value: "vendedor", label: "Vendedor" },
              ]}
              style={{ maxWidth: 180 }}
              clearable
            />
          </Flex>

          <ScrollArea>
            <Flex gap="lg" justify="center" align="flex-start" wrap="wrap">
              {paginatedUsuarios.map(({ asistente, row }) => (
                <Card
                  key={asistente.id}
                  shadow="sm"
                  radius="md"
                  padding="xs"
                  style={{
                    maxWidth: 680,
                    width: "100%",
                    background: "#f9fafb",
                    border: "1px solid #e5e7eb",
                    boxShadow: "0 2px 8px #0001",
                  }}
                >
                  <Title
                    order={5}
                    ta="center"
                    mb={4}
                    style={{ letterSpacing: 0.5 }}
                  >
                    {asistente.empresa}
                  </Title>
                  <Group justify="center" gap={6} mb="xs">
                    <Text size="xs" c="dimmed">
                      {asistente.nombre}
                    </Text>
                    {asistente.checkedIn ? (
                      <Badge color="green" variant="light" size="xs">
                        ✓ Check-in
                      </Badge>
                    ) : (
                      <Badge color="gray" variant="outline" size="xs">
                        Sin check-in
                      </Badge>
                    )}
                  </Group>

                  <Menu withinPortal position="bottom-start">
                    <Menu.Target>
                      <Button
                        variant="light"
                        size="xs"
                        color="yellow"
                        mb="sm"
                        disabled={
                          !pendingMeetings.some(
                            (m) => m.receiverId === asistente.id,
                          )
                        }
                      >
                        Solicitudes pendientes (
                        {
                          pendingMeetings.filter(
                            (m) => m.receiverId === asistente.id,
                          ).length
                        }
                        )
                      </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {pendingMeetings
                        .filter((m) => m.receiverId === asistente.id)
                        .map((m) => {
                          const requester = asistentes.find(
                            (a) => a.id === m.requesterId,
                          );
                          return (
                            <Menu.Item key={m.id}>
                              <div>
                                <b>
                                  {requester
                                    ? `${requester.empresa} (${requester.nombre})`
                                    : m.requesterId}
                                </b>
                                <div style={{ fontSize: 11, color: "#777" }}>
                                  {m.timeSlot || "Sin horario"}
                                </div>
                              </div>
                            </Menu.Item>
                          );
                        })}
                      {pendingMeetings.filter(
                        (m) => m.receiverId === asistente.id,
                      ).length === 0 && (
                        <Menu.Item disabled>No hay pendientes</Menu.Item>
                      )}
                    </Menu.Dropdown>
                  </Menu>

                  <Divider mb="sm" />
                  <ScrollArea>
                  <Table
                    striped
                    highlightOnHover
                    horizontalSpacing="xs"
                    verticalSpacing={8}
                    style={{ borderRadius: 12, overflow: "hidden", minWidth: 260 }}
                  >
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th
                          style={{
                            fontSize: 11,
                            color: "#6b7280",
                            fontWeight: 600,
                            width: 30,
                            padding: "4px 8px"
                          }}
                        >
                          Hora
                        </Table.Th>
                        <Table.Th
                          style={{
                            fontSize: 11,
                            color: "#6b7280",
                            fontWeight: 600,
                            padding: "4px 8px"
                          }}
                        >
                          Estado / Contraparte
                        </Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {slotsWithBreaks.map((rowItem, ri) => {
                        if (rowItem.type === "break") {
                          return (
                            <Table.Tr
                              key={`break-${ri}`}
                              style={{ backgroundColor: "#90caf9" }}
                            >
                              <Table.Td
                                style={{
                                  fontWeight: 600,
                                  fontSize: 11,
                                  color: "#1565c0",
                                  whiteSpace: "nowrap",
                                  padding: "4px 8px"
                                }}
                              >
                                {rowItem.start} - {rowItem.end}
                              </Table.Td>
                              <Table.Td style={{ padding: "4px 8px" }}>
                                <Badge color="blue" variant="light" size="sm">
                                  {rowItem.label}
                                </Badge>
                              </Table.Td>
                            </Table.Tr>
                          );
                        }
                        const i = timeSlotIndexMap[rowItem.time] ?? -1;
                        const slot = rowItem.time;
                        const cell = i >= 0 ? row[i] : { status: "available" };
                        const slotEndTime = (() => {
                          const dur = config?.config?.meetingDuration || 30;
                          const [h, m] = slot.split(":").map(Number);
                          const endMin = h * 60 + m + dur;
                          return `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
                        })();
                        return (
                          <Table.Tr key={i} style={{ borderRadius: 5 }}>
                            <Table.Td
                              style={{
                                fontWeight: 600,
                                fontSize: 10,
                                color: "#1f2125ff",
                                whiteSpace: "nowrap",
                                padding: "2px"
                              }}
                            >
                              <Stack gap={1} align="center">
                                {slot}
                                <Menu
                                  withinPortal
                                  position="bottom-start"
                                  shadow="md"
                                  width={180}
                                >
                                  <Menu.Target>
                                    <ActionIcon
                                      size="xs"
                                      variant="light"
                                      color="teal"
                                    >
                                      <IconPlus size={10} />
                                    </ActionIcon>
                                  </Menu.Target>
                                  <Menu.Dropdown>
                                    <Menu.Label>Crear reunión</Menu.Label>
                                    <Menu.Item
                                      disabled={cell.status === "accepted"}
                                      onClick={() => {
                                        const slotsForTime = agenda.filter(
                                          (s) =>
                                            s.startTime === slot &&
                                            s.available &&
                                            (!s.date ||
                                              s.date === selectedDate),
                                        );
                                        setQuickModal({
                                          opened: true,
                                          slotsDisponibles: slotsForTime,
                                          defaultUser: asistente.id,
                                        });
                                      }}
                                    >
                                      ⚡ Cita rápida
                                    </Menu.Item>
                                    <Menu.Item
                                      onClick={() =>
                                        setFreeMeetingModal({
                                          opened: true,
                                          asistente,
                                          timeSlot: `${slot} - ${slotEndTime}`,
                                          meetingDate: selectedDate,
                                        })
                                      }
                                    >
                                      👥 Reunión libre
                                    </Menu.Item>
                                  </Menu.Dropdown>
                                </Menu>
                              </Stack>
                            </Table.Td>
                            <Table.Td style={{ padding: "4px" }}>
                              {cell.status === "accepted" ? (
                                (() => {
                                  const affinity = getAffinityScore(
                                    asistente.id,
                                    cell.participants?.[0],
                                  );
                                  const ss = getSurveyStatus(cell.meetingId, [
                                    asistente.id,
                                    ...cell.participants,
                                  ]);
                                  const meetingDataForCell = meetings.find(
                                    (m) => m.id === cell.meetingId,
                                  );
                                  return (
                                    <Stack gap={4}>
                                      <Paper
                                        p={8}
                                        radius="md"
                                        style={{
                                          border: "1px solid #e5e7eb",
                                          borderLeft: "3px solid #4caf50",
                                          background: "#fff",
                                        }}
                                      >
                                        <Stack gap={6}>
                                          {/* Fila 1: estado + mesa + acciones */}
                                          <Group
                                            justify="space-between"
                                            wrap="wrap"
                                          >
                                            <Group gap={5}>
                                              <StatusBadge
                                                status={cell.status}
                                              />
                                              <Badge
                                                size="xs"
                                                variant="outline"
                                                color="gray"
                                              >
                                                Mesa {cell.table}
                                              </Badge>
                                              {affinity && (
                                                <Badge
                                                  size="xs"
                                                  variant="light"
                                                  color="blue"
                                                >
                                                  {affinity.score}%
                                                </Badge>
                                              )}
                                            </Group>
                                            <Group gap={4}>
                                              <Tooltip
                                                label="Editar reunión"
                                                withArrow
                                              >
                                                <ActionIcon
                                                  size="xs"
                                                  variant="subtle"
                                                  color="blue"
                                                  onClick={() => {
                                                    const mtg = meetings.find(
                                                      (m) =>
                                                        m.id === cell.meetingId,
                                                    );
                                                    if (mtg) {
                                                      const [
                                                        startTime,
                                                        endTime,
                                                      ] =
                                                        mtg.timeSlot.split(
                                                          " - ",
                                                        );
                                                      setEditModal({
                                                        opened: true,
                                                        meeting: mtg,
                                                        slot: {
                                                          tableNumber:
                                                            mtg.tableAssigned,
                                                          startTime,
                                                          endTime,
                                                          id:
                                                            agenda.find(
                                                              (s) =>
                                                                s.tableNumber ===
                                                                  Number(
                                                                    mtg.tableAssigned,
                                                                  ) &&
                                                                s.startTime ===
                                                                  startTime,
                                                            )?.id || "",
                                                        },
                                                        lockedUserId:
                                                          asistente.id,
                                                      });
                                                    }
                                                  }}
                                                >
                                                  <IconPencil size={11} />
                                                </ActionIcon>
                                              </Tooltip>
                                              <Tooltip
                                                label={ss.label}
                                                withArrow
                                              >
                                                <Badge
                                                  color={ss.color}
                                                  variant={
                                                    ss.count > 0
                                                      ? "filled"
                                                      : "outline"
                                                  }
                                                  size="xs"
                                                  style={{
                                                    cursor:
                                                      ss.count > 0
                                                        ? "pointer"
                                                        : "default",
                                                  }}
                                                  onClick={(e) =>
                                                    ss.count > 0 &&
                                                    openSurveyModal(
                                                      cell.meetingId,
                                                      e,
                                                    )
                                                  }
                                                >
                                                  📋 {ss.count}/{ss.total}
                                                </Badge>
                                              </Tooltip>
                                              <ParticipantPopover
                                                width={340}
                                                trigger={
                                                  <Tooltip
                                                    label="Ver información de participantes"
                                                    withArrow
                                                  >
                                                    <ActionIcon
                                                      size="xs"
                                                      variant="subtle"
                                                      color="gray"
                                                    >
                                                      <IconInfoCircle
                                                        size={13}
                                                      />
                                                    </ActionIcon>
                                                  </Tooltip>
                                                }
                                              >
                                                <div
                                                  style={{ marginBottom: 10 }}
                                                >
                                                  <Text
                                                    size="sm"
                                                    fw={700}
                                                    mb={2}
                                                  >
                                                    Usuario
                                                  </Text>
                                                  <Text size="sm" fw={600}>
                                                    {asistente.empresa}
                                                  </Text>
                                                  <Text size="xs" c="dimmed">
                                                    {asistente.nombre}
                                                  </Text>
                                                  <Text size="xs">
                                                    <span
                                                      style={{
                                                        color: "#6c6c6c",
                                                      }}
                                                    >
                                                      Tel:{" "}
                                                    </span>
                                                    {asistente.telefono || (
                                                      <i>No registrado</i>
                                                    )}
                                                  </Text>
                                                  <Text size="xs">
                                                    <span
                                                      style={{
                                                        color: "#6c6c6c",
                                                      }}
                                                    >
                                                      Intención llamada:{" "}
                                                    </span>
                                                    {asistente.intencionLlamada || (
                                                      <i>No especificada</i>
                                                    )}
                                                  </Text>
                                                  <Text size="xs">
                                                    <span
                                                      style={{
                                                        color: "#6c6c6c",
                                                      }}
                                                    >
                                                      Descripción:{" "}
                                                    </span>
                                                    {asistente.descripcion || (
                                                      <i>No especificada</i>
                                                    )}
                                                  </Text>
                                                  <Text size="xs">
                                                    <span
                                                      style={{
                                                        color: "#6c6c6c",
                                                      }}
                                                    >
                                                      Necesidad:{" "}
                                                    </span>
                                                    {asistente.necesidad || (
                                                      <i>No especificada</i>
                                                    )}
                                                  </Text>
                                                </div>
                                                <Divider my={6} />
                                                <Text size="sm" fw={700} mb={4}>
                                                  Contraparte
                                                </Text>
                                                {cell.participants.map(
                                                  (pid) => {
                                                    const info =
                                                      participantsInfo[pid];
                                                    if (!info)
                                                      return (
                                                        <div key={pid}>
                                                          {pid}
                                                        </div>
                                                      );
                                                    const aff =
                                                      getAffinityScore(
                                                        asistente.id,
                                                        pid,
                                                      );
                                                    return (
                                                      <div
                                                        key={pid}
                                                        style={{
                                                          marginBottom: 8,
                                                        }}
                                                      >
                                                        <Text
                                                          size="sm"
                                                          fw={600}
                                                        >
                                                          {info.empresa}
                                                        </Text>
                                                        <Text
                                                          size="xs"
                                                          c="dimmed"
                                                        >
                                                          {info.nombre}
                                                        </Text>
                                                        <Text size="xs">
                                                          <span
                                                            style={{
                                                              color: "#6c6c6c",
                                                            }}
                                                          >
                                                            Tel:{" "}
                                                          </span>
                                                          {info.telefono || (
                                                            <i>No registrado</i>
                                                          )}
                                                        </Text>
                                                        <Text size="xs">
                                                          <span
                                                            style={{
                                                              color: "#6c6c6c",
                                                            }}
                                                          >
                                                            Intención
                                                            llamada:{" "}
                                                          </span>
                                                          {info.intencionLlamada || (
                                                            <i>
                                                              No especificada
                                                            </i>
                                                          )}
                                                        </Text>
                                                        <Text size="xs">
                                                          <span
                                                            style={{
                                                              color: "#6c6c6c",
                                                            }}
                                                          >
                                                            Descripción:{" "}
                                                          </span>
                                                          {info.descripcion || (
                                                            <i>
                                                              No especificada
                                                            </i>
                                                          )}
                                                        </Text>
                                                        <Text size="xs">
                                                          <span
                                                            style={{
                                                              color: "#6c6c6c",
                                                            }}
                                                          >
                                                            Necesidad:{" "}
                                                          </span>
                                                          {info.necesidad || (
                                                            <i>
                                                              No especificada
                                                            </i>
                                                          )}
                                                        </Text>
                                                        {aff && (
                                                          <div
                                                            style={{
                                                              marginTop: 6,
                                                              padding:
                                                                "5px 8px",
                                                              backgroundColor:
                                                                "#e7f5ff",
                                                              borderRadius: 4,
                                                            }}
                                                          >
                                                            <Text
                                                              size="xs"
                                                              fw={600}
                                                              c="blue"
                                                            >
                                                              Afinidad:{" "}
                                                              {aff.score}%
                                                            </Text>
                                                            {aff.reasons
                                                              ?.length > 0 && (
                                                              <Text
                                                                size="xs"
                                                                c="dimmed"
                                                                mt={2}
                                                              >
                                                                {aff.reasons.join(
                                                                  ", ",
                                                                )}
                                                              </Text>
                                                            )}
                                                          </div>
                                                        )}
                                                      </div>
                                                    );
                                                  },
                                                )}
                                              </ParticipantPopover>
                                            </Group>
                                          </Group>

                                          {/* Fila 2: participantes */}
                                          <Stack gap={3}>
                                            {[
                                              asistente.id,
                                              ...cell.participants,
                                            ].map((pid) => {
                                              const info =
                                                pid === asistente.id
                                                  ? asistente
                                                  : participantsInfo[pid];
                                              const hasSurvey = (
                                                surveys[cell.meetingId] || []
                                              ).some((r) => r.userId === pid);
                                              return (
                                                <Group
                                                  key={pid}
                                                  gap={4}
                                                  wrap="nowrap"
                                                  style={{ minWidth: 0 }}
                                                >
                                                  <Tooltip
                                                    label={
                                                      hasSurvey
                                                        ? "Ver encuesta"
                                                        : "Llenar encuesta"
                                                    }
                                                    withArrow
                                                  >
                                                    <ActionIcon
                                                      size="xs"
                                                      variant={
                                                        hasSurvey
                                                          ? "filled"
                                                          : "light"
                                                      }
                                                      color={
                                                        hasSurvey
                                                          ? "green"
                                                          : "gray"
                                                      }
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (hasSurvey)
                                                          openUserSurveyModal(
                                                            cell.meetingId,
                                                            pid,
                                                            e,
                                                          );
                                                        else
                                                          openFillSurveyModal(
                                                            cell.meetingId,
                                                            pid,
                                                            meetingDataForCell,
                                                            e,
                                                          );
                                                      }}
                                                    >
                                                      {hasSurvey ? (
                                                        <IconClipboardCheck
                                                          size={11}
                                                        />
                                                      ) : (
                                                        <IconClipboard
                                                          size={11}
                                                        />
                                                      )}
                                                    </ActionIcon>
                                                  </Tooltip>
                                                  {info?.telefono ? (
                                                    <>
                                                      <Tooltip label={`Llamar: ${info.telefono}${info.intencionLlamada ? ` · Intención: ${info.intencionLlamada}` : ""}`} withArrow multiline w={240}>
                                                        <ActionIcon size="xs" variant="subtle" color="blue" onClick={(e) => { e.stopPropagation(); window.open(`tel:${info.telefono}`); }}>
                                                          <IconPhone size={11} />
                                                        </ActionIcon>
                                                      </Tooltip>
                                                      <Tooltip label="Copiar número" withArrow>
                                                        <ActionIcon size="xs" variant="subtle" color="gray" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(info.telefono); }}>
                                                          <IconCopy size={11} />
                                                        </ActionIcon>
                                                      </Tooltip>
                                                    </>
                                                  ) : (
                                                    <Tooltip label="Sin teléfono" withArrow>
                                                      <ActionIcon size="xs" variant="subtle" color="gray" disabled>
                                                        <IconPhone size={11} />
                                                      </ActionIcon>
                                                    </Tooltip>
                                                  )}
                                                  <div
                                                    style={{
                                                      flex: 1,
                                                      minWidth: 0,
                                                    }}
                                                  >
                                                    <Text
                                                      size="xs"
                                                      fw={600}
                                                      truncate
                                                      style={{
                                                        color: "#1c7ed6",
                                                      }}
                                                    >
                                                      {info
                                                        ? info.empresa
                                                        : pid}
                                                    </Text>
                                                    {info && (
                                                      <Text
                                                        size="xs"
                                                        c="dimmed"
                                                        truncate
                                                      >
                                                        {info.nombre}
                                                      </Text>
                                                    )}
                                                  </div>
                                                </Group>
                                              );
                                            })}
                                          </Stack>

                                          {/* Fila 3: checkbox realizada */}
                                          <OptimisticCheckbox
                                            size="xs"
                                            label="Realizada"
                                            checked={!!cell.completed}
                                            onChange={(e) => toggleMeetingCompleted(cell.meetingId, cell.completed, e)}
                                            onClick={(e) => e.stopPropagation()}
                                            color="green"
                                          />
                                        </Stack>
                                      </Paper>
                                      {/* Reuniones libres en este slot */}
                                      {(() => {
                                        const freeMeetings = meetings.filter(
                                          (m) => {
                                            if (
                                              !m.isExternal ||
                                              m.status !== "accepted"
                                            )
                                              return false;
                                            if (
                                              !m.participants.includes(
                                                asistente.id,
                                              )
                                            )
                                              return false;
                                            const mStart = (m.timeSlot || "")
                                              .split(" - ")[0]
                                              .trim();
                                            return (
                                              mStart === slot &&
                                              (!m.meetingDate ||
                                                m.meetingDate === selectedDate)
                                            );
                                          },
                                        );
                                        if (freeMeetings.length === 0)
                                          return null;
                                        return (
                                          <FreeMeetingsList
                                            freeMeetings={freeMeetings}
                                            participantsInfo={participantsInfo}
                                            getAffinityScore={getAffinityScore}
                                            toggleMeetingCompleted={
                                              toggleMeetingCompleted
                                            }
                                            surveys={surveys}
                                            openSurveyModal={openSurveyModal}
                                            openUserSurveyModal={
                                              openUserSurveyModal
                                            }
                                            openFillSurveyModal={
                                              openFillSurveyModal
                                            }
                                            getSurveyStatus={getSurveyStatus}
                                            onCancelFreeMeeting={
                                              handleCancelFreeMeeting
                                            }
                                            openEditModal={(fm) =>
                                              setEditFreeMeetingModal({
                                                opened: true,
                                                meeting: fm,
                                              })
                                            }
                                          />
                                        );
                                      })()}
                                    </Stack>
                                  );
                                })()
                              ) : (
                                <Stack gap={4}>
                                  <Paper
                                    p={8}
                                    radius="md"
                                    style={{
                                      border: "1px solid #e5e7eb",
                                      borderLeft: "3px solid #9ca3af",
                                      background: "#fff",
                                    }}
                                  >
                                    <StatusBadge status={cell.status} />
                                  </Paper>
                                  {(() => {
                                    const freeMeetings = meetings.filter(
                                      (m) => {
                                        if (
                                          !m.isExternal ||
                                          m.status !== "accepted"
                                        )
                                          return false;
                                        if (
                                          !m.participants.includes(asistente.id)
                                        )
                                          return false;
                                        const mStart = (m.timeSlot || "")
                                          .split(" - ")[0]
                                          .trim();
                                        return (
                                          mStart === slot &&
                                          (!m.meetingDate ||
                                            m.meetingDate === selectedDate)
                                        );
                                      },
                                    );
                                    if (freeMeetings.length === 0) return null;
                                    return (
                                      <FreeMeetingsList
                                        freeMeetings={freeMeetings}
                                        participantsInfo={participantsInfo}
                                        getAffinityScore={getAffinityScore}
                                        toggleMeetingCompleted={
                                          toggleMeetingCompleted
                                        }
                                        surveys={surveys}
                                        openSurveyModal={openSurveyModal}
                                        openUserSurveyModal={
                                          openUserSurveyModal
                                        }
                                        openFillSurveyModal={
                                          openFillSurveyModal
                                        }
                                        getSurveyStatus={getSurveyStatus}
                                        onCancelFreeMeeting={
                                          handleCancelFreeMeeting
                                        }
                                        openEditModal={(fm) =>
                                          setEditFreeMeetingModal({
                                            opened: true,
                                            meeting: fm,
                                          })
                                        }
                                      />
                                    );
                                  })()}
                                </Stack>
                              )}
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                  </ScrollArea>
                </Card>
              ))}
            </Flex>
            {filteredMatrixUsuarios.length > ITEMS_PER_PAGE && (
              <Flex justify="center" mt="xl" mb="md">
                <Pagination total={Math.ceil(filteredMatrixUsuarios.length / ITEMS_PER_PAGE)} value={usuariosPage} onChange={setUsuariosPage} />
              </Flex>
            )}
          </ScrollArea>
        </Tabs.Panel>
      </Tabs>

      <QuickMeetingModal
        opened={quickModal.opened}
        onClose={() =>
          setQuickModal({
            opened: false,
            slotsDisponibles: [],
            defaultUser: null,
          })
        }
        slotsDisponibles={quickModal.slotsDisponibles || []}
        defaultUser={quickModal.defaultUser}
        assistants={getAvailableUsersForSlot(
          asistentes,
          meetings,
          quickModal.slotsDisponibles?.[0] || {},
        )}
        onCreate={handleQuickCreateMeeting}
        loading={creatingMeeting}
      />

      <EditMeetingModal
        opened={editModal.opened}
        onClose={() =>
          setEditModal({ opened: false, meeting: null, slot: null })
        }
        slot={editModal.slot}
        meeting={editModal.meeting}
        assistants={getAvailableUsersForSlot(
          asistentes,
          meetings,
          editModal.slot || {},
          editModal.meeting,
        )}
        onUpdate={handleEditMeeting}
        onCancel={handleCancelMeeting}
        loading={creatingMeeting}
        lockedUserId={editModal.lockedUserId}
        onSwapMeetings={handleSwapMeetings}
        allMeetings={meetings}
        agenda={agenda}
        participantsInfo={participantsInfo}
        slotsDisponibles={slotsDisponiblesParaEdicion}
        getAffinity={getAffinityScore}
        companies={dashboard.companies || []}
      />

      <EditFreeMeetingModal
        opened={editFreeMeetingModal.opened}
        onClose={() =>
          setEditFreeMeetingModal({ opened: false, meeting: null })
        }
        meeting={editFreeMeetingModal.meeting}
        assistants={asistentes}
        onUpdate={handleUpdateFreeMeeting}
        onCancel={handleCancelFreeMeetingById}
        loading={creatingMeeting}
        participantsInfo={participantsInfo}
        getAffinity={getAffinityScore}
      />

      <CreateFreeMeetingModal
        opened={freeMeetingModal.opened}
        onClose={() =>
          setFreeMeetingModal({
            opened: false,
            asistente: null,
            timeSlot: "",
            meetingDate: null,
            tableNumber: null,
          })
        }
        fixedAttendee={freeMeetingModal.asistente}
        timeSlot={freeMeetingModal.timeSlot}
        assistants={asistentes}
        getAffinity={getAffinityScore}
        onCreate={handleCreateFreeMeeting}
        loading={creatingFree}
        timeSlots={timeSlots}
        meetingDuration={config?.config?.meetingDuration || 30}
      />

      {globalMessage && (
        <Alert
          mt="md"
          title="Aviso"
          color="green"
          withCloseButton
          onClose={() => setGlobalMessage("")}
        >
          {globalMessage}
        </Alert>
      )}

      {/* Modal para llenar encuesta de un asistente */}
      <Modal
        opened={fillSurveyModal.opened}
        onClose={() =>
          setFillSurveyModal({
            opened: false,
            meetingId: null,
            userId: null,
            meetingData: null,
          })
        }
        title={(() => {
          const info = participantsInfo[fillSurveyModal.userId];
          return info
            ? `Encuesta — ${info.nombre} (${info.empresa})`
            : "Llenar encuesta";
        })()}
        size="md"
        centered
      >
        {fillSurveyLoading ? (
          <Group justify="center" py="md">
            <Loader />
          </Group>
        ) : (
          <Stack gap="md">
            {getSurveyFieldsForUser(fillSurveyModal.userId).map((field) => {
              const val = fillSurveyValues[field.name] ?? "";
              const onChange = (v) =>
                setFillSurveyValues((prev) => ({ ...prev, [field.name]: v }));

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
              if (field.type === "number") {
                return (
                  <NumberInput
                    key={field.name}
                    label={field.label}
                    value={val === "" ? "" : Number(val)}
                    onChange={(v) => onChange(String(v))}
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
                    data={field.options.map((o) => ({ value: o, label: o }))}
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
                    data={["1", "2", "3", "4", "5"].map((n) => ({
                      value: n,
                      label: `${n} ⭐`,
                    }))}
                    required={field.required}
                    radius="md"
                  />
                );
              }
              return (
                <TextInput
                  key={field.name}
                  label={field.label}
                  value={val}
                  onChange={(e) => onChange(e.currentTarget.value)}
                  required={field.required}
                  radius="md"
                />
              );
            })}
            <Group justify="flex-end" mt="xs">
              <Button
                variant="default"
                onClick={() =>
                  setFillSurveyModal({
                    opened: false,
                    meetingId: null,
                    userId: null,
                    meetingData: null,
                  })
                }
              >
                Cancelar
              </Button>
              <Button
                loading={fillSurveySaving}
                onClick={handleSaveFillSurvey}
                disabled={getSurveyFieldsForUser(fillSurveyModal.userId)
                  .filter((f) => f.required)
                  .some((f) => !fillSurveyValues[f.name])}
              >
                Guardar
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={surveyModal?.opened || false}
        onClose={() =>
          setSurveyModal({ opened: false, meetingId: null, responses: [] })
        }
        title="Encuestas de la reunión"
        size="lg"
      >
        {surveyModal?.opened && (
          <Stack gap="md">
            {surveyModal.responses.length === 0 ? (
              <Text c="dimmed">No hay encuestas respondidas.</Text>
            ) : (
              surveyModal.responses.map((resp) => {
                const excluded = new Set([
                  "id",
                  "meetingId",
                  "userId",
                  "otherUserId",
                  "otherUserName",
                  "otherUserEmpresa",
                  "userEmpresa",
                  "userName",
                  "createdAt",
                ]);
                const fields = Object.entries(resp).filter(
                  ([k]) => !excluded.has(k),
                );
                return (
                  <Paper key={resp.id} p="md" withBorder radius="md">
                    <Text fw={700} size="sm">
                      {resp.userName}
                    </Text>
                    <Text size="xs" c="dimmed" mb="xs">
                      {resp.userEmpresa}
                    </Text>
                    <Divider mb="xs" />
                    <Stack gap={4}>
                      {fields.map(([key, val]) => (
                        <div key={key} style={{ display: "flex", gap: 8 }}>
                          <Text
                            size="xs"
                            fw={600}
                            style={{ minWidth: 160, color: "#555" }}
                          >
                            {surveyFieldLabels[key] || key}:
                          </Text>
                          <Text size="xs">{String(val)}</Text>
                        </div>
                      ))}
                    </Stack>
                  </Paper>
                );
              })
            )}
          </Stack>
        )}
      </Modal>
    </Container>
  );
};

export default MatrixPage;

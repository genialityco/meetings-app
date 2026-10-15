// Llenar encuestas de reunión a nombre de un asistente (/admin/event/:eventId/encuestas-asistente).
// El equipo del evento busca al asistente por nombre, correo, empresa o teléfono, ve sus
// reuniones aceptadas y llena/edita la encuesta de cada una. Sin login de admin (como /matrix):
// basta la sesión anónima. Guarda igual que el formulario de la matriz:
// meetingSurveys/{meetingId}_{uid} con filledByAdmin: true.
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  Container,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import { IconArrowLeft, IconCheck, IconClipboardText, IconSearch, IconUserCheck, IconX } from "@tabler/icons-react";
import { collection, deleteField, doc, getDoc, getDocs, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { DEFAULT_SURVEY_FIELDS, getRatingData, SurveyField } from "./ConfigureSurveyModal";
import { normalizeTipoAsistente } from "../../utils/attendeeRole";
import { getTableLabel } from "../dashboard/meetingSlotEngine";
import { getEventDayKeys, isCheckedInOnDay, isPastCheckInDay, localTodayISO, resolveCheckInDay } from "../../utils/eventDays";

const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Mismos campos que el formulario de la matriz (MatrixPage.getSurveyFieldsForUser)
function getSurveyFields(eventConfig: any, tipoAsistente: unknown): SurveyField[] {
  if ((eventConfig?.policies?.surveyMode || "default") !== "custom") return DEFAULT_SURVEY_FIELDS;
  const cfg = eventConfig?.surveyConfig;
  const role = normalizeTipoAsistente(tipoAsistente);
  if (role === "vendedor" && cfg?.vendedorFields?.length) return cfg.vendedorFields;
  if (role === "comprador" && cfg?.compradorFields?.length) return cfg.compradorFields;
  return cfg?.compradorFields || cfg?.vendedorFields || DEFAULT_SURVEY_FIELDS;
}

// Igual que handleToggle de CheckInTab: escribe/borra checkIns.{día} y, si el evento exige
// check-in para activar reuniones (standbyCheckInRequired), mueve las reuniones de ese día
// entre "standby" y "ready".
async function setCheckIn(eventId: string, eventConfig: any, attendeeId: string, day: string, value: boolean) {
  await updateDoc(doc(db, "users", attendeeId), { [`checkIns.${day}`]: value ? new Date() : deleteField() });
  if (eventConfig?.policies?.standbyCheckInRequired !== true) return;
  const meetingsCol = collection(db, "events", eventId, "meetings");
  if (value) {
    const snap = await getDocs(
      query(meetingsCol, where("status", "==", "accepted"), where("checkInStatus", "==", "standby"), where("participants", "array-contains", attendeeId)),
    );
    for (const d of snap.docs) {
      const m = d.data();
      if (m.meetingDate !== day) continue;
      const otherId = (m.participants || []).find((p: string) => p !== attendeeId);
      if (!otherId) continue;
      const other = await getDoc(doc(db, "users", otherId));
      if (other.exists() && other.data()?.checkIns?.[day]) await updateDoc(d.ref, { checkInStatus: "ready" });
    }
  } else {
    const snap = await getDocs(query(meetingsCol, where("status", "==", "accepted"), where("participants", "array-contains", attendeeId)));
    for (const d of snap.docs) if (d.data().meetingDate === day) await updateDoc(d.ref, { checkInStatus: "standby" });
  }
}

const formatCheckInTime = (v: any) => {
  const d = v?.toDate ? v.toDate() : v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) : "";
};

const empresaOf = (u: any) => (u?.company_razonSocial || u?.empresa || "").trim();

const formatDate = (d?: string) => {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
};

export default function AttendeeSurveyFillPage() {
  const { eventId } = useParams();
  const [event, setEvent] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<any[]>([]);
  // Encuestas de ambos participantes de sus reuniones, por id de doc ({meetingId}_{userId})
  const [surveys, setSurveys] = useState<Record<string, any>>({});
  const [loadingMeetings, setLoadingMeetings] = useState(false);
  // respondentId: a nombre de quién se llena (el asistente buscado o su contraparte)
  const [modal, setModal] = useState<{ meeting: any; respondentId: string } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [checkInBusy, setCheckInBusy] = useState<string | null>(null); // día en curso

  useEffect(() => {
    if (!eventId) return;
    getDoc(doc(db, "events", eventId)).then((s) => setEvent(s.data() || null));
    return onSnapshot(query(collection(db, "users"), where("eventId", "==", eventId)), (snap) =>
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    );
  }, [eventId]);

  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);
  const selected = selectedId ? usersById[selectedId] : null;
  const eventDays = useMemo(() => getEventDayKeys(event?.config), [event]);
  const today = localTodayISO();
  const currentDay = resolveCheckInDay(event?.config);

  const toggleCheckIn = async (day: string) => {
    if (!selected || !eventId) return;
    if (isPastCheckInDay(day)) {
      showNotification({ color: "red", title: "Día bloqueado", message: "No se puede modificar el check-in de un día que ya pasó." });
      return;
    }
    const value = !isCheckedInOnDay(selected, day);
    setCheckInBusy(day);
    try {
      await setCheckIn(eventId, event?.config, selected.id, day, value);
      showNotification({ color: value ? "green" : "gray", title: value ? "Check-in registrado" : "Check-in revertido", message: selected.nombre });
    } catch (e) {
      console.error("Error en check-in:", e);
      showNotification({ color: "red", title: "No se pudo actualizar el check-in", message: "Intenta de nuevo." });
    } finally {
      setCheckInBusy(null);
    }
  };

  const results = useMemo(() => {
    const q = norm(search);
    if (q.length < 2) return [];
    const digits = q.replace(/\D/g, "");
    return users
      .filter((u) => {
        const text = [u.nombre, u.correo, u.email, u.contacto?.correo, empresaOf(u)].map(norm).join(" ");
        if (text.includes(q)) return true;
        return digits.length >= 4 && [u.telefono, u.cedula].some((v) => String(v || "").replace(/\D/g, "").includes(digits));
      })
      .slice(0, 20);
  }, [users, search]);

  // Reuniones aceptadas del asistente + su encuesta de cada una, en tiempo real
  useEffect(() => {
    if (!eventId || !selectedId) return;
    setLoadingMeetings(true);
    const unsubMeetings = onSnapshot(
      query(
        collection(db, "events", eventId, "meetings"),
        where("participants", "array-contains", selectedId),
        where("status", "==", "accepted"),
      ),
      (snap) => {
        setMeetings(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as any)
            .sort((a, b) => `${a.meetingDate || ""} ${a.timeSlot || ""}`.localeCompare(`${b.meetingDate || ""} ${b.timeSlot || ""}`)),
        );
        setLoadingMeetings(false);
      },
    );
    return () => unsubMeetings();
  }, [eventId, selectedId]);

  // Encuestas de las dos partes de cada reunión (Firestore admite hasta 30 valores en "in")
  const meetingIdsKey = meetings.map((m) => m.id).join(",");
  useEffect(() => {
    const ids = meetingIdsKey ? meetingIdsKey.split(",") : [];
    if (!ids.length) {
      setSurveys({});
      return;
    }
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
    const parts: Record<number, Record<string, any>> = {};
    const unsubs = chunks.map((chunk, idx) =>
      onSnapshot(query(collection(db, "meetingSurveys"), where("meetingId", "in", chunk)), (snap) => {
        parts[idx] = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
        setSurveys(Object.assign({}, ...Object.values(parts)));
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [meetingIdsKey]);

  const surveyOf = (meetingId: string, userId: string) => surveys[`${meetingId}_${userId}`];
  const otherOf = (meeting: any, userId: string): string =>
    (meeting.participants || [meeting.requesterId, meeting.receiverId]).find((p: string) => p && p !== userId) || "";

  const respondent = modal ? usersById[modal.respondentId] : null;
  const fields = useMemo(() => getSurveyFields(event?.config, respondent?.tipoAsistente), [event, respondent]);

  const openSurvey = (meeting: any, respondentId: string) => {
    const existing = surveyOf(meeting.id, respondentId);
    const vals: Record<string, string> = {};
    getSurveyFields(event?.config, usersById[respondentId]?.tipoAsistente).forEach(
      (f) => (vals[f.name] = existing?.[f.name] != null ? String(existing[f.name]) : ""),
    );
    setValues(vals);
    setModal({ meeting, respondentId });
  };

  // andNext: tras guardar, abre la encuesta de la contraparte en la misma reunión
  const saveSurvey = async (andNext = false) => {
    if (!modal || !respondent) return;
    const { meeting, respondentId } = modal;
    const otherId = otherOf(meeting, respondentId);
    const other = usersById[otherId] || {};
    setSaving(true);
    try {
      await setDoc(doc(db, "meetingSurveys", `${meeting.id}_${respondentId}`), {
        meetingId: meeting.id,
        userId: respondentId,
        userName: respondent.nombre || "",
        userEmpresa: respondent.empresa || "",
        otherUserId: otherId,
        otherUserName: other.nombre || "",
        otherUserEmpresa: other.empresa || "",
        createdAt: new Date(),
        value: values["value"] || "",
        comments: values["comments"] || "",
        ...values,
        filledByAdmin: true,
      });
      showNotification({ color: "green", title: "Encuesta guardada", message: `${respondent.nombre} · reunión con ${other.nombre || ""}` });
      if (andNext && otherId && usersById[otherId]) openSurvey(meeting, otherId);
      else setModal(null);
    } catch (e) {
      console.error("Error guardando encuesta:", e);
      showNotification({ color: "red", title: "No se pudo guardar", message: "Intenta de nuevo." });
    } finally {
      setSaving(false);
    }
  };

  const missingRequired = fields.filter((f) => f.required).some((f) => !values[f.name]);
  const filledCount = selected ? meetings.filter((m) => surveyOf(m.id, selected.id)).length : 0;
  const modalOtherId = modal ? otherOf(modal.meeting, modal.respondentId) : "";
  const modalOther = modalOtherId ? usersById[modalOtherId] : null;

  const renderField = (field: SurveyField) => {
    const val = values[field.name] ?? "";
    const onChange = (v: string) => setValues((prev) => ({ ...prev, [field.name]: v }));
    const common = { label: field.label, required: field.required, radius: "md" as const };
    if (field.type === "textarea")
      return <Textarea {...common} value={val} onChange={(e) => onChange(e.currentTarget.value)} minRows={3} />;
    if (field.type === "number")
      return <NumberInput {...common} value={val === "" ? "" : Number(val)} onChange={(v) => onChange(v === "" ? "" : String(v))} />;
    if (field.type === "select" && field.options?.length)
      return <Select {...common} value={val || null} onChange={(v) => onChange(v || "")} data={field.options.map((o) => ({ value: o, label: o }))} />;
    if (field.type === "rating")
      return <Select {...common} value={val || null} onChange={(v) => onChange(v || "")} data={getRatingData(field)} />;
    return <TextInput {...common} value={val} onChange={(e) => onChange(e.currentTarget.value)} />;
  };

  return (
    <Container size="md" py="lg">
      <Stack gap="md">
        <Group gap="sm">
          <Button component={Link} to={`/admin/event/${eventId}`} variant="subtle" leftSection={<IconArrowLeft size={16} />}>
            Volver
          </Button>
          <div>
            <Title order={2}>Encuestas por asistente</Title>
            <Text c="dimmed" size="sm">
              {event?.eventName || eventId}
            </Text>
          </div>
        </Group>

        {!selected ? (
          <Paper withBorder radius="md" p="md">
            <TextInput
              autoFocus
              size="md"
              placeholder="Buscar por nombre, correo, empresa o teléfono"
              leftSection={<IconSearch size={18} />}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              radius="md"
            />
            <Stack gap={6} mt="md">
              {search.trim().length >= 2 && results.length === 0 && (
                <Text c="dimmed" ta="center" py="md">
                  No se encontraron asistentes.
                </Text>
              )}
              {results.map((u) => (
                <UnstyledButton key={u.id} onClick={() => setSelectedId(u.id)}>
                  <Card withBorder radius="md" padding="sm">
                    <Group justify="space-between" wrap="nowrap">
                      <div style={{ minWidth: 0 }}>
                        <Text fw={600} size="sm" truncate>
                          {u.nombre}
                        </Text>
                        <Text size="xs" c="dimmed" truncate>
                          {empresaOf(u) || "Sin empresa"} · {u.correo || u.email || "sin correo"}
                        </Text>
                      </div>
                      <Group gap={6} wrap="nowrap">
                        {isCheckedInOnDay(u, currentDay) && (
                          <Badge variant="light" color="green" leftSection={<IconUserCheck size={12} />}>
                            Check-in
                          </Badge>
                        )}
                        {normalizeTipoAsistente(u.tipoAsistente) && (
                          <Badge variant="light" color={normalizeTipoAsistente(u.tipoAsistente) === "vendedor" ? "teal" : "blue"}>
                            {normalizeTipoAsistente(u.tipoAsistente) === "vendedor" ? "Expositor" : "Asistente"}
                          </Badge>
                        )}
                      </Group>
                    </Group>
                  </Card>
                </UnstyledButton>
              ))}
            </Stack>
          </Paper>
        ) : (
          <Paper withBorder radius="md" p="md">
            <Group justify="space-between" wrap="wrap" mb="md">
              <div>
                <Text fw={700} size="lg">
                  {selected.nombre}
                </Text>
                <Text size="sm" c="dimmed">
                  {empresaOf(selected) || "Sin empresa"} · {selected.correo || selected.email || "sin correo"}
                </Text>
              </div>
              <Group gap="xs">
                <Badge variant="light" color={filledCount === meetings.length && meetings.length > 0 ? "green" : "gray"} size="lg">
                  {filledCount} / {meetings.length} encuestas
                </Badge>
                <Button
                  variant="default"
                  leftSection={<IconX size={14} />}
                  onClick={() => {
                    setSelectedId(null);
                    setMeetings([]);
                    setSurveys({});
                  }}
                >
                  Cambiar asistente
                </Button>
              </Group>
            </Group>

            {/* Check-in por día del evento (mismo dato que la pestaña Check-In del admin) */}
            <Paper withBorder radius="md" p="sm" mb="md" bg="var(--mantine-color-gray-0)">
              <Group gap="sm" wrap="wrap">
                <Text size="sm" fw={600}>
                  Check-in:
                </Text>
                {(eventDays.length ? eventDays : [currentDay]).map((day) => {
                  const done = isCheckedInOnDay(selected, day);
                  const past = isPastCheckInDay(day);
                  const label = day === "unico" ? "Evento" : `${formatDate(day)}${day === today ? " (hoy)" : ""}`;
                  return (
                    <Group key={day} gap={6} wrap="nowrap">
                      <Badge variant={done ? "filled" : "outline"} color={done ? "green" : "gray"}>
                        {label}: {done ? `✔ ${formatCheckInTime(selected.checkIns?.[day])}` : "sin check-in"}
                      </Badge>
                      {!past && (
                        <Button
                          size="compact-xs"
                          variant={done ? "subtle" : "filled"}
                          color={done ? "gray" : "green"}
                          loading={checkInBusy === day}
                          disabled={!!checkInBusy && checkInBusy !== day}
                          onClick={() => toggleCheckIn(day)}
                        >
                          {done ? "Quitar" : "Hacer check-in"}
                        </Button>
                      )}
                    </Group>
                  );
                })}
              </Group>
            </Paper>

            {loadingMeetings ? (
              <Group justify="center" p="xl">
                <Loader />
              </Group>
            ) : meetings.length === 0 ? (
              <Text c="dimmed" ta="center" py="md">
                Este asistente no tiene reuniones aceptadas.
              </Text>
            ) : (
              <Stack gap="sm">
                {meetings.map((m) => {
                  const otherId = (m.participants || []).find((p: string) => p !== selected.id);
                  const other = usersById[otherId] || {};
                  return (
                    <Card key={m.id} withBorder radius="md" padding="sm">
                      <Group justify="space-between" wrap="wrap" gap="sm">
                        <div style={{ minWidth: 0 }}>
                          <Text fw={600} size="sm">
                            {other.nombre || "Participante"}{" "}
                            <Text span c="dimmed" fw={400}>
                              · {empresaOf(other)}
                            </Text>
                          </Text>
                          <Group gap={6} mt={4}>
                            {m.meetingDate && <Badge variant="light" color="gray">{formatDate(m.meetingDate)}</Badge>}
                            {m.timeSlot && m.timeSlot !== "—" && <Badge variant="light">{m.timeSlot}</Badge>}
                            {m.tableAssigned && (
                              <Badge variant="light" color="orange">
                                {getTableLabel(m.tableAssigned, event?.config?.tableNames)}
                              </Badge>
                            )}
                            {m.isExternal && <Badge variant="light" color="grape">Libre</Badge>}
                            {m.completed && <Badge variant="light" color="teal">Realizada</Badge>}
                          </Group>
                        </div>
                        {/* Encuesta de cada participante: el asistente buscado y su contraparte */}
                        <Stack gap={6}>
                          {[selected.id, otherId].filter(Boolean).map((pid: string) => {
                            const person = usersById[pid];
                            const filled = !!surveyOf(m.id, pid);
                            return (
                              <Group key={pid} gap="xs" justify="flex-end" wrap="nowrap">
                                <Text size="xs" c="dimmed" maw={150} truncate>
                                  {pid === selected.id ? "Encuesta de " : "Contraparte: "}
                                  {(person?.nombre || "").split(" ")[0]}
                                </Text>
                                {filled ? (
                                  <Badge color="green" leftSection={<IconCheck size={12} />}>
                                    Llena
                                  </Badge>
                                ) : (
                                  <Badge color="gray" variant="outline">
                                    Pendiente
                                  </Badge>
                                )}
                                <Button
                                  size="compact-xs"
                                  variant={filled ? "default" : "filled"}
                                  leftSection={<IconClipboardText size={12} />}
                                  disabled={!person}
                                  onClick={() => openSurvey(m, pid)}
                                >
                                  {filled ? "Editar" : "Llenar"}
                                </Button>
                              </Group>
                            );
                          })}
                        </Stack>
                      </Group>
                    </Card>
                  );
                })}
              </Stack>
            )}
          </Paper>
        )}
      </Stack>

      <Modal
        opened={!!modal}
        onClose={() => setModal(null)}
        centered
        title={
          modal && respondent
            ? `Encuesta de ${respondent.nombre} — reunión con ${modalOther?.nombre || ""}`
            : "Encuesta"
        }
      >
        <Stack gap="md">
          {fields.map((f) => (
            <div key={f.name}>{renderField(f)}</div>
          ))}
          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={() => setModal(null)}>
              Cancelar
            </Button>
            <Button
              variant={modalOther ? "light" : "filled"}
              loading={saving}
              disabled={missingRequired}
              onClick={() => saveSurvey(false)}
            >
              Guardar
            </Button>
            {modalOther && (
              <Button loading={saving} disabled={missingRequired} onClick={() => saveSurvey(true)}>
                Guardar y llenar la de {(modalOther.nombre || "").split(" ")[0]}
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}

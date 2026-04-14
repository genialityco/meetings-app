import { useEffect, useState, useRef, useContext } from "react";
import {
  Modal, Stack, Text, Button, Group, Badge, Box, Loader, Center,
  TextInput, Textarea, Select,
} from "@mantine/core";
import { IconCheck, IconX } from "@tabler/icons-react";
import { doc, updateDoc, getDoc, setDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { UserContext } from "../../context/UserContext";
import { DEFAULT_SURVEY_FIELDS } from "../admin/ConfigureSurveyModal";

interface Props {
  uid: string;
  eventId: string;
  enabled: boolean;
  eventConfig: any;
}

interface PendingMeeting {
  id: string;
  timeSlot: string;
  tableAssigned?: string;
  meetingDate?: string;
  participants: string[];
  otherName?: string;
  otherEmpresa?: string;
  otherId?: string;
}

const POLL_INTERVAL_MS = 60_000;

function isMeetingOver(meeting: any, meetingDuration: number): boolean {
  try {
    const date = meeting.meetingDate || new Date().toISOString().slice(0, 10);
    const [startStr] = (meeting.timeSlot || "").split(" - ");
    if (!startStr) return false;
    const [h, m] = startStr.split(":").map(Number);
    const endMin = h * 60 + m + (meetingDuration || 30);
    const endH = Math.floor(endMin / 60);
    const endM = endMin % 60;
    const endDate = new Date(`${date}T${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}:00`);
    return new Date() > endDate;
  } catch {
    return false;
  }
}

export default function MeetingConfirmationGuard({ uid, eventId, enabled, eventConfig }: Props) {
  const { currentUser } = useContext(UserContext);
  const [pending, setPending] = useState<PendingMeeting[]>([]);
  const [current, setCurrent] = useState<PendingMeeting | null>(null);
  const [saving, setSaving] = useState(false);
  // Survey state
  const [showSurvey, setShowSurvey] = useState(false);
  const [surveyValues, setSurveyValues] = useState<Record<string, string>>({});
  const [savingSurvey, setSavingSurvey] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Determine survey fields based on policy and user role
  const myRole = (currentUser?.data?.tipoAsistente || "").toLowerCase();
  const surveyMode = eventConfig?.policies?.surveyMode || "default";
  const surveyBlocked = (() => {
    const blocked = eventConfig?.policies?.surveyBlockedFor || "none";
    if (blocked === "ambos") return true;
    if (blocked === "compradores" && myRole === "comprador") return true;
    if (blocked === "vendedores" && myRole === "vendedor") return true;
    return false;
  })();

  const surveyFields: any[] = (() => {
    if (surveyMode === "custom") {
      const cfg = eventConfig?.surveyConfig;
      if (myRole === "vendedor" && cfg?.vendedorFields?.length) return cfg.vendedorFields;
      if (myRole === "comprador" && cfg?.compradorFields?.length) return cfg.compradorFields;
      return cfg?.compradorFields || cfg?.vendedorFields || DEFAULT_SURVEY_FIELDS;
    }
    return DEFAULT_SURVEY_FIELDS;
  })();

  const checkMeetings = async () => {
    if (!uid || !eventId) return;
    try {
      const snap = await getDocs(
        query(
          collection(db, "events", eventId, "meetings"),
          where("status", "==", "accepted"),
          where("participants", "array-contains", uid)
        )
      );

      const duration = eventConfig?.meetingDuration || 30;
      const unconfirmed: PendingMeeting[] = [];

      for (const d of snap.docs) {
        const m = { id: d.id, ...d.data() } as any;
        if (typeof m.completed === "boolean") continue;
        if (!isMeetingOver(m, duration)) continue;

        const otherId = (m.participants || []).find((p: string) => p !== uid);
        let otherName = "";
        let otherEmpresa = "";
        if (otherId) {
          try {
            const otherDoc = await getDoc(doc(db, "users", otherId));
            if (otherDoc.exists()) {
              otherName = otherDoc.data().nombre || "";
              otherEmpresa = otherDoc.data().empresa || "";
            }
          } catch (e) {
            console.warn(`[Guard] Could not fetch user ${otherId}:`, e);
          }
        }

        unconfirmed.push({
          id: d.id,
          timeSlot: m.timeSlot || "",
          tableAssigned: m.tableAssigned,
          meetingDate: m.meetingDate,
          participants: m.participants || [],
          otherName: otherName || "Participante",
          otherEmpresa,
          otherId,
        });
      }

      setPending(unconfirmed);
      if (unconfirmed.length > 0 && !current) {
        setCurrent(unconfirmed[0]);
      } else if (unconfirmed.length === 0) {
        setCurrent(null);
      }
    } catch (e) {
      console.error("[MeetingConfirmationGuard] Error checking meetings:", e);
    }
  };

  useEffect(() => {
    if (!enabled) {
      setPending([]);
      setCurrent(null);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    checkMeetings();
    intervalRef.current = setInterval(checkMeetings, POLL_INTERVAL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [enabled, uid, eventId]);

  useEffect(() => {
    if (!current && pending.length > 0) setCurrent(pending[0]);
  }, [pending, current]);

  // Step 1: user says "No" → mark completed=false and move on
  const handleNo = async () => {
    if (!current) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "events", eventId, "meetings", current.id), {
        completed: false,
        confirmedAt: new Date(),
        confirmedBy: uid,
      });
      advanceToNext();
    } catch (e) {
      console.error("[Guard] Error confirming no:", e);
    } finally {
      setSaving(false);
    }
  };

  // Step 2: user says "Yes" → mark completed=true and show survey (if not blocked)
  const handleYes = async () => {
    if (!current) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "events", eventId, "meetings", current.id), {
        completed: true,
        confirmedAt: new Date(),
        confirmedBy: uid,
      });
      if (!surveyBlocked && surveyFields.length > 0) {
        setSurveyValues({});
        setShowSurvey(true);
      } else {
        advanceToNext();
      }
    } catch (e) {
      console.error("[Guard] Error confirming yes:", e);
    } finally {
      setSaving(false);
    }
  };

  // Step 3: save survey and advance
  const handleSaveSurvey = async () => {
    if (!current) return;
    setSavingSurvey(true);
    try {
      const myInfo = currentUser?.data || {};
      const otherInfo = { nombre: current.otherName, empresa: current.otherEmpresa };
      await setDoc(doc(db, "meetingSurveys", `${current.id}_${uid}`), {
        meetingId: current.id,
        userId: uid,
        userName: myInfo.nombre || "",
        userEmpresa: myInfo.empresa || "",
        otherUserId: current.otherId || "",
        otherUserName: current.otherName || "",
        otherUserEmpresa: current.otherEmpresa || "",
        value: surveyValues["value"] || "",
        comments: surveyValues["comments"] || "",
        ...surveyValues,
        createdAt: new Date(),
      });
    } catch (e) {
      console.error("[Guard] Error saving survey:", e);
    } finally {
      setSavingSurvey(false);
      setShowSurvey(false);
      advanceToNext();
    }
  };

  const handleSkipSurvey = () => {
    setShowSurvey(false);
    advanceToNext();
  };

  const advanceToNext = () => {
    const remaining = pending.filter((m) => m.id !== current?.id);
    setPending(remaining);
    setCurrent(remaining.length > 0 ? remaining[0] : null);
    setShowSurvey(false);
    setSurveyValues({});
  };

  if (!enabled || !current) return null;

  const requiredFields = surveyFields.filter((f) => f.required);
  const surveyValid = requiredFields.every((f) => !!surveyValues[f.name]);

  return (
    <>
      <div style={{
        position: "fixed", inset: 0, zIndex: 9998,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
      }} />
      <Modal
        opened={!!current}
        onClose={() => {}}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        centered
        size="sm"
        zIndex={9999}
        title={
          <Badge color="orange" variant="filled" size="lg">
            {pending.length} reunión{pending.length !== 1 ? "es" : ""} por confirmar
          </Badge>
        }
      >
        {!showSurvey ? (
          <Stack gap="md">
            <Text fw={700} size="md">¿Se realizó esta reunión?</Text>
            <Box p="md" style={{ background: "#f8f9fa", borderRadius: 8 }}>
              {current.otherName && <Text size="sm" fw={600}>{current.otherName}</Text>}
              {current.otherEmpresa && <Text size="xs" c="dimmed">{current.otherEmpresa}</Text>}
              <Text size="xs" mt={4}>🕐 {current.timeSlot}</Text>
              {current.tableAssigned && <Text size="xs">🪑 Mesa {current.tableAssigned}</Text>}
              {current.meetingDate && <Text size="xs">📅 {current.meetingDate}</Text>}
            </Box>
            <Text size="xs" c="dimmed">
              Debes confirmar si la reunión se llevó a cabo para continuar usando la plataforma.
            </Text>
            {saving ? (
              <Center py="sm"><Loader size="sm" /></Center>
            ) : (
              <Group grow>
                <Button color="red" variant="light" leftSection={<IconX size={16} />} onClick={handleNo}>
                  No se realizó
                </Button>
                <Button color="green" leftSection={<IconCheck size={16} />} onClick={handleYes}>
                  Sí se realizó
                </Button>
              </Group>
            )}
          </Stack>
        ) : (
          <Stack gap="md">
            <Text fw={700} size="md">Encuesta de reunión</Text>
            <Text size="xs" c="dimmed">
              Con: <b>{current.otherName}</b>{current.otherEmpresa ? ` — ${current.otherEmpresa}` : ""}
            </Text>

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
                    minRows={2}
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

            <Group grow mt="xs">
              <Button variant="default" size="sm" onClick={handleSkipSurvey}>
                Omitir
              </Button>
              <Button
                color="green"
                loading={savingSurvey}
                disabled={!surveyValid}
                onClick={handleSaveSurvey}
              >
                Guardar encuesta
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}

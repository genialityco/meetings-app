import { useEffect, useState, useRef } from "react";
import {
  Modal, Stack, Text, Button, Group, Badge, Box, Loader, Center,
} from "@mantine/core";
import { IconCheck, IconX } from "@tabler/icons-react";
import { doc, updateDoc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";

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
  const [pending, setPending] = useState<PendingMeeting[]>([]);
  const [current, setCurrent] = useState<PendingMeeting | null>(null);
  const [saving, setSaving] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

      console.log(`[Guard] Found ${snap.docs.length} accepted meetings for uid=${uid} eventId=${eventId}`);

      const duration = eventConfig?.meetingDuration || 30;
      const unconfirmed: PendingMeeting[] = [];

      for (const d of snap.docs) {
        const m = { id: d.id, ...d.data() } as any;
        console.log(`[Guard] Meeting ${d.id}: completed=${m.completed}, timeSlot=${m.timeSlot}, over=${isMeetingOver(m, duration)}`);

        // Skip if already confirmed by anyone
        if (typeof m.completed === "boolean") continue;
        // Skip if not finished yet
        if (!isMeetingOver(m, duration)) continue;

        // Fetch other participant directly by doc ID
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
        });
      }

      console.log(`[Guard] Unconfirmed meetings needing confirmation: ${unconfirmed.length}`);
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

  const handleConfirm = async (completed: boolean) => {
    if (!current) return;
    setSaving(true);
    try {
      const meetingRef = doc(db, "events", eventId, "meetings", current.id);
      console.log(`[Guard] Updating meeting at path: events/${eventId}/meetings/${current.id}`);
      await updateDoc(meetingRef, {
        completed,
        confirmedAt: new Date(),
        confirmedBy: uid,
      });
      console.log(`[Guard] Meeting ${current.id} confirmed as completed=${completed}`);
      const remaining = pending.filter((m) => m.id !== current.id);
      setPending(remaining);
      setCurrent(remaining.length > 0 ? remaining[0] : null);
    } catch (e) {
      console.error("[MeetingConfirmationGuard] Error confirming:", e);
    } finally {
      setSaving(false);
    }
  };

  if (!enabled || !current) return null;

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
              <Button color="red" variant="light" leftSection={<IconX size={16} />} onClick={() => handleConfirm(false)}>
                No se realizó
              </Button>
              <Button color="green" leftSection={<IconCheck size={16} />} onClick={() => handleConfirm(true)}>
                Sí se realizó
              </Button>
            </Group>
          )}
        </Stack>
      </Modal>
    </>
  );
}

import { useState, useEffect, useMemo } from "react";
import {
  Stack, TextInput, Text, Group, Badge, Avatar,
  ActionIcon, Loader, Box, ScrollArea, Divider,
} from "@mantine/core";
import { IconSearch, IconX, IconCheck, IconUserCheck } from "@tabler/icons-react";
import { collection, query, where, onSnapshot, doc, updateDoc, getDocs, getDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";

export default function CheckInTab({ event }) {
  const [attendees, setAttendees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [updating, setUpdating] = useState(null);

  useEffect(() => {
    if (!event?.id) return;
    setLoading(true);
    const q = query(collection(db, "users"), where("eventId", "==", event.id));
    const unsub = onSnapshot(q, (snap) => {
      setAttendees(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsub();
  }, [event?.id]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    if (!term) return attendees;
    return attendees.filter((a) =>
      (a.nombre || "").toLowerCase().includes(term) ||
      (a.empresa || "").toLowerCase().includes(term) ||
      (a.correo || "").toLowerCase().includes(term)
    );
  }, [attendees, search]);

  const checkedIn = filtered.filter((a) => a.checkedIn);
  const notCheckedIn = filtered.filter((a) => !a.checkedIn);

  const handleToggle = async (attendee) => {
    setUpdating(attendee.id);
    try {
      const newValue = !attendee.checkedIn;
      await updateDoc(doc(db, "users", attendee.id), {
        checkedIn: newValue,
        ...(newValue ? { checkInTime: new Date() } : { checkOutTime: new Date() }),
      });

      // Resolve standby meetings if policy is active
      const standbyEnabled = event?.config?.policies?.standbyCheckInRequired === true;
      if (standbyEnabled && event?.id) {
        const targetStatus = newValue ? "standby" : "accepted";
        const standbySnap = await getDocs(
          query(
            collection(db, "events", event.id, "meetings"),
            where("status", "==", targetStatus),
            where("participants", "array-contains", attendee.id)
          )
        );
        for (const d of standbySnap.docs) {
          const m = d.data();
          const otherId = (m.participants || []).find((p) => p !== attendee.id);
          if (!otherId) continue;

          if (newValue) {
            // Check-in: leer checkedIn del otro usuario directo de Firestore (evita estado local desactualizado)
            const otherUserDoc = await getDoc(doc(db, "users", otherId));
            const otherCheckedIn = otherUserDoc.exists() && otherUserDoc.data().checkedIn === true;
            if (otherCheckedIn) {
              await updateDoc(doc(db, "events", event.id, "meetings", d.id), { status: "accepted" });
            }
          } else {
            // Uncheck-in: demote to standby
            await updateDoc(doc(db, "events", event.id, "meetings", d.id), { status: "standby" });
          }
        }
      }
    } catch (e) {
      console.error("Error toggling check-in:", e);
    } finally {
      setUpdating(null);
    }
  };

  const AttendeeRow = ({ a }) => (
    <Box
      px="md"
      py="sm"
      style={{
        borderBottom: "1px solid #f1f3f5",
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: a.checkedIn ? "#f0fdf4" : "#fff",
      }}
    >
      <Avatar src={a.photoURL} radius="xl" size={42} color="teal">
        {(a.nombre || "?")[0].toUpperCase()}
      </Avatar>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} size="sm" lineClamp={1}>{a.nombre || "Sin nombre"}</Text>
        <Text size="xs" c="dimmed" lineClamp={1}>{a.empresa || "—"}</Text>
        <Text size="xs" c="dimmed" lineClamp={1}>{a.correo || "—"}</Text>
      </Box>
      <Group gap="xs" wrap="nowrap">
        {a.checkedIn ? (
          <Badge color="green" variant="light" size="sm" leftSection={<IconUserCheck size={12} />}>
            Presente
          </Badge>
        ) : (
          <Badge color="gray" variant="outline" size="sm">
            Pendiente
          </Badge>
        )}
        <ActionIcon
          size="lg"
          radius="xl"
          variant={a.checkedIn ? "filled" : "light"}
          color={a.checkedIn ? "green" : "blue"}
          loading={updating === a.id}
          onClick={() => handleToggle(a)}
          title={a.checkedIn ? "Revertir check-in" : "Confirmar asistencia"}
        >
          <IconCheck size={18} />
        </ActionIcon>
      </Group>
    </Box>
  );

  return (
    <Stack gap={0}>
      {/* Buscador */}
      <Box px="md" py="sm" style={{ borderBottom: "1px solid #e9ecef", background: "#fff", position: "sticky", top: 0, zIndex: 10 }}>
        <TextInput
          placeholder="Buscar por nombre, empresa o correo..."
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          leftSection={<IconSearch size={16} />}
          rightSection={search ? (
            <ActionIcon variant="subtle" size="sm" onClick={() => setSearch("")}>
              <IconX size={14} />
            </ActionIcon>
          ) : null}
          radius="xl"
        />
        <Group mt="xs" gap="xs">
          <Badge color="green" variant="light">{checkedIn.length} presentes</Badge>
          <Badge color="gray" variant="light">{notCheckedIn.length} pendientes</Badge>
          <Badge color="blue" variant="light">{filtered.length} total</Badge>
        </Group>
      </Box>

      {loading ? (
        <Group justify="center" py="xl"><Loader size="sm" /></Group>
      ) : filtered.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl" size="sm">
          {search ? "No se encontraron asistentes." : "No hay asistentes registrados."}
        </Text>
      ) : (
        <ScrollArea>
          {/* Presentes primero */}
          {checkedIn.length > 0 && (
            <>
              <Divider label={<Text size="xs" fw={600} c="green">Presentes ({checkedIn.length})</Text>} labelPosition="left" mx="md" my="xs" />
              {checkedIn.map((a) => <AttendeeRow key={a.id} a={a} />)}
            </>
          )}
          {/* Pendientes */}
          {notCheckedIn.length > 0 && (
            <>
              <Divider label={<Text size="xs" fw={600} c="dimmed">Pendientes ({notCheckedIn.length})</Text>} labelPosition="left" mx="md" my="xs" />
              {notCheckedIn.map((a) => <AttendeeRow key={a.id} a={a} />)}
            </>
          )}
        </ScrollArea>
      )}
    </Stack>
  );
}

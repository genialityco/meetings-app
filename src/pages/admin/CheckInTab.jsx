import { useState, useEffect, useMemo } from "react";
import {
  Stack, TextInput, Text, Group, Badge, Avatar,
  ActionIcon, Loader, Box, ScrollArea, Divider,
  Collapse, Paper, SimpleGrid, Button,
} from "@mantine/core";
import {
  IconSearch, IconX, IconCheck, IconUserCheck,
  IconChevronDown, IconChevronUp, IconEdit, IconDeviceFloppy,
} from "@tabler/icons-react";
import { collection, query, where, onSnapshot, doc, updateDoc, getDocs, getDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";

// Campos básicos siempre visibles
const BASIC_FIELDS = [
  { key: "nombre", label: "Nombre" },
  { key: "empresa", label: "Empresa" },
  { key: "cargo", label: "Cargo" },
  { key: "correo", label: "Correo" },
  { key: "telefono", label: "Teléfono" },
  { key: "tipoAsistente", label: "Tipo" },
];

function AttendeeRow({ a, event, updating, onToggle }) {
  const [expanded, setExpanded] = useState(false);
  const [editingField, setEditingField] = useState(null); // key being edited
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  // Build all fields: basic + any extra from formFields config
  const formFields = event?.config?.formFields || [];
  const extraFields = formFields.filter(
    (f) => !BASIC_FIELDS.some((b) => b.key === f.name) &&
      f.name !== "photoURL" && f.name !== "aceptaTratamiento"
  );

  const startEdit = (key, currentVal) => {
    setEditingField(key);
    setEditValue(currentVal ?? "");
  };

  const cancelEdit = () => { setEditingField(null); setEditValue(""); };

  const saveEdit = async () => {
    if (!editingField) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "users", a.id), { [editingField]: editValue });
    } catch (e) {
      console.error("Error saving field:", e);
    } finally {
      setSaving(false);
      setEditingField(null);
      setEditValue("");
    }
  };

  const FieldRow = ({ fieldKey, label }) => {
    const val = a[fieldKey];
    const display = Array.isArray(val) ? val.join(", ") : (val ?? "—");
    const isEditing = editingField === fieldKey;

    return (
      <Box>
        <Text size="xs" c="dimmed" fw={500}>{label}</Text>
        {isEditing ? (
          <Group gap={4} mt={2}>
            <TextInput
              value={editValue}
              onChange={(e) => setEditValue(e.currentTarget.value)}
              size="xs"
              style={{ flex: 1 }}
              onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
              autoFocus
            />
            <ActionIcon size="sm" color="green" variant="filled" loading={saving} onClick={saveEdit}>
              <IconDeviceFloppy size={13} />
            </ActionIcon>
            <ActionIcon size="sm" color="gray" variant="light" onClick={cancelEdit}>
              <IconX size={13} />
            </ActionIcon>
          </Group>
        ) : (
          <Group gap={4} mt={2} wrap="nowrap">
            <Text size="sm" style={{ flex: 1, wordBreak: "break-word" }}>{display}</Text>
            <ActionIcon size="xs" variant="subtle" color="blue" onClick={() => startEdit(fieldKey, Array.isArray(val) ? val.join(", ") : (val ?? ""))}>
              <IconEdit size={12} />
            </ActionIcon>
          </Group>
        )}
      </Box>
    );
  };

  return (
    <Paper
      withBorder
      radius="md"
      mb="xs"
      style={{ background: a.checkedIn ? "#f0fdf4" : "#fff", overflow: "hidden" }}
    >
      {/* Header row */}
      <Box
        px="md"
        py="sm"
        style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
        onClick={() => setExpanded((v) => !v)}
      >
        <Avatar src={a.photoURL} radius="xl" size={42} color="teal">
          {(a.nombre || "?")[0].toUpperCase()}
        </Avatar>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600} size="sm" lineClamp={1}>{a.nombre || "Sin nombre"}</Text>
          <Text size="xs" c="dimmed" lineClamp={1}>{a.empresa || "—"}</Text>
          <Text size="xs" c="dimmed" lineClamp={1}>{a.correo || a.telefono || "—"}</Text>
        </Box>
        <Group gap="xs" wrap="nowrap" onClick={(e) => e.stopPropagation()}>
          {a.checkedIn ? (
            <Badge color="green" variant="light" size="sm" leftSection={<IconUserCheck size={12} />}>
              Presente
            </Badge>
          ) : (
            <Badge color="gray" variant="outline" size="sm">Pendiente</Badge>
          )}
          <ActionIcon
            size="lg"
            radius="xl"
            variant={a.checkedIn ? "filled" : "light"}
            color={a.checkedIn ? "green" : "blue"}
            loading={updating === a.id}
            onClick={() => onToggle(a)}
            title={a.checkedIn ? "Revertir check-in" : "Confirmar asistencia"}
          >
            <IconCheck size={18} />
          </ActionIcon>
        </Group>
        <ActionIcon variant="subtle" size="sm" color="gray">
          {expanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
        </ActionIcon>
      </Box>

      {/* Expanded detail */}
      <Collapse in={expanded}>
        <Divider />
        <Box px="md" py="sm">
          <Text size="xs" fw={700} c="dimmed" mb="xs" tt="uppercase">Datos básicos</Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
            {BASIC_FIELDS.map((f) => (
              <FieldRow key={f.key} fieldKey={f.key} label={f.label} />
            ))}
          </SimpleGrid>

          {extraFields.length > 0 && (
            <>
              <Divider my="sm" />
              <Text size="xs" fw={700} c="dimmed" mb="xs" tt="uppercase">Campos adicionales</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                {extraFields.map((f) => (
                  <FieldRow key={f.name} fieldKey={f.name} label={f.label || f.name} />
                ))}
              </SimpleGrid>
            </>
          )}

          {a.checkInTime && (
            <Text size="xs" c="dimmed" mt="sm">
              ✅ Check-in: {a.checkInTime?.toDate ? a.checkInTime.toDate().toLocaleString("es-CO") : new Date(a.checkInTime).toLocaleString("es-CO")}
            </Text>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}

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
      (a.correo || "").toLowerCase().includes(term) ||
      (a.telefono || "").toLowerCase().includes(term)
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
            const otherUserDoc = await getDoc(doc(db, "users", otherId));
            const otherCheckedIn = otherUserDoc.exists() && otherUserDoc.data().checkedIn === true;
            if (otherCheckedIn) {
              await updateDoc(doc(db, "events", event.id, "meetings", d.id), { status: "accepted" });
            }
          } else {
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

  return (
    <Stack gap={0}>
      {/* Buscador */}
      <Box px="md" py="sm" style={{ borderBottom: "1px solid #e9ecef", background: "#fff", position: "sticky", top: 0, zIndex: 10 }}>
        <TextInput
          placeholder="Buscar por nombre, empresa, correo o teléfono..."
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
        <Box px="md" pt="sm">
          {checkedIn.length > 0 && (
            <>
              <Divider label={<Text size="xs" fw={600} c="green">Presentes ({checkedIn.length})</Text>} labelPosition="left" mb="xs" />
              {checkedIn.map((a) => (
                <AttendeeRow key={a.id} a={a} event={event} updating={updating} onToggle={handleToggle} />
              ))}
            </>
          )}
          {notCheckedIn.length > 0 && (
            <>
              <Divider label={<Text size="xs" fw={600} c="dimmed">Pendientes ({notCheckedIn.length})</Text>} labelPosition="left" mb="xs" mt={checkedIn.length > 0 ? "md" : 0} />
              {notCheckedIn.map((a) => (
                <AttendeeRow key={a.id} a={a} event={event} updating={updating} onToggle={handleToggle} />
              ))}
            </>
          )}
        </Box>
      )}
    </Stack>
  );
}

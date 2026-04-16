import { useState, useEffect, useMemo } from "react";
import {
  Stack, TextInput, Text, Group, Badge, Avatar,
  ActionIcon, Loader, Box, ScrollArea, Divider,
  Collapse, Paper, SimpleGrid, Button, Modal,
  Textarea, Select, Checkbox, FileInput,
} from "@mantine/core";
import {
  IconSearch, IconX, IconCheck, IconUserCheck,
  IconChevronDown, IconChevronUp, IconEdit, IconDeviceFloppy,
} from "@tabler/icons-react";
import { collection, query, where, onSnapshot, doc, updateDoc, getDocs, getDoc, addDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../firebase/firebaseConfig";

// Campos básicos siempre visibles
const BASIC_FIELDS = [
  { key: "nombre", label: "Nombre" },
  { key: "cargo", label: "Cargo" },
  { key: "correo", label: "Correo" },
  { key: "telefono", label: "Teléfono" },
  { key: "tipoAsistente", label: "Tipo" },
];

function AttendeeRow({ a, event, updating, onToggle }) {
  const [expanded, setExpanded] = useState(false);
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  // Build all fields from formFields config
  const formFields = event?.config?.formFields || [];

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
          <Text 
            size="sm" 
            style={{ flex: 1, wordBreak: "break-word", cursor: "pointer", padding: "4px 8px", borderRadius: "4px" }}
            onClick={() => startEdit(fieldKey, Array.isArray(val) ? val.join(", ") : (val ?? ""))}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#f0f0f0"}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
          >
            {display}
          </Text>
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
          <Text size="xs" c="dimmed" lineClamp={1}>
            {[
              a.correo ? `correo: ${a.correo}` : null,
              a.empresa ? `empresa: ${a.empresa}` : null,
              a.telefono ? `teléfono: ${a.telefono}` : null,
            ]
              .filter(Boolean)
              .join(", ")}
          </Text>
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
      </Box>

      {/* Expanded detail */}
      <Collapse in={expanded}>
        <Divider />
        <Box px="md" py="sm">
          {formFields.length > 0 ? (
            <>
              <Text size="xs" fw={700} c="dimmed" mb="xs" tt="uppercase">Datos básicos</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                {(() => {
                  const basicNames = BASIC_FIELDS.map((f) => f.key);
                  const basicFields = basicNames
                    .map((name) => formFields.find((f) => f.name === name))
                    .filter(Boolean);
                  return basicFields.map((f) => (
                    <FieldRow key={f.name} fieldKey={f.name} label={f.label || f.name} />
                  ));
                })()}
              </SimpleGrid>
              {(() => {
                const basicNames = BASIC_FIELDS.map((f) => f.key);
                const additionalFields = formFields.filter(
                  (f) => !basicNames.includes(f.name) && f.name !== "photoURL" && f.name !== "aceptaTratamiento"
                );
                return additionalFields.length > 0 ? (
                  <>
                    <Divider my="sm" />
                    <Text size="xs" fw={700} c="dimmed" mb="xs" tt="uppercase">Campos adicionales</Text>
                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                      {additionalFields.map((f) => (
                        <FieldRow key={f.name} fieldKey={f.name} label={f.label || f.name} />
                      ))}
                    </SimpleGrid>
                  </>
                ) : null;
              })()}
            </>
          ) : (
            <>
              <Text size="xs" fw={700} c="dimmed" mb="xs" tt="uppercase">Datos básicos</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                {BASIC_FIELDS.map((f) => (
                  <FieldRow key={f.key} fieldKey={f.key} label={f.label} />
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
  const [createUserOpened, setCreateUserOpened] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [newUserValues, setNewUserValues] = useState({});
  const [newUserErrors, setNewUserErrors] = useState({});

  const isValidEmail = (v = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());
  const validateField = (field, value) => {
    const { validation = {}, required = true } = field;

    if (required && (!value || (typeof value === "string" && value.trim() === ""))) {
      return validation?.errorMessage || `El campo ${field.label} es obligatorio`;
    }

    if (validation?.minLength && value?.length < validation.minLength) {
      return validation.errorMessage || `Debe tener al menos ${validation.minLength} caracteres`;
    }

    if (validation?.maxLength && value?.length > validation.maxLength) {
      return validation.errorMessage || `No puede exceder ${validation.maxLength} caracteres`;
    }

    if (validation?.pattern) {
      try {
        let patternString = validation.pattern.trim();
        if (patternString.startsWith("/") && patternString.endsWith("/")) {
          patternString = patternString.slice(1, -1);
        }
        const regex = new RegExp(patternString);
        if (!regex.test(value)) {
          return validation.errorMessage || `El formato no es válido`;
        }
      } catch (err) {
        console.warn(`Regex inválido: ${validation.pattern}`, err);
      }
    }

    return null;
  };

  const getCreateValue = (fieldName) => {
    if (fieldName.startsWith("contacto.")) {
      const key = fieldName.split(".")[1];
      return newUserValues.contacto?.[key] || "";
    }
    return newUserValues[fieldName] ?? "";
  };

  const setCreateValue = (fieldName, value) => {
    if (fieldName.startsWith("contacto.")) {
      const key = fieldName.split(".")[1];
      setNewUserValues((prev) => ({
        ...prev,
        contacto: { ...prev.contacto, [key]: value },
      }));
      return;
    }
    setNewUserValues((prev) => ({ ...prev, [fieldName]: value }));
  };

  const resetCreateUserForm = () => {
    setNewUserValues({});
    setNewUserErrors({});
  };

  const createFields = (() => {
    const eventFields = event?.config?.formFields?.filter((f) => f.name !== "photoURL") || [];
    if (eventFields.length === 0) {
      return BASIC_FIELDS.map((f) => ({ name: f.key, label: f.label, type: "text", required: true }));
    }

    const basicNames = BASIC_FIELDS.map((f) => f.key);
    const basicFields = basicNames
      .map((name) => eventFields.find((f) => f.name === name))
      .filter(Boolean);
    const remainingFields = eventFields.filter((f) => !basicNames.includes(f.name));
    return [...basicFields, ...remainingFields];
  })();

  const renderCreateUserFields = () => {
    return createFields.map((field) => {
      const fieldError = newUserErrors[field.name];
      const value = getCreateValue(field.name);

      if (field.name === "photo") {
        return (
          <FileInput
            key={field.name}
            label={field.label || "Foto de perfil"}
            placeholder="Selecciona una imagen"
            accept="image/png,image/jpeg"
            value={value || null}
            onChange={(file) => {
              setCreateValue(field.name, file);
              setNewUserErrors((prev) => ({ ...prev, [field.name]: null }));
            }}
            error={fieldError}
          />
        );
      }

      if (field.type === "richtext") {
        return (
          <Textarea
            key={field.name}
            label={field.label}
            value={value}
            onChange={(e) => {
              setCreateValue(field.name, e.currentTarget.value);
              setNewUserErrors((prev) => ({ ...prev, [field.name]: null }));
            }}
            error={fieldError}
            minRows={4}
          />
        );
      }

      if (field.type === "select") {
        return (
          <Select
            key={field.name}
            label={field.label}
            placeholder="Selecciona una opción"
            data={field.options || []}
            value={value}
            onChange={(v) => {
              setCreateValue(field.name, v);
              setNewUserErrors((prev) => ({ ...prev, [field.name]: null }));
            }}
            error={fieldError}
            required={field.required}
            searchable
          />
        );
      }

      if (field.type === "checkbox") {
        return (
          <Checkbox
            key={field.name}
            label={field.label}
            checked={!!value}
            onChange={(e) => {
              setCreateValue(field.name, e.currentTarget.checked);
              setNewUserErrors((prev) => ({ ...prev, [field.name]: null }));
            }}
            error={fieldError}
            required={field.required}
          />
        );
      }

      return (
        <TextInput
          key={field.name}
          label={field.label}
          placeholder={field.label}
          value={value}
          onChange={(e) => {
            setCreateValue(field.name, e.currentTarget.value);
            setNewUserErrors((prev) => ({ ...prev, [field.name]: null }));
          }}
          error={fieldError}
          required={field.required}
        />
      );
    });
  };

  const uploadProfilePicture = async (file) => {
    const storageRef = ref(storage, `profilePictures/${Date.now()}_${file.name}`);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  };

  const handleCreateUser = async () => {
    const errors = {};
    createFields.forEach((field) => {
      const value = getCreateValue(field.name);
      const error = validateField(field, value);
      if (error) errors[field.name] = error;
    });

    if (Object.keys(errors).length > 0) {
      setNewUserErrors(errors);
      return;
    }

    const correoValue = getCreateValue("correo") || getCreateValue("email");
    if (correoValue && !isValidEmail(correoValue)) {
      setNewUserErrors((prev) => ({ ...prev, correo: "Ingresa un correo válido." }));
      return;
    }

    setCreatingUser(true);
    try {
      if (correoValue) {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("correo", "==", correoValue.trim().toLowerCase()));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          setNewUserErrors((prev) => ({ ...prev, correo: "Ya existe un usuario con este correo." }));
          setCreatingUser(false);
          return;
        }
      }

      const dataToSave = {
        ...newUserValues,
        eventId: event?.id,
        checkedIn: false,
        createdAt: new Date().toISOString(),
      };

      if (correoValue) {
        dataToSave.correo = correoValue.trim().toLowerCase();
      }

      if (dataToSave.photo) {
        const photoURL = await uploadProfilePicture(dataToSave.photo);
        dataToSave.photoURL = photoURL;
        delete dataToSave.photo;
      }

      await addDoc(collection(db, "users"), dataToSave);
      resetCreateUserForm();
      setCreateUserOpened(false);
    } catch (error) {
      console.error("Error creando usuario:", error);
    } finally {
      setCreatingUser(false);
    }
  };

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
        if (newValue) {
          const standbySnap = await getDocs(
            query(
              collection(db, "events", event.id, "meetings"),
              where("status", "==", "accepted"),
              where("checkInStatus", "==", "standby"),
              where("participants", "array-contains", attendee.id)
            )
          );
          for (const d of standbySnap.docs) {
            const m = d.data();
            const otherId = (m.participants || []).find((p) => p !== attendee.id);
            if (!otherId) continue;
            const otherUserDoc = await getDoc(doc(db, "users", otherId));
            const otherCheckedIn = otherUserDoc.exists() && otherUserDoc.data().checkedIn === true;
            if (otherCheckedIn) {
              await updateDoc(doc(db, "events", event.id, "meetings", d.id), { checkInStatus: "ready" });
            }
          }
        } else {
          const acceptedSnap = await getDocs(
            query(
              collection(db, "events", event.id, "meetings"),
              where("status", "==", "accepted"),
              where("participants", "array-contains", attendee.id)
            )
          );
          for (const d of acceptedSnap.docs) {
            await updateDoc(doc(db, "events", event.id, "meetings", d.id), { checkInStatus: "standby" });
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
        <Group mt="xs" gap="xs" align="center">
          <Badge color="green" variant="light">{checkedIn.length} presentes</Badge>
          <Badge color="gray" variant="light">{notCheckedIn.length} pendientes</Badge>
          <Badge color="blue" variant="light">{filtered.length} total</Badge>
          <Button size="xs" variant="outline" onClick={() => { resetCreateUserForm(); setCreateUserOpened(true); }}>
            Crear usuario
          </Button>
        </Group>

        <Modal
          opened={createUserOpened}
          onClose={() => setCreateUserOpened(false)}
          title="Crear usuario"
          size="lg"
          centered
        >
          <Stack>
            {renderCreateUserFields()}
            <Group position="right" spacing="xs">
              <Button variant="default" onClick={() => setCreateUserOpened(false)}>
                Cancelar
              </Button>
              <Button loading={creatingUser} onClick={handleCreateUser}>
                Crear usuario
              </Button>
            </Group>
          </Stack>
        </Modal>
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

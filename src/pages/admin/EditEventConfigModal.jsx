/* eslint-disable react/prop-types */
import { useState, useMemo } from "react";
import {
  Button,
  Modal,
  NumberInput,
  Stack,
  TextInput,
  Text,
  Alert,
  Group,
  Divider,
} from "@mantine/core";
import { doc, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../firebase/firebaseConfig";

// Aux: "HH:mm" a minutos
function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

// Modal de configuración de evento/agendamiento
const EditEventConfigModal = ({
  opened,
  onClose,
  event,
  refreshEvents,
  setGlobalMessage,
}) => {
  // ---- Estados ----
  const [eventName, setEventName] = useState(event.eventName || "");
  const [eventDate, setEventDate] = useState(event.config?.eventDate || "");
  const [eventStartTime, setEventStartTime] = useState(event.config?.eventStartTime || "");
  const [eventEndTime, setEventEndTime] = useState(event.config?.eventEndTime || "");
  const [eventLocation, setEventLocation] = useState(event.config?.eventLocation || "");
  const [eventImageUrl, setEventImageUrl] = useState(event.eventImage || "");
  const [eventImageFile, setEventImageFile] = useState(null);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState(event.backgroundImage || "");
  const [backgroundMobileImageUrl, setBackgroundMobileImageUrl] = useState(event.backgroundMobileImage || "");
  const [backgroundImageFile, setBackgroundImageFile] = useState(null);
  const [backgroundMobileImageFile, setBackgroundMobileImageFile] = useState(null);

  // Config básicos
  const [maxPersons, setMaxPersons] = useState(event.config?.maxPersons || 100);
  const [numTables, setNumTables] = useState(event.config?.numTables || 50);
  const [meetingDuration, setMeetingDuration] = useState(event.config?.meetingDuration || 10);
  const [breakTime, setBreakTime] = useState(event.config?.breakTime || 5);
  const [startTime, setStartTime] = useState(event.config?.startTime || "09:00");
  const [endTime, setEndTime] = useState(event.config?.endTime || "18:00");
  const [tableNamesInput, setTableNamesInput] = useState(
    (event.config?.tableNames || []).join(", ")
  );
  // Bloques de descanso
  const [breakBlocks, setBreakBlocks] = useState(event.config?.breakBlocks?.length
    ? event.config.breakBlocks
    : []);
  // Máximo de citas por usuario (editable y calculado)
  const [maxMeetingsPerUser, setMaxMeetingsPerUser] = useState(
    event.config?.maxMeetingsPerUser ?? 1
  );

  // Archivos de imagen
  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) setEventImageFile(e.target.files[0]);
  };
  const handleBackgroundFileChange = (e) => {
    if (e.target.files && e.target.files[0]) setBackgroundImageFile(e.target.files[0]);
  };
  const handleBackgroundMobileFileChange = (e) => {
    if (e.target.files && e.target.files[0]) setBackgroundMobileImageFile(e.target.files[0]);
  }

  // Subida a Storage
  const uploadImage = async (file) => {
    const storageRef = ref(storage, `events/${file.name}-${Date.now()}`);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  };

  // ------ RESUMEN CALCULADO ------
  const configSummary = useMemo(() => {
    const totalMinutes = timeToMinutes(endTime) - timeToMinutes(startTime);
    const blockLen = meetingDuration + breakTime;
    // Filtrar descansos válidos
    const validBreakBlocks = breakBlocks.filter(
      (b) => b.start && b.end && b.start < b.end
    );
    const totalBreakMinutes = validBreakBlocks.reduce((acc, block) => {
      return acc + (timeToMinutes(block.end) - timeToMinutes(block.start));
    }, 0);

    // Calcular minutos hábiles descontando descansos definidos
    const workingMinutes = totalMinutes - totalBreakMinutes;
    const totalBlocks = Math.floor(workingMinutes / blockLen);
    const totalSlots = totalBlocks * numTables;

    return {
      totalBlocks,
      totalSlots,
      maxMeetingsPerUser: totalBlocks,
      breakBlocksCount: validBreakBlocks.length,
      totalBreakMinutes,
    };
  }, [startTime, endTime, meetingDuration, breakTime, numTables, breakBlocks]);

  // ------ GUARDADO ------
  const saveConfig = async () => {
    let finalEventImage = eventImageUrl;
    let finalBackgroundImage = backgroundImageUrl;
    let finalBackgroundMobileImage = backgroundMobileImageUrl;

    try {
      if (eventImageFile) finalEventImage = await uploadImage(eventImageFile);
      if (backgroundImageFile) finalBackgroundImage = await uploadImage(backgroundImageFile);
      if (backgroundMobileImageFile) finalBackgroundMobileImage = await uploadImage(backgroundMobileImageFile);
    } catch (err) {
      setGlobalMessage?.("Error al subir la(s) imagen(es)");
      return;
    }

    // Nombres de mesas (si los dan, forzar a la cantidad real)
    let tableNames = [];
    if (tableNamesInput.trim() !== "") {
      tableNames = tableNamesInput.split(",").map((t) => t.trim()).filter(Boolean);
      if (tableNames.length !== numTables) setNumTables(tableNames.length);
    } else {
      tableNames = Array.from({ length: numTables }, (_, i) => `Mesa ${i + 1}`);
    }

    // Formato: [{start: "10:00", end: "10:15"}, ...]
    const breakBlocksSanitized = breakBlocks.filter(
      (b) => b.start && b.end && b.start < b.end
    );

    const newConfig = {
      maxPersons,
      numTables,
      meetingDuration,
      breakTime,
      startTime,
      endTime,
      tableNames,
      breakBlocks: breakBlocksSanitized,
      maxMeetingsPerUser: maxMeetingsPerUser || configSummary.maxMeetingsPerUser,
      eventDate,
      eventStartTime,
      eventEndTime,
      eventLocation,
    };

    try {
      await setDoc(
        doc(db, "events", event.id),
        {
          eventName,
          eventImage: finalEventImage,
          backgroundImage: finalBackgroundImage,
          backgroundMobileImage: finalBackgroundMobileImage,
          config: newConfig,
        },
        { merge: true }
      )
      setGlobalMessage?.("Configuración actualizada correctamente");
      onClose();
      refreshEvents();
    } catch (error) {
      setGlobalMessage("Error al actualizar configuración");
    }
  };

  // ---------- UI ----------
  return (
    <Modal opened={opened} onClose={onClose} title="Configuración del evento" size="xl">
      <Stack>
        <TextInput
          label="Nombre del Evento"
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
        />
        <TextInput
          label="Fecha del Evento"
          type="date"
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
        />
        <Group grow>
          <TextInput
            label="Hora de inicio del evento"
            type="time"
            value={eventStartTime}
            onChange={(e) => setEventStartTime(e.target.value)}
          />
          <TextInput
            label="Hora de fin del evento"
            type="time"
            value={eventEndTime}
            onChange={(e) => setEventEndTime(e.target.value)}
          />
        </Group>
        <TextInput
          label="Lugar del Evento"
          value={eventLocation}
          placeholder="Ingrese la ubicación del evento"
          onChange={(e) => setEventLocation(e.target.value)}
        />
        <TextInput
          label="URL de la imagen del Evento (opcional)"
          value={eventImageUrl}
          onChange={(e) => setEventImageUrl(e.target.value)}
        />
        <input type="file" accept="image/*" onChange={handleFileChange} style={{ marginBottom: 12 }} />
        <TextInput
          label="URL imagen de fondo (opcional)"
          value={backgroundImageUrl}
          onChange={(e) => setBackgroundImageUrl(e.target.value)}
        />
        <input type="file" accept="image/*" onChange={handleBackgroundFileChange} style={{ marginBottom: 12 }} />
        <TextInput
          label="URL imagen de fondo mobile (opcional)"
          value={backgroundMobileImageUrl}
          onChange={(e) => setBackgroundMobileImageUrl(e.target.value)}
        />
        <input type="file" accept="image/*" onChange={handleBackgroundMobileFileChange} style={{ marginBottom: 12 }} />
        <NumberInput
          label="Cantidad máxima de personas"
          value={maxPersons}
          onChange={setMaxPersons}
          min={1}
        />
        <NumberInput
          label="Cantidad de mesas"
          value={numTables}
          onChange={setNumTables}
          min={1}
        />
        <TextInput
          label="Nombres de mesas (separados por coma)"
          value={tableNamesInput}
          placeholder="Ejemplo: Mesa 1, Mesa 2, VIP, ..."
          onChange={(e) => setTableNamesInput(e.target.value)}
        />
        <NumberInput
          label="Duración de cada cita (minutos)"
          value={meetingDuration}
          onChange={setMeetingDuration}
          min={5}
        />
        <NumberInput
          label="Tiempo entre citas (minutos)"
          value={breakTime}
          onChange={setBreakTime}
          min={0}
        />
        <Group grow>
          <TextInput
            label="Hora de inicio"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
          <TextInput
            label="Hora de fin"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </Group>
        <Divider label="Bloques de descanso (opcional)" my="sm" />
        {breakBlocks.map((block, idx) => (
          <Group key={idx} align="flex-end" spacing="xs" noWrap>
            <Text size="sm">Bloque #{idx + 1}</Text>
            <TextInput
              label="Inicio"
              type="time"
              value={block.start}
              onChange={(e) => {
                const updated = [...breakBlocks];
                updated[idx].start = e.target.value;
                setBreakBlocks(updated);
              }}
              style={{ width: 120 }}
            />
            <TextInput
              label="Fin"
              type="time"
              value={block.end}
              onChange={(e) => {
                const updated = [...breakBlocks];
                updated[idx].end = e.target.value;
                setBreakBlocks(updated);
              }}
              style={{ width: 120 }}
            />
            <Button
              variant="subtle"
              color="red"
              size="xs"
              onClick={() => setBreakBlocks(breakBlocks.filter((_, i) => i !== idx))}
            >
              Eliminar
            </Button>
          </Group>
        ))}
        <Button
          variant="outline"
          size="xs"
          onClick={() => setBreakBlocks([...breakBlocks, { start: "", end: "" }])}
          style={{ width: 180 }}
        >
          Añadir bloque de descanso
        </Button>
        <Divider my="xs" />
        <NumberInput
          label="Límite máximo de citas por usuario"
          value={maxMeetingsPerUser}
          onChange={setMaxMeetingsPerUser}
          min={1}
          description="Puedes dejarlo igual al número de bloques, o ajustarlo según la lógica del evento."
        />
        <Alert color="blue" variant="light" mt="md">
          <Text><b>Resumen configuración agenda:</b></Text>
          <Text size="sm">
            • Bloques de reunión: {configSummary.totalBlocks}
          </Text>
          <Text size="sm">
            • Slots totales (bloques × mesas): {configSummary.totalSlots}
          </Text>
          <Text size="sm">
            • Citas máximas por usuario (teórico): {configSummary.maxMeetingsPerUser}
          </Text>
          <Text size="sm">
            • Límite máximo de citas por usuario (editable): {maxMeetingsPerUser}
          </Text>
          <Text size="sm">
            • Bloques de descanso definidos: {configSummary.breakBlocksCount}
          </Text>
          <Text size="sm">
            • Tiempo total de descansos: {configSummary.totalBreakMinutes} minutos
          </Text>
        </Alert>
        <Button onClick={saveConfig} mt="md">Guardar configuración</Button>
      </Stack>
    </Modal>
  );
};

export default EditEventConfigModal;
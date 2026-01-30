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
  ColorInput,
} from "@mantine/core";
import { doc, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../firebase/firebaseConfig";
import QRCode from "qrcode";

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
  
  // Nuevo campo para Landing URL y QR
  const [landingUrl, setLandingUrl] = useState(event.landingUrl || "");
  const [landingQR, setLandingQR] = useState(event.landingQR || "");

  // Config básicos
  const [maxPersons, setMaxPersons] = useState(event.config?.maxPersons || 100);
  const [numTables, setNumTables] = useState(event.config?.numTables || 50);
  const [meetingDuration, setMeetingDuration] = useState(event.config?.meetingDuration || 10);
  const [breakTime, setBreakTime] = useState(event.config?.breakTime || 0);
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

  // Color primario (hex)
  const [primaryColor, setPrimaryColor] = useState(event.config?.primaryColor || "#228be6");

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

  // Generar QR y subirlo a Storage
  const generateAndUploadQR = async (url) => {
    try {
      // Generar QR como data URL
      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 500,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      
      // Convertir data URL a Blob
      const response = await fetch(qrDataUrl);
      const blob = await response.blob();
      
      // Crear un archivo con nombre único
      const fileName = `qr-${event.id}-${Date.now()}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });
      
      // Subir a Storage
      const storageRef = ref(storage, `events/qr/${fileName}`);
      await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);
      
      return downloadUrl;
    } catch (error) {
      console.error('Error generando QR:', error);
      throw error;
    }
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
    let finalLandingQR = landingQR;

    try {
      if (eventImageFile) finalEventImage = await uploadImage(eventImageFile);
      if (backgroundImageFile) finalBackgroundImage = await uploadImage(backgroundImageFile);
      if (backgroundMobileImageFile) finalBackgroundMobileImage = await uploadImage(backgroundMobileImageFile);
      
      // Generar y subir QR si hay una URL de landing
      if (landingUrl && landingUrl.trim() !== "") {
        setGlobalMessage?.("Generando código QR...");
        finalLandingQR = await generateAndUploadQR(landingUrl);
      }
    } catch (err) {
      console.error(err);
      setGlobalMessage?.("Error al subir la(s) imagen(es) o generar el QR");
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
      primaryColor,
    };

    try {
      await setDoc(
        doc(db, "events", event.id),
        {
          eventName,
          eventImage: finalEventImage,
          backgroundImage: finalBackgroundImage,
          backgroundMobileImage: finalBackgroundMobileImage,
          landingUrl,
          landingQR: finalLandingQR,
          config: newConfig,
        },
        { merge: true }
      )
      setGlobalMessage?.("Configuración actualizada correctamente");
      onClose();
      refreshEvents();
    } catch (error) {
      console.error(error);
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
        
        <Divider label="Landing y código QR" my="sm" />
        <TextInput
          label="URL del Landing"
          value={landingUrl}
          placeholder="https://ejemplo.com/landing"
          onChange={(e) => setLandingUrl(e.target.value)}
          description="Se generará automáticamente un código QR con esta URL al guardar"
        />
        {landingQR && (
          <Alert color="green" variant="light">
            <Text size="sm">Código QR actual generado</Text>
            <img src={landingQR} alt="QR Code" style={{ width: 150, marginTop: 8 }} />
          </Alert>
        )}
        
        <Divider label="Color principal" my="sm" />
        <ColorInput
          label="Color primario"
          description="Define el color primario de la interfaz para Landing y Dashboard"
          value={primaryColor}
          onChange={setPrimaryColor}
          format="hex"
          swatches={['#228be6','#e64980','#be4bdb','#7950f2','#4c6ef5','#15aabf','#12b886','#40c057','#fab005','#fd7e14','#fa5252']}
        />

        <Divider label="Imágenes del evento" my="sm" />
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
        
        <Divider label="Configuración de agendamiento" my="sm" />
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
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
  // Soporte multi-día con configuración por día
  const [eventDays, setEventDays] = useState(() => {
    // Si existe dailyConfig, usarlo
    if (event.config?.dailyConfig) {
      return Object.entries(event.config.dailyConfig).map(([date, config]) => ({
        date,
        startTime: config.startTime || "09:00",
        endTime: config.endTime || "18:00",
        breakBlocks: config.breakBlocks || [],
      }));
    }
    // Si existe eventDates, crear configuración por defecto
    if (event.config?.eventDates?.length) {
      return event.config.eventDates.map((date) => ({
        date,
        startTime: event.config?.startTime || "09:00",
        endTime: event.config?.endTime || "18:00",
        breakBlocks: event.config?.breakBlocks || [],
      }));
    }
    // Si solo existe eventDate, crear un día
    if (event.config?.eventDate) {
      return [{
        date: event.config.eventDate,
        startTime: event.config?.startTime || "09:00",
        endTime: event.config?.endTime || "18:00",
        breakBlocks: event.config?.breakBlocks || [],
      }];
    }
    // Por defecto, un día vacío
    return [{
      date: "",
      startTime: "09:00",
      endTime: "18:00",
      breakBlocks: [],
    }];
  });
  
  const [eventLocation, setEventLocation] = useState(event.config?.eventLocation || "");
  const [eventImageUrl, setEventImageUrl] = useState(event.eventImage || "");
  const [eventImageFile, setEventImageFile] = useState(null);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState(event.backgroundImage || "");
  const [backgroundMobileImageUrl, setBackgroundMobileImageUrl] = useState(event.backgroundMobileImage || "");
  const [backgroundImageFile, setBackgroundImageFile] = useState(null);
  const [backgroundMobileImageFile, setBackgroundMobileImageFile] = useState(null);

  // Logo para el header del dashboard
  const [dashboardLogoUrl, setDashboardLogoUrl] = useState(event.dashboardLogo || "");
  const [dashboardLogoFile, setDashboardLogoFile] = useState(null);
  
  // Nuevo campo para Landing URL y QR
  const [landingUrl, setLandingUrl] = useState(event.landingUrl || "");
  const [landingQR, setLandingQR] = useState(event.landingQR || "");

  // Config básicos
  const [maxPersons, setMaxPersons] = useState(event.config?.maxPersons || 100);
  const [numTables, setNumTables] = useState(event.config?.numTables || 50);
  const [meetingDuration, setMeetingDuration] = useState(event.config?.meetingDuration || 10);
  const [breakTime, setBreakTime] = useState(event.config?.breakTime || 0);
  // Configuración global (ya no se usa para horarios, solo para referencia)
  const [startTime, setStartTime] = useState(event.config?.startTime || "09:00");
  const [endTime, setEndTime] = useState(event.config?.endTime || "18:00");
  const [tableNamesInput, setTableNamesInput] = useState(
    (event.config?.tableNames || []).join(", ")
  );
  // Bloques de descanso globales (ya no se usan, cada día tiene los suyos)
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
  const handleDashboardLogoFileChange = (e) => {
    if (e.target.files && e.target.files[0]) setDashboardLogoFile(e.target.files[0]);
  };

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
    let totalBlocks = 0;
    let totalBreakMinutes = 0;
    
    // Calcular para cada día
    eventDays.forEach((day) => {
      const totalMinutes = timeToMinutes(day.endTime) - timeToMinutes(day.startTime);
      const blockLen = meetingDuration + breakTime;
      
      // Filtrar descansos válidos del día
      const validBreakBlocks = (day.breakBlocks || []).filter(
        (b) => b.start && b.end && b.start < b.end
      );
      
      const dayBreakMinutes = validBreakBlocks.reduce((acc, block) => {
        return acc + (timeToMinutes(block.end) - timeToMinutes(block.start));
      }, 0);
      
      totalBreakMinutes += dayBreakMinutes;
      
      // Calcular minutos hábiles descontando descansos
      const workingMinutes = totalMinutes - dayBreakMinutes;
      const dayBlocks = Math.floor(workingMinutes / blockLen);
      totalBlocks += dayBlocks;
    });
    
    const numDays = eventDays.length || 1;
    const totalSlots = totalBlocks * numTables;
    const avgBlocksPerDay = Math.floor(totalBlocks / numDays);

    return {
      totalBlocks,
      totalSlots,
      maxMeetingsPerUser: totalBlocks, // Total en todos los días
      avgBlocksPerDay,
      breakBlocksCount: eventDays.reduce((acc, day) => acc + (day.breakBlocks?.length || 0), 0),
      totalBreakMinutes,
      numDays,
    };
  }, [eventDays, meetingDuration, breakTime, numTables]);

  // ------ GUARDADO ------
  const saveConfig = async () => {
    let finalEventImage = eventImageUrl;
    let finalBackgroundImage = backgroundImageUrl;
    let finalBackgroundMobileImage = backgroundMobileImageUrl;
    let finalDashboardLogo = dashboardLogoUrl;
    let finalLandingQR = landingQR;

    try {
      if (eventImageFile) finalEventImage = await uploadImage(eventImageFile);
      if (backgroundImageFile) finalBackgroundImage = await uploadImage(backgroundImageFile);
      if (backgroundMobileImageFile) finalBackgroundMobileImage = await uploadImage(backgroundMobileImageFile);
      if (dashboardLogoFile) finalDashboardLogo = await uploadImage(dashboardLogoFile);
      
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

    // Ordenar fechas cronológicamente
    const sortedDays = [...eventDays].sort((a, b) => a.date.localeCompare(b.date));
    const eventDates = sortedDays.map(d => d.date);
    
    // Crear dailyConfig con la configuración de cada día
    const dailyConfig = {};
    sortedDays.forEach((day) => {
      if (day.date) {
        dailyConfig[day.date] = {
          startTime: day.startTime,
          endTime: day.endTime,
          breakBlocks: (day.breakBlocks || []).filter(
            (b) => b.start && b.end && b.start < b.end
          ),
        };
      }
    });
    
    const newConfig = {
      maxPersons,
      numTables,
      meetingDuration,
      breakTime,
      startTime, // Mantener para compatibilidad
      endTime, // Mantener para compatibilidad
      tableNames,
      breakBlocks: breakBlocksSanitized, // Mantener para compatibilidad
      maxMeetingsPerUser: maxMeetingsPerUser || configSummary.maxMeetingsPerUser,
      eventDates: eventDates, // Array de fechas
      eventDate: eventDates[0] || "", // Primera fecha (compatibilidad)
      dailyConfig, // NUEVO: configuración específica por día
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
          dashboardLogo: finalDashboardLogo,
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
        
        <Divider label="Fechas y horarios del evento (multi-día)" my="sm" />
        <Text size="sm" c="dimmed">
          Configura uno o más días para el evento. Cada día puede tener horarios y descansos diferentes.
        </Text>
        
        {eventDays.map((day, dayIdx) => (
          <Stack key={dayIdx} p="md" style={{ border: "1px solid #e0e0e0", borderRadius: 8 }}>
            <Group justify="space-between" align="center">
              <Text fw={600} size="sm">Día {dayIdx + 1}</Text>
              <Button
                variant="subtle"
                color="red"
                size="xs"
                onClick={() => setEventDays(eventDays.filter((_, i) => i !== dayIdx))}
                disabled={eventDays.length === 1}
              >
                Eliminar día
              </Button>
            </Group>
            
            <TextInput
              label="Fecha"
              type="date"
              value={day.date}
              onChange={(e) => {
                const updated = [...eventDays];
                updated[dayIdx].date = e.target.value;
                setEventDays(updated);
              }}
              required
            />
            
            <Group grow>
              <TextInput
                label="Hora de inicio"
                type="time"
                value={day.startTime}
                onChange={(e) => {
                  const updated = [...eventDays];
                  updated[dayIdx].startTime = e.target.value;
                  setEventDays(updated);
                }}
              />
              <TextInput
                label="Hora de fin"
                type="time"
                value={day.endTime}
                onChange={(e) => {
                  const updated = [...eventDays];
                  updated[dayIdx].endTime = e.target.value;
                  setEventDays(updated);
                }}
              />
            </Group>
            
            <Divider label="Bloques de descanso (opcional)" my="xs" />
            {(day.breakBlocks || []).map((block, blockIdx) => (
              <Group key={blockIdx} align="flex-end" spacing="xs" wrap="nowrap">
                <Text size="xs">Descanso #{blockIdx + 1}</Text>
                <TextInput
                  label="Inicio"
                  type="time"
                  value={block.start}
                  onChange={(e) => {
                    const updated = [...eventDays];
                    updated[dayIdx].breakBlocks[blockIdx].start = e.target.value;
                    setEventDays(updated);
                  }}
                  style={{ width: 120 }}
                />
                <TextInput
                  label="Fin"
                  type="time"
                  value={block.end}
                  onChange={(e) => {
                    const updated = [...eventDays];
                    updated[dayIdx].breakBlocks[blockIdx].end = e.target.value;
                    setEventDays(updated);
                  }}
                  style={{ width: 120 }}
                />
                <Button
                  variant="subtle"
                  color="red"
                  size="xs"
                  onClick={() => {
                    const updated = [...eventDays];
                    updated[dayIdx].breakBlocks = updated[dayIdx].breakBlocks.filter((_, i) => i !== blockIdx);
                    setEventDays(updated);
                  }}
                >
                  Eliminar
                </Button>
              </Group>
            ))}
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                const updated = [...eventDays];
                if (!updated[dayIdx].breakBlocks) updated[dayIdx].breakBlocks = [];
                updated[dayIdx].breakBlocks.push({ start: "", end: "" });
                setEventDays(updated);
              }}
              style={{ width: 200 }}
            >
              Añadir descanso a este día
            </Button>
          </Stack>
        ))}
        
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEventDays([...eventDays, { 
            date: "", 
            startTime: "09:00", 
            endTime: "18:00",
            breakBlocks: []
          }])}
          fullWidth
        >
          Añadir día al evento
        </Button>
        
        <Divider label="Fechas y horarios del evento (multi-día)" my="sm" />
        <Text size="sm" c="dimmed">
          Configura uno o más días para el evento. Cada día puede tener horarios y descansos diferentes.
        </Text>
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

        <TextInput
          label="Logo del Dashboard (opcional)"
          description="Imagen o logo que se muestra en el header del dashboard del evento"
          value={dashboardLogoUrl}
          onChange={(e) => setDashboardLogoUrl(e.target.value)}
        />
        <input type="file" accept="image/*" onChange={handleDashboardLogoFileChange} style={{ marginBottom: 12 }} />
        {dashboardLogoUrl && (
          <img src={dashboardLogoUrl} alt="Logo dashboard" style={{ height: 40, objectFit: "contain", marginBottom: 8 }} />
        )}

        <Divider label="Configuración de agendamiento" my="sm" />
        <Text size="sm" c="dimmed" mb="sm">
          Configuración global que aplica a todos los días del evento.
        </Text>
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
            • Días del evento: {configSummary.numDays}
          </Text>
          <Text size="sm">
            • Bloques de reunión totales: {configSummary.totalBlocks}
          </Text>
          <Text size="sm">
            • Bloques promedio por día: {configSummary.avgBlocksPerDay}
          </Text>
          <Text size="sm">
            • Slots totales (bloques × mesas): {configSummary.totalSlots}
          </Text>
          <Text size="sm">
            • Citas máximas por usuario (total): {configSummary.maxMeetingsPerUser}
          </Text>
          <Text size="sm">
            • Límite máximo de citas por usuario (editable): {maxMeetingsPerUser}
          </Text>
          <Text size="sm">
            • Bloques de descanso totales: {configSummary.breakBlocksCount}
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
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
  SegmentedControl,
  Select,
  Tabs,
  Paper,
  Box,
  Title,
  Grid
} from "@mantine/core";
import { IconSettings, IconCalendarTime, IconPalette, IconCalendarEvent, IconUsers, IconChecklist } from "@tabler/icons-react";
import { doc, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../firebase/firebaseConfig";
import QRCode from "qrcode";
import ConfigureFieldsModal from "./ConfigureFieldsModal";
import EventPoliciesModal from "./EventPoliciesModal";
import ConfigureSurveyModal from "./ConfigureSurveyModal";

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
  const [eventType, setEventType] = useState(event.eventType || "Networking");
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
  const [landingTitleType, setLandingTitleType] = useState(event.config?.landingTitleType || "text");
  const [landingTitleImageUrl, setLandingTitleImageUrl] = useState(event.config?.landingTitleImage || "");
  const [landingTitleImageFile, setLandingTitleImageFile] = useState(null);
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
  const handleLandingTitleImageFileChange = (e) => {
    if (e.target.files && e.target.files[0]) setLandingTitleImageFile(e.target.files[0]);
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
    let finalLandingTitleImage = landingTitleImageUrl;
    let finalBackgroundImage = backgroundImageUrl;
    let finalBackgroundMobileImage = backgroundMobileImageUrl;
    let finalDashboardLogo = dashboardLogoUrl;
    let finalLandingQR = landingQR;

    try {
      if (eventImageFile) finalEventImage = await uploadImage(eventImageFile);
      if (landingTitleImageFile) finalLandingTitleImage = await uploadImage(landingTitleImageFile);
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
      landingTitleType,
      landingTitleImage: finalLandingTitleImage,
    };

    try {
      await setDoc(
        doc(db, "events", event.id),
        {
          eventName,
          eventType,
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
      refreshEvents();
    } catch (error) {
      console.error(error);
      setGlobalMessage("Error al actualizar configuración");
    }
  };

  // ---------- UI ----------
  return (
    <Modal opened={opened} onClose={onClose} title="Configuración del evento" size="xl">
      <Tabs 
        defaultValue="general" 
        variant="pills"
        radius="xl"
        color="blue"
        styles={{
          list: {
            gap: '8px',
            marginBottom: '24px',
            backgroundColor: 'var(--mantine-color-gray-0)',
            padding: '6px',
            borderRadius: '100px',
            flexWrap: 'wrap',
            justifyContent: 'center'
          },
          tab: {
            fontWeight: 600,
            transition: 'all 0.2s ease',
            border: '1px solid transparent',
            '&[data-active]': {
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            },
            '&:hover:not([data-active])': {
              backgroundColor: 'var(--mantine-color-gray-2)',
            }
          }
        }}
      >
        <Tabs.List>
          <Tabs.Tab value="general" leftSection={<IconSettings size={16} />}>General</Tabs.Tab>
          <Tabs.Tab value="horarios" leftSection={<IconCalendarTime size={16} />}>Horarios</Tabs.Tab>
          <Tabs.Tab value="apariencia" leftSection={<IconPalette size={16} />}>Apariencia</Tabs.Tab>
          <Tabs.Tab value="agendamiento" leftSection={<IconCalendarEvent size={16} />}>Agendamiento</Tabs.Tab>
          <Tabs.Tab value="campos" leftSection={<IconUsers size={16} />}>Campos</Tabs.Tab>
          <Tabs.Tab value="politicas" leftSection={<IconSettings size={16} />}>Políticas</Tabs.Tab>
          <Tabs.Tab value="encuesta" leftSection={<IconChecklist size={16} />}>Encuesta</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="general">
          <Stack>
            <Alert title="Información General" color="blue" variant="light">
              Datos básicos que identifican al evento frente a los asistentes.
            </Alert>
            <TextInput
              label="Nombre del Evento"
              value={eventName}
              description="El título principal del evento (ej: Gran Rueda de Negocios 2026)."
              onChange={(e) => setEventName(e.target.value)}
            />
            
            <Select
              label="Tipo de Evento"
              description="Define cómo interactúan los usuarios. En Networking todos son iguales; en Rueda de Negocios se usan roles como Comprador/Vendedor."
              data={[
                { value: "Networking", label: "Networking" },
                { value: "Rueda de negocios", label: "Rueda de negocios" }
              ]}
              value={eventType}
              onChange={setEventType}
            />

            <TextInput
              label="Lugar del evento"
              value={eventLocation}
              placeholder="Ej: Centro de Convenciones, Hotel XYZ, etc."
              onChange={(e) => setEventLocation(e.target.value)}
              description="Ubicación física donde se realizará el evento. Se mostrará a los asistentes."
            />
            <TextInput
              label="URL del Landing"
              value={landingUrl}
              placeholder="https://ejemplo.com/landing"
              onChange={(e) => setLandingUrl(e.target.value)}
              description="Página promocional del evento. Se generará automáticamente un código QR con esta URL al guardar."
            />
            {landingQR && (
              <Alert color="green" variant="light">
                <Text size="sm">Código QR actual generado</Text>
                <img src={landingQR} alt="QR Code" style={{ width: 150, marginTop: 8 }} />
              </Alert>
            )}
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={onClose}>Cancelar</Button>
              <Button onClick={saveConfig}>Guardar configuración básica</Button>
            </Group>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="horarios">
          <Stack>
            <Alert title="Días y Horarios del Evento" color="blue" variant="light">
              Configura uno o más días para el evento. Cada día puede tener horarios de inicio/fin y bloques de descanso independientes (ej: hora de almuerzo).
            </Alert>
            
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
                <Text size="xs" c="dimmed" mb="xs">
                  Añade espacios donde no se agendarán reuniones (ej: 12:00 a 13:00 para almuerzo).
                </Text>
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
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={onClose}>Cancelar</Button>
              <Button onClick={saveConfig}>Guardar fechas y horarios</Button>
            </Group>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="apariencia">
          <Grid>
            <Grid.Col span={{ base: 12, md: 7 }}>
              <Stack>
                <Alert title="Diseño Visual" color="blue" variant="light">
                  Personaliza cómo se ve la plataforma para los asistentes de tu evento.
                </Alert>
                
                <ColorInput
                  label="Color primario"
                  description="Afecta botones, enlaces, y elementos destacados de la interfaz."
                  value={primaryColor}
                  onChange={setPrimaryColor}
                  format="hex"
                  swatches={['#228be6','#e64980','#be4bdb','#7950f2','#4c6ef5','#15aabf','#12b886','#40c057','#fab005','#fd7e14','#fa5252']}
                />

                <Divider label="Título de la Landing Page" my="sm" />
                <Text size="sm" fw={500} mb={4}>Tipo de título en Landing</Text>
                <SegmentedControl
                  value={landingTitleType}
                  onChange={setLandingTitleType}
                  data={[
                    { label: 'Usar Texto', value: 'text' },
                    { label: 'Usar Logo/Imagen', value: 'image' },
                  ]}
                />
                {landingTitleType === 'image' && (
                  <>
                    <TextInput
                      label="URL de la imagen del título"
                      value={landingTitleImageUrl}
                      onChange={(e) => setLandingTitleImageUrl(e.target.value)}
                    />
                    <input type="file" accept="image/*" onChange={handleLandingTitleImageFileChange} style={{ marginTop: 8, marginBottom: 12 }} />
                  </>
                )}

                <Divider label="Imágenes de la Plataforma" my="sm" />
                <TextInput
                  label="Logo del Dashboard (Opcional)"
                  description="Aparecerá en la parte superior izquierda dentro del panel de asistentes."
                  value={dashboardLogoUrl}
                  onChange={(e) => setDashboardLogoUrl(e.target.value)}
                />
                <input type="file" accept="image/*" onChange={handleDashboardLogoFileChange} style={{ marginBottom: 12 }} />
                
                <TextInput
                  label="Imagen del Evento (Opcional)"
                  description="Imagen principal que representa al evento en listados."
                  value={eventImageUrl}
                  onChange={(e) => setEventImageUrl(e.target.value)}
                />
                <input type="file" accept="image/*" onChange={handleFileChange} style={{ marginBottom: 12 }} />
                {(eventImageUrl || eventImageFile) && (
                  <img src={eventImageFile ? URL.createObjectURL(eventImageFile) : eventImageUrl} alt="Evento" style={{ height: 40, objectFit: "contain", marginBottom: 12 }} />
                )}
                
                <TextInput
                  label="URL imagen de fondo en escritorio (Opcional)"
                  description="Fondo de pantalla para la landing page (login/registro)."
                  value={backgroundImageUrl}
                  onChange={(e) => setBackgroundImageUrl(e.target.value)}
                />
                <input type="file" accept="image/*" onChange={handleBackgroundFileChange} style={{ marginBottom: 12 }} />
                {(backgroundImageUrl || backgroundImageFile) && (
                  <img src={backgroundImageFile ? URL.createObjectURL(backgroundImageFile) : backgroundImageUrl} alt="Fondo" style={{ height: 40, objectFit: "contain", marginBottom: 12 }} />
                )}
                
                <TextInput
                  label="URL imagen de fondo en móviles (Opcional)"
                  description="Fondo optimizado para teléfonos."
                  value={backgroundMobileImageUrl}
                  onChange={(e) => setBackgroundMobileImageUrl(e.target.value)}
                />
                <input type="file" accept="image/*" onChange={handleBackgroundMobileFileChange} style={{ marginBottom: 12 }} />
                {(backgroundMobileImageUrl || backgroundMobileImageFile) && (
                  <img src={backgroundMobileImageFile ? URL.createObjectURL(backgroundMobileImageFile) : backgroundMobileImageUrl} alt="Fondo Mobile" style={{ height: 40, objectFit: "contain", marginBottom: 12 }} />
                )}
              </Stack>
            </Grid.Col>

            {/* Columna de Vista Previa */}
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Paper p="md" withBorder style={{ borderColor: primaryColor || "#228be6", backgroundColor: "#f8f9fa", position: "sticky", top: 20 }}>
                <Text fw={700} c="dimmed" mb="md" size="xs" tt="uppercase">Vista Previa Simulada</Text>
                
                {/* Header Simulado */}
                <Group justify="space-between" mb="xl" p="xs" style={{ backgroundColor: "#fff", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
                  {dashboardLogoUrl || dashboardLogoFile ? (
                    <img src={dashboardLogoFile ? URL.createObjectURL(dashboardLogoFile) : dashboardLogoUrl} alt="Logo" style={{ height: 24, objectFit: "contain" }} />
                  ) : (
                    <Text fw={700} size="sm">Logo Genérico</Text>
                  )}
                  <Box w={24} h={24} style={{ borderRadius: "50%", backgroundColor: primaryColor }} />
                </Group>

                {/* Contenido Landing Simulado */}
                <Stack align="center" ta="center" mb="xl">
                  {landingTitleType === 'image' && (landingTitleImageUrl || landingTitleImageFile) ? (
                    <Box 
                      p="xs" 
                      style={{ width: "100%", minHeight: 60, display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
                      <img 
                        src={landingTitleImageFile ? URL.createObjectURL(landingTitleImageFile) : landingTitleImageUrl} 
                        alt="Título del Landing" 
                        style={{ maxHeight: 60, maxWidth: "100%", objectFit: "contain" }} 
                      />
                    </Box>
                  ) : (
                    <Title order={3}>{eventName || "Título del Evento"}</Title>
                  )}
                  <Text size="xs" c="dimmed">
                    Así se verá el encabezado de bienvenida para tus asistentes en la página principal.
                  </Text>
                </Stack>

                <Button fullWidth color={primaryColor || "#228be6"} mb="sm">
                  Botón Primario de Ejemplo
                </Button>
                <Button fullWidth variant="outline" color={primaryColor || "#228be6"}>
                  Botón Secundario de Ejemplo
                </Button>
                
                <Text ta="center" size="xs" mt="md" c={primaryColor || "#228be6"} style={{ textDecoration: "underline" }}>
                  Enlace con color primario
                </Text>
              </Paper>
            </Grid.Col>
          </Grid>
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onClose}>Cancelar</Button>
            <Button onClick={saveConfig}>Guardar apariencia</Button>
          </Group>
        </Tabs.Panel>

        <Tabs.Panel value="agendamiento">
          <Stack>
            <Alert title="Configuración de la Agenda" color="blue" variant="light">
              Define las reglas matemáticas para la generación de reuniones. Modificar esto recalculará los cupos disponibles.
            </Alert>
            
            <NumberInput
              label="Cantidad de mesas físicas disponibles"
              description="El total de espacios simultáneos donde pueden ocurrir reuniones (ej. 50 mesas)."
              value={numTables}
              onChange={setNumTables}
              min={1}
            />
            <TextInput
              label="Nombres de las mesas (Opcional)"
              description="Si quieres dar nombres específicos, sepáralos por coma (ej: VIP 1, VIP 2). Si no, se llamarán Mesa 1, Mesa 2..."
              value={tableNamesInput}
              placeholder="Ejemplo: Mesa 1, Mesa 2, VIP, ..."
              onChange={(e) => setTableNamesInput(e.target.value)}
            />
            <Group grow>
              <NumberInput
                label="Duración de cada cita"
                description="Tiempo neto de la reunión en minutos (ej: 15)."
                value={meetingDuration}
                onChange={setMeetingDuration}
                min={5}
              />
              <NumberInput
                label="Tiempo de transición"
                description="Minutos entre citas para que las personas cambien de mesa (ej: 5)."
                value={breakTime}
                onChange={setBreakTime}
                min={0}
              />
            </Group>
            
            <NumberInput
              label="Límite de citas por usuario"
              description="Máximo de reuniones que una sola persona puede tener en todo el evento."
              value={maxMeetingsPerUser}
              onChange={setMaxMeetingsPerUser}
              min={1}
            />
            
            <Alert color="gray" mt="md">
              <Text><b>Resumen de Capacidad del Evento:</b></Text>
              <Text size="sm">
                • Días del evento: {configSummary.numDays}
              </Text>
              <Text size="sm">
                • Bloques de reunión generados por día: {configSummary.avgBlocksPerDay}
              </Text>
              <Text size="sm">
                • Capacidad total (Mesas × Bloques): <strong>{configSummary.totalSlots} cupos de reunión.</strong>
              </Text>
              <Text size="sm">
                • Tiempo total asignado a descansos: {configSummary.totalBreakMinutes} minutos.
              </Text>
            </Alert>
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={onClose}>Cancelar</Button>
              <Button onClick={saveConfig}>Guardar agendamiento</Button>
            </Group>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="campos">
          <Alert title="Configuración de Campos" color="blue" variant="light" mb="md" mt="md">
            Aquí puedes personalizar los campos del formulario de registro y su presentación.
          </Alert>
          <ConfigureFieldsModal
            opened={true}
            onClose={onClose}
            event={event}
            refreshEvents={refreshEvents}
            setGlobalMessage={setGlobalMessage}
            inline={true}
          />
        </Tabs.Panel>

        <Tabs.Panel value="politicas">
          <Alert title="Políticas del Evento" color="blue" variant="light" mb="md" mt="md">
            Define cómo interactúan los usuarios y las restricciones aplicables.
          </Alert>
          <EventPoliciesModal
            opened={true}
            onClose={onClose}
            event={event}
            refreshEvents={refreshEvents}
            setGlobalMessage={setGlobalMessage}
            inline={true}
          />
        </Tabs.Panel>

        <Tabs.Panel value="encuesta">
          <Alert title="Configuración de Encuestas" color="blue" variant="light" mb="md" mt="md">
            Define las encuestas de satisfacción para compradores y vendedores.
          </Alert>
          <ConfigureSurveyModal
            opened={true}
            onClose={onClose}
            event={event}
            refreshEvents={refreshEvents}
            setGlobalMessage={setGlobalMessage}
            inline={true}
          />
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
};

export default EditEventConfigModal;
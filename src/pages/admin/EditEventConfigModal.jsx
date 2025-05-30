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
} from "@mantine/core";
import { doc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../firebase/firebaseConfig";

// Funciones auxiliares
function timeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
}

/* ===================================================
   Componente EditEventConfigModal
   – Modal para editar la configuración de un evento,
     mostrando un resumen de las citas posibles.
=================================================== */
const EditEventConfigModal = ({
  opened,
  onClose,
  event,
  refreshEvents,
  setGlobalMessage,
}) => {
  // Campos generales del evento
  const [eventName, setEventName] = useState(event.eventName || "");
  const [eventImageUrl, setEventImageUrl] = useState(event.eventImage || "");
  const [eventImageFile, setEventImageFile] = useState(null);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState(event.backgroundImage || "");
  const [backgroundImageFile, setBackgroundImageFile] = useState(null);

  // Campos de configuración del evento
  const [maxPersons, setMaxPersons] = useState(event.config?.maxPersons || 100);
  const [numTables, setNumTables] = useState(event.config?.numTables || 50);
  const [meetingDuration, setMeetingDuration] = useState(
    event.config?.meetingDuration || 10
  );
  const [breakTime, setBreakTime] = useState(event.config?.breakTime || 5);
  const [startTime, setStartTime] = useState(
    event.config?.startTime || "09:00"
  );
  const [endTime, setEndTime] = useState(event.config?.endTime || "18:00");
  const [tableNamesInput, setTableNamesInput] = useState(
    event.config?.tableNames?.join(", ") || ""
  );
  const [breakBlocks, setBreakBlocks] = useState(
    event.config?.breakBlocks || [{ start: "", end: "" }]
  );

  // Maneja el cambio en el input de tipo "file"
  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setEventImageFile(e.target.files[0]);
    }
  };
  const handleBackgroundFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setBackgroundImageFile(e.target.files[0]);
    }
  };

  // Función para subir la imagen a Firebase Storage y obtener la URL
  const uploadImage = async (file) => {
    const storageRef = ref(storage, `events/${file.name}-${Date.now()}`);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  };

  // Cálculo de resumen: total de bloques, total de slots, y máximo de citas por usuario
  const configSummary = useMemo(() => {
    try {
      const totalMinutes = timeToMinutes(endTime) - timeToMinutes(startTime);
      const blockLength = meetingDuration + breakTime;
      const totalBlocks = Math.floor(totalMinutes / blockLength);
      const totalSlots = totalBlocks * numTables;
      const maxMeetingsPerUser = totalBlocks;

      // Calcular bloques de descanso válidos
      const validBreakBlocks = breakBlocks.filter(
        (b) => b.start && b.end && b.start < b.end
      );

      const totalBreakMinutes = validBreakBlocks.reduce((acc, block) => {
        const minutes = timeToMinutes(block.end) - timeToMinutes(block.start);
        return acc + minutes;
      }, 0);

      return {
        totalBlocks,
        totalSlots,
        maxMeetingsPerUser,
        breakBlocksCount: validBreakBlocks.length,
        totalBreakMinutes,
      };
    } catch {
      return {
        totalBlocks: 0,
        totalSlots: 0,
        maxMeetingsPerUser: 0,
        breakBlocksCount: 0,
        totalBreakMinutes: 0,
      };
    }
  }, [startTime, endTime, meetingDuration, breakTime, numTables, breakBlocks]);

  const [maxMeetingsPerUser, setMaxMeetingsPerUser] = useState(
    event.config?.maxMeetingsPerUser ?? configSummary.maxMeetingsPerUser
  );

  // Guardar los cambios en Firestore
  const saveConfig = async () => {
    let finalEventImage = eventImageUrl;
    let finalBackgroundImage = backgroundImageUrl;
    if (eventImageFile) {
      try {
        finalEventImage = await uploadImage(eventImageFile);
      } catch (error) {
        console.error("Error subiendo la imagen:", error);
        setGlobalMessage?.("Error al subir la imagen.");
        return;
      }
    }
    if (backgroundImageFile) {
      try {
        finalBackgroundImage = await uploadImage(backgroundImageFile);
      } catch (error) {
        console.error("Error subiendo la imagen de fondo:", error);
        setGlobalMessage?.("Error al subir la imagen de fondo.");
        return;
      }
    }

    // Procesar tableNames
    let tableNames = [];
    if (tableNamesInput.trim() !== "") {
      tableNames = tableNamesInput
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name !== "");
      if (tableNames.length !== numTables) {
        setNumTables(tableNames.length);
      }
    } else {
      tableNames = Array.from({ length: numTables }, (_, i) =>
        (i + 1).toString()
      );
    }

    const newConfig = {
      maxPersons,
      numTables,
      meetingDuration,
      breakTime,
      startTime,
      endTime,
      tableNames,
      maxMeetingsPerUser,
      breakBlocks,
    };

    try {
      await updateDoc(doc(db, "events", event.id), {
        eventName,
        eventImage: finalEventImage,
        backgroundImage: finalBackgroundImage,
        config: newConfig,
      });

      setGlobalMessage("Configuración actualizada correctamente.");
      onClose();
      refreshEvents();
    } catch (error) {
      console.error("Error al actualizar configuración:", error);
      setGlobalMessage("Error al actualizar configuración.");
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Editar Configuración del Evento"
    >
      <Stack spacing="xs">
        {/* Campos para nombre e imagen del evento */}
        <TextInput
          label="Nombre del Evento"
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
        />

        <TextInput
          label="URL de la imagen del Evento (opcional)"
          placeholder="https://..."
          value={eventImageUrl}
          onChange={(e) => setEventImageUrl(e.target.value)}
        />

        {/* File input para subir la imagen al Storage */}
        <input type="file" accept="image/*" onChange={handleFileChange} />

        {/* Imagen de fondo */}
        <TextInput
          label="URL de la imagen de fondo (opcional)"
          placeholder="https://..."
          value={backgroundImageUrl}
          onChange={(e) => setBackgroundImageUrl(e.target.value)}
        />
        <input type="file" accept="image/*" onChange={handleBackgroundFileChange} />

        {/* Campos de configuración */}
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
          label="Nombres de mesas (opcional)"
          placeholder="Ej. Mesa 1, Mesa 2, ..."
          value={tableNamesInput}
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
        <TextInput
          label="Hora de inicio (HH:mm)"
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
        />
        <TextInput
          label="Hora de fin (HH:mm)"
          type="time"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
        />

        <NumberInput
          label="Límite máximo de citas por usuario"
          value={maxMeetingsPerUser}
          onChange={setMaxMeetingsPerUser}
          min={1}
          description="Cuántas citas como máximo puede aceptar cada usuario"
        />

        <Text weight={500}>Bloques de descanso</Text>
        {breakBlocks.map((block, idx) => (
          <Stack key={idx} spacing={4}>
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
            />
            <Button
              variant="subtle"
              color="red"
              size="xs"
              onClick={() =>
                setBreakBlocks(breakBlocks.filter((_, i) => i !== idx))
              }
            >
              Eliminar bloque
            </Button>
          </Stack>
        ))}

        <Button
          variant="outline"
          size="xs"
          onClick={() =>
            setBreakBlocks([...breakBlocks, { start: "", end: "" }])
          }
        >
          Añadir otro bloque
        </Button>

        {/* Resumen de la configuración */}
        <Alert color="blue" variant="light">
          <Text>
            <strong>Resumen de la configuración:</strong>
          </Text>
          <Text size="sm">
            • Bloques de reunión: {configSummary.totalBlocks}
          </Text>
          <Text size="sm">
            • Slots totales (bloques × mesas): {configSummary.totalSlots}
          </Text>
          <Text size="sm">
            • Citas máximas por usuario (1 cita por bloque):{" "}
            {configSummary.maxMeetingsPerUser}
          </Text>
          <Text size="sm">
            • Citas máximas por usuario (configurable): {maxMeetingsPerUser}
          </Text>
          <Text size="sm">
            • Bloques de descanso definidos: {configSummary.breakBlocksCount}
          </Text>
          <Text size="sm">
            • Tiempo total de descansos: {configSummary.totalBreakMinutes}{" "}
            minutos
          </Text>
        </Alert>

        <Button onClick={saveConfig}>Guardar Configuración</Button>
      </Stack>
    </Modal>
  );
};

export default EditEventConfigModal;

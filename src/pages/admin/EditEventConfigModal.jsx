/* eslint-disable react/prop-types */
import { Button, Modal, NumberInput, Stack, TextInput } from "@mantine/core";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { useState } from "react";

/* ===================================================
   Componente EditEventConfigModal
   – Modal para editar la configuración de un evento.
=================================================== */
const EditEventConfigModal = ({ opened, onClose, event, refreshEvents, setGlobalMessage }) => {
  // Se inicializan los campos con la configuración del evento
  const [maxPersons, setMaxPersons] = useState(event.config?.maxPersons || 100);
  const [numTables, setNumTables] = useState(event.config?.numTables || 50);
  const [meetingDuration, setMeetingDuration] = useState(event.config?.meetingDuration || 10);
  const [breakTime, setBreakTime] = useState(event.config?.breakTime || 5);
  const [startTime, setStartTime] = useState(event.config?.startTime || "09:00");
  const [endTime, setEndTime] = useState(event.config?.endTime || "18:00");
  const [tableNamesInput, setTableNamesInput] = useState(
    event.config?.tableNames?.join(", ") || ""
  );

  const saveConfig = async () => {
    let tableNames = [];
    if (tableNamesInput.trim() !== "") {
      tableNames = tableNamesInput
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name !== "");
      if (tableNames.length !== numTables) {
        // Se actualiza el número de mesas según los nombres ingresados
        setNumTables(tableNames.length);
      }
    } else {
      tableNames = Array.from({ length: numTables }, (_, i) => (i + 1).toString());
    }

    const newConfig = {
      maxPersons,
      numTables,
      meetingDuration,
      breakTime,
      startTime,
      endTime,
      tableNames,
    };

    try {
      await updateDoc(doc(db, "events", event.id), {
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
    <Modal opened={opened} onClose={onClose} title="Editar Configuración del Evento">
      <Stack>
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
        <Button onClick={saveConfig}>Guardar Configuración</Button>
      </Stack>
    </Modal>
  );
};

export default EditEventConfigModal;
/* eslint-disable react/prop-types */
import { useState } from "react";
import { Modal, Stack, TextInput, Button } from "@mantine/core";
import { collection, addDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../firebase/firebaseConfig";

const CreateEventModal = ({ opened, onClose, refreshEvents, setGlobalMessage }) => {
  const [eventName, setEventName] = useState("");
  const [eventImageUrl, setEventImageUrl] = useState("");
  const [eventImageFile, setEventImageFile] = useState(null);

  // Maneja el cambio en el input de tipo "file"
  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setEventImageFile(e.target.files[0]);
    }
  };

  // Función para subir la imagen a Firebase Storage y obtener la URL
  const uploadImage = async (file) => {
    const storageRef = ref(storage, `events/${file.name}-${Date.now()}`);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  };

  const createEvent = async () => {
    if (!eventName) {
      setGlobalMessage("El nombre del evento es obligatorio.");
      return;
    }
    try {
      // Si se ha seleccionado un archivo, se sube; en caso contrario se usa la URL ingresada.
      let imageUrl = eventImageUrl;
      if (eventImageFile) {
        imageUrl = await uploadImage(eventImageFile);
      }
      const newEvent = {
        eventName,
        eventImage: imageUrl,
        // Configuración por defecto del evento
        config: {
          maxPersons: 100,
          numTables: 50,
          meetingDuration: 10,
          breakTime: 5,
          startTime: "09:00",
          endTime: "18:00",
          tableNames: [],
        },
      };
      await addDoc(collection(db, "events"), newEvent);
      setGlobalMessage("Evento creado correctamente.");
      // Reiniciar campos
      setEventName("");
      setEventImageUrl("");
      setEventImageFile(null);
      onClose();
      refreshEvents();
    } catch (error) {
      console.error("Error al crear evento:", error);
      setGlobalMessage("Error al crear evento.");
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Crear Evento">
      <Stack>
        <TextInput
          label="Nombre del Evento"
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
        />
        <TextInput
          label="URL de Imagen del Evento (opcional)"
          placeholder="https://..."
          value={eventImageUrl}
          onChange={(e) => setEventImageUrl(e.target.value)}
        />
        <input type="file" accept="image/*" onChange={handleFileChange} />
        <Button onClick={createEvent}>Crear</Button>
      </Stack>
    </Modal>
  );
};

export default CreateEventModal;

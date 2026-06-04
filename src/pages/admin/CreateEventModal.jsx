/* eslint-disable react/prop-types */
import { useState, useContext } from "react";
import { Modal, Stack, TextInput, Button, Select, Alert, Text } from "@mantine/core";
import { collection, addDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../firebase/firebaseConfig";
import { AdminAuthContext } from "../../context/AdminAuthContext";

const CreateEventModal = ({ opened, onClose, refreshEvents, setGlobalMessage, orgId }) => {
  const { adminUser } = useContext(AdminAuthContext);
  const [eventName, setEventName] = useState("");
  const [eventType, setEventType] = useState("Networking");
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
        eventType,
        eventImage: imageUrl,
        createdBy: adminUser?.uid || null,
        owners: orgId ? [] : (adminUser?.uid ? [adminUser.uid] : []),
        createdAt: new Date(),
        organizationId: orgId || null,
        status: "abierto",
        // Configuración por defecto del evento
        config: {
          maxPersons: 100,
          numTables: 50,
          meetingDuration: 10,
          breakTime: 5,
          startTime: "09:00",
          endTime: "18:00",
          tableNames: [],
          registrationEnabled: true,
        },
      };
      await addDoc(collection(db, "events"), newEvent);
      setGlobalMessage("Evento creado correctamente.");
      // Reiniciar campos
      setEventName("");
      setEventType("Networking");
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
        <Select
          label="Tipo de Evento"
          data={[
            { value: "Networking", label: "Networking" },
            { value: "Rueda de negocios", label: "Rueda de negocios" }
          ]}
          value={eventType}
          onChange={setEventType}
        />
        
        <Alert title="Información sobre el Tipo de Evento" color="blue" variant="light">
          <Text size="sm">
            <strong>Networking:</strong> Modalidad abierta sin roles predefinidos. Cualquier asistente puede conectar con otros por igual.
          </Text>
          <Text size="sm" mt="xs">
            <strong>Rueda de negocios:</strong> Modalidad estructurada basada en roles (ej. Comprador y Vendedor). Permite definir quién se puede reunir con quién.
          </Text>
        </Alert>

        <TextInput
          label="URL de Imagen del Evento (opcional)"
          placeholder="https://..."
          value={eventImageUrl}
          onChange={(e) => setEventImageUrl(e.target.value)}
        />
        <input type="file" accept="image/*" onChange={handleFileChange} />
        <Text size="xs" c="dimmed" mt="-xs">
          Esta imagen es el identificador visual del evento. Se mostrará en la <strong>página de registro (Landing)</strong> y en la <strong>cabecera del panel de control (Dashboard)</strong> de los asistentes. <br />
          <strong>Dimensiones recomendadas:</strong> Formato horizontal, aprox. 800x400 píxeles.
        </Text>
        <Button onClick={createEvent}>Crear</Button>
      </Stack>
    </Modal>
  );
};

export default CreateEventModal;

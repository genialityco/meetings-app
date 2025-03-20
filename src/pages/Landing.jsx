import { useEffect, useState, useContext, useCallback } from "react";
import {
  TextInput,
  Button,
  Paper,
  Title,
  Stack,
  Loader,
  Divider,
  Image,
  Text,
  Select,
  FileInput,
  Flex,
} from "@mantine/core";
import { RichTextEditor, Link } from "@mantine/tiptap";
import { useEditor } from "@tiptap/react";
import Highlight from "@tiptap/extension-highlight";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";

import { useNavigate, useParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { UserContext } from "../context/UserContext";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../firebase/firebaseConfig";

// Función para subir la imagen a Firebase Storage
const uploadProfilePicture = async (file, uid) => {
  const storageRef = ref(storage, `profilePictures/${uid}/${file.name}`);
  await uploadBytes(storageRef, file);
  const photoURL = await getDownloadURL(storageRef);
  return photoURL;
};

const Landing = () => {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const { userLoading, loginByCedula, currentUser, updateUser } =
    useContext(UserContext);

  const [event, setEvent] = useState({});
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [formValues, setFormValues] = useState({
    nombre: "",
    cedula: "",
    empresa: "",
    cargo: "",
    descripcion: "",
    interesPrincipal: "",
    necesidad: "",
    contacto: { correo: "", telefono: "" },
    photo: null, // Campo para almacenar el archivo de foto
  });
  const [profilePicPreview, setProfilePicPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchCedula, setSearchCedula] = useState("");
  const [searchError, setSearchError] = useState("");
  const [showInfo, setShowInfo] = useState(false);

  // Configuración del editor Tiptap con Mantine
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link,
      Highlight,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: formValues.descripcion || "<p>Escribe aquí la descripción...</p>",
  });

  // Cargar datos del usuario (si ya existe)
  useEffect(() => {
    if (currentUser?.data) {
      setFormValues((prev) => ({
        ...prev,
        ...currentUser.data,
      }));
      if (currentUser.data.photoURL) {
        setProfilePicPreview(currentUser.data.photoURL);
      }
    }
  }, [currentUser]);

  // Cargar la configuración del evento (registros habilitados)
  useEffect(() => {
    if (eventId) {
      const unsubscribe = onSnapshot(
        doc(db, "events", eventId),
        (eventDoc) => {
          if (eventDoc.exists()) {
            const eventData = eventDoc.data();
            setEvent(eventData);
            setRegistrationEnabled(
              eventData.config?.registrationEnabled ?? true
            );
          }
        },
        (error) => {
          console.error("Error in real-time listener:", error);
        }
      );
      return () => unsubscribe();
    }
  }, [eventId]);

  // Manejar cambios en el formulario (incluyendo campos anidados)
  const handleChange = (field, value) => {
    if (field.startsWith("contacto.")) {
      const key = field.split(".")[1];
      setFormValues((prev) => ({
        ...prev,
        contacto: {
          ...prev.contacto,
          [key]: value,
        },
      }));
    } else {
      setFormValues((prev) => ({
        ...prev,
        [field]: value,
      }));
    }
  };

  // Buscar usuario por cédula
  const handleSearchByCedula = async () => {
    setLoading(true);
    setSearchError("");
    setShowInfo(false);

    const result = await loginByCedula(searchCedula);

    if (result?.success) {
      navigate(eventId ? `/dashboard/${eventId}` : "/dashboard");
    } else {
      setSearchError("No se encuentra registrada esta cédula");
      setShowInfo(true);
    }
    setLoading(false);
  };

  // Enviar formulario (registro o actualización)
  const handleSubmit = useCallback(async () => {
    setLoading(true);
    try {
      const uid = currentUser.uid;
      let dataToUpdate = { ...formValues, eventId };

      // Si hay un archivo de foto, se sube y se obtiene la URL
      if (formValues.photo) {
        const photoURL = await uploadProfilePicture(formValues.photo, uid);
        dataToUpdate.photoURL = photoURL;
        delete dataToUpdate.photo; // No enviar el objeto File a Firestore
      }

      await updateUser(uid, dataToUpdate);
      navigate(eventId ? `/dashboard/${eventId}` : "/dashboard");
    } catch (error) {
      console.error("Error en el registro:", error);
    }
    setLoading(false);
  }, [currentUser, formValues, navigate, updateUser, eventId]);

  const handleGoToDashboard = () => {
    navigate("/dashboard");
  };

  if (userLoading) return <Loader />;

  return (
    <Paper shadow="md" p="xl" style={{ maxWidth: 500, margin: "40px auto" }}>
      <Flex justify="center">
        <a
          href="https://geniality.com.co/"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img src={event.eventImage} width={150} alt="Networking Event" />
        </a>
      </Flex>
      <Title order={2} align="center" mb="md">
        {event.eventName}
      </Title>

      <Text ta="justify" mb="lg">
        Si ya se ha registrado, puede ingresar con su número de cédula.
      </Text>

      {/* Sección de búsqueda de usuario */}
      <Stack>
        <TextInput
          label="Ingrese su cédula"
          placeholder="Número de cédula"
          value={searchCedula}
          onChange={(e) => setSearchCedula(e.target.value)}
        />
        {searchError && <Text color="red">{searchError}</Text>}
        <Button onClick={handleSearchByCedula} loading={loading}>
          Ingresar
        </Button>
      </Stack>
      <Divider my="md" />

      {registrationEnabled ? (
        <Stack>
          <TextInput
            label="Nombre"
            placeholder="Tu nombre completo"
            value={formValues.nombre}
            onChange={(e) => handleChange("nombre", e.target.value)}
            required
          />
          <TextInput
            label="Cédula"
            placeholder="Tu número de identificación"
            value={formValues.cedula}
            onChange={(e) => handleChange("cedula", e.target.value)}
            required
          />
          <TextInput
            label="Empresa"
            placeholder="Nombre de la empresa"
            value={formValues.empresa}
            onChange={(e) => handleChange("empresa", e.target.value)}
            required
          />
          <TextInput
            label="Cargo"
            placeholder="Tu cargo"
            value={formValues.cargo}
            onChange={(e) => handleChange("cargo", e.target.value)}
            required
          />
          <Title order={6}>Descripción breve del negocio</Title>
          {/* Editor Tiptap integrado */}
          <RichTextEditor editor={editor}>
            <RichTextEditor.Toolbar sticky stickyOffset={60}>
              <RichTextEditor.ControlsGroup>
                <RichTextEditor.Bold />
                <RichTextEditor.Italic />
                <RichTextEditor.Underline />
                <RichTextEditor.Strikethrough />
                <RichTextEditor.ClearFormatting />
                <RichTextEditor.Highlight />
                <RichTextEditor.Code />
              </RichTextEditor.ControlsGroup>
              <RichTextEditor.ControlsGroup>
                <RichTextEditor.H1 />
                <RichTextEditor.H2 />
                <RichTextEditor.H3 />
                <RichTextEditor.H4 />
              </RichTextEditor.ControlsGroup>
              <RichTextEditor.ControlsGroup>
                <RichTextEditor.Blockquote />
                <RichTextEditor.Hr />
                <RichTextEditor.BulletList />
                <RichTextEditor.OrderedList />
              </RichTextEditor.ControlsGroup>
              <RichTextEditor.ControlsGroup>
                <RichTextEditor.Link />
                <RichTextEditor.Unlink />
              </RichTextEditor.ControlsGroup>
              <RichTextEditor.ControlsGroup>
                <RichTextEditor.AlignLeft />
                <RichTextEditor.AlignCenter />
                <RichTextEditor.AlignJustify />
                <RichTextEditor.AlignRight />
              </RichTextEditor.ControlsGroup>
              <RichTextEditor.ControlsGroup>
                <RichTextEditor.Undo />
                <RichTextEditor.Redo />
              </RichTextEditor.ControlsGroup>
            </RichTextEditor.Toolbar>
            <RichTextEditor.Content />
          </RichTextEditor>
          <Select
            label="Interés principal"
            placeholder="Selecciona una opción"
            data={[
              { value: "proveedores", label: "Conocer proveedores" },
              { value: "clientes", label: "Conocer clientes" },
              { value: "abierto", label: "Abierto" },
            ]}
            value={formValues.interesPrincipal}
            onChange={(value) => handleChange("interesPrincipal", value)}
            required
          />
          <TextInput
            label="Necesidad específica para la rueda de negocios"
            placeholder="¿Qué necesitas?"
            value={formValues.necesidad}
            onChange={(e) => handleChange("necesidad", e.target.value)}
            required
          />
          <TextInput
            label="Correo (opcional)"
            placeholder="Tu correo electrónico"
            value={formValues.contacto.correo}
            onChange={(e) => handleChange("contacto.correo", e.target.value)}
          />
          <TextInput
            label="Teléfono (opcional)"
            placeholder="Tu número de teléfono"
            value={formValues.contacto.telefono}
            onChange={(e) => handleChange("contacto.telefono", e.target.value)}
          />
          {/* Campo para cargar o tomar la foto de perfil */}
          <FileInput
            label="Foto de perfil"
            placeholder="Selecciona o toma una foto"
            accept="image/png,image/jpeg"
            inputProps={{ capture: "user" }}
            value={formValues.photo}
            onChange={(file) => {
              handleChange("photo", file);
              if (file) {
                setProfilePicPreview(URL.createObjectURL(file));
              } else {
                setProfilePicPreview(null);
              }
            }}
          />
          {/* Vista previa de la foto */}
          {profilePicPreview && (
            <Image
              src={profilePicPreview}
              alt="Vista previa de la foto de perfil"
              height={150}
              fit="cover"
              radius="md"
              mt="sm"
            />
          )}
          <Button onClick={handleSubmit} loading={loading}>
            {currentUser?.data ? "Actualizar" : "Registrarse"}
          </Button>
          {currentUser?.data && (
            <Button onClick={handleGoToDashboard}>Ir a la dashboard</Button>
          )}
        </Stack>
      ) : (
        <Text align="center" color="gray" mt="md">
          Los nuevos registros están inhabilitados para este evento.
        </Text>
      )}

      {showInfo && (
        <>
          <Divider my="md" />
          <Text align="center" color="gray">
            Si no se encuentra registrada su cédula, significa que no asistió
            presencialmente al evento y no podrá acceder al directorio.
          </Text>
        </>
      )}
    </Paper>
  );
};

export default Landing;

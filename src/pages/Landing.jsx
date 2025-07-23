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
  Container,
  Checkbox,
  Box,
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
import { useMediaQuery } from "@mantine/hooks";

// Subir imagen a Firebase Storage
const uploadProfilePicture = async (file, uid) => {
  const storageRef = ref(storage, `profilePictures/${uid}/${file.name}`);
  await uploadBytes(storageRef, file);
  const photoURL = await getDownloadURL(storageRef);
  return photoURL;
};

const CONSENTIMIENTO_FIELD_NAME = "aceptaTratamiento";

const Landing = () => {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const { userLoading, loginByEmail, currentUser, updateUser } =
    useContext(UserContext);

  const [event, setEvent] = useState({});
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [formValues, setFormValues] = useState({});
  const [profilePicPreview, setProfilePicPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchCedula, setSearchCedula] = useState("");
  const [searchError, setSearchError] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  const [tratamientoError, setTratamientoError] = useState("");

  const isMobile = useMediaQuery("(max-width: 600px)");

  // Editor solo para descripcion/richtext
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link,
      Highlight,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: formValues.descripcion || "<p>Escribe aquí la descripción...</p>",
    onUpdate: ({ editor }) => {
      setFormValues((prev) => ({
        ...prev,
        descripcion: editor.getText(),
      }));
    },
  });

  // Cargar datos del usuario si ya existe
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

  // Cargar configuración del evento
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

  // Obtener valor de cualquier campo, soportando contacto.*
  function getValueForField(fieldName) {
    if (fieldName.startsWith("contacto.")) {
      return formValues.contacto?.[fieldName.split(".")[1]] || "";
    }
    return formValues[fieldName] ?? "";
  }

  // Actualizar formValues de cualquier campo (soporta contacto.*, file y checkboxes)
  function handleDynamicChange(field, value) {
    if (field.startsWith("contacto.")) {
      const key = field.split(".")[1];
      setFormValues((prev) => ({
        ...prev,
        contacto: { ...prev.contacto, [key]: value },
      }));
    } else {
      setFormValues((prev) => ({ ...prev, [field]: value }));
    }
  }

  // Buscar usuario por cédula
  const handleSearchByCedula = async () => {
    setLoading(true);
    setSearchError("");
    setShowInfo(false);

    const result = await loginByEmail(searchCedula, eventId);

    if (result?.success) {
      navigate(`/dashboard/${eventId}`);
    } else {
      setSearchError("No se encuentra registrada esta cédula para este evento");
      setShowInfo(true);
    }
    setLoading(false);
  };

  // Submit registro/actualización
  const handleSubmit = useCallback(async () => {
    setTratamientoError("");
    if (!formValues[CONSENTIMIENTO_FIELD_NAME]) {
      setTratamientoError(
        "Debes aceptar el tratamiento de datos para continuar."
      );
      return;
    }
    setLoading(true);
    try {
      const uid = currentUser.uid;
      let dataToUpdate = { ...formValues, eventId };

      // Manejar upload foto (si el campo existe)
      if (formValues.photo) {
        const photoURL = await uploadProfilePicture(formValues.photo, uid);
        dataToUpdate.photoURL = photoURL;
        delete dataToUpdate.photo; // No enviar objeto File a Firestore
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

  // Si el usuario aún está cargando, muestra un Loader
  if (userLoading) return <Loader />;

  // Si no existe eventId, mostramos mensaje
  if (!eventId) {
    return (
      <Container>
        <Paper
          shadow="md"
          p="xl"
          style={{ maxWidth: 500, margin: "40px auto" }}
        >
          <Text align="center">
            Esta es una plataforma de networking desarrollada por Geniality SAS.
            <br />
            Visítanos:{" "}
            <a
              href="https://geniality.com.co/"
              target="_blank"
              rel="noopener noreferrer"
            >
              https://geniality.com.co
            </a>
          </Text>
        </Paper>
      </Container>
    );
  }

  // Render dinámico de los campos configurados en Firestore
  function renderDynamicFormFields() {
    if (!Array.isArray(event?.config?.formFields)) return null;

    return event.config.formFields.map((field) => {
      // Foto de perfil (file input)
      if (field.name === "photo") {
        return (
          <FileInput
            key={field.name}
            label={field.label || "Foto de perfil"}
            placeholder="Selecciona o toma una foto"
            accept="image/png,image/jpeg"
            inputProps={{ capture: "user" }}
            value={formValues.photo}
            onChange={(file) => {
              handleDynamicChange("photo", file);
              if (file) {
                setProfilePicPreview(URL.createObjectURL(file));
              } else {
                setProfilePicPreview(null);
              }
            }}
          />
        );
      }

      // RichText (solo descripcion, adaptarlo para más si usas otros richtext)
      if (field.type === "richtext") {
        return (
          <div key={field.name}>
            <Title order={6}>{field.label}</Title>
            <RichTextEditor editor={editor}>
              <RichTextEditor.Content />
            </RichTextEditor>
          </div>
        );
      }

      // Select (incluye soporte para options dinámicas)
      if (field.type === "select") {
        return (
          <Select
            key={field.name}
            label={field.label}
            placeholder="Selecciona una opción"
            data={field.options || []}
            value={getValueForField(field.name)}
            onChange={(value) => handleDynamicChange(field.name, value)}
            required={field.required}
            mb="sm"
          />
        );
      }

      // Checkbox personalizado (no consentimiento)
      if (
        field.type === "checkbox" &&
        field.name !== CONSENTIMIENTO_FIELD_NAME
      ) {
        return (
          <Checkbox
            key={field.name}
            label={field.label}
            checked={!!getValueForField(field.name)}
            onChange={(e) =>
              handleDynamicChange(field.name, e.currentTarget.checked)
            }
            required={field.required}
            mb="sm"
          />
        );
      }

      // Campos de contacto anidados (correo/teléfono)
      if (
        field.name === "contacto.correo" ||
        field.name === "contacto.telefono"
      ) {
        return (
          <TextInput
            key={field.name}
            label={field.label}
            placeholder={field.label}
            value={getValueForField(field.name)}
            onChange={(e) => handleDynamicChange(field.name, e.target.value)}
            required={field.required}
          />
        );
      }

      // TextInput por defecto para otros campos
      return (
        <TextInput
          key={field.name}
          label={field.label}
          placeholder={field.label}
          value={getValueForField(field.name)}
          onChange={(e) => handleDynamicChange(field.name, e.target.value)}
          required={field.required}
        />
      );
    });
  }

  return (
    <Box
      style={{
        minHeight: "100vh",
        width: "100vw",
        backgroundImage:
          event.backgroundImage && event.backgroundImage.startsWith("http")
            ? `url('${event.backgroundImage}')`
            : `url('/FONDO-DESKTOP.png')`,
        backgroundPosition: "center center",
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
        padding: 0,
        margin: 0,
      }}
    >
      <Container
        fluid
        style={{ padding: 0, minHeight: "100vh", background: "transparent" }}
      >
        <Paper
          shadow="xl"
          withBorder
          radius="lg"
          p="xl"
          style={{
            maxWidth: isMobile ? 300 : 500,
            margin: "40px auto",
          }}
        >
          <Paper shadow="xl" withBorder radius="lg">
            <Flex justify="center">
              {/* <a
                href="https://geniality.com.co/"
                target="_blank"
                rel="noopener noreferrer"
              > */}
                <Image src={event.eventImage} alt="Networking Event" />
              {/* </a> */}
            </Flex>
          </Paper>
          <Title order={2} align="center" my="md">
            {event.eventName}
          </Title>

          <Text ta="justify" mb="lg">
            <strong>Plataforma de Networking y Reuniones de Negocio</strong>{" "}
            Conecta con otras empresas y permite que te encuentren para agendar
            reuniones durante el evento
          </Text>

          <Text ta="justify" mb="lg">
            Si ya se ha registrado, puede ingresar con su correo.
          </Text>

          {/* Sección de búsqueda de usuario */}
          <Stack>
            <TextInput
              label="Ingrese con su correo"
              placeholder="Correo electronico"
              value={searchCedula}
              onChange={(e) => setSearchCedula(e.target.value)}
            />
            {searchError && <Text c="red">{searchError}</Text>}
            <Button
              onClick={handleSearchByCedula}
              loading={loading}
              color="#00b481"
            >
              <Text
                c="black"
                fw={700}
                fz={isMobile ? "md" : "lg"}
                tt="uppercase"
              >
                Ingresar
              </Text>
            </Button>
          </Stack>
          <Divider my="md" />

          {registrationEnabled ? (
            <Stack>
              <Text ta="justify" my="lg" size="lg">
                Para un registro nuevo diligencia el formulario.
              </Text>

              {/* --- FORMULARIO DINÁMICO --- */}
              {renderDynamicFormFields()}

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

              {/* Consentimiento al final */}
              <Checkbox
                label={
                  event.config?.tratamientoDatosText ||
                  "Al utilizar este aplicativo, autorizo a GEN.IALITY SAS identificada con NIT 901555490, ..."
                }
                checked={!!formValues[CONSENTIMIENTO_FIELD_NAME]}
                onChange={(e) =>
                  handleDynamicChange(
                    CONSENTIMIENTO_FIELD_NAME,
                    e.currentTarget.checked
                  )
                }
                required
                mt="md"
              />
              {tratamientoError && <Text color="red">{tratamientoError}</Text>}

              <Button onClick={handleSubmit} loading={loading}>
                {currentUser?.data ? "Actualizar" : "Registrarse"}
              </Button>
              {currentUser?.data && (
                <Button onClick={handleGoToDashboard}>
                  Ir a la dashboard
                </Button>
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
                Si no se encuentra registrada su cédula, significa que no
                asistió presencialmente al evento y no podrá acceder al
                directorio.
              </Text>
            </>
          )}
        </Paper>
      </Container>
    </Box>
  );
};

export default Landing;

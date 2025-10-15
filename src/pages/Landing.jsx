/* eslint-disable react/prop-types */
import { useEffect, useState, useContext, useCallback, useMemo } from "react";
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
  Group,
  Avatar,
  Alert,
  Tabs,
  Badge,
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
import Placeholder from "@tiptap/extension-placeholder";
import { collection, query, where, getDocs } from "firebase/firestore";

const CONSENTIMIENTO_FIELD_NAME = "aceptaTratamiento";

// ---- helpers ----
const uploadProfilePicture = async (file, uid) => {
  const storageRef = ref(storage, `profilePictures/${uid}/${file.name}`);
  await uploadBytes(storageRef, file);
  const photoURL = await getDownloadURL(storageRef);
  return photoURL;
};

const isValidEmail = (v = "") =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());

const formatDateCO = (value) => {
  if (!value) return null;
  const d =
    typeof value?.toDate === "function"
      ? value.toDate()
      : value instanceof Date
        ? value
        : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("es-CO", { timeZone: "America/Bogota" });
};

// Función para eliminar tags HTML
const stripHtmlTags = (html) => {
  if (!html) return "";
  const tmp = document.createElement("DIV");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
};

function formatTime(timeString) {
  if (!timeString) return "";

  // Se espera formato "HH:mm" (por ejemplo "14:30")
  const [hourStr, minuteStr] = timeString.split(":");
  let hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);

  const suffix = hour >= 12 ? "p. m." : "a. m.";
  hour = hour % 12 || 12; // convierte 0 → 12 y 13→1, 14→2, etc.

  return `${hour}:${minute.toString().padStart(2, "0")} ${suffix}`;
}
function formatDate(dateString) {
  if (!dateString) return "";

  const [year, month, day] = dateString.split("-").map(Number);

  // Nombres de los meses en español
  const months = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
  ];

  return `${day} de ${months[month - 1]} de ${year}`;
}

const InfoLine = ({ label, value }) => (
  <Group wrap="nowrap" gap="xs">
    <Text fw={500}>{label}:</Text>
    <Text c="dimmed" lineClamp={1} style={{ minWidth: 0 }}>
      {value || "—"}
    </Text>
  </Group>
);
const validateField = (field, value) => {
  const { validation = {}, required = true } = field;

  if (required && (!value || value.trim() === "")) {
    return validation?.errorMessage || `El campo ${field.label} es obligatorio`;
  }

  if (validation?.minLength && value?.length < validation.minLength) {
    return validation.errorMessage || `Debe tener al menos ${validation.minLength} caracteres`;
  }

  if (validation?.maxLength && value?.length > validation.maxLength) {
    return validation.errorMessage || `No puede exceder ${validation.maxLength} caracteres`;
  }

  if (validation?.pattern) {
    try {
      // 🔧 Elimina las barras iniciales y finales si existen
      let patternString = validation.pattern.trim();
      if (patternString.startsWith("/") && patternString.endsWith("/")) {
        patternString = patternString.slice(1, -1);
      }

      const regex = new RegExp(patternString);

      if (!regex.test(value)) {
        return validation.errorMessage || `El formato no es válido`;
      }
    } catch (err) {
      console.warn(`Regex inválido: ${validation.pattern}`, err);
    }
  }

  return null;
};

// --------- Componente principal ----------
const Landing = () => {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const { userLoading, loginByEmail, currentUser, updateUser, logout } =
    useContext(UserContext);

  const [event, setEvent] = useState({});
  const [registrationEnabled, setRegistrationEnabled] = useState(true);

  // UI state
  const [activeTab, setActiveTab] = useState("login"); // 'login' | 'register'
  const isMobile = useMediaQuery("(max-width: 600px)");

  // Login state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [showProfileSummary, setShowProfileSummary] = useState(true);

  // Form state (se comparte entre registro y edición)
  const [formValues, setFormValues] = useState({});
  const [profilePicPreview, setProfilePicPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tratamientoError, setTratamientoError] = useState("");
  const [formErrors, setFormErrors] = useState({});
  // Editor tiptap (solo si hay richtext en form)
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link,
      Highlight,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({
        placeholder: "Describe tu empresa, productos o servicios...",
      }),
    ],
    content: "",
    onUpdate: ({ editor }) => {
      const htmlContent = editor.getHTML();
      const plainText = stripHtmlTags(htmlContent);
      setFormValues((prev) => ({
        ...prev,
        descripcion: plainText,
      }));
    },
  });

   // helpers de campos dinámicos
  const getValueForField = useCallback(
    (fieldName) => {
      if (fieldName.startsWith("contacto.")) {
        return formValues.contacto?.[fieldName.split(".")[1]] || "";
      }
      return formValues[fieldName] ?? "";
    },
    [formValues]
  );
  const validateForm = useCallback(() => {
    const errors = {};
    event?.config?.formFields?.forEach((field) => {
      const value = getValueForField(field.name);
      const error = validateField(field, value);
      if (error) {
        errors[field.name] = error;
      }
    });

    // Special case for consentimiento
    if (!formValues[CONSENTIMIENTO_FIELD_NAME]) {
      errors[CONSENTIMIENTO_FIELD_NAME] = "Debes aceptar el tratamiento de datos para continuar.";
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0; // Return true if no errors
  }, [event?.config?.formFields, formValues, getValueForField]);

  // Actualizar el editor cuando formValues.descripcion cambia
  useEffect(() => {
    if (editor && formValues.descripcion) {
      const currentText = stripHtmlTags(editor.getHTML());
      if (currentText !== formValues.descripcion) {
        editor.commands.setContent(formValues.descripcion, false);
      }
    }
  }, [editor, formValues.descripcion]);

  // Cargar configuración del evento
  useEffect(() => {
    console.log("event", event)
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

  useEffect(() => {
    if (currentUser?.data) {
      if (currentUser.data.eventId !== eventId) {
        logout();
        setShowProfileSummary(false);
        setFormValues({});
        setProfilePicPreview(null);
        setActiveTab("login");
        if (editor) {
          editor.commands.setContent("");
        }
      }
    }
    setShowProfileSummary(currentUser?.data);
  }, [currentUser, eventId, logout]);


  // Prefill cuando el contexto ya tiene user.data (p.ej., al volver de login)
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

 

  const handleDynamicChange = useCallback((field, value) => {
    if (field.startsWith("contacto.")) {
      const key = field.split(".")[1];
      setFormValues((prev) => ({
        ...prev,
        contacto: { ...prev.contacto, [key]: value },
      }));
    } else {
      setFormValues((prev) => ({ ...prev, [field]: value }));
    }
  }, []);

  // Login por correo — si existe, muestro resumen y opción de actualizar o entrar
  const handleLogin = useCallback(async () => {
    setLoginError("");
    if (!isValidEmail(loginEmail)) {
      setLoginError("Por favor ingresa un correo válido.");
      return;
    }
    setLoginLoading(true);
    try {
      const result = await loginByEmail(loginEmail.trim(), eventId);
      if (result?.success) {
        // Asumimos que currentUser se pobla; muestro el resumen.
        setShowProfileSummary(true);
        // Prellenar formulario con datos actuales (por si decide actualizar)
        if (result?.user?.data) {
          setFormValues((prev) => ({ ...prev, ...result.user.data }));
          if (result.user.data.photoURL) {
            setProfilePicPreview(result.user.data.photoURL);
          }
        }
      } else {
        setLoginError(
          "No se encontró un participante con este correo para este evento."
        );
        setShowProfileSummary(false);
      }
    } catch (e) {
      console.error(e);
      setLoginError("Ocurrió un error al intentar ingresar.");
      setShowProfileSummary(false);
    } finally {
      setLoginLoading(false);
    }
  }, [loginByEmail, loginEmail, eventId]);

  // Guardar (tanto registro nuevo como actualización)
 const handleSubmit = useCallback(async () => {
  setTratamientoError("");
  if (!validateForm()) {
    return; // Detiene si la validación falla
  }

  setSaving(true);
  try {
    const uid = currentUser?.uid;
    let dataToUpdate = {
      ...formValues,
      correo: formValues["correo"].toLowerCase().trim(),
      eventId,
      updatedAt: new Date().toISOString(),
    };
    
    // Normalizar el campo de correo
    if (!dataToUpdate.email && dataToUpdate?.contacto?.correo) {
      dataToUpdate.email = dataToUpdate.contacto.correo;
    }
    
    console.log("Form values to save:", dataToUpdate);
    // ⚠️ Verificar si el correo ya existe (y no pertenece al mismo usuario)
    if (dataToUpdate.correo) {
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("correo", "==", dataToUpdate.correo));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const existingUser = querySnapshot.docs[0];
        const existingData = existingUser.data();

        // ⚠️ Si el correo existe y el eventId es el mismo (y no es el mismo usuario)
        if (existingUser.id !== uid && existingData.eventId === eventId) {
          alert("⚠️ Este correo ya está registrado para este evento.");
          setSaving(false);
          return;
    }
  }
    }

    // Si el usuario no tiene fecha de creación, se agrega
    if (!currentUser?.data?.createdAt) {
      dataToUpdate.createdAt = new Date().toISOString();
    }

    // Si se cargó una foto, se sube primero
    if (formValues.photo) {
      const photoURL = await uploadProfilePicture(formValues.photo, uid);
      dataToUpdate.photoURL = photoURL;
      delete dataToUpdate.photo;
    }

    // Guardar/actualizar el usuario
    await updateUser(uid, dataToUpdate);
    navigate(eventId ? `/dashboard/${eventId}` : "/dashboard");

  } catch (error) {
    console.error("Error en el guardado:", error);
  } finally {
    setSaving(false);
  }
}, [currentUser, formValues, navigate, updateUser, eventId, validateForm]);

  const handleGoToDashboard = useCallback(() => {
    navigate(eventId ? `/dashboard/${eventId}` : "/dashboard");
  }, [navigate, eventId]);

  // Render de campos dinámicos (reutilizable para registrar/editar)
  const renderDynamicFormFields = useCallback(() => {
    if (!Array.isArray(event?.config?.formFields)) return null;

    return event.config.formFields.map((field) => {
      const fieldError = formErrors[field.name];

      // Photo field
      if (field.name === "photo") {
        return (
          <FileInput
            key={field.name}
            label={field.label || "Foto de perfil"}
            placeholder="Selecciona o toma una foto"
            accept="image/png,image/jpeg"
            inputProps={{ capture: "user" }}
            value={formValues.photo || null}
            onChange={(file) => {
              handleDynamicChange("photo", file);
              if (file) {
                setProfilePicPreview(URL.createObjectURL(file));
              } else {
                setProfilePicPreview(null);
              }
              setFormErrors((prev) => ({ ...prev, [field.name]: null }));
            }}
            error={fieldError}
            required={field.required}
          />
        );
      }

      // RichText field
      if (field.type === "richtext") {
        return (
          <div key={field.name}>
            <Title order={6}>{field.label}</Title>
            <RichTextEditor editor={editor}>
              <RichTextEditor.Content />
            </RichTextEditor>
            {fieldError && (
              <Text c="red" size="sm" mt="xs">
                {fieldError}
              </Text>
            )}
          </div>
        );
      }

      // Select field
      if (field.type === "select") {
        return (
          <Select
            key={field.name}
            label={field.label}
            placeholder="Selecciona una opción"
            data={field.options || []}
            value={getValueForField(field.name)}
            onChange={(value) => {
              handleDynamicChange(field.name, value);
              const error = validateField(field, value);
              setFormErrors((prev) => ({ ...prev, [field.name]: error }));
            }}
            required={field.required}
            mb="sm"
            searchable
            error={fieldError}
          />
        );
      }

      // Checkbox (except consentimiento)
      if (
        field.type === "checkbox" &&
        field.name !== CONSENTIMIENTO_FIELD_NAME
      ) {
        return (
          <Checkbox
            key={field.name}
            label={field.label}
            checked={!!getValueForField(field.name)}
            onChange={(e) => {
              handleDynamicChange(field.name, e.currentTarget.checked);
              const error = validateField(field, e.currentTarget.checked ? "checked" : "");
              setFormErrors((prev) => ({ ...prev, [field.name]: error }));
            }}
            required={field.required}
            mb="sm"
            error={fieldError}
          />
        );
      }

      // TextInput for contacto fields or default text
      return (
        <TextInput
          key={field.name}
          label={field.label}
          placeholder={field.label}
          value={getValueForField(field.name)}
          onChange={(e) => {
            handleDynamicChange(field.name, e.target.value);
            const error = validateField(field, e.target.value);
            setFormErrors((prev) => ({ ...prev, [field.name]: error }));
          }}
          required={field.required}
          error={fieldError}
        />
      );
    });
  }, [
    event?.config?.formFields,
    formValues,
    formErrors,
    getValueForField,
    handleDynamicChange,
    editor,
  ]);

  // Vista resumen de perfil tras login
  const ProfileSummary = useMemo(() => {
    if (!showProfileSummary) return null;

    const data = currentUser?.data || formValues || {};
    const avatarSrc = data?.photoURL || profilePicPreview || null;

    return (
      <Paper withBorder shadow="sm" radius="md" p="md">
        <Group align="flex-start" wrap="nowrap">
          <Avatar src={avatarSrc} size={64} radius="xl">
            {String(data?.name || data?.nombres || "U")
              .slice(0, 1)
              .toUpperCase()}
          </Avatar>
          <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
            <Group justify="space-between" wrap="nowrap">
              <Title order={5} lineClamp={1}>
                {data?.name || data?.nombres || "Participante"}
              </Title>
              <Badge variant="light">Registrado</Badge>
            </Group>
            <InfoLine label="Empresa" value={data?.empresa || data?.company} />
            <InfoLine
              label="Teléfono"
              value={data?.telefono || data?.contacto?.telefono}
            />
            {data?.createdAt && (
              <Text size="xs" c="dimmed">
                Registrado: {formatDateCO(data.createdAt)}
              </Text>
            )}
          </Stack>
        </Group>

        <Group mt="md" grow={isMobile}>
          {/* <Button
            variant="default"
            onClick={() => setShowProfileSummary(false)}
          >
            Actualizar mis datos
          </Button> */}
          <Button onClick={handleGoToDashboard}>Entrar al directorio</Button>
        </Group>
      </Paper>
    );
  }, [
    showProfileSummary,
    currentUser,
    formValues,
    profilePicPreview,
    isMobile,
    handleGoToDashboard,
  ]);

  // Si el usuario aún está cargando, loader
  if (userLoading) return <Loader />;

  // Sin eventId -> landing básica
  if (!eventId) {
    return (
      <Container>
        <Paper
          shadow="md"
          p="xl"
          style={{ maxWidth: 520, margin: "40px auto" }}
        >
          <Text ta="center">
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

  return (
    <Box
      style={{
        minHeight: "100vh",
        width: "100vw",
        backgroundImage:
          event.backgroundImage && event.backgroundImage.startsWith("http")
            ? !isMobile ? `url('${event.backgroundImage}')` : `url('${event.backgroundMobileImage}')`
            : `url('/FONDO-DESKTOP.png')`,
        backgroundPosition: "center center",
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
      }}
    >
      <Container fluid style={{ padding: 0, minHeight: "100vh" }}>
        <Paper
          shadow="xl"
          withBorder
          radius="lg"
          p={isMobile ? "lg" : "xl"}
          style={{
            maxWidth: isMobile ? "100%" : 720,
            margin: "40px auto",
            background: "rgba(255,255,255,0.95)",
            backdropFilter: "blur(6px)",
          }}
        >
          {/* Header visual del evento */}
          <Flex justify="center" align="center" w={"100%"}>
            <Image
              src={event.eventImage}
              alt="Networking Event"
              w={"100vh"}
              fit="contain"
              style={{ boxShadow: '10px 30px 40px rgba(0, 0, 0, 0.1)', borderRadius: 8, maxWidth: isMobile ? "100%" : "100%" }}
            />
          </Flex>

          <Title order={isMobile ? 4 : 3} ta="center" my="md">
            {event.eventName || "Evento de Networking"}
          </Title>
          <Group align="flex-start" justify="space-between">
            <div style={{ flex: 1 }}>
              <Text ta="justify">
                {event?.config?.eventDate && (
                  <>
                    <Text span fw={700}>Fecha del evento:</Text>{" "}
                    {formatDate(event?.config?.eventDate)}
                  </>
                )}
              </Text>

              <Text ta="justify">
                {event?.config?.eventStartTime && (
                  <>
                    <Text span fw={700}>Hora de inicio:</Text>{" "}
                    {formatTime(event?.config?.eventStartTime)}
                  </>
                )}
              </Text>

              <Text ta="justify">
                {event?.config?.eventEndTime && (
                  <>
                    <Text span fw={700}>Hora de finalización:</Text>{" "}
                    {formatTime(event?.config?.eventEndTime)}
                  </>
                )}
              </Text>

              <Text ta="justify">
                {event?.config?.eventLocation && (
                  <>
                    <Text span fw={700}>Lugar del evento:</Text>{" "}
                    {event.config.eventLocation}
                  </>
                )}
              </Text>
            </div>

            {event?.landingQR && (
              <Image
                src={event.landingQR}
                alt="Código QR del evento"
                w={120}
                fit="contain"
              />
            )}
          </Group>
          <Text ta="justify" mb="lg" mt="lg">
            <strong>Plataforma de Networking y Reuniones de Negocio.</strong>{" "}
            Conecta con otras empresas y permite que te encuentren para agendar
            reuniones durante el evento. Ingresa con el correo registrado de la
            empresa o regístrate si es tu primera vez.
          </Text>

          <Tabs
            value={activeTab}
            onChange={setActiveTab}
            variant="pills"
            radius="md"
            keepMounted={false}
          >
            <Tabs.List grow>
              <Tabs.Tab value="login">Ingresar</Tabs.Tab>
              <Tabs.Tab value="register" disabled={!registrationEnabled}>
                {currentUser?.data ? "Actualizar datos" : "Registrarse"}
              </Tabs.Tab>
            </Tabs.List>

            {/* --------- TAB INGRESAR --------- */}
            <Tabs.Panel value="login" pt="md">
              <Stack>
                <TextInput
                  label="Correo electrónico"
                  placeholder="tu@empresa.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  required
                />
                {loginError && (
                  <Alert color="red" variant="light">
                    {loginError}
                  </Alert>
                )}
                
                  <Group justify="flex-end">
                    <Button loading={loginLoading} onClick={handleLogin}>
                      Ingresar
                    </Button>
                  </Group>
                

                {showProfileSummary && ProfileSummary}

                {/* Si elige actualizar, muestro el formulario debajo */}
                {/* {!showProfileSummary && currentUser?.data && (
                  <Alert color="yellow" variant="light">
                    Ya tienes información guardada. Si deseas actualizarla, usa
                    la pestaña "Registrarse" (está habilitada como edición).
                  </Alert>
                )} */}
              </Stack>
            </Tabs.Panel>

            {/* --------- TAB REGISTRARSE / EDITAR --------- */}
            <Tabs.Panel value="register" pt="md">
              {!registrationEnabled && (
                <Text ta="center" c="gray" mt="md">
                  Los nuevos registros están inhabilitados para este evento.
                </Text>
              )}

              {registrationEnabled && (
                <Stack>
                  <Text ta="justify" my="sm" size="lg">
                    {currentUser?.data
                      ? "Actualiza tu información antes de continuar."
                      : "Completa el formulario para crear tu registro."}
                  </Text>

                  {/* Form dinámico */}
                  {renderDynamicFormFields()}

                  {/* Vista previa foto */}
                  {/* {profilePicPreview && (
                    <Image
                      src={profilePicPreview}
                      alt="Vista previa de la foto de perfil"
                      height={150}
                      fit="cover"
                      radius="md"
                      mt="sm"
                    />
                  )} */}

                  {/* Consentimiento */}
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
                  {tratamientoError && <Text c="red">{tratamientoError}</Text>}

                  <Group justify="space-between" grow={isMobile}>
                    {currentUser?.data && (
                      <Button variant="default" onClick={handleGoToDashboard}>
                        Entrar al directorio
                      </Button>
                    )}
                    <Button onClick={handleSubmit} loading={saving}>
                      {currentUser?.data ? "Guardar cambios" : "Registrarme"}
                    </Button>
                  </Group>
                </Stack>
              )}
            </Tabs.Panel>
          </Tabs>

          {/* Nota informativa opcional */}
          <Divider my="lg" />
          <Text ta="center" c="dimmed" fz="sm">
            ¿Problemas para ingresar? Verifica que tu correo esté registrado por
            la organización del evento.
          </Text>
        </Paper>
      </Container>
    </Box>
  );
};

export default Landing;
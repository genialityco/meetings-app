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

const InfoLine = ({ label, value }) => (
  <Group wrap="nowrap" gap="xs">
    <Text fw={500}>{label}:</Text>
    <Text c="dimmed" lineClamp={1} style={{ minWidth: 0 }}>
      {value || "—"}
    </Text>
  </Group>
);

// --------- Componente principal ----------
const Landing = () => {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const { userLoading, loginByEmail, currentUser, updateUser } =
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
  const [showProfileSummary, setShowProfileSummary] = useState(false);

  // Form state (se comparte entre registro y edición)
  const [formValues, setFormValues] = useState({});
  const [profilePicPreview, setProfilePicPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tratamientoError, setTratamientoError] = useState("");

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
    content: formValues.descripcion || "",
    onUpdate: ({ editor }) => {
      setFormValues((prev) => ({
        ...prev,
        descripcion: editor.getText(),
      }));
    },
  });

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
    if (!formValues[CONSENTIMIENTO_FIELD_NAME]) {
      setTratamientoError(
        "Debes aceptar el tratamiento de datos para continuar."
      );
      return;
    }
    if (!isValidEmail(formValues?.email || formValues?.correo || "")) {
      // intenta leer de "email" o "correo" según cómo hayas nombrado el campo
      // si usas campo dinámico “contacto.correo”, captura más abajo
    }

    setSaving(true);
    try {
      const uid = currentUser?.uid;
      let dataToUpdate = {
        ...formValues,
        eventId,
        updatedAt: new Date().toISOString(),
      };

      // Soporte para contacto.correo si lo usas como login
      if (!dataToUpdate.email && dataToUpdate?.contacto?.correo) {
        dataToUpdate.email = dataToUpdate.contacto.correo;
      }

      if (formValues.photo) {
        const photoURL = await uploadProfilePicture(formValues.photo, uid);
        dataToUpdate.photoURL = photoURL;
        delete dataToUpdate.photo; // no subir File a Firestore
      }

      await updateUser(uid, dataToUpdate);

      // Si viene desde login-tab, después de actualizar puede entrar al directorio
      // o lo llevamos directo:
      navigate(eventId ? `/dashboard/${eventId}` : "/dashboard");
    } catch (error) {
      console.error("Error en el guardado:", error);
    } finally {
      setSaving(false);
    }
  }, [currentUser, formValues, navigate, updateUser, eventId]);

  const handleGoToDashboard = useCallback(() => {
    navigate(eventId ? `/dashboard/${eventId}` : "/dashboard");
  }, [navigate, eventId]);

  // Render de campos dinámicos (reutilizable para registrar/editar)
  const renderDynamicFormFields = useCallback(() => {
    if (!Array.isArray(event?.config?.formFields)) return null;

    return event.config.formFields.map((field) => {
      // Foto perfil
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
            }}
          />
        );
      }

      // RichText
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

      // Select
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
            searchable
          />
        );
      }

      // Checkbox (excepto consentimiento)
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

      // Campos de contacto
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

      // TextInput por defecto
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
  }, [
    event?.config?.formFields,
    formValues,
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
          <Button
            variant="default"
            onClick={() => setShowProfileSummary(false)}
          >
            Actualizar mis datos
          </Button>
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
    <Container
      fluid
      p={0}
      style={{
        minHeight: "100vh",
        // Fondo en el Container
        backgroundImage: `url('${
          event.backgroundImage && event.backgroundImage.startsWith("http")
            ? event.backgroundImage
            : "/FONDO-DESKTOP.png"
        }')`,
        backgroundPosition: "center",
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",

        // Centrado del contenido
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Container fluid style={{ padding: 0, minHeight: "100vh" }}>
        <Paper
          shadow="xl"
          withBorder
          radius="lg"
          p={isMobile ? "lg" : "xl"}
          style={{
            maxWidth: isMobile ? 360 : 720,
            margin: "40px auto",
            background: "rgba(255,255,255,0.95)",
            backdropFilter: "blur(6px)",
          }}
        >
          {/* Header visual del evento */}
          <Flex justify="center" align="center" p="md">
            <Image
              src={event.eventImage}
              w={isMobile ? 350 : 700}
              alt="Networking Event"
              fit="contain"
              style={{boxShadow: '10px 30px 40px rgba(0, 0, 0, 0.1)', borderRadius: 8}}
            />
          </Flex>

        <Title order={isMobile ? 4 : 3} ta="center" my="md">
          {event.eventName || "Evento de Networking"}
        </Title>

        <Text ta="justify" mb="lg">
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
              Registrarse
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
              {!showProfileSummary && (
                <Group justify="flex-end">
                  <Button loading={loginLoading} onClick={handleLogin}>
                    Ingresar
                  </Button>
                </Group>
              )}

              {showProfileSummary && ProfileSummary}

              {!showProfileSummary && currentUser?.data && (
                <Alert color="yellow" variant="light">
                  Ya tienes información guardada. Si deseas actualizarla, usa la
                  pestaña “Registrarse” (está habilitada como edición).
                </Alert>
              )}
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

                {renderDynamicFormFields()}

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

        <Divider my="lg" />
        <Text ta="center" c="dimmed" fz="sm">
          ¿Problemas para ingresar? Verifica que tu correo esté registrado por
          la organización del evento.
        </Text>
      </Paper>
    </Container>
  );
};

export default Landing;

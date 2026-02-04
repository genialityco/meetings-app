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
  MultiSelect,
  Flex,
  Container,
  Checkbox,
  Box,
  Group,
  Avatar,
  Alert,
  Tabs,
  Badge,
  Stepper,
  MantineProvider,
  createTheme,
} from "@mantine/core";
import { generateColors } from "@mantine/colors-generator";
import { RichTextEditor, Link } from "@mantine/tiptap";
import { useEditor } from "@tiptap/react";
import Highlight from "@tiptap/extension-highlight";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { useNavigate, useParams } from "react-router-dom";
import {
  doc,
  onSnapshot,
  collection,
  query,
  where,
  getDocs,
  getDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { UserContext } from "../context/UserContext";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../firebase/firebaseConfig";
import { useMediaQuery } from "@mantine/hooks";
import Placeholder from "@tiptap/extension-placeholder";
import { uploadCompanyLogo } from "../utils/companyStorage";

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

const normalizeNit = (v = "") => String(v || "").replace(/\D/g, "");

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
  const [hourStr, minuteStr] = timeString.split(":");
  let hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  const suffix = hour >= 12 ? "p. m." : "a. m.";
  hour = hour % 12 || 12;
  return `${hour}:${minute.toString().padStart(2, "0")} ${suffix}`;
}

function formatDate(dateString) {
  if (!dateString) return "";
  const [year, month, day] = dateString.split("-").map(Number);
  const months = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
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

  // checkbox: value puede ser boolean
  if (required) {
    if (typeof value === "boolean") {
      if (!value)
        return (
          validation?.errorMessage || `El campo ${field.label} es obligatorio`
        );
    } else {
      if (!value || String(value).trim() === "") {
        return (
          validation?.errorMessage || `El campo ${field.label} es obligatorio`
        );
      }
    }
  }

  if (validation?.minLength && value?.length < validation.minLength) {
    return (
      validation.errorMessage ||
      `Debe tener al menos ${validation.minLength} caracteres`
    );
  }

  if (validation?.maxLength && value?.length > validation.maxLength) {
    return (
      validation.errorMessage ||
      `No puede exceder ${validation.maxLength} caracteres`
    );
  }

  if (validation?.pattern) {
    try {
      let patternString = String(validation.pattern).trim();
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

  // Form state
  const [formValues, setFormValues] = useState({});
  const [profilePicPreview, setProfilePicPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  // Stepper state
  const [activeStep, setActiveStep] = useState(0);
  const [companyLookupLoading, setCompanyLookupLoading] = useState(false);

  const [photoUploadStatus, setPhotoUploadStatus] = useState("idle");
  // "idle" | "ready" | "uploading" | "done" | "error"
  const [photoUploadError, setPhotoUploadError] = useState("");

  // Company logo state
  const [companyLogoFile, setCompanyLogoFile] = useState(null);
  const [companyLogoPreview, setCompanyLogoPreview] = useState(null);

  // Editor tiptap
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

  const getValueForField = useCallback(
    (fieldName) => {
      // tu código original usa startsWith("contacto") (sin punto),
      // pero el resto del componente usa "contacto." → dejamos soportados ambos
      if (fieldName.startsWith("contacto.")) {
        return formValues.contacto?.[fieldName.split(".")[1]] || "";
      }
      if (fieldName.startsWith("contacto")) {
        return formValues.contacto?.[fieldName.split(".")[1]] || "";
      }
      return formValues[fieldName] ?? "";
    },
    [formValues],
  );

  const fieldsByName = useMemo(() => {
    const map = new Map();
    (event?.config?.formFields || []).forEach((f) => map.set(f.name, f));
    return map;
  }, [event?.config?.formFields]);

  // Si estás usando stepper: config desde admin
  const registrationForm = event?.config?.registrationForm || null;
  const steps =
    registrationForm?.mode === "stepper" ? registrationForm.steps || [] : null;

  // Campos que pertenecen al paso de empresa → se guardan en el doc de empresa
  const companyStepFields = useMemo(() => {
    const allSteps = registrationForm?.steps || [];
    const companyStep = allSteps.find((s) =>
      (s.fields || []).includes("company_nit"),
    );
    if (companyStep) return companyStep.fields || [];
    // Fallback si no hay step con company_nit
    return ["company_nit", "company_razonSocial", "descripcion"];
  }, [registrationForm?.steps]);

  // Evalúa visibilidad condicional de un campo (showWhen)
  const isFieldVisible = useCallback(
    (field) => {
      if (!field?.showWhen) return true;
      const parentValue = getValueForField(field.showWhen.field);
      const allowed = field.showWhen.value || [];
      if (Array.isArray(parentValue)) {
        return parentValue.some((v) => allowed.includes(v));
      }
      return allowed.includes(parentValue);
    },
    [getValueForField],
  );

  const validateForm = useCallback(() => {
    const errors = {};
    (event?.config?.formFields || []).forEach((field) => {
      // No validar campos ocultos por condición
      if (!isFieldVisible(field)) return;

      let value = getValueForField(field.name);

      if (
        (field.name === "photoURL" || field.type === "photo") &&
        formValues._photoFile
      ) {
        value = "selected";
      }

      const error = validateField(field, value);

      if (error) errors[field.name] = error;
    });

    if (!formValues[CONSENTIMIENTO_FIELD_NAME]) {
      errors[CONSENTIMIENTO_FIELD_NAME] =
        "Debes aceptar el tratamiento de datos para continuar.";
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }, [event?.config?.formFields, formValues, getValueForField, isFieldVisible]);

  const validateStep = useCallback(
    (fieldNames = []) => {
      const errors = {};
      fieldNames.forEach((name) => {
        const def = fieldsByName.get(name);
        if (!def) return;
        // No validar campos ocultos por condición
        if (!isFieldVisible(def)) return;

        let value = getValueForField(def.name);

        // ✅ si el campo es foto, aceptar archivo seleccionado como "cumple"
        if (
          (def.name === "photoURL" || def.type === "photo") &&
          formValues._photoFile
        ) {
          value = "selected";
        }

        const err = validateField(def, value);

        if (err) errors[def.name] = err;
      });

      // si es el último paso, exigir consentimiento
      const isLast = steps && activeStep === steps.length - 1;
      if (isLast && !formValues[CONSENTIMIENTO_FIELD_NAME]) {
        errors[CONSENTIMIENTO_FIELD_NAME] =
          "Debes aceptar el tratamiento de datos para continuar.";
      }

      setFormErrors((prev) => ({ ...prev, ...errors }));
      return Object.keys(errors).length === 0;
    },
    [
      fieldsByName,
      getValueForField,
      isFieldVisible,
      steps,
      activeStep,
      formValues,
    ],
  );

  // Actualizar el editor cuando formValues.descripcion cambia
  useEffect(() => {
    if (editor && formValues.descripcion) {
      const currentText = stripHtmlTags(editor.getHTML());
      if (currentText !== formValues.descripcion) {
        editor.commands.setContent(formValues.descripcion, false);
      }
    }
  }, [editor, formValues.descripcion]);

  // Cargar evento
  useEffect(() => {
    if (!eventId) return;
    const unsubscribe = onSnapshot(
      doc(db, "events", eventId),
      (eventDoc) => {
        if (eventDoc.exists()) {
          const eventData = eventDoc.data();
          setEvent(eventData);
          setRegistrationEnabled(eventData.config?.registrationEnabled ?? true);
          setActiveStep(0);
        }
      },
      (error) => console.error("Error in real-time listener:", error),
    );
    return () => unsubscribe();
  }, [eventId]);

  useEffect(() => {
    if (currentUser?.data) {
      if (currentUser.data.eventId !== eventId) {
        logout();
        setFormValues({});
        setProfilePicPreview(null);
        setActiveTab("login");
        setActiveStep(0);
        if (editor) editor.commands.setContent("");
      } else {
        // Si hay sesión activa y está en el evento correcto, redirigir a dashboard
        navigate(eventId ? `/dashboard/${eventId}` : "/dashboard");
      }
    }
  }, [currentUser, eventId, logout, editor, navigate]);

  // Prefill
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

  useEffect(() => {
    if (currentUser?.data?.photoURL) {
      setProfilePicPreview(currentUser.data.photoURL);
      setPhotoUploadStatus("done");
    }
  }, [currentUser?.data?.photoURL]);

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

  // ✅ lookup empresa por NIT usando docId = nitNorm
  const lookupCompanyByNit = useCallback(async () => {
    if (!eventId) return;

    const nitNorm = normalizeNit(formValues.company_nit || "");
    if (!nitNorm) return;

    setCompanyLookupLoading(true);
    try {
      const companyRef = doc(db, "events", eventId, "companies", nitNorm);
      const snap = await getDoc(companyRef);

      if (snap.exists()) {
        const data = snap.data();
        setFormValues((prev) => {
          const updated = {
            ...prev,
            company_nit: nitNorm,
            companyId: companyRef.id,
          };
          // Autocompletar campos del paso empresa desde el doc
          companyStepFields.forEach((fieldName) => {
            if (fieldName === "company_nit") return;
            if (data[fieldName] !== undefined && data[fieldName] !== null) {
              updated[fieldName] = data[fieldName];
            }
          });
          // Compatibilidad: razonSocial se guarda como company_razonSocial en el form
          if (data.razonSocial && !updated.company_razonSocial) {
            updated.company_razonSocial = data.razonSocial;
          }
          return updated;
        });

        if (data.logoUrl) {
          setCompanyLogoPreview(data.logoUrl);
        }
      } else {
        setFormValues((prev) => ({
          ...prev,
          company_nit: nitNorm,
          companyId: null,
        }));
        setCompanyLogoPreview(null);
      }
    } catch (e) {
      console.error("lookupCompanyByNit error:", e);
    } finally {
      setCompanyLookupLoading(false);
    }
  }, [eventId, formValues.company_nit, companyStepFields]);

  // Login
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
        // Redirigir automáticamente a dashboard sin mostrar resumen
        navigate(eventId ? `/dashboard/${eventId}` : "/dashboard");
      } else {
        setLoginError(
          "No se encontró un participante con este correo para este evento.",
        );
      }
    } catch (e) {
      console.error(e);
      setLoginError("Ocurrió un error al intentar ingresar.");
    } finally {
      setLoginLoading(false);
    }
  }, [loginByEmail, loginEmail, eventId, navigate]);

  // Submit
  const handleSubmit = useCallback(async () => {
    if (!validateForm()) return;

    setPhotoUploadError("");
    if (!formValues._photoFile && formValues.photoURL)
      setPhotoUploadStatus("done");

    setSaving(true);
    try {
      const uid = currentUser?.uid;

      let dataToUpdate = {
        ...formValues,
        correo: String(formValues["correo"] || "").toLowerCase().trim(),
        eventId,
        updatedAt: new Date().toISOString(),
      };

      // Verificar duplicado correo por evento
      if (dataToUpdate.correo) {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("correo", "==", dataToUpdate.correo));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          const existingUser = querySnapshot.docs[0];
          const existingData = existingUser.data();
          if (existingUser.id !== uid && existingData.eventId === eventId) {
            alert("⚠️ Este correo ya está registrado para este evento.");
            setSaving(false);
            return;
          }
        }
      }

      if (!currentUser?.data?.createdAt) {
        dataToUpdate.createdAt = new Date().toISOString();
      }

      // Foto
      if (formValues._photoFile) {
        try {
          setPhotoUploadStatus("uploading");
          const photoURL = await uploadProfilePicture(
            formValues._photoFile,
            uid,
          );
          dataToUpdate.photoURL = photoURL;
          delete dataToUpdate._photoFile;
          setPhotoUploadStatus("done");
        } catch (e) {
          console.error("Error subiendo imagen:", e);
          setPhotoUploadStatus("error");
          setPhotoUploadError(
            "No se pudo subir la foto. Intenta de nuevo o continúa sin foto.",
          );
          delete dataToUpdate._photoFile;
        }
      }

      // ✅ Empresa: crear o enlazar — guarda todos los campos del paso empresa
      const nitNorm = normalizeNit(formValues.company_nit || "");
      const razon = String(formValues.company_razonSocial || "").trim();

      if (eventId && nitNorm) {
        const companyRef = doc(db, "events", eventId, "companies", nitNorm);
        const snap = await getDoc(companyRef);

        // Recopilar valores de los campos del paso empresa
        const companyFieldData = {};
        companyStepFields.forEach((fieldName) => {
          if (fieldName === "company_nit") return;
          const val = formValues[fieldName];
          if (val !== undefined && val !== null) {
            companyFieldData[fieldName] = val;
          }
        });
        // Compatibilidad: razonSocial como campo raíz del doc
        if (razon) companyFieldData.razonSocial = razon;

        if (!snap.exists()) {
          await setDoc(companyRef, {
            nitNorm,
            ...companyFieldData,
            logoUrl: null,
            fixedTable: null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(
            companyRef,
            { ...companyFieldData, updatedAt: serverTimestamp() },
            { merge: true },
          );
        }

        // Subir logo de empresa si se seleccionó uno
        if (companyLogoFile && eventId && nitNorm) {
          try {
            const logoUrl = await uploadCompanyLogo(
              eventId,
              nitNorm,
              companyLogoFile,
            );
            await setDoc(
              companyRef,
              { logoUrl, updatedAt: serverTimestamp() },
              { merge: true },
            );
          } catch (e) {
            console.error("Error subiendo logo de empresa:", e);
          }
        }

        dataToUpdate.companyId = nitNorm;
        dataToUpdate.company_nit = nitNorm;
        dataToUpdate.company_razonSocial = razon || null;

        // compatibilidad: tu directorio usa "empresa"
        if (razon) dataToUpdate.empresa = razon;
      }

      await updateUser(uid, dataToUpdate);
      navigate(eventId ? `/dashboard/${eventId}` : "/dashboard");
    } catch (error) {
      console.error("Error en el guardado:", error);
    } finally {
      setSaving(false);
    }
  }, [
    currentUser,
    formValues,
    navigate,
    updateUser,
    eventId,
    validateForm,
    companyStepFields,
    companyLogoFile,
  ]);

  // Render de campos (lista fija)
  const renderFieldsForNames = useCallback(
    (names = []) => {
      return names.map((name) => {
        const field = fieldsByName.get(name);
        if (!field) return null;

        // Campo oculto por condición showWhen
        if (!isFieldVisible(field)) return null;

        const fieldError = formErrors[field.name];

        // Photo
        if (field.name === "photoURL" || field.type === "photo") {
          return (
            <Box key={field.name}>
              <FileInput
                label={field.label || "Foto de perfil"}
                placeholder="Selecciona o toma una foto"
                accept="image/png,image/jpeg"
                inputProps={{ capture: "user" }}
                value={null}
                onChange={(file) => {
                  setPhotoUploadError("");
                  handleDynamicChange("_photoFile", file);

                  if (file) {
                    setProfilePicPreview(URL.createObjectURL(file));
                    setPhotoUploadStatus("ready");
                  } else {
                    setProfilePicPreview(null);
                    setPhotoUploadStatus("idle");
                  }

                  setFormErrors((prev) => ({ ...prev, [field.name]: null }));
                }}
                error={fieldError}
                radius="md"
              />

              {profilePicPreview ? (
                <img
                  src={profilePicPreview}
                  alt="Vista previa"
                  width={120}
                  height={120}
                  style={{ borderRadius: "10px", marginTop: "10px" }}
                />
              ) : null}

              <Group justify="space-between" mt={6}>
                <Text size="xs" c="dimmed">
                  {photoUploadStatus === "idle" &&
                    "Opcional. Puedes tomarla con la cámara o elegir de galería."}
                  {photoUploadStatus === "ready" && "Imagen lista para subir."}
                  {photoUploadStatus === "uploading" && "Subiendo imagen..."}
                  {photoUploadStatus === "done" &&
                    "Imagen cargada correctamente ✅"}
                  {photoUploadStatus === "error" &&
                    "No se pudo subir la imagen ❌"}
                </Text>

                {photoUploadStatus === "uploading" ? <Loader size="xs" /> : null}
              </Group>

              {photoUploadError ? (
                <Alert color="red" variant="light" mt="xs" radius="md">
                  {photoUploadError}
                </Alert>
              ) : null}
            </Box>
          );
        }

        // Richtext
        if (field.type === "richtext") {
          return (
            <Box key={field.name}>
              <Title order={6}>{field.label}</Title>
              <RichTextEditor editor={editor}>
                <RichTextEditor.Content />
              </RichTextEditor>
              {fieldError && (
                <Text c="red" size="sm" mt="xs">
                  {fieldError}
                </Text>
              )}
            </Box>
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
              onChange={(value) => {
                handleDynamicChange(field.name, value);
                const error = validateField(field, value);
                setFormErrors((prev) => ({ ...prev, [field.name]: error }));
              }}
              required={field.required}
              searchable
              error={fieldError}
              radius="md"
            />
          );
        }

        // MultiSelect (con opción "Otro, ¿Cuál?" si includeOtro)
        if (field.type === "multiselect") {
          const baseOptions = field.options || [];
          const msOptions = field.includeOtro
            ? [...baseOptions, { value: "__otro__", label: "Otro, ¿Cuál?" }]
            : baseOptions;
          const msValue = getValueForField(field.name) || [];
          const hasOtro =
            field.includeOtro &&
            Array.isArray(msValue) &&
            msValue.includes("__otro__");

          return (
            <Box key={field.name}>
              <MultiSelect
                label={field.label}
                placeholder="Selecciona una o más opciones"
                data={msOptions}
                value={msValue}
                onChange={(value) => {
                  handleDynamicChange(field.name, value);
                  const error = validateField(
                    field,
                    value?.length ? value : "",
                  );
                  setFormErrors((prev) => ({ ...prev, [field.name]: error }));
                  if (!value.includes("__otro__")) {
                    handleDynamicChange(field.name + "_otro", "");
                  }
                }}
                required={field.required}
                searchable
                clearable
                error={fieldError}
                radius="md"
              />
              {hasOtro && (
                <TextInput
                  label="Especifica cuál"
                  placeholder="Escribe tu respuesta"
                  value={getValueForField(field.name + "_otro") || ""}
                  onChange={(e) => {
                    handleDynamicChange(
                      field.name + "_otro",
                      e.currentTarget.value,
                    );
                  }}
                  required
                  radius="md"
                />
              )}
            </Box>
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
                const error = validateField(field, e.currentTarget.checked);
                setFormErrors((prev) => ({ ...prev, [field.name]: error }));
              }}
              required={field.required}
              error={fieldError}
            />
          );
        }

        // Special: company_nit (normaliza y lookup)
        if (field.name === "company_nit") {
          return (
            <TextInput
              key={field.name}
              label={field.label}
              placeholder="Solo números"
              value={getValueForField(field.name)}
              onChange={(e) => {
                const onlyDigits = normalizeNit(e.target.value);
                handleDynamicChange(field.name, onlyDigits);
                const error = validateField(field, onlyDigits);
                setFormErrors((prev) => ({ ...prev, [field.name]: error }));
              }}
              onBlur={lookupCompanyByNit}
              rightSection={companyLookupLoading ? <Loader size="xs" /> : null}
              required={field.required}
              error={fieldError}
              radius="md"
            />
          );
        }

        // Special: company_logo — file upload for company logo
        if (field.name === "company_logo" || field.type === "file") {
          return (
            <Box key={field.name}>
              <FileInput
                label={field.label || "Logo de empresa (opcional)"}
                placeholder="Subir logo"
                accept="image/png,image/jpeg,image/webp"
                value={companyLogoFile}
                onChange={(file) => {
                  setCompanyLogoFile(file);
                  setCompanyLogoPreview(file ? URL.createObjectURL(file) : null);
                }}
                radius="md"
              />

              {companyLogoPreview && (
                <img
                  src={companyLogoPreview}
                  alt="Logo preview"
                  style={{
                    width: 110,
                    height: 110,
                    objectFit: "contain",
                    borderRadius: 12,
                    marginTop: 8,
                    border: "1px solid rgba(0,0,0,0.08)",
                    background: "rgba(255,255,255,0.8)",
                    padding: 8,
                  }}
                />
              )}
            </Box>
          );
        }

        // Default text
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
            radius="md"
          />
        );
      });
    },
    [
      fieldsByName,
      formErrors,
      getValueForField,
      handleDynamicChange,
      editor,
      lookupCompanyByNit,
      companyLookupLoading,
      companyLogoFile,
      companyLogoPreview,
      isFieldVisible,
      profilePicPreview,
      photoUploadStatus,
      photoUploadError,
    ],
  );

  // fallback (modo plano)
  const renderDynamicFormFields = useCallback(() => {
    if (!Array.isArray(event?.config?.formFields)) return null;
    return renderFieldsForNames(event.config.formFields.map((f) => f.name));
  }, [event?.config?.formFields, renderFieldsForNames]);

  const eventTheme = useMemo(() => {
    const hex = event.config?.primaryColor;
    if (!hex) return createTheme({});
    return createTheme({
      colors: { eventPrimary: generateColors(hex) },
      primaryColor: "eventPrimary",
    });
  }, [event.config?.primaryColor]);

  // 🎨 estilos del layout (como la imagen)
  const bgStyle = useMemo(() => {
    const img =
      event.backgroundImage && String(event.backgroundImage).startsWith("http")
        ? !isMobile
          ? event.backgroundImage
          : event.backgroundMobileImage || event.backgroundImage
        : null;

    return {
      minHeight: "100vh",
      width: "100%",
      backgroundImage: img
        ? `url('${img}')`
        : `linear-gradient(180deg, rgba(15,71,32,1) 0%, rgba(7,36,18,1) 100%)`,
      backgroundPosition: "center center",
      backgroundSize: "cover",
      backgroundRepeat: "no-repeat",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: isMobile ? 18 : 28,
    };
  }, [event.backgroundImage, event.backgroundMobileImage, isMobile]);

  const headerBg = useMemo(
    () => ({
      padding: isMobile ? 14 : 18,
      background:
        "radial-gradient(900px 280px at 18% 0%, rgba(34,197,94,0.25), transparent 60%), radial-gradient(900px 280px at 82% 0%, rgba(16,185,129,0.18), transparent 60%), rgba(16, 185, 129, 0.10)",
      borderBottom: "1px solid rgba(0,0,0,0.06)",
    }),
    [isMobile],
  );

  if (userLoading) return <Loader />;

  if (!eventId) {
    return (
      <Container>
        <Paper shadow="md" p="xl" style={{ maxWidth: 520, margin: "40px auto" }}>
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
    <MantineProvider theme={eventTheme} inherit>
      <Box style={bgStyle}>
        <Container size={isMobile ? "xs" : "sm"} px={0} w="100%">
          <Paper
            radius="xl"
            shadow="xl"
            withBorder
            style={{
              overflow: "hidden",
              background: "rgba(255,255,255,0.92)",
              backdropFilter: "blur(10px)",
              borderColor: "rgba(255,255,255,0.55)",
            }}
          >
            {/* Header banner (como la imagen) */}
            <Box style={headerBg}>
              <Paper
                radius="xl"
                withBorder
                style={{
                  overflow: "hidden",
                  background: "rgba(255,255,255,0.72)",
                  borderColor: "rgba(255,255,255,0.7)",
                }}
              >
                <Flex
                  align="center"
                  justify="center"
                  style={{
                    padding: isMobile ? 10 : 12,
                  }}
                >
                  <img
                    src={event.eventImage}
                    alt="Encuentro"
                    style={{
                      width: "100%",
                      borderRadius: 14,
                    }}
                  />
                </Flex>
              </Paper>
            </Box>

            {/* Body */}
            <Box px={isMobile ? 18 : 22} py={isMobile ? 18 : 20}>
              <Stack gap="md">
                <Stack gap={4} ta="center">
                  <Title order={2} style={{ lineHeight: 1.05 }}>
                    {event.eventName || "Encuentro de afiliados"}
                  </Title>

                  {event?.config?.eventDate ? (
                    <Text c="dimmed" size="sm">
                      <Text span fw={700} c="dark">
                        Fecha del evento:
                      </Text>{" "}
                      {formatDate(event?.config?.eventDate)}
                    </Text>
                  ) : null}

                  <Group justify="center" gap="xs">
                    {event?.config?.eventStartTime ? (
                      <Badge variant="light" radius="md">
                        Inicio: {formatTime(event?.config?.eventStartTime)}
                      </Badge>
                    ) : null}
                    {event?.config?.eventEndTime ? (
                      <Badge variant="light" radius="md">
                        Fin: {formatTime(event?.config?.eventEndTime)}
                      </Badge>
                    ) : null}
                  </Group>

                  {event?.config?.eventLocation ? (
                    <Text size="sm" c="dimmed">
                      <Text span fw={700} c="dark">
                        Lugar:
                      </Text>{" "}
                      {event.config.eventLocation}
                    </Text>
                  ) : null}
                </Stack>

                {event?.landingQR ? (
                  <Paper
                    radius="lg"
                    withBorder
                    p="sm"
                    style={{
                      maxWidth: 220,
                      margin: "0 auto",
                      background: "rgba(255,255,255,0.8)",
                    }}
                  >
                    <Image
                      src={event.landingQR}
                      alt="QR del evento"
                      fit="contain"
                      style={{ width: "100%" }}
                    />
                  </Paper>
                ) : null}

                <Text
                  ta="center"
                  size={isMobile ? "sm" : "md"}
                  style={{ maxWidth: 560, margin: "0 auto" }}
                >
                  <strong>Plataforma de Networking y Reuniones de Negocio.</strong>{" "}
                  Conecta con otras empresas y permite que te encuentren para
                  agendar reuniones durante el evento. Ingresa con el correo
                  registrado de la empresa o regístrate si es tu primera vez.
                </Text>

                {/* Tabs tipo botones grandes */}
                <Tabs
                  value={activeTab}
                  onChange={setActiveTab}
                  keepMounted={false}
                  variant="unstyled"
                >
                  <Tabs.List grow style={{ gap: 12 }}>
                    <Tabs.Tab
                      value="login"
                      style={{
                        borderRadius: 14,
                        height: 44,
                        fontWeight: 800,
                        letterSpacing: 0.2,
                        border: "1px solid rgba(0,0,0,0.12)",
                        background:
                          activeTab === "login"
                            ? "linear-gradient(180deg, rgba(16,185,129,1), rgba(5,150,105,1))"
                            : "rgba(255,255,255,0.85)",
                        color:
                          activeTab === "login"
                            ? "white"
                            : "rgba(0,0,0,0.78)",
                        boxShadow:
                          activeTab === "login"
                            ? "0 12px 22px rgba(5,150,105,0.25)"
                            : "none",
                      }}
                    >
                      INGRESAR
                    </Tabs.Tab>

                    <Tabs.Tab
                      value="register"
                      disabled={!registrationEnabled}
                      style={{
                        borderRadius: 14,
                        height: 44,
                        fontWeight: 800,
                        letterSpacing: 0.2,
                        border: "1px solid rgba(0,0,0,0.12)",
                        background:
                          activeTab === "register"
                            ? "linear-gradient(180deg, rgba(16,185,129,1), rgba(5,150,105,1))"
                            : "rgba(255,255,255,0.85)",
                        color:
                          activeTab === "register"
                            ? "white"
                            : "rgba(0,0,0,0.78)",
                        boxShadow:
                          activeTab === "register"
                            ? "0 12px 22px rgba(5,150,105,0.25)"
                            : "none",
                        opacity: !registrationEnabled ? 0.5 : 1,
                      }}
                    >
                      {currentUser?.data ? "ACTUALIZAR" : "REGISTRARSE"}
                    </Tabs.Tab>
                  </Tabs.List>

                  {/* LOGIN */}
                  <Tabs.Panel value="login" pt="md">
                    <Stack gap="sm">
                      <TextInput
                        label="Correo electrónico"
                        placeholder="tu@empresa.com"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                        required
                        radius="md"
                        size="md"
                      />

                      {loginError ? (
                        <Alert color="red" variant="light" radius="md">
                          {loginError}
                        </Alert>
                      ) : null}

                      <Button
                        radius="md"
                        size="md"
                        loading={loginLoading}
                        onClick={handleLogin}
                        style={{ height: 44, fontWeight: 800 }}
                      >
                        INGRESAR
                      </Button>
                    </Stack>
                  </Tabs.Panel>

                  {/* REGISTER */}
                  <Tabs.Panel value="register" pt="md">
                    {!registrationEnabled ? (
                      <Text ta="center" c="dimmed" mt="md">
                        Los nuevos registros están inhabilitados para este
                        evento.
                      </Text>
                    ) : (
                      <Stack>
                        <Text ta="center" c="dimmed">
                          {currentUser?.data
                            ? "Actualiza tu información antes de continuar."
                            : "Completa el formulario para crear tu registro."}
                        </Text>

                        {steps ? (
                          <>
                            <Paper
                              radius="lg"
                              withBorder
                              p="md"
                              style={{ background: "rgba(255,255,255,0.75)" }}
                            >
                              <Stepper
                                active={activeStep}
                                onStepClick={setActiveStep}
                                breakpoint="sm"
                              >
                                {steps.map((s) => (
                                  <Stepper.Step key={s.id} label={s.title} />
                                ))}
                              </Stepper>
                            </Paper>

                            <Paper
                              radius="lg"
                              withBorder
                              p="md"
                              style={{ background: "rgba(255,255,255,0.75)" }}
                            >
                              <Stack>
                                {renderFieldsForNames(
                                  steps[activeStep]?.fields || [],
                                )}

                                {activeStep === steps.length - 1 && (
                                  <>
                                    <Checkbox
                                      label={
                                        event.config?.tratamientoDatosText ||
                                        "Al utilizar este aplicativo, autorizo a GEN.IALITY SAS identificada con NIT 901555490, ..."
                                      }
                                      checked={
                                        !!formValues[CONSENTIMIENTO_FIELD_NAME]
                                      }
                                      onChange={(e) =>
                                        handleDynamicChange(
                                          CONSENTIMIENTO_FIELD_NAME,
                                          e.currentTarget.checked,
                                        )
                                      }
                                      required
                                      mt="sm"
                                    />
                                    {formErrors[CONSENTIMIENTO_FIELD_NAME] ? (
                                      <Text c="red" size="sm">
                                        {formErrors[CONSENTIMIENTO_FIELD_NAME]}
                                      </Text>
                                    ) : null}
                                  </>
                                )}
                              </Stack>
                            </Paper>

                            <Group
                              justify="space-between"
                              grow={isMobile}
                              mt="sm"
                            >
                              <Button
                                variant="default"
                                radius="md"
                                size="md"
                                onClick={() =>
                                  setActiveStep((s) => Math.max(0, s - 1))
                                }
                                disabled={activeStep === 0}
                              >
                                Atrás
                              </Button>

                              {activeStep < steps.length - 1 ? (
                                <Button
                                  radius="md"
                                  size="md"
                                  onClick={() => {
                                    const ok = validateStep(
                                      steps[activeStep]?.fields || [],
                                    );
                                    if (!ok) return;
                                    setActiveStep((s) =>
                                      Math.min(steps.length - 1, s + 1),
                                    );
                                  }}
                                >
                                  Siguiente
                                </Button>
                              ) : (
                                <Button
                                  radius="md"
                                  size="md"
                                  onClick={handleSubmit}
                                  loading={
                                    saving || photoUploadStatus === "uploading"
                                  }
                                  disabled={
                                    saving || photoUploadStatus === "uploading"
                                  }
                                  style={{ fontWeight: 800, height: 44 }}
                                >
                                  {currentUser?.data
                                    ? "Guardar cambios"
                                    : "Registrarme"}
                                </Button>
                              )}
                            </Group>
                          </>
                        ) : (
                          <>
                            <Paper
                              radius="lg"
                              withBorder
                              p="md"
                              style={{ background: "rgba(255,255,255,0.75)" }}
                            >
                              <Stack>
                                {renderDynamicFormFields()}

                                <Checkbox
                                  label={
                                    event.config?.tratamientoDatosText ||
                                    "Al utilizar este aplicativo, autorizo a GEN.IALITY SAS identificada con NIT 901555490, ..."
                                  }
                                  checked={
                                    !!formValues[CONSENTIMIENTO_FIELD_NAME]
                                  }
                                  onChange={(e) =>
                                    handleDynamicChange(
                                      CONSENTIMIENTO_FIELD_NAME,
                                      e.currentTarget.checked,
                                    )
                                  }
                                  required
                                  mt="sm"
                                />
                                {formErrors[CONSENTIMIENTO_FIELD_NAME] ? (
                                  <Text c="red" size="sm">
                                    {formErrors[CONSENTIMIENTO_FIELD_NAME]}
                                  </Text>
                                ) : null}
                              </Stack>
                            </Paper>

                            <Group
                              justify="space-between"
                              grow={isMobile}
                              mt="sm"
                            >
                              <Button
                                radius="md"
                                size="md"
                                onClick={handleSubmit}
                                loading={saving}
                                style={{ fontWeight: 800, height: 44 }}
                              >
                                {currentUser?.data
                                  ? "Guardar cambios"
                                  : "Registrarme"}
                              </Button>
                            </Group>
                          </>
                        )}
                      </Stack>
                    )}
                  </Tabs.Panel>
                </Tabs>

                <Divider my={6} />

                <Text ta="center" c="dimmed" fz="sm">
                  ¿Problemas para ingresar? Verifica que tu correo esté
                  registrado por la organización del evento.
                </Text>
              </Stack>
            </Box>
          </Paper>

          <Text ta="center" mt="md" c="rgba(255,255,255,0.85)" size="sm">
            Powered by Geniality
          </Text>
        </Container>
      </Box>
    </MantineProvider>
  );
};

export default Landing;

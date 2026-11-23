/* eslint-disable react/prop-types */
import { useEffect, useState, useContext, useCallback, useMemo } from "react";
import {
  TextInput,
  Textarea,
  Button,
  Paper,
  Title,
  Stack,
  Loader,
  Divider,
  Text,
  Select,
  FileInput,
  MultiSelect,
  Container,
  Checkbox,
  Box,
  Group,
  Alert,
  Tabs,
  Badge,
  Stepper,
  Progress,
  MantineProvider,
  ActionIcon,
  Tooltip,
  ThemeIcon,
} from "@mantine/core";
import { buildEventTheme } from "../theme.js";
import { RichTextEditor, Link } from "@mantine/tiptap";
import { useEditor } from "@tiptap/react";
import Highlight from "@tiptap/extension-highlight";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconSparkles,
  IconMapPin,
  IconArrowUpRight,
  IconPhoto,
} from "@tabler/icons-react";

import { auth, db } from "../firebase/firebaseConfig";
import { signInAnonymously } from "firebase/auth";
import { storage } from "../firebase/firebaseConfig";
import { UserContext } from "../context/UserContext";
import { uploadCompanyLogo } from "../utils/companyStorage";
import { trackEvent } from "../utils/analytics";
import {
  COUNTRY_CODES,
  detectDefaultIso2,
  getDialCodeForIso2,
  parsePhoneValue,
  isPhoneField,
  cleanLocalPhoneNumber,
} from "../utils/phoneUtils";
import { sendWelcomeNotification } from "../utils/whatsappService";
import { getEventDayKeys, formatDayLabel } from "../utils/eventDays";
import { getForcedRegistrationRole } from "../utils/attendeeRole";
import { withRoleLabel } from "../utils/attendeeFields";
import { normalizeNit } from "../utils/nit";
import { usePhoneAvailability } from "../hooks/usePhoneAvailability";

const PHONE_TAKEN_MSG =
  "Este número ya está registrado en el evento. Ingresa con esa cuenta.";
import SupportButton from "../components/SupportButton";
import PhoneMatchPickerModal from "../components/PhoneMatchPickerModal";
import { findAttendeesByPhone } from "../utils/phoneLogin";
import CompanyNitSearchInput from "../components/CompanyNitSearchInput";
import RegistrationWelcome from "../components/RegistrationWelcome";
import { resolveConsentLabel } from "../utils/registrationWelcome";

const CONSENTIMIENTO_FIELD_NAME = "aceptaTratamiento";
const getConsentimientos = (config = {}) => {
  if (Array.isArray(config.consentimientos) && config.consentimientos.length > 0) {
    return config.consentimientos
      .map((item, index) => ({
        name: item.name || (index === 0 ? CONSENTIMIENTO_FIELD_NAME : `consentimiento_${index + 1}`),
        label: String(
          item.label ||
          (index === 0 ? resolveConsentLabel(config.tratamientoDatosLabel) : ""),
        ).trim(),
        text: String(
          item.text ||
          (index === 0 ? config.tratamientoDatosText || "" : ""),
        ).trim(),
        required: item.required !== false,
      }))
      .filter((item) => item.label);
  }
  return [{
    name: CONSENTIMIENTO_FIELD_NAME,
    label: resolveConsentLabel(config.tratamientoDatosLabel),
    text: config.tratamientoDatosText || "",
    required: true,
  }];
};

// Selector de código de país del teléfono en el registro público: mismo listado
// completo que usa el panel admin (ModalEditAttendee.jsx/AttendeesList.jsx).
const LANDING_COUNTRY_CODES = COUNTRY_CODES;

// ---- helpers ----
const uploadProfilePicture = async (file, uid) => {
  const storageRef = ref(storage, `profilePictures/${uid}/${file.name}`);
  await uploadBytes(storageRef, file);
  const photoURL = await getDownloadURL(storageRef);
  return photoURL;
};

const uploadPdfDocument = async (file, eventId, uid, fieldName) => {
  const ext = file.name.split(".").pop() || "pdf";
  const storageRef = ref(
    storage,
    `brochures/${eventId}/${uid}/${fieldName}.${ext}`,
  );
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
};

const isValidEmail = (v = "") =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());


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

const validateField = (field, value) => {
  const { validation = {} } = field;
  const required = field.required ?? true;

  const isPhone = isPhoneField(field);

  let checkValue = value;
  if (isPhone && value) {
    const m = String(value)
      .trim()
      .match(/^(\+\d{1,4})\s?(.*)$/);
    checkValue = m ? m[2].trim() : String(value).replace(/\D/g, "");
  }

  if (required) {
    if (typeof value === "boolean") {
      if (!value)
        return (
          validation?.errorMessage || `El campo ${field.label} es obligatorio`
        );
    } else {
      if (!checkValue || String(checkValue).trim() === "") {
        return (
          validation?.errorMessage || `El campo ${field.label} es obligatorio`
        );
      }
    }
  }

  // Si no es requerido y está vacío, es válido
  if (
    value === null ||
    value === undefined ||
    String(checkValue).trim() === "" ||
    (typeof value === "boolean" && !value)
  ) {
    return null;
  }

  const valueToValidate = isPhone
    ? String(checkValue).trim()
    : String(value).trim();

  if (validation?.minLength && valueToValidate.length < validation.minLength) {
    return (
      validation.errorMessage ||
      `Debe tener al menos ${validation.minLength} caracteres`
    );
  }

  if (validation?.maxLength && valueToValidate.length > validation.maxLength) {
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
      if (!regex.test(valueToValidate)) {
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
  const [searchParams] = useSearchParams();
  const {
    userLoading,
    loginByEmail,
    loginByCedula,
    loginAsUser,
    currentUser,
    updateUser,
    logout,
  } =
    useContext(UserContext);

  const [event, setEvent] = useState({});
  const consentimientos = useMemo(
    () => getConsentimientos(event?.config),
    [event?.config],
  );
  const [registrationEnabled, setRegistrationEnabled] = useState(true);

  // UI state
  // ?ingresar=1 abre directo la pestaña de ingreso (p. ej. el enlace que se envía a
  // expositores precargados, para que no se registren de nuevo por error)
  const [activeTab, setActiveTab] = useState(
    searchParams.get("ingresar") === "1" ? "login" : "register",
  ); // 'login' | 'register'
  const isMobile = useMediaQuery("(max-width: 600px)");

  // Login state
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  // Varias personas con el celular escrito: modal para elegir (null = cerrado)
  const [phoneMatches, setPhoneMatches] = useState(null);

  // Form state
  const [formValues, setFormValues] = useState({});
  const [profilePicPreview, setProfilePicPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  // Mensaje mostrado debajo del botón de registro cuando no se pudo enviar
  const [submitError, setSubmitError] = useState("");

  // Stepper state
  const [activeStep, setActiveStep] = useState(0);
  const [companyLookupLoading, setCompanyLookupLoading] = useState(false);

  const [photoUploadStatus, setPhotoUploadStatus] = useState("idle");
  const [photoUploadError, setPhotoUploadError] = useState("");

  // Company logo state
  const [companyLogoFile, setCompanyLogoFile] = useState(null);
  const [companyLogoPreview, setCompanyLogoPreview] = useState(null);

  // PDF document fields state: { [fieldName]: File }
  const [pdfFiles, setPdfFiles] = useState({});

  // País por defecto del selector de teléfono: zona horaria del dispositivo, luego
  // idioma del navegador, luego Colombia (ver detectDefaultIso2).
  const defaultIso2 = useMemo(() => {
    const detected = detectDefaultIso2();
    return LANDING_COUNTRY_CODES.some((c) => c.value === detected)
      ? detected
      : "co";
  }, []);
  // País elegido a mano en cada campo de teléfono: desempata indicativos
  // compartidos (+1 Canadá / EE. UU.) al volver a leer el valor guardado.
  const [phoneIsoByField, setPhoneIsoByField] = useState({});

  // AI description improvement state
  const [improvingDescription, setImprovingDescription] = useState(false);

  const configuredDescriptionPlaceholder = useMemo(() => {
    const descripcionField = (event?.config?.formFields || []).find(
      (f) => f.name === "descripcion",
    );
    return (
      descripcionField?.placeholder?.trim() ||
      "Describe tu empresa, productos o servicios..."
    );
  }, [event?.config?.formFields]);
  // Editor tiptap
  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        Underline,
        Link,
        Highlight,
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        Placeholder.configure({
          placeholder: configuredDescriptionPlaceholder,
        }),
      ],
      content: "",
      // Alto mínimo ~3 líneas para que se note que caben varias líneas de texto
      editorProps: { attributes: { style: "min-height: 72px" } },
      onUpdate: ({ editor }) => {
        const htmlContent = editor.getHTML();
        const plainText = stripHtmlTags(htmlContent);
        setFormValues((prev) => ({
          ...prev,
          descripcion: plainText,
        }));
      },
    },
    [configuredDescriptionPlaceholder],
  );

  const getValueForField = useCallback(
    (fieldName) => {
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

  // Política: fuerza tipoAsistente ("comprador" o "vendedor") y oculta el selector en el
  // formulario. Puede venir del forzado global o del parámetro de URL (roleUrlParamEnabled).
  const forcedRole = getForcedRegistrationRole(
    event?.config?.policies,
    searchParams,
  );

  // Campos del formulario con la etiqueta resuelta según el rol (labelByRole)
  const roleForLabels = forcedRole || formValues.tipoAsistente;
  const formFields = useMemo(
    () =>
      (event?.config?.formFields || []).map((f) =>
        withRoleLabel(f, roleForLabels),
      ),
    [event?.config?.formFields, roleForLabels],
  );

  const fieldsByName = useMemo(() => {
    const map = new Map();
    formFields.forEach((f) => map.set(f.name, f));
    return map;
  }, [formFields]);

  // Teléfono ya registrado por otro asistente del evento: se bloquea el registro
  // (evita multicuentas) y se ofrece ingresar con la cuenta existente.
  const primaryPhoneField = useMemo(
    () => formFields.find((f) => isPhoneField(f)) || null,
    [formFields],
  );
  const { state: phoneCheck, verifyNow: verifyPhoneNow } = usePhoneAvailability(
    eventId,
    primaryPhoneField ? formValues[primaryPhoneField.name] : "",
    currentUser?.uid,
  );

  const registrationForm = event?.config?.registrationForm || null;
  const steps =
    registrationForm?.mode === "stepper" ? registrationForm.steps || [] : null;

  const companyStepFields = useMemo(() => {
    const allSteps = registrationForm?.steps || [];
    const companyStep = allSteps.find((s) =>
      (s.fields || []).includes("company_nit"),
    );
    if (companyStep) return companyStep.fields || [];
    return ["company_nit", "company_razonSocial", "descripcion"];
  }, [registrationForm?.steps]);

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

  // Resume en un solo mensaje qué campos impidieron el registro
  const buildMissingFieldsMessage = useCallback(
    (errors) => {
      const names = Object.keys(errors).filter((n) => errors[n]);
      if (names.length === 0) return "";
      const consentNames = new Set(consentimientos.map((item) => item.name));
      const labels = names
        .filter((n) => !consentNames.has(n))
        .map((n) => fieldsByName.get(n)?.label || n);
      const parts = [];
      if (labels.length) {
        parts.push(`Revisa los campos marcados en rojo: ${labels.join(", ")}.`);
      }
      names
        .filter((n) => consentNames.has(n))
        .forEach((n) => parts.push(errors[n]));
      return parts.join(" ");
    },
    [consentimientos, fieldsByName],
  );

  const validateForm = useCallback(() => {
    const errors = {};
    formFields.forEach((field) => {
      // Ignorar validación de tipoAsistente si el evento es de Networking o se fuerza el rol
      if (
        (event?.eventType === "Networking" || forcedRole) &&
        field.name === "tipoAsistente"
      )
        return;

      if (!isFieldVisible(field)) return;

      let value = getValueForField(field.name);

      if (
        (field.name === "photoURL" || field.type === "photo") &&
        formValues._photoFile
      ) {
        value = "selected";
      }

      if (
        field.type === "pdf" &&
        (pdfFiles[field.name] || formValues[field.name])
      ) {
        value = "selected";
      }

      // El logo vive fuera de formValues (companyLogoFile), o ya existe en la empresa (preview)
      if (
        (field.name === "company_logo" || field.type === "file") &&
        (companyLogoFile || companyLogoPreview)
      ) {
        value = "selected";
      }

      const error = validateField(field, value);
      if (error) errors[field.name] = error;
    });

    consentimientos.forEach((consent) => {
      if (consent.required && !formValues[consent.name]) {
        errors[consent.name] = `Debes aceptar: ${consent.label}`;
      }
    });

    console.log("ERRORES DE VALIDACION:", errors);
    console.log("VALORES DEL FORMULARIO:", formValues);

    setFormErrors(errors);
    return errors;
  }, [
    formFields,
    event?.eventType,
    forcedRole,
    formValues,
    getValueForField,
    isFieldVisible,
    pdfFiles,
    companyLogoFile,
    companyLogoPreview,
    consentimientos,
  ]);

  const validateStep = useCallback(
    (fieldNames = []) => {
      const errors = {};
      fieldNames.forEach((name) => {
        // Ignorar validación de tipoAsistente si el evento es de Networking o se fuerza el rol
        if (
          (event?.eventType === "Networking" || forcedRole) &&
          name === "tipoAsistente"
        )
          return;

        const def = fieldsByName.get(name);
        if (!def) return;
        if (!isFieldVisible(def)) return;

        let value = getValueForField(def.name);

        if (
          (def.name === "photoURL" || def.type === "photo") &&
          formValues._photoFile
        ) {
          value = "selected";
        }

        if (
          def.type === "pdf" &&
          (pdfFiles[def.name] || formValues[def.name])
        ) {
          value = "selected";
        }

        if (
          (def.name === "company_logo" || def.type === "file") &&
          (companyLogoFile || companyLogoPreview)
        ) {
          value = "selected";
        }

        const err = validateField(def, value);
        if (err) errors[def.name] = err;
        else if (
          def.name === primaryPhoneField?.name &&
          phoneCheck.status === "registered"
        ) {
          errors[def.name] = PHONE_TAKEN_MSG;
        }
      });

      const isLast = steps && activeStep === steps.length - 1;
      if (isLast) {
        consentimientos.forEach((consent) => {
          if (consent.required && !formValues[consent.name]) {
            errors[consent.name] = `Debes aceptar: ${consent.label}`;
          }
        });
      }

      setFormErrors((prev) => ({ ...prev, ...errors }));
      const errorCount = Object.keys(errors).length;
      setSubmitError(errorCount ? buildMissingFieldsMessage(errors) : "");
      return errorCount === 0;
    },
    [
      buildMissingFieldsMessage,
      companyLogoFile,
      companyLogoPreview,
      fieldsByName,
      getValueForField,
      isFieldVisible,
      steps,
      activeStep,
      formValues,
      pdfFiles,
      primaryPhoneField,
      consentimientos,
      phoneCheck.status,
      event?.eventType,
      forcedRole,
    ],
  );

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
          const isEventOpen =
            eventData.status === "abierto" ||
            (eventData.config?.registrationEnabled ?? true);
          setRegistrationEnabled(isEventOpen);
          setActiveStep(0);

          if (eventData.eventType === "Networking") {
            setFormValues((prev) => ({
              ...prev,
              tipoAsistente: "Asistente",
            }));
          }
        }
      },
      (error) => console.error("Error in real-time listener:", error),
    );
    return () => unsubscribe();
  }, [eventId]);

  // Rol forzado (política global o parámetro de URL): se refleja en el formulario
  useEffect(() => {
    if (event?.eventType === "Networking" || !forcedRole) return;
    setFormValues((prev) =>
      prev.tipoAsistente === forcedRole
        ? prev
        : { ...prev, tipoAsistente: forcedRole },
    );
  }, [forcedRole, event?.eventType]);

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
        navigate(eventId ? `/dashboard/${eventId}` : "/dashboard");
      }
    }
  }, [currentUser, eventId, logout, editor, navigate]);

  useEffect(() => {
    if (currentUser?.data) {
      setFormValues((prev) => ({
        ...prev,
        ...currentUser.data,
        ...(event?.eventType === "Networking"
          ? { tipoAsistente: "Asistente" }
          : forcedRole
            ? { tipoAsistente: forcedRole }
            : {}),
      }));
      if (currentUser.data.photoURL) {
        setProfilePicPreview(currentUser.data.photoURL);
      }
    }
  }, [currentUser, event?.eventType, forcedRole]);

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

  // nitOverride: NIT elegido en el buscador (onBlur llega con el evento, no con un string)
  const lookupCompanyByNit = useCallback(async (nitOverride) => {
    if (!eventId) return;

    const nitNorm = normalizeNit(
      typeof nitOverride === "string" ? nitOverride : formValues.company_nit || "",
    );
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
          companyStepFields.forEach((fieldName) => {
            if (fieldName === "company_nit") return;
            // Evita que datos de empresa sobreescriban el nombre personal del usuario
            if (fieldName === "nombre") return;
            if (data[fieldName] !== undefined && data[fieldName] !== null) {
              updated[fieldName] = data[fieldName];
            }
          });
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

  // Ingreso con el celular: el servidor (phoneLogin) ya ubicó al asistente por su
  // teléfono; aquí se abre la sesión igual que en /acceso (AutoLoginPage).
  const loginWithPhoneMatch = useCallback(
    async (uid) => {
      setPhoneMatches(null);
      setLoginLoading(true);
      try {
        // Las reglas exigen una sesión de Firebase para escribir
        if (!auth.currentUser) await signInAnonymously(auth);
        const snap = await getDoc(doc(db, "users", uid));
        if (!snap.exists() || snap.data().eventId !== eventId) {
          setLoginError("No se encontró un participante con este celular para este evento.");
          return;
        }
        trackEvent({ name: "login", params: { method: "phone" } });
        loginAsUser(uid, snap.data());
        setDoc(doc(db, "users", uid), { lastConnection: new Date() }, { merge: true }).catch(
          (e) => console.warn("No se pudo actualizar lastConnection:", e),
        );
        navigate(`/dashboard/${eventId}`);
      } catch (e) {
        console.error(e);
        setLoginError("Ocurrió un error al intentar ingresar.");
      } finally {
        setLoginLoading(false);
      }
    },
    [eventId, loginAsUser, navigate],
  );

  const handleLogin = useCallback(async () => {
    setLoginError("");
    const identifier = loginIdentifier.trim();
    // Con "@" es un correo; si no, se busca como cédula y, si no aparece, como celular
    const byEmail = identifier.includes("@");
    const digits = identifier.replace(/\D/g, "");
    if (byEmail) {
      if (!isValidEmail(identifier)) {
        setLoginError("Por favor ingresa un correo válido.");
        return;
      }
    } else if (digits.length < 5) {
      setLoginError("Ingresa tu correo, tu número de identidad o tu celular.");
      return;
    }

    if (byEmail) trackEvent({ name: "login", params: { method: "email" } });

    setLoginLoading(true);
    try {
      if (byEmail) {
        const result = await loginByEmail(identifier, eventId);
        if (result?.success) navigate(eventId ? `/dashboard/${eventId}` : "/dashboard");
        else setLoginError("No se encontró un participante con este correo para este evento.");
        return;
      }

      const result = await loginByCedula(identifier, eventId);
      if (result?.success) {
        trackEvent({ name: "login", params: { method: "cedula" } });
        navigate(eventId ? `/dashboard/${eventId}` : "/dashboard");
        return;
      }

      const notFound =
        "No encontramos un participante con este número de identidad o celular para este evento.";
      if (!eventId || digits.length < 7) {
        setLoginError(notFound);
        return;
      }
      const byPhone = await findAttendeesByPhone(eventId, identifier);
      if (!byPhone.ok) {
        setLoginError(
          `Demasiados intentos sin resultado. Intenta de nuevo en ${Math.ceil(
            byPhone.retryAfterSec / 60,
          )} minutos o escríbenos con el botón de Soporte.`,
        );
      } else if (byPhone.matches.length === 1) {
        await loginWithPhoneMatch(byPhone.matches[0].uid);
      } else if (byPhone.matches.length > 1) {
        setPhoneMatches(byPhone.matches);
      } else {
        setLoginError(notFound);
      }
    } catch (e) {
      console.error(e);
      setLoginError("Ocurrió un error al intentar ingresar.");
    } finally {
      setLoginLoading(false);
    }
  }, [loginByEmail, loginByCedula, loginWithPhoneMatch, loginIdentifier, eventId, navigate]);

  // Función para mejorar descripción con IA
  const handleImproveDescription = useCallback(async () => {
    setImprovingDescription(true);
    try {
      const response = await fetch(
        "https://improveuserdescription-6eaymlz5eq-uc.a.run.app",

        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipoAsistente:
              event?.eventType === "Networking"
                ? "Asistente"
                : forcedRole || formValues.tipoAsistente,
            interesPrincipal: formValues.interesPrincipal,
            necesidad: formValues.necesidad,
            cargo: formValues.cargo,
            empresa: formValues.empresa || formValues.company_razonSocial,
            currentDescription: formValues.descripcion,
          }),
        },
      );

      if (!response.ok) {
        throw new Error("Error al mejorar descripción");
      }

      const data = await response.json();

      if (data.success && data.description) {
        // Actualizar el editor y el formValues
        if (editor) {
          editor.commands.setContent(data.description);
        }
        setFormValues((prev) => ({
          ...prev,
          descripcion: data.description,
        }));
      }
    } catch (error) {
      console.error("Error improving description:", error);
      // Solo log en consola, sin alertas
    } finally {
      setImprovingDescription(false);
    }
  }, [formValues, editor, event?.eventType, forcedRole]);

  const handleSubmit = useCallback(async () => {
    console.log("Iniciando handleSubmit...");
    setSubmitError("");
    // Sin el evento cargado formFields está vacío y validateForm solo revisa el
    // consentimiento: se guardaba un usuario sin nombre/empresa/rol (conexión lenta,
    // navegadores in-app). No se permite enviar hasta tener la configuración.
    if (!event || formFields.length === 0) {
      setSubmitError(
        "Aún estamos cargando el formulario del evento. Espera unos segundos e intenta de nuevo.",
      );
      return;
    }
    const validationErrors = validateForm();
    if (Object.keys(validationErrors).length > 0) {
      console.warn("Validación falló. Abortando submit.");
      setSubmitError(buildMissingFieldsMessage(validationErrors));
      // En modo stepper, llevar al usuario al primer paso con un campo con error
      if (steps) {
        const firstErrorStep = steps.findIndex((st) =>
          (st.fields || []).some((f) => validationErrors[f]),
        );
        if (firstErrorStep >= 0 && firstErrorStep !== activeStep) {
          setActiveStep(firstErrorStep);
        }
      }
      return;
    }

    // Revalida el teléfono sin esperar el debounce (pudo escribirlo y enviar de una vez)
    if (primaryPhoneField && formValues[primaryPhoneField.name]) {
      const phoneResult = await verifyPhoneNow();
      if (phoneResult.status === "registered") {
        setFormErrors((prev) => ({
          ...prev,
          [primaryPhoneField.name]: PHONE_TAKEN_MSG,
        }));
        setSubmitError(
          "Este teléfono ya está registrado en el evento. Ingresa con esa cuenta en lugar de crear una nueva.",
        );
        if (steps) {
          const phoneStep = steps.findIndex((st) =>
            (st.fields || []).includes(primaryPhoneField.name),
          );
          if (phoneStep >= 0) setActiveStep(phoneStep);
        }
        return;
      }
    }
    console.log("Validación exitosa. Guardando...");

    setPhotoUploadError("");
    if (!formValues._photoFile && formValues.photoURL)
      setPhotoUploadStatus("done");

    setSaving(true);
    try {
      const uid = currentUser?.uid;
      const isNewUser = !currentUser?.data?.createdAt;

      // Guarda de seguridad: uid puede seguir apuntando al documento de OTRO
      // evento si el logout() del useEffect de detección de evento no llegó
      // a completarse a tiempo (red inestable, navegador in-app, etc.).
      // Escribir aquí encima sobrescribiría el registro de ese otro evento
      // en vez de crear uno independiente. Abortamos y forzamos una sesión
      // nueva en lugar de arriesgar el dato del otro evento.
      if (currentUser?.data?.eventId && currentUser.data.eventId !== eventId) {
        console.warn(
          "handleSubmit abortado: currentUser pertenece a otro evento",
          currentUser.data.eventId,
          "!==",
          eventId,
        );
        await logout();
        alert(
          "Tu sesión estaba asociada a otro evento. Se reinició tu sesión, por favor completa el formulario nuevamente.",
        );
        setSaving(false);
        return;
      }

      let dataToUpdate = Object.fromEntries(
        Object.entries({
          ...formValues,
          // Si es networking forzamos tipoAsistente a 'Asistente'; si la política está activa, a 'comprador' o 'vendedor'
          tipoAsistente:
            event?.eventType === "Networking"
              ? "Asistente"
              : forcedRole || formValues.tipoAsistente,
          correo: String(formValues["correo"] || "")
            .toLowerCase()
            .trim(),
          eventId,
          updatedAt: new Date().toISOString(),
        }).filter(([, v]) => v !== undefined),
      );
      // company_nit es solo el nombre del campo del formulario (paso de empresa);
      // el dato persistido en el asistente vive únicamente en companyId (ver más abajo).
      delete dataToUpdate.company_nit;

      // Validación de correo duplicado (mejorada)
      if (dataToUpdate.correo) {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("correo", "==", dataToUpdate.correo));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          // Verificar si algún documento existente es de otro usuario en el mismo evento
          const duplicateFound = querySnapshot.docs.some((docSnap) => {
            const existingData = docSnap.data();
            // Es duplicado si:
            // 1. Es un usuario diferente (docSnap.id !== uid)
            // 2. Y está en el mismo evento (existingData.eventId === eventId)
            return docSnap.id !== uid && existingData.eventId === eventId;
          });

          if (duplicateFound) {
            setSubmitError(
              "Este correo ya está registrado para este evento. Ingresa desde la pestaña de ingreso o usa otro correo.",
            );
            setFormErrors((prev) => ({
              ...prev,
              correo: "Este correo ya está registrado para este evento.",
            }));
            setSaving(false);
            return;
          }
        }
      }

      if (!currentUser?.data?.createdAt) {
        dataToUpdate.createdAt = new Date().toISOString();
        dataToUpdate.welcomePopupSeen = false; // Solo para usuarios nuevos
      }

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

      // Subir documentos PDF por campo
      for (const [fieldName, pdfFile] of Object.entries(pdfFiles)) {
        if (pdfFile) {
          try {
            const pdfUrl = await uploadPdfDocument(
              pdfFile,
              eventId,
              uid,
              fieldName,
            );
            dataToUpdate[fieldName] = pdfUrl;
          } catch (e) {
            console.error(`Error subiendo PDF ${fieldName}:`, e);
          }
        }
      }

      const nitNorm = normalizeNit(formValues.company_nit || "");
      let razon = String(
        formValues.company_razonSocial || formValues.empresa || "",
      ).trim();

      if (eventId && nitNorm) {
        try {
          const companyRef = doc(db, "events", eventId, "companies", nitNorm);
          const snap = await getDoc(companyRef);

          // If no name provided locally, use existing Firestore razonSocial
          if (!razon && snap.exists()) {
            razon = String(snap.data()?.razonSocial || "").trim();
          }

          const companyFieldData = {};
          companyStepFields.forEach((fieldName) => {
            if (fieldName === "company_nit") return;
            const val = formValues[fieldName];
            if (val !== undefined && val !== null) {
              companyFieldData[fieldName] = val;
            }
          });
          if (razon) companyFieldData.razonSocial = razon;
          if (formValues.descripcion)
            companyFieldData.descripcion = formValues.descripcion;

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
        } catch (e) {
          console.warn(
            "No se pudo guardar datos de empresa (sin permisos o sin NIT):",
            e,
          );
        }

        dataToUpdate.companyId = nitNorm;
        dataToUpdate.company_razonSocial = razon || null;
        dataToUpdate.empresa = razon || nitNorm;
      }

      // Sin NIT: si hay razón social en el formulario, guardarla como empresa
      if (!nitNorm && razon && !dataToUpdate.empresa) {
        dataToUpdate.empresa = razon;
      }

      // Generar attendeeId si la política está activa y el usuario no tiene uno
      if (eventId && uid) {
        try {
          const alreadyHasId = currentUser?.data?.attendeeId;
          if (!alreadyHasId) {
            const eventSnap = await getDoc(doc(db, "events", eventId));
            const attendeeIdEnabled =
              eventSnap.exists() &&
              eventSnap.data()?.config?.policies?.attendeeIdEnabled === true;
            if (attendeeIdEnabled) {
              // Contar usuarios existentes del evento para generar el número
              const usersSnap = await getDocs(
                query(collection(db, "users"), where("eventId", "==", eventId)),
              );
              const numero = usersSnap.size; // el usuario actual ya fue guardado, así que size >= 1
              const tipo = (
                dataToUpdate.tipoAsistente ||
                currentUser?.data?.tipoAsistente ||
                "A"
              )
                .charAt(0)
                .toUpperCase();
              dataToUpdate.attendeeId = `${numero}${tipo}`;
            }
          }
        } catch (e) {
          console.warn("[attendeeId] Error:", e);
        }
      }

      await updateUser(uid, dataToUpdate);

      // Track registration/update completion
      if (isNewUser) {
        trackEvent({
          name: "sign_up",
          params: {
            method: "form",
          },
        });

        // Enviar mensaje de WhatsApp y Correo de bienvenida al registrarse por primera vez (solo si la política lo permite)
        if (event?.config?.policies?.welcomeMessageEnabled === true) {
          try {
            const eventName = event?.eventName || "el evento";

            const badgeUrl = `badge/${eventId}/${uid}`;

            // Format date for notification
            let formattedDate = "Por definir";
            let formattedTime = "Por definir";

            if (
              event?.config?.eventDates &&
              event.config.eventDates.length > 0
            ) {
              formattedDate = formatDate(event.config.eventDates[0]);
              const firstDayConfig =
                event.config.dailyConfig?.[event.config.eventDates[0]];
              if (firstDayConfig?.startTime) {
                formattedTime = formatTime(firstDayConfig.startTime);
              }
            } else if (event?.config?.eventDate) {
              formattedDate = formatDate(event.config.eventDate);
              if (event?.config?.eventStartTime) {
                formattedTime = formatTime(event.config.eventStartTime);
              }
            }

            // 1. Enviar a WhatsApp
            if (dataToUpdate.telefono) {
              await sendWelcomeNotification({
                phone: dataToUpdate.telefono,
                name: dataToUpdate.nombre || "Asistente",
                eventName: eventName,
                eventId,
                badgeUrl,
                headerImageUrl:
                  event?.eventImage || event?.config?.landingTitleImage,
                date: formattedDate,
                time: formattedTime,
                fallbackInfo: { enabled: false, email: "", subject: "" }, // Evitar doble correo
                tracking: { eventId, userId: uid },
              });
            }

            // 2. Forzar envío de Correo
            if (dataToUpdate.correo) {
              await sendWelcomeNotification({
                phone: "+570000000000", // Teléfono falso para forzar fallback al correo
                name: dataToUpdate.nombre || "Asistente",
                eventName: eventName,
                eventId,
                badgeUrl,
                headerImageUrl:
                  event?.eventImage || event?.config?.landingTitleImage,
                date: formattedDate,
                time: formattedTime,
                fallbackInfo: {
                  enabled: true,
                  email: dataToUpdate.correo,
                  subject: `Bienvenido a ${eventName}`,
                },
              });
            }
          } catch (err) {
            console.error(
              "No se pudo enviar la notificación de bienvenida:",
              err,
            );
          }
        }
      } else {
        trackEvent({
          name: "profile_updated",
          params: {
            fields_updated: Object.keys(dataToUpdate),
          },
        });
      }

      navigate(eventId ? `/dashboard/${eventId}` : "/dashboard");
    } catch (error) {
      console.error("Error en el guardado:", error);
      setSubmitError(
        "No pudimos completar tu registro por un error de conexión o del servidor. Intenta de nuevo en unos segundos.",
      );
    } finally {
      setSaving(false);
    }
  }, [
    buildMissingFieldsMessage,
    steps,
    activeStep,
    currentUser,
    formValues,
    navigate,
    updateUser,
    logout,
    eventId,
    validateForm,
    companyStepFields,
    companyLogoFile,
    pdfFiles,
    event,
    formFields.length,
    forcedRole,
    primaryPhoneField,
    verifyPhoneNow,
  ]);

  const renderFieldsForNames = useCallback(
    (names = []) => {
      return names.map((name) => {
        if (
          (event?.eventType === "Networking" || forcedRole) &&
          name === "tipoAsistente"
        ) {
          return null;
        }

        const field = fieldsByName.get(name);
        if (!field) return null;
        if (!isFieldVisible(field)) return null;

        const fieldError = formErrors[field.name];

        if (field.name === "photoURL" || field.type === "photo") {
          return (
            <Box key={field.name}>
              <FileInput
                label={field.label || "Foto de perfil"}
                placeholder={field.placeholder || "Selecciona o toma una foto"}
                accept="image/png,image/jpeg"
                inputProps={{ capture: "user" }}
                required={field.required ?? true}
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
                <div
                  style={{
                    position: "relative",
                    display: "inline-block",
                    marginTop: 10,
                  }}
                >
                  <img
                    src={profilePicPreview}
                    alt="Vista previa"
                    width={120}
                    height={120}
                    style={{
                      borderRadius: "10px",
                      display: "block",
                      opacity: photoUploadStatus === "uploading" ? 0.4 : 1,
                    }}
                  />
                  {photoUploadStatus === "uploading" && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "10px",
                        background: "rgba(255,255,255,0.5)",
                      }}
                    >
                      <Loader size="sm" />
                    </div>
                  )}
                </div>
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

                {photoUploadStatus === "uploading" ? (
                  <Loader size="xs" />
                ) : null}
              </Group>

              {photoUploadError ? (
                <Alert color="red" variant="light" mt="xs" radius="md">
                  {photoUploadError}
                </Alert>
              ) : null}
            </Box>
          );
        }

        if (field.type === "richtext") {
          return (
            <Box key={field.name}>
              <Group justify="space-between" mb="xs">
                <Title order={6}>{field.label}</Title>
                <Tooltip label="Mejorar descripción con IA">
                  <ActionIcon
                    variant="light"
                    color="blue"
                    size="lg"
                    onClick={handleImproveDescription}
                    loading={improvingDescription}
                    disabled={
                      improvingDescription ||
                      (event?.eventType !== "Networking" &&
                        !forcedRole &&
                        !formValues.tipoAsistente)
                    }
                  >
                    <IconSparkles size={18} />
                  </ActionIcon>
                </Tooltip>
              </Group>
              <RichTextEditor editor={editor}>
                <RichTextEditor.Content />
              </RichTextEditor>
              {event?.eventType !== "Networking" &&
                !forcedRole &&
                !formValues.tipoAsistente && (
                  <Text size="xs" c="dimmed" mt="xs">
                    💡 Completa el campo &ldquo;Tipo de asistente&rdquo; para usar la IA
                  </Text>
                )}
              {fieldError && (
                <Text c="red" size="sm" mt="xs">
                  {fieldError}
                </Text>
              )}
            </Box>
          );
        }

        if (field.type === "select") {
          return (
            <Select
              key={field.name}
              label={field.label}
              placeholder={field.placeholder || "Selecciona una opción"}
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
                placeholder={
                  field.placeholder || "Selecciona una o más opciones"
                }
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

        if (field.type === "eventDays") {
          const dayKeys = getEventDayKeys(event?.config);
          const dayOptions = dayKeys.map((day, idx) => ({
            value: day,
            label: formatDayLabel(day, idx),
          }));
          const dayValue = Array.isArray(getValueForField(field.name))
            ? getValueForField(field.name)
            : [];

          if (dayOptions.length === 0) return null;

          return (
            <MultiSelect
              key={field.name}
              label={field.label}
              placeholder={
                field.placeholder || "Selecciona los días a los que asistirás"
              }
              data={dayOptions}
              value={dayValue}
              onChange={(value) => {
                handleDynamicChange(field.name, value);
                const error = validateField(field, value?.length ? value : "");
                setFormErrors((prev) => ({ ...prev, [field.name]: error }));
              }}
              required={field.required}
              clearable
              error={fieldError}
              radius="md"
            />
          );
        }

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

        if (field.name === "company_nit") {
          return (
            <CompanyNitSearchInput
              key={field.name}
              eventId={eventId}
              label={field.label}
              placeholder={field.placeholder || "Escribe tu NIT (sin guion) o el nombre de tu empresa"}
              value={getValueForField(field.name) || ""}
              onChange={(normalized) => {
                handleDynamicChange(field.name, normalized);
                const error = validateField(field, normalized);
                setFormErrors((prev) => ({ ...prev, [field.name]: error }));
              }}
              onSelectCompany={(company) => {
                handleDynamicChange(field.name, company.id);
                setFormErrors((prev) => ({ ...prev, [field.name]: null }));
                lookupCompanyByNit(company.id);
              }}
              onBlur={lookupCompanyByNit}
              loading={companyLookupLoading}
              required={field.required}
              error={fieldError}
            />
          );
        }

        if (field.name === "company_logo" || field.type === "file") {
          return (
            <Box key={field.name}>
              <FileInput
                label={field.label || "Logo de empresa"}
                description="Imagen del logo (PNG, JPG o WEBP)"
                placeholder="Toca para seleccionar una imagen"
                leftSection={<IconPhoto size={18} stroke={1.5} />}
                accept="image/png,image/jpeg,image/webp"
                value={companyLogoFile}
                onChange={(file) => {
                  setCompanyLogoFile(file);
                  setCompanyLogoPreview(
                    file ? URL.createObjectURL(file) : null,
                  );
                  setFormErrors((prev) => ({ ...prev, [field.name]: null }));
                }}
                clearable
                required={field.required ?? true}
                error={fieldError}
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

        if (field.type === "pdf") {
          const currentFile = pdfFiles[field.name] || null;
          const existingUrl = formValues[field.name];
          return (
            <Box key={field.name}>
              <FileInput
                label={field.label || "Documento PDF"}
                placeholder={field.placeholder || "Selecciona un PDF"}
                accept="application/pdf"
                value={currentFile}
                onChange={(file) => {
                  setPdfFiles((prev) => ({ ...prev, [field.name]: file }));
                  setFormErrors((prev) => ({ ...prev, [field.name]: null }));
                }}
                required={field.required ?? true}
                error={fieldError}
                radius="md"
              />
              {!currentFile && existingUrl && (
                <Text size="xs" c="dimmed" mt={4}>
                  Ya tienes un documento cargado.{" "}
                  <a href={existingUrl} target="_blank" rel="noreferrer">
                    Ver documento
                  </a>
                </Text>
              )}
            </Box>
          );
        }

        if (isPhoneField(field)) {
          const rawValue = getValueForField(field.name);
          const {
            iso2,
            dialCode,
            number: phoneNumber,
          } = parsePhoneValue(
            rawValue,
            phoneIsoByField[field.name] || defaultIso2,
          );

          return (
            <Box key={field.name}>
              <Text size="sm" fw={500} mb={4}>
                {field.label}
                {field.required && (
                  <Text component="span" c="red" ml={2}>
                    *
                  </Text>
                )}
              </Text>
              <Group gap={6} align="flex-start" wrap="nowrap">
                <Select
                  data={LANDING_COUNTRY_CODES}
                  value={iso2}
                  onChange={(newIso2) => {
                    if (!newIso2) return;
                    setPhoneIsoByField((prev) => ({
                      ...prev,
                      [field.name]: newIso2,
                    }));
                    const dc = getDialCodeForIso2(newIso2);
                    const combined = phoneNumber ? `${dc} ${phoneNumber}` : dc;
                    handleDynamicChange(field.name, combined);
                    const err = validateField(field, combined);
                    setFormErrors((prev) => ({ ...prev, [field.name]: err }));
                  }}
                  style={{ width: 104 }}
                  searchable
                  radius="md"
                  comboboxProps={{ width: 300 }}
                  allowDeselect={false}
                />
                <TextInput
                  placeholder={field.placeholder || "Número"}
                  value={phoneNumber}
                  onChange={(e) => {
                    const num = cleanLocalPhoneNumber(e.target.value, dialCode);
                    const combined = `${dialCode} ${num}`.trim(); // dialCode viene del parsePhoneValue
                    handleDynamicChange(field.name, combined);
                    const err = validateField(field, combined);
                    setFormErrors((prev) => ({
                      ...prev,
                      [field.name]: err,
                    }));
                  }}
                  required={field.required}
                  error={fieldError}
                  style={{ flex: 1 }}
                  radius="md"
                  rightSection={
                    field.name === primaryPhoneField?.name &&
                    phoneCheck.status === "checking" ? (
                      <Loader size="xs" />
                    ) : null
                  }
                />
              </Group>
              {field.name === primaryPhoneField?.name &&
                phoneCheck.status === "registered" && (
                  <Alert color="orange" radius="md" mt="xs" p="sm">
                    <Text size="sm">
                      Este número ya está registrado en el evento
                      {phoneCheck.nombreMask
                        ? ` a nombre de ${phoneCheck.nombreMask}`
                        : ""}
                      {phoneCheck.empresa ? ` (${phoneCheck.empresa})` : ""}
                      {phoneCheck.correoMask
                        ? `, con el correo ${phoneCheck.correoMask}`
                        : ""}
                      . No crees una cuenta nueva: ingresa con la que ya
                      tienes.
                    </Text>
                    <Button
                      size="xs"
                      radius="md"
                      mt="xs"
                      onClick={() => {
                        setLoginError("");
                        setActiveTab("login");
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Ingresar con esa cuenta
                    </Button>
                  </Alert>
                )}
              {field.name === primaryPhoneField?.name &&
                phoneCheck.status === "available" &&
                !currentUser?.data?.createdAt && (
                  <Text size="xs" c="teal.7" mt={4}>
                    Número disponible
                  </Text>
                )}
            </Box>
          );
        }

        if (field.name === "correo" || field.name === "email") {
          return (
            <TextInput
              key={field.name}
              label={field.label}
              placeholder={field.placeholder || field.label}
              value={getValueForField(field.name)}
              onChange={(e) => {
                // Normalizar a minúscula al tipear: evita duplicados por
                // "Juan@Gmail.com" vs "juan@gmail.com" y que el login por
                // correo (que sí compara en minúscula) no encuentre al usuario.
                const lower = e.target.value.toLowerCase();
                handleDynamicChange(field.name, lower);
                const error = validateField(field, lower);
                setFormErrors((prev) => ({ ...prev, [field.name]: error }));
              }}
              required={field.required}
              error={fieldError}
              radius="md"
              autoCapitalize="none"
            />
          );
        }

        if (field.type === "date") {
          return (
            <TextInput
              key={field.name}
              type="date"
              label={field.label}
              placeholder={field.placeholder || undefined}
              value={getValueForField(field.name) || ""}
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
        }

        // Campos de texto tipo "descripción" se muestran como área de texto
        // (2+ líneas visibles) para invitar a escribir más detalle
        const isLongText = /descrip/i.test(
          `${field.name} ${field.label || ""}`,
        );
        const TextComponent = isLongText ? Textarea : TextInput;

        return (
          <TextComponent
            key={field.name}
            {...(isLongText ? { autosize: true, minRows: 2, maxRows: 6 } : {})}
            label={field.label}
            placeholder={field.placeholder || field.label}
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
      eventId,
      primaryPhoneField,
      phoneCheck,
      currentUser?.data?.createdAt,
      companyLogoFile,
      companyLogoPreview,
      isFieldVisible,
      profilePicPreview,
      photoUploadStatus,
      photoUploadError,
      pdfFiles,
      formValues,
      defaultIso2,
      phoneIsoByField,
      event?.eventType,
      forcedRole,
    ],
  );

  const renderDynamicFormFields = useCallback(() => {
    if (!Array.isArray(event?.config?.formFields)) return null;
    return renderFieldsForNames(formFields.map((f) => f.name));
  }, [event?.config?.formFields, formFields, renderFieldsForNames]);

  const eventTheme = useMemo(
    () => buildEventTheme(event.config?.primaryColor),
    [event.config?.primaryColor],
  );

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
        : `linear-gradient(180deg, #ffffff 0%, #f8f9fa 100%)`,
      backgroundPosition: "center center",
      backgroundSize: "cover",
      backgroundRepeat: "no-repeat",
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "center",
      padding: isMobile ? 18 : 28,
    };
  }, [event.backgroundImage, event.backgroundMobileImage, isMobile]);

  if (userLoading)
    return <div className="splash-screen" role="img" aria-label="Magnetic" />;

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

  // Error general justo debajo del botón de registro
  const submitErrorAlert = submitError ? (
    <Alert color="red" variant="light" radius="md" mt="xs">
      {submitError}
    </Alert>
  ) : null;

  // ========= estilos reutilizables tabs =========
  // Color principal del evento (config.primaryColor vía eventTheme); el texto
  // usa el contraste de Mantine para que un color claro no quede con letra blanca.
  const tabBaseStyle = (active) => ({
    borderRadius: 14,
    height: 44,
    fontWeight: 800,
    letterSpacing: 0.2,
    border: active
      ? "1px solid var(--mantine-primary-color-filled)"
      : "1px solid rgba(0,0,0,0.12)",
    background: active
      ? "var(--mantine-primary-color-filled)"
      : "rgba(255,255,255,0.85)",
    color: active ? "var(--mantine-primary-color-contrast)" : "rgba(0,0,0,0.78)",
    boxShadow: active
      ? "0 12px 22px color-mix(in srgb, var(--mantine-primary-color-filled) 28%, transparent)"
      : "none",
  });

  // ========= bloques compartidos móvil / escritorio =========
  // Las dos disposiciones usan los mismos bloques; solo cambia el layout.
  const isUpdate = !!currentUser?.data;
  const registerBusy = saving || photoUploadStatus === "uploading";
  const welcomeVariant =
    forcedRole === "vendedor" || forcedRole === "comprador"
      ? forcedRole
      : "general";
  const sectionBg = "rgba(255,255,255,0.75)";

  const eventTitleBlock =
    event.config?.landingTitleType === "image" &&
    event.config?.landingTitleImage ? (
      <img
        src={event.config.landingTitleImage}
        alt={event.eventName || "Evento"}
        style={{
          maxWidth: "100%",
          maxHeight: isMobile ? 100 : 120,
          objectFit: "contain",
          marginBottom: 8,
        }}
      />
    ) : (
      <Stack gap={isMobile ? 8 : 10} align="center">
        <Title
          order={isMobile ? 2 : 1}
          style={{
            lineHeight: isMobile ? 1.1 : 1.08,
            fontSize: isMobile
              ? "clamp(1.5rem, 6vw, 2rem)"
              : "clamp(2rem, 3vw, 2.6rem)",
            fontWeight: 800,
            letterSpacing: isMobile ? "-0.01em" : "-0.02em",
            color: "var(--mantine-primary-color-9)",
            textShadow: "0 2px 18px rgba(255,255,255,0.6)",
          }}
        >
          {event.eventName || "Encuentro de afiliados"}
        </Title>
        <Box
          style={{
            width: isMobile ? 48 : 64,
            height: isMobile ? 4 : 5,
            borderRadius: 999,
            background:
              "linear-gradient(90deg, var(--mantine-primary-color-4), var(--mantine-primary-color-8))",
          }}
        />
      </Stack>
    );

  // Fechas del evento (multi-día o el formato antiguo de un solo día)
  const eventDatesBlock =
    event?.config?.eventDates && event.config.eventDates.length > 0 ? (
      <Stack gap="xs">
        <Text c="dimmed" size={isMobile ? "sm" : "md"} fw={700}>
          Fechas del evento:
        </Text>
        {event.config.eventDates.map((date, index) => {
          const dailyConfig = event.config.dailyConfig?.[date];
          return (
            <Paper key={index} withBorder p="xs" radius="md">
              <Stack gap={4}>
                <Text size="sm" fw={600}>
                  {formatDate(date)}
                </Text>
                {dailyConfig && (
                  <Group justify="center" gap="xs">
                    {dailyConfig.startTime && (
                      <Badge variant="light" size="sm" radius="md">
                        Inicio: {formatTime(dailyConfig.startTime)}
                      </Badge>
                    )}
                    {dailyConfig.endTime && (
                      <Badge variant="light" size="sm" radius="md">
                        Fin: {formatTime(dailyConfig.endTime)}
                      </Badge>
                    )}
                  </Group>
                )}
              </Stack>
            </Paper>
          );
        })}
      </Stack>
    ) : event?.config?.eventDate ? (
      <>
        <Text c="dimmed" size={isMobile ? "sm" : "md"}>
          <Text span fw={700} c="dark">
            Fecha del evento:
          </Text>{" "}
          {formatDate(event?.config?.eventDate)}
        </Text>
        <Group justify="center" gap={isMobile ? "xs" : "md"}>
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
      </>
    ) : null;

  const eventLocationBlock = event?.config?.eventLocation ? (
    <Paper
      withBorder
      radius="lg"
      p={isMobile ? "sm" : "md"}
      style={{
        background: "rgba(255,255,255,0.9)",
        borderColor: "rgba(0,0,0,0.08)",
      }}
    >
      <Stack gap={isMobile ? 8 : 10} align="center">
        <Group gap={isMobile ? 8 : 10} wrap="nowrap" justify="center">
          <ThemeIcon size={isMobile ? 26 : 32} radius="xl" variant="light">
            <IconMapPin size={isMobile ? 15 : 18} />
          </ThemeIcon>
          <Text size={isMobile ? "sm" : "md"} fw={700} ta="center">
            {event.config.eventLocation}
          </Text>
        </Group>
        {event?.config?.eventLocationMapUrl ? (
          <Button
            component="a"
            href={event.config.eventLocationMapUrl}
            target="_blank"
            rel="noopener noreferrer"
            size={isMobile ? "xs" : "sm"}
            radius="xl"
            rightSection={<IconArrowUpRight size={isMobile ? 14 : 16} />}
          >
            Cómo llegar
          </Button>
        ) : null}
      </Stack>
    </Paper>
  ) : null;

  const eventInfoBlock = (
    <Stack gap={isMobile ? 4 : 8} align="center" ta="center">
      {eventTitleBlock}
      {eventDatesBlock}
      {eventLocationBlock}
    </Stack>
  );

  const tabsList = (
    <Tabs.List grow style={{ gap: isMobile ? 12 : 8, marginBottom: 16 }}>
      <Tabs.Tab value="login" style={tabBaseStyle(activeTab === "login")}>
        INGRESAR
      </Tabs.Tab>
      <Tabs.Tab
        value="register"
        disabled={!registrationEnabled}
        style={{
          ...tabBaseStyle(activeTab === "register"),
          opacity: !registrationEnabled ? 0.5 : 1,
        }}
      >
        {isUpdate ? "ACTUALIZAR" : "REGISTRARSE"}
      </Tabs.Tab>
    </Tabs.List>
  );

  const loginPanel = (
    <Tabs.Panel value="login">
      <Box maw={520} mx="auto">
        <Stack gap="sm">
          <TextInput
            label="Correo, número de identidad o celular"
            placeholder="tu@empresa.com o 3001234567"
            value={loginIdentifier}
            onChange={(e) => setLoginIdentifier(e.target.value.toLowerCase())}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            required
            radius="md"
            size="md"
            autoCapitalize="none"
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
            fullWidth
          >
            INGRESAR
          </Button>
        </Stack>
      </Box>
    </Tabs.Panel>
  );

  // Casilla de consentimiento: etiqueta corta + texto legal debajo
  const consentBlock = (
    <Stack gap="sm" mt="sm">
      {consentimientos.map((consent) => (
        <Checkbox
          key={consent.name}
          label={consent.label}
          description={consent.text || undefined}
          checked={!!formValues[consent.name]}
          onChange={(e) => {
            const checked = e.currentTarget.checked;
            handleDynamicChange(consent.name, checked);
            setFormErrors((prev) => ({
              ...prev,
              [consent.name]: consent.required && !checked
                ? `Debes aceptar: ${consent.label}`
                : null,
            }));
          }}
          error={formErrors[consent.name] || undefined}
          required={consent.required}
          styles={{ label: { fontWeight: 600 } }}
        />
      ))}
    </Stack>
  );

  const currentStepFields = steps ? steps[activeStep]?.fields || [] : [];
  const previousStepErrors = steps
    ? Object.entries(formErrors).filter(
        ([k, msg]) =>
          msg &&
          !consentimientos.some((consent) => consent.name === k) &&
          !currentStepFields.includes(k),
      )
    : [];

  // Indicador de pasos: en celular, "Paso X de N" + barra (el Stepper
  // horizontal no cabe con los títulos)
  const stepIndicator = steps ? (
    isMobile ? (
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Text size="sm" fw={700} truncate>
            {steps[activeStep]?.title}
          </Text>
          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
            Paso {activeStep + 1} de {steps.length}
          </Text>
        </Group>
        <Progress
          value={((activeStep + 1) / steps.length) * 100}
          size="sm"
          radius="xl"
        />
      </Stack>
    ) : (
      <Stepper active={activeStep} onStepClick={setActiveStep} size="sm">
        {steps.map((s) => (
          <Stepper.Step key={s.id} label={s.title} />
        ))}
      </Stepper>
    )
  ) : null;

  const submitButton = (
    <Button
      radius="md"
      size="md"
      onClick={handleSubmit}
      loading={registerBusy}
      disabled={registerBusy}
      style={{ fontWeight: 800, height: 44 }}
    >
      {isUpdate ? "Guardar cambios" : "Registrarme"}
    </Button>
  );

  const registerForm = steps ? (
    <>
      <Paper
        radius="lg"
        withBorder
        p={isMobile ? "sm" : "md"}
        style={{ background: sectionBg }}
      >
        {stepIndicator}
      </Paper>

      <Paper radius="lg" withBorder p="md" style={{ background: sectionBg }}>
        <Stack>
          {renderFieldsForNames(currentStepFields)}

          {activeStep === steps.length - 1 && (
            <>
              {consentBlock}
              {previousStepErrors.length > 0 && (
                <Alert
                  color="red"
                  variant="light"
                  title="Faltan datos en pasos anteriores"
                  mt="md"
                  radius="md"
                >
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {previousStepErrors.map(([key, msg]) => (
                      <li key={key}>
                        <Text size="sm">
                          <strong>{fieldsByName.get(key)?.label || key}:</strong>{" "}
                          {msg}
                        </Text>
                      </li>
                    ))}
                  </ul>
                </Alert>
              )}
            </>
          )}
        </Stack>
      </Paper>

      <Group justify="space-between" grow={isMobile} mt="sm">
        <Button
          variant="default"
          radius="md"
          size="md"
          onClick={() => setActiveStep((s) => Math.max(0, s - 1))}
          disabled={activeStep === 0}
        >
          Atrás
        </Button>

        {activeStep < steps.length - 1 ? (
          <Button
            radius="md"
            size="md"
            onClick={() => {
              if (!validateStep(currentStepFields)) return;
              setActiveStep((s) => Math.min(steps.length - 1, s + 1));
            }}
          >
            Siguiente
          </Button>
        ) : (
          submitButton
        )}
      </Group>
    </>
  ) : (
    <>
      <Paper radius="lg" withBorder p="md" style={{ background: sectionBg }}>
        <Stack>
          {renderDynamicFormFields()}
          {consentBlock}
        </Stack>
      </Paper>

      <Group justify="flex-end" grow={isMobile} mt="sm">
        {submitButton}
      </Group>
    </>
  );

  const registerPanel = (
    <Tabs.Panel value="register">
      {!registrationEnabled ? (
        <Text ta="center" c="dimmed" mt="md">
          Los nuevos registros están inhabilitados para este evento.
        </Text>
      ) : (
        <Box maw={860} mx="auto">
          <Stack>
            <RegistrationWelcome
              config={event.config?.registrationWelcome}
              variant={welcomeVariant}
              isUpdate={isUpdate}
              compact={isMobile}
            />
            {registerForm}
            {submitErrorAlert}
          </Stack>
        </Box>
      )}
    </Tabs.Panel>
  );

  // Pie de la tarjeta: logos Magnetic + "Powered by GEN.iality", enlazado a la
  // página de GEN.iality (reemplaza el antiguo texto "Powered by Magnetic")
  const helperText = (
    <Box ta="center">
      <a
        href="https://geniality.com.co/"
        target="_blank"
        rel="noopener noreferrer"
        title="Ir a GEN.iality"
        style={{ display: "inline-block", maxWidth: isMobile ? 260 : 340 }}
      >
        <img
          src="/footer-magnetic-geniality.png"
          alt="Magnetic · Powered by GEN.iality"
          width={600}
          height={150}
          style={{ width: "100%", height: "auto", display: "block" }}
        />
      </a>
    </Box>
  );

  return (
    <MantineProvider theme={eventTheme} inherit>
      <Box style={bgStyle}>
        <Container size={isMobile ? "xs" : "lg"} px={0} w="100%">
          <Paper
            radius="xl"
            shadow="xl"
            withBorder
            style={{
              overflow: "hidden",
              background: "rgba(255, 255, 255, 0.82)",
              backdropFilter: "blur(10px)",
              borderColor: "rgba(255,255,255,0.55)",
            }}
          >
            <Box px={isMobile ? 18 : 28} py={isMobile ? 18 : 24}>
              <Tabs
                value={activeTab}
                onChange={setActiveTab}
                keepMounted={false}
                variant="unstyled"
              >
                {isMobile ? (
                  /* ================= MÓVIL ================= */
                  <Stack gap="md">
                    {event.eventImage ? (
                      <Paper
                        radius="xl"
                        withBorder
                        mb="sm"
                        style={{
                          overflow: "hidden",
                          background: "rgba(255,255,255,0.72)",
                          borderColor: "rgba(255,255,255,0.7)",
                        }}
                      >
                        <img
                          src={event.eventImage}
                          alt="Encuentro"
                          style={{
                            width: "100%",
                            objectFit: "cover",
                            borderRadius: 14,
                            display: "block",
                          }}
                        />
                      </Paper>
                    ) : null}

                    {eventInfoBlock}

                    <Box>
                      {tabsList}
                      {loginPanel}
                      {registerPanel}
                    </Box>

                    <Divider my={6} />
                    {helperText}
                  </Stack>
                ) : (
                  /* ================= ESCRITORIO ================= */
                  <Stack gap="lg">
                    {/* Fila 1: imagen + información del evento */}
                    <Box
                      style={{
                        display: "grid",
                        gridTemplateColumns: event.eventImage
                          ? "1.25fr 1fr"
                          : "1fr",
                        gap: 18,
                        alignItems: "stretch",
                      }}
                    >
                      {event.eventImage ? (
                        <Paper
                          radius="xl"
                          withBorder
                          style={{
                            overflow: "hidden",
                            background: "rgba(255,255,255,0.72)",
                            borderColor: "rgba(255,255,255,0.7)",
                            minHeight: 260,
                          }}
                        >
                          <img
                            src={event.eventImage}
                            alt="Encuentro"
                            style={{
                              width: "100%",
                              height: "100%",
                              display: "block",
                            }}
                          />
                        </Paper>
                      ) : null}

                      <Paper
                        radius="xl"
                        withBorder
                        p="lg"
                        style={{
                          background: sectionBg,
                          borderColor: "rgba(255,255,255,0.7)",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "center",
                          minHeight: 260,
                        }}
                      >
                        {eventInfoBlock}
                      </Paper>
                    </Box>

                    {/* Fila 2: ingresar / registrarse */}
                    <Paper
                      radius="xl"
                      withBorder
                      p="lg"
                      style={{
                        background: sectionBg,
                        borderColor: "rgba(255,255,255,0.7)",
                      }}
                    >
                      {tabsList}
                      {loginPanel}
                      {registerPanel}
                    </Paper>

                    <Divider my={2} />
                    {helperText}
                  </Stack>
                )}
              </Tabs>
            </Box>
          </Paper>
        </Container>
      </Box>
      <SupportButton eventName={event?.eventName} />
      <PhoneMatchPickerModal
        matches={phoneMatches}
        onPick={(m) => loginWithPhoneMatch(m.uid)}
        onClose={() => setPhoneMatches(null)}
      />
    </MantineProvider>
  );
};

export default Landing;

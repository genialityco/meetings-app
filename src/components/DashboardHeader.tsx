import { useState, useContext, useEffect, useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Group,
  Avatar,
  Image,
  Title,
  Text,
  Menu,
  Modal,
  Stack,
  TextInput,
  Textarea,
  Select,
  MultiSelect,
  Checkbox,
  FileInput,
  Button,
  Loader,
  Alert,
  Box,
  Paper,
  Stepper,
  Grid,
  Tooltip,
  ActionIcon,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconEdit, IconLogout, IconChevronDown, IconPackage, IconBuilding, IconQrcode, IconScan } from "@tabler/icons-react";
import { UserContext } from "../context/UserContext";
import { isComprador as isCompradorRole } from "../utils/attendeeRole";
import { withRoleLabel } from "../utils/attendeeFields";
import { resolveCheckInDay, isCheckedInOnDay, getEventDayKeys, formatDayLabel } from "../utils/eventDays";
import { parseStandVisitQrUrl } from "../utils/qrScan";
import QrScannerModal from "./QrScannerModal";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { storage, db } from "../firebase/firebaseConfig";
import { uploadCompanyLogo } from "../utils/companyStorage";
import { showNotification } from "@mantine/notifications";
import NotificationsMenu from "../pages/dashboard/NotificationsMenu";

interface DashboardHeaderProps {
  eventImage: string;
  dashboardLogo: string;
  eventName: string;
  notifications: any[];
  onNotificationClick?: (notif: any) => void;
  onMarkAllRead?: () => void;
  formFields: any[];
  eventConfig?: any;
  policies?: any;
}

const uploadProfilePicture = async (file: File, uid: string) => {
  const storageRef = ref(storage, `profilePictures/${uid}/${file.name}`);
  await uploadBytes(storageRef, file);
  return await getDownloadURL(storageRef);
};

const normalizeNit = (v = "") => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const CONSENTIMIENTO_FIELD_NAME = "aceptaTratamiento";

// Campos del registro que no deben poder editarse desde el perfil del asistente
// (bloqueados = ni se muestran). company_nit: cambiarlo movería al asistente a otra empresa.
// "correo"/"email" NO van aquí: se muestran de solo lectura en renderField (ver
// READONLY_EDIT_FIELDS) en vez de ocultarse del todo, para que el asistente pueda
// al menos verificar qué correo tiene registrado.
const HIDDEN_EDIT_FIELDS = new Set(["tipoAsistente", "company_nit"]);

// Campos que sí se muestran pero no se pueden modificar desde este modal: es el
// dato con el que el asistente ingresa al evento (cambiarlo aquí podría dejarlo
// sin poder volver a iniciar sesión).
const READONLY_EDIT_FIELDS = new Set(["correo", "email"]);

const isLogoField = (f: any) => f?.name === "company_logo" || f?.type === "file";

const DashboardHeader = ({
  eventImage,
  dashboardLogo,
  eventName,
  notifications,
  onNotificationClick,
  onMarkAllRead,
  formFields,
  eventConfig,
  policies,
}: DashboardHeaderProps) => {
  const { currentUser, updateUser, logout } = useContext(UserContext);
  const navigate = useNavigate();
  const { eventId } = useParams();
  const uid = currentUser?.uid;

  const sellerRedirect = policies?.sellerRedirectToProducts === true;
  const isComprador = sellerRedirect && isCompradorRole(currentUser?.data?.tipoAsistente);
  const qrOnlyMode = policies?.qrOnlyModeEnabled === true;
  const data = currentUser?.data || {};
  const isMobile = useMediaQuery("(max-width: 600px)");

  // Edit modal state
  const [editModalOpened, setEditModalOpened] = useState(false);
  const [editStep, setEditStep] = useState(0);
  const [editData, setEditData] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [profilePicPreview, setProfilePicPreview] = useState<string | null>(null);
  const [photoUploadStatus, setPhotoUploadStatus] = useState<
    "idle" | "ready" | "uploading" | "done" | "error"
  >("idle");
  const [photoUploadError, setPhotoUploadError] = useState("");

  // Logo de la empresa (vive en events/{eventId}/companies/{nit}, no en el usuario)
  const [companyLogoFile, setCompanyLogoFile] = useState<File | null>(null);
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
  const [companyLogoPreview, setCompanyLogoPreview] = useState<string | null>(null);

  // ?editProfile=1 abre este modal (p. ej. desde "Editar empresa" en Mi empresa o
  // desde la página pública de la propia empresa)
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("editProfile") === "1" && currentUser?.data) {
      setEditModalOpened(true);
      const next = new URLSearchParams(searchParams);
      next.delete("editProfile");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, currentUser?.data]);

  // Escáner in-app del QR fijo del stand (evita depender de la cámara nativa,
  // que puede abrir un navegador sin la sesión del asistente)
  const [standScannerOpened, setStandScannerOpened] = useState(false);

  const handleStandScan = useCallback(
    (text: string) => {
      const parsed = parseStandVisitQrUrl(text);
      if (!parsed) {
        showNotification({
          title: "Código no reconocido",
          message: "Este QR no es un código de visita a stand.",
          color: "red",
        });
        return;
      }
      if (eventId && parsed.eventId !== eventId) {
        showNotification({
          title: "Código de otro evento",
          message: "Este código de stand pertenece a otro evento.",
          color: "red",
        });
        return;
      }
      setStandScannerOpened(false);
      navigate(`/stand-visit/${parsed.eventId}/${parsed.companyNit}`);
    },
    [eventId, navigate],
  );

  // Check-in state

  // attendeeId: leer del contexto o directamente de Firestore si no está disponible
  const [attendeeIdLocal, setAttendeeIdLocal] = useState<string | null>(null);

  useEffect(() => {
    const fromContext = currentUser?.data?.attendeeId;
    if (fromContext) {
      setAttendeeIdLocal(fromContext);
      return;
    }
    // Si la política está activa y no hay ID en contexto, leer de Firestore
    if (uid && policies?.attendeeIdEnabled) {
      getDoc(doc(db, "users", uid)).then((snap) => {
        if (snap.exists()) {
          const id = snap.data()?.attendeeId;
          if (id) setAttendeeIdLocal(id);
        }
      }).catch(() => {});
    }
  }, [uid, currentUser?.data?.attendeeId, policies?.attendeeIdEnabled]);

  // Cargar los datos solo al ABRIR el modal: currentUser se actualiza en tiempo
  // real (onSnapshot) y re-sincronizar con el modal abierto borraría lo que el
  // asistente está escribiendo.
  useEffect(() => {
    if (editModalOpened && currentUser?.data) {
      setEditData({ ...currentUser.data });
      setProfilePicPreview(currentUser.data.photoURL || null);
      setPhotoUploadStatus(currentUser.data.photoURL ? "done" : "idle");
      setPhotoUploadError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editModalOpened]);

  // Cargar el logo actual de la empresa al abrir el modal
  useEffect(() => {
    if (!editModalOpened) return;
    setCompanyLogoFile(null);
    const evId = currentUser?.data?.eventId;
    const nit = currentUser?.data?.companyId;
    if (!evId || !nit) {
      setCompanyLogoUrl(null);
      setCompanyLogoPreview(null);
      return;
    }
    getDoc(doc(db, "events", evId, "companies", nit))
      .then((snap) => {
        const url = snap.exists() ? snap.data()?.logoUrl || null : null;
        setCompanyLogoUrl(url);
        setCompanyLogoPreview(url);
      })
      .catch(() => {});
  }, [editModalOpened, currentUser?.data?.eventId, currentUser?.data?.companyId]);

  const handleChange = useCallback((fieldName: string, value: any) => {
    if (fieldName.startsWith("contacto.")) {
      const key = fieldName.split(".")[1];
      setEditData((prev: any) => ({
        ...prev,
        contacto: { ...prev.contacto, [key]: value },
      }));
    } else {
      setEditData((prev: any) => ({ ...prev, [fieldName]: value }));
    }
  }, []);

  const getFieldValue = useCallback(
    (fieldName: string) => {
      if (fieldName.startsWith("contacto.")) {
        return editData.contacto?.[fieldName.split(".")[1]] || "";
      }
      // "company_nit" es solo el nombre del campo del formulario: el valor
      // persistido en el asistente vive en companyId.
      if (fieldName === "company_nit") {
        return editData.companyId ?? "";
      }
      return editData[fieldName] ?? "";
    },
    [editData],
  );

  // Conditional field visibility (showWhen support)
  const isFieldVisible = useCallback(
    (field: any) => {
      if (!field?.showWhen) return true;
      const parentValue = getFieldValue(field.showWhen.field);
      const allowed = field.showWhen.value || [];
      if (Array.isArray(parentValue)) {
        return parentValue.some((v: string) => allowed.includes(v));
      }
      return allowed.includes(parentValue);
    },
    [getFieldValue],
  );

  const handleSave = useCallback(async () => {
    if (!uid) return;
    setSaving(true);
    setPhotoUploadError("");

    try {
      const dataToUpdate: any = { ...editData };

      // Photo upload
      if (dataToUpdate._photoFile) {
        setPhotoUploadStatus("uploading");
        try {
          const photoURL = await uploadProfilePicture(dataToUpdate._photoFile, uid);
          dataToUpdate.photoURL = photoURL;
          delete dataToUpdate._photoFile;
          setPhotoUploadStatus("done");
        } catch (e) {
          setPhotoUploadStatus("error");
          setPhotoUploadError("No se pudo subir la foto. Intenta de nuevo.");
          throw e;
        }
      }

      // "company_nit" es solo el nombre del campo del formulario (paso de
      // empresa); el dato persistido en el asistente vive únicamente en companyId.
      // El campo NIT solo llega en dataToUpdate si el usuario lo editó; si no,
      // usamos el companyId ya existente para poder sincronizar el doc de la
      // empresa aunque solo se hayan cambiado otros campos (razón social, etc.).
      const nitNorm = normalizeNit(
        dataToUpdate.company_nit || dataToUpdate.companyId || currentUser?.data?.companyId
      );
      if (nitNorm) {
        dataToUpdate.companyId = nitNorm;
      }
      delete dataToUpdate.company_nit;
      // Compat: empresa = razon social
      if (dataToUpdate.company_razonSocial) {
        dataToUpdate.empresa = String(dataToUpdate.company_razonSocial).trim();
      }
      // Clean contacto if present
      if (dataToUpdate.contacto) delete dataToUpdate.contacto;

      // Check if networking fields were modified
      const steps = eventConfig?.registrationForm?.steps || [];
      const networkingStep = steps.find((s: any) => s.id === "networking");
      const networkingFields = networkingStep?.fields || [];
      
      let networkingFieldsModified = false;
      if (networkingFields.length > 0) {
        for (const fieldName of networkingFields) {
          const oldValue = currentUser?.data?.[fieldName];
          const newValue = dataToUpdate[fieldName];
          if (oldValue !== newValue) {
            networkingFieldsModified = true;
            console.log(`Networking field modified: ${fieldName}`);
            break;
          }
        }
      }

      dataToUpdate.updatedAt = new Date().toISOString();
      await updateUser(uid, dataToUpdate);

      // Sync company doc in events/{eventId}/companies/{nitNorm}
      // Include all fields from the company step dynamically
      const eventId = dataToUpdate.eventId || currentUser?.data?.eventId;
      if (eventId && nitNorm) {
        const companyStep = steps.find((s: any) =>
          (s.fields || []).includes("company_nit")
        );
        // Mismo criterio que el registro (Landing.jsx): sin paso de empresa se
        // sincronizan razón social y descripción.
        const companyFieldNames: string[] = companyStep?.fields || ["company_nit", "company_razonSocial", "descripcion"];

        const companyDoc: any = { nitNorm, updatedAt: new Date() };
        for (const fieldName of companyFieldNames) {
          if (fieldName === "company_nit") continue; // already as nitNorm
          if (fieldName === "company_logo") continue; // logo handled separately
          const val = dataToUpdate[fieldName];
          if (val !== undefined && val !== null) {
            // Map company_razonSocial -> razonSocial for the company doc
            if (fieldName === "company_razonSocial") {
              companyDoc.razonSocial = String(val).trim();
            } else {
              companyDoc[fieldName] = val;
            }
          }
        }

        if (companyLogoFile) {
          try {
            companyDoc.logoUrl = await uploadCompanyLogo(eventId, nitNorm, companyLogoFile);
          } catch (e) {
            console.error("Error subiendo logo de empresa:", e);
            showNotification({
              title: "Logo no actualizado",
              message: "No se pudo subir el logo de la empresa. El resto de tus datos sí se guardó.",
              color: "orange",
            });
          }
        }

        await setDoc(
          doc(db, "events", eventId, "companies", nitNorm),
          companyDoc,
          { merge: true }
        );
      }

      // Regenerate vector if networking fields were modified
      if (networkingFieldsModified && eventId) {
        console.log("Regenerating vector for user due to networking field changes");
        try {
          const response = await fetch(
            "https://regeneratevectorsforevent-6eaymlz5eq-uc.a.run.app",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                eventId,
                userId: uid,
              }),
            }
          );

          if (!response.ok) {
            console.error("Failed to regenerate vector:", await response.text());
          } else {
            console.log("Vector regenerated successfully");
          }
        } catch (vectorError) {
          console.error("Error calling regenerateVectorsForEvent:", vectorError);
          // No mostramos error al usuario, es un proceso en segundo plano
        }
      }

      showNotification({
        title: "Perfil actualizado",
        message: "Tus datos fueron guardados correctamente.",
        color: "teal",
      });
      setEditModalOpened(false);
    } catch (error) {
      console.error("Error al actualizar el perfil:", error);
      showNotification({
        title: "Error",
        message: "No se pudo guardar los cambios.",
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  }, [uid, editData, updateUser, currentUser, eventConfig, companyLogoFile]);


  const handleLogout = useCallback(() => {
    logout();
    if (data?.eventId) window.location.assign(`/event/${data.eventId}`);
  }, [logout, data?.eventId]);

  // Render a single form field based on its type
  const renderField = useCallback(
    (rawField: any) => {
      if (!rawField) return null;
      // Etiqueta según el rol del propio asistente (labelByRole)
      const field = withRoleLabel(rawField, data?.tipoAsistente);
      // Skip consent field in edit
      if (field.name === CONSENTIMIENTO_FIELD_NAME) return null;
      // Campos que el asistente no puede modificar (p. ej. tipo de asistente)
      if (HIDDEN_EDIT_FIELDS.has(field.name)) return null;

      // Correo: visible pero de solo lectura (es el dato de inicio de sesión)
      if (READONLY_EDIT_FIELDS.has(field.name)) {
        return (
          <TextInput
            key={field.name}
            label={field.label || "Correo"}
            value={getFieldValue(field.name)}
            disabled
            description="No se puede editar: es el correo con el que ingresas al evento."
          />
        );
      }

      // Photo
      if (field.name === "photoURL" || field.type === "photo") {
        return (
          <Box key={field.name}>
            <Group justify="center" mb="xs">
              <Avatar src={profilePicPreview || data.photoURL} size={100} radius="50%">
                {data?.nombre ? data.nombre[0] : "U"}
              </Avatar>
            </Group>
            <FileInput
              label={field.label || "Foto de perfil"}
              placeholder="Selecciona o toma una foto"
              accept="image/png,image/jpeg"
              value={null}
              onChange={(file: File | null) => {
                setPhotoUploadError("");
                handleChange("_photoFile", file);
                if (file) {
                  setProfilePicPreview(URL.createObjectURL(file));
                  setPhotoUploadStatus("ready");
                } else {
                  setProfilePicPreview(data.photoURL || null);
                  setPhotoUploadStatus(data.photoURL ? "done" : "idle");
                }
              }}
            />
            <Text size="xs" c="dimmed" mt={4}>
              {photoUploadStatus === "idle" && "Opcional."}
              {photoUploadStatus === "ready" && "Imagen lista para subir."}
              {photoUploadStatus === "uploading" && "Subiendo imagen..."}
              {photoUploadStatus === "done" && "Imagen cargada correctamente."}
              {photoUploadStatus === "error" && "No se pudo subir la imagen."}
            </Text>
            {photoUploadError && (
              <Alert color="red" variant="light" mt="xs">{photoUploadError}</Alert>
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
            value={getFieldValue(field.name)}
            onChange={(value) => handleChange(field.name, value)}
            searchable
          />
        );
      }

      // MultiSelect
      if (field.type === "multiselect") {
        return (
          <MultiSelect
            key={field.name}
            label={field.label}
            placeholder="Selecciona una o más opciones"
            data={field.options || []}
            value={Array.isArray(getFieldValue(field.name)) ? getFieldValue(field.name) : []}
            onChange={(value) => handleChange(field.name, value)}
            searchable
            clearable
          />
        );
      }

      // Días de asistencia (opciones dinámicas = días configurados del evento)
      if (field.type === "eventDays") {
        const dayKeys = getEventDayKeys(eventConfig);
        const dayOptions = dayKeys.map((day: string, idx: number) => ({
          value: day,
          label: formatDayLabel(day, idx),
        }));
        if (dayOptions.length === 0) return null;
        return (
          <MultiSelect
            key={field.name}
            label={field.label}
            placeholder="Selecciona los días a los que asistirás"
            data={dayOptions}
            value={Array.isArray(getFieldValue(field.name)) ? getFieldValue(field.name) : []}
            onChange={(value) => handleChange(field.name, value)}
            clearable
          />
        );
      }

      // Checkbox
      if (field.type === "checkbox") {
        return (
          <Checkbox
            key={field.name}
            label={field.label}
            checked={!!getFieldValue(field.name)}
            onChange={(e) => handleChange(field.name, e.currentTarget.checked)}
          />
        );
      }

      // Textarea
      if (field.type === "textarea" || field.type === "richtext" || field.name === "descripcion") {
        return (
          <Textarea
            key={field.name}
            label={field.label}
            value={getFieldValue(field.name)}
            onChange={(e) => handleChange(field.name, e.target.value)}
            minRows={3}
          />
        );
      }

      // Logo de la empresa
      if (isLogoField(field)) {
        return (
          <Box key={field.name}>
            <FileInput
              label={field.label || "Logo de empresa"}
              placeholder={companyLogoPreview ? "Cambiar logo" : "Subir logo"}
              accept="image/png,image/jpeg,image/webp"
              value={companyLogoFile}
              clearable
              onChange={(file: File | null) => {
                setCompanyLogoFile(file);
                setCompanyLogoPreview(file ? URL.createObjectURL(file) : companyLogoUrl);
              }}
            />
            {companyLogoPreview && (
              <Image
                src={companyLogoPreview}
                alt="Logo de la empresa"
                w={110}
                h={110}
                fit="contain"
                radius="md"
                mt={8}
                p={6}
                style={{ border: "1px solid var(--mantine-color-gray-3)" }}
              />
            )}
          </Box>
        );
      }

      // company_nit — normalize on change
      if (field.name === "company_nit") {
        return (
          <TextInput
            key={field.name}
            label={field.label}
            value={getFieldValue(field.name)}
            onChange={(e) => handleChange(field.name, normalizeNit(e.target.value))}
          />
        );
      }

      // Default: text
      return (
        <TextInput
          key={field.name}
          label={field.label}
          placeholder={field.label}
          value={getFieldValue(field.name)}
          onChange={(e) => handleChange(field.name, e.target.value)}
        />
      );
    },
    [getFieldValue, handleChange, profilePicPreview, photoUploadStatus, photoUploadError, data, companyLogoFile, companyLogoPreview, companyLogoUrl],
  );

  const checkedIn = isCheckedInOnDay(currentUser?.data, resolveCheckInDay(eventConfig));
  const avatarSrc = data?.photoURL || null;
  const userName = data?.nombre || data?.name || "U";
  const attendeeId = attendeeIdLocal || data?.attendeeId || null;
  const showAttendeeId = policies?.attendeeIdEnabled === true && !!attendeeId;

  return (
    <>
      <Group
        justify="space-between"
        align="center"
        wrap="nowrap"
        gap={isMobile ? 6 : "md"}
        py="sm"
        px={isMobile ? "xs" : "md"}
        style={{
          borderBottom: "1px solid var(--mantine-color-gray-3)",
          position: "sticky",
          top: 0,
          zIndex: 100,
          background: "var(--mantine-color-body)",
        }}
      >
        {/* Izquierda: Logo + Nombre del evento */}
        <Group gap="sm" align="center" wrap="nowrap" style={{ minWidth: 0, flex: isMobile ? "1 1 0" : undefined }}>
          {(dashboardLogo || eventImage) ? (
            <Image
              src={dashboardLogo || eventImage}
              alt={eventName}
              h={isMobile ? 30 : 45}
              w="auto"
              maw="100%"
              fit="contain"
            />
          ) : null}
          {!isMobile && !(dashboardLogo || eventImage) && (
            <Title order={5} lineClamp={1}>
              {eventName || "Dashboard"}
            </Title>
          )}
        </Group>

        {/* Centro: Identificador de asistente */}
        {showAttendeeId && (
          <Box
            style={
              isMobile
                ? { flexShrink: 0, pointerEvents: "none" }
                : { position: "absolute", left: "50%", transform: "translateX(-50%)", pointerEvents: "none" }
            }
          >
            <Text
              fw={900}
              style={{
                fontSize: isMobile ? 20 : 38,
                lineHeight: 1,
                letterSpacing: 2,
                color: "var(--mantine-color-blue-7)",
                userSelect: "none",
              }}
            >
              {attendeeId}
            </Text>
          </Box>
        )}

        {/* Derecha: Notificaciones + Check-in + Avatar con Menu */}
        <Group gap={isMobile ? 4 : "sm"} align="center" wrap="nowrap" style={{ flexShrink: 0 }}>
          {!qrOnlyMode && policies?.standVisitsEnabled === true && (
            isMobile ? (
              <Tooltip label="Escanear stand" withArrow>
                <ActionIcon
                  variant="light"
                  color="grape"
                  size={34}
                  radius="xl"
                  onClick={() => setStandScannerOpened(true)}
                  aria-label="Escanear stand"
                >
                  <IconScan size={20} />
                </ActionIcon>
              </Tooltip>
            ) : (
              <Button
                variant="light"
                color="grape"
                radius="xl"
                leftSection={<IconScan size={18} />}
                onClick={() => setStandScannerOpened(true)}
              >
                Escanear stand
              </Button>
            )
          )}

          {eventId && uid && (
            <Tooltip label="Mi código QR" withArrow>
              <ActionIcon
                variant="default"
                size={isMobile ? 34 : 42}
                radius="xl"
                onClick={() => window.open(`/badge/${eventId}/${uid}`, "_blank")}
                aria-label="Mi código QR"
              >
                <IconQrcode size={20} />
              </ActionIcon>
            </Tooltip>
          )}

          <NotificationsMenu
            notifications={notifications}
            onNotificationClick={onNotificationClick}
            onMarkAllRead={onMarkAllRead}
          />

          <Menu position="bottom-end" width={200} shadow="md">
            <Menu.Target>
              <Group gap={isMobile ? 4 : 6} wrap="nowrap" style={{ cursor: "pointer" }}>
                <Avatar src={avatarSrc} size={isMobile ? 32 : 36} radius="xl">
                  {String(userName).slice(0, 1).toUpperCase()}
                </Avatar>
                <Stack gap={0}>
                  {!isMobile && (
                    <Text size="sm" fw={500} lineClamp={1} maw={150}>
                      {userName}
                    </Text>
                  )}
                  {/* Estado de check-in del día: verde = con check-in, naranja = sin check-in */}
                  <Group gap={isMobile ? 3 : 5} wrap="nowrap" aria-label={checkedIn ? "Con check-in" : "Sin check-in"}>
                    <Box
                      style={{
                        width: isMobile ? 6 : 8,
                        height: isMobile ? 6 : 8,
                        borderRadius: 999,
                        flexShrink: 0,
                        background: checkedIn ? "#37b24d" : "#fd7e14",
                      }}
                    />
                    <Text fz={isMobile ? 10 : "xs"} c={checkedIn ? "green.8" : "orange.8"} fw={500} style={{ whiteSpace: "nowrap" }}>
                      {checkedIn ? "Con check-in" : "Sin check-in"}
                    </Text>
                  </Group>
                </Stack>
                {!isMobile && <IconChevronDown size={14} />}
              </Group>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconEdit size={16} />}
                onClick={() => setEditModalOpened(true)}
              >
                Editar perfil
              </Menu.Item>
              {!qrOnlyMode && eventId && !isComprador && (
                <Menu.Item
                  leftSection={<IconPackage size={16} />}
                  onClick={() => navigate(`/dashboard/${eventId}/my-products`)}
                >
                  Mis productos
                </Menu.Item>
              )}
              {!qrOnlyMode && eventId && (
                <Menu.Item
                  leftSection={<IconBuilding size={16} />}
                  onClick={() => navigate(`/dashboard/${eventId}/my-company`)}
                >
                  Mi empresa
                </Menu.Item>
              )}
              {eventId && currentUser?.uid && (
                <Menu.Item
                  leftSection={<IconQrcode size={16} />}
                  onClick={() => window.open(`/badge/${eventId}/${currentUser.uid}`, "_blank")}
                >
                  Ver mi código QR
                </Menu.Item>
              )}
              <Menu.Divider />
              <Menu.Item
                color="red"
                leftSection={<IconLogout size={16} />}
                onClick={handleLogout}
              >
                Cerrar sesión
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      {/* Modal de edición con formFields dinámicos */}
      <Modal
        opened={editModalOpened}
        onClose={() => { setEditModalOpened(false); setEditStep(0); }}
        title={
          <Group gap="xs">
            <IconEdit size={20} />
            <Text fw={600}>Editar Perfil</Text>
          </Group>
        }
        size="lg"
        centered
      >
        <Stack gap="md">
          {formFields.length > 0
            ? (() => {
                // Mismo modo que el formulario de registro: "stepper" (paso a paso) o plano
                const regForm = eventConfig?.registrationForm;
                const steps: any[] = regForm?.steps || [];
                const isStepper = regForm?.mode === "stepper" && steps.length > 0;

                const companyStep = steps.find((s: any) =>
                  (s.fields || []).includes("company_nit")
                );
                const companyFieldNames: Set<string> = new Set(
                  companyStep?.fields || ["company_nit", "company_razonSocial", "company_logo", "empresa"]
                );

                const editableFields = formFields.filter(
                  (f: any) =>
                    f.name !== CONSENTIMIENTO_FIELD_NAME && !HIDDEN_EDIT_FIELDS.has(f.name)
                );
                const hasCompanyFields = editableFields.some(
                  (f: any) => companyFieldNames.has(f.name) && isFieldVisible(f)
                );
                const companyNote = hasCompanyFields ? (
                  <Text size="xs" c="dimmed" mt="xs">
                    Al guardar, la información de la empresa se actualiza para todos los representantes.
                  </Text>
                ) : null;

                const renderGrid = (fields: any[]) => {
                  const visible = fields.filter(isFieldVisible);
                  if (visible.length === 0) return null;
                  return (
                    <Grid gutter="sm">
                      {visible.map((field: any) => (
                        <Grid.Col
                          key={field.name}
                          span={
                            field.type === "textarea" ||
                            field.type === "richtext" ||
                            field.type === "photo" ||
                            field.name === "photoURL" ||
                            field.name === "descripcion" ||
                            isLogoField(field) ||
                            field.type === "multiselect" ||
                            field.type === "eventDays"
                              ? 12
                              : 6
                          }
                        >
                          {renderField(field)}
                        </Grid.Col>
                      ))}
                    </Grid>
                  );
                };

                if (!isStepper) {
                  // Formulario plano: respeta el orden configurado de los campos
                  return (
                    <Paper withBorder radius="md" p="md">
                      {renderGrid(editableFields)}
                      {companyNote}
                    </Paper>
                  );
                }

                // Paso a paso: un paso por cada step configurado; los campos que no
                // pertenecen a ningún paso van al último para no perderlos.
                const assigned = new Set(steps.flatMap((st: any) => st.fields || []));
                const stepGroups = steps.map((st: any, i: number) => {
                  const names: string[] = st.fields || [];
                  let fields = names
                    .map((n) => editableFields.find((f: any) => f.name === n))
                    .filter(Boolean) as any[];
                  if (i === steps.length - 1) {
                    fields = fields.concat(editableFields.filter((f: any) => !assigned.has(f.name)));
                  }
                  return { id: st.id ?? i, title: st.title || `Paso ${i + 1}`, fields };
                }).filter((g: any) => g.fields.some(isFieldVisible));

                if (stepGroups.length === 0) return null;
                const current = Math.min(editStep, stepGroups.length - 1);
                const isLast = current === stepGroups.length - 1;

                return (
                  <>
                    <Stepper active={current} onStepClick={setEditStep} size="sm" allowNextStepsSelect>
                      {stepGroups.map((g: any) => (
                        <Stepper.Step key={g.id} label={g.title} />
                      ))}
                    </Stepper>
                    <Paper withBorder radius="md" p="md">
                      {renderGrid(stepGroups[current].fields)}
                      {stepGroups[current].fields.some((f: any) => companyFieldNames.has(f.name)) && companyNote}
                    </Paper>
                    <Group justify="space-between">
                      <Button
                        variant="default"
                        disabled={current === 0}
                        onClick={() => setEditStep(current - 1)}
                      >
                        Anterior
                      </Button>
                      {!isLast && (
                        <Button onClick={() => setEditStep(current + 1)}>Siguiente</Button>
                      )}
                    </Group>
                  </>
                );
              })()
            : (
              <Paper withBorder radius="md" p="md">
                <Grid gutter="sm">
                  <Grid.Col span={12}>
                    <TextInput
                      label="Nombre"
                      value={editData.nombre || ""}
                      onChange={(e) => handleChange("nombre", e.target.value)}
                    />
                  </Grid.Col>
                  <Grid.Col span={12}>
                    <TextInput
                      label="Teléfono"
                      value={editData.telefono || ""}
                      onChange={(e) => handleChange("telefono", e.target.value)}
                    />
                  </Grid.Col>
                </Grid>
              </Paper>
            )}

          <Button
            onClick={handleSave}
            loading={saving || photoUploadStatus === "uploading"}
            fullWidth
            size="md"
          >
            Guardar cambios
          </Button>
        </Stack>
      </Modal>

      <QrScannerModal
        opened={standScannerOpened}
        onClose={() => setStandScannerOpened(false)}
        onDecode={handleStandScan}
        title="Escanear código del stand"
        hint="Apunta la cámara al código QR del stand para registrar tu visita."
      />
    </>
  );
};

export default DashboardHeader;

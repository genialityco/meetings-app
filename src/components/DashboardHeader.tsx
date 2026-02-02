import { useState, useContext, useEffect, useCallback } from "react";
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
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconEdit, IconLogout, IconChevronDown } from "@tabler/icons-react";
import { UserContext } from "../context/UserContext";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../firebase/firebaseConfig";
import NotificationsMenu from "../pages/dashboard/NotificationsMenu";

interface DashboardHeaderProps {
  eventImage: string;
  dashboardLogo: string;
  eventName: string;
  notifications: any[];
  formFields: any[];
}

const uploadProfilePicture = async (file: File, uid: string) => {
  const storageRef = ref(storage, `profilePictures/${uid}/${file.name}`);
  await uploadBytes(storageRef, file);
  return await getDownloadURL(storageRef);
};

const normalizeNit = (v = "") => String(v || "").replace(/\D/g, "");

const CONSENTIMIENTO_FIELD_NAME = "aceptaTratamiento";

const DashboardHeader = ({
  eventImage,
  dashboardLogo,
  eventName,
  notifications,
  formFields,
}: DashboardHeaderProps) => {
  const { currentUser, updateUser, logout } = useContext(UserContext);
  const uid = currentUser?.uid;
  const data = currentUser?.data || {};
  const isMobile = useMediaQuery("(max-width: 600px)");

  // Edit modal state
  const [editModalOpened, setEditModalOpened] = useState(false);
  const [editData, setEditData] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [profilePicPreview, setProfilePicPreview] = useState<string | null>(null);
  const [photoUploadStatus, setPhotoUploadStatus] = useState<
    "idle" | "ready" | "uploading" | "done" | "error"
  >("idle");
  const [photoUploadError, setPhotoUploadError] = useState("");

  // Sync edit data when modal opens
  useEffect(() => {
    if (editModalOpened && currentUser?.data) {
      setEditData({ ...currentUser.data });
      setProfilePicPreview(currentUser.data.photoURL || null);
      setPhotoUploadStatus(currentUser.data.photoURL ? "done" : "idle");
      setPhotoUploadError("");
    }
  }, [editModalOpened, currentUser]);

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
      return editData[fieldName] ?? "";
    },
    [editData],
  );

  const handleSave = useCallback(async () => {
    if (!uid) return;
    setSaving(true);
    setPhotoUploadError("");

    try {
      const dataToUpdate: any = { ...editData };

      // Photo upload
      if (dataToUpdate._photoFile) {
        try {
          setPhotoUploadStatus("uploading");
          const photoURL = await uploadProfilePicture(dataToUpdate._photoFile, uid);
          dataToUpdate.photoURL = photoURL;
          delete dataToUpdate._photoFile;
          setPhotoUploadStatus("done");
        } catch (e) {
          console.error("Error subiendo imagen:", e);
          setPhotoUploadStatus("error");
          setPhotoUploadError("No se pudo subir la foto. Intenta de nuevo.");
          delete dataToUpdate._photoFile;
        }
      }

      // Normalize NIT
      if (dataToUpdate.company_nit) {
        dataToUpdate.company_nit = normalizeNit(dataToUpdate.company_nit);
      }
      // Compat: empresa = razon social
      if (dataToUpdate.company_razonSocial) {
        dataToUpdate.empresa = String(dataToUpdate.company_razonSocial).trim();
      }
      // Clean contacto if present
      if (dataToUpdate.contacto) delete dataToUpdate.contacto;

      dataToUpdate.updatedAt = new Date().toISOString();
      await updateUser(uid, dataToUpdate);
      setEditModalOpened(false);
    } catch (error) {
      console.error("Error al actualizar el perfil:", error);
    } finally {
      setSaving(false);
    }
  }, [uid, editData, updateUser]);

  const handleLogout = useCallback(() => {
    logout();
    if (data?.eventId) window.location.assign(`/event/${data.eventId}`);
  }, [logout, data?.eventId]);

  // Render a single form field based on its type
  const renderField = useCallback(
    (field: any) => {
      if (!field) return null;
      // Skip consent field in edit
      if (field.name === CONSENTIMIENTO_FIELD_NAME) return null;

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
            value={getFieldValue(field.name) || []}
            onChange={(value) => handleChange(field.name, value)}
            searchable
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

      // company_logo / file type — skip in edit modal (logo se edita en registro)
      if (field.name === "company_logo" || field.type === "file") {
        return null;
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
    [getFieldValue, handleChange, profilePicPreview, photoUploadStatus, photoUploadError, data],
  );

  const avatarSrc = data?.photoURL || null;
  const userName = data?.nombre || data?.name || "U";

  return (
    <>
      <Group
        justify="space-between"
        align="center"
        py="sm"
        px="md"
        style={{
          borderBottom: "1px solid var(--mantine-color-gray-3)",
          position: "sticky",
          top: 0,
          zIndex: 100,
          background: "var(--mantine-color-body)",
        }}
      >
        {/* Izquierda: Logo + Nombre del evento */}
        <Group gap="sm" align="center">
          {(dashboardLogo || eventImage) ? (
            <Image
              src={dashboardLogo || eventImage}
              alt={eventName}
              h={50}
              w="auto"
              fit="contain"
            />
          ) : null}
          {!isMobile && (
            <Title order={5} lineClamp={1}>
              {eventName || "Dashboard"}
            </Title>
          )}
        </Group>

        {/* Derecha: Notificaciones + Avatar con Menu */}
        <Group gap="sm" align="center">
          <NotificationsMenu notifications={notifications} />

          <Menu position="bottom-end" width={200} shadow="md">
            <Menu.Target>
              <Group gap={6} style={{ cursor: "pointer" }}>
                <Avatar src={avatarSrc} size={36} radius="xl">
                  {String(userName).slice(0, 1).toUpperCase()}
                </Avatar>
                {!isMobile && (
                  <Text size="sm" fw={500} lineClamp={1} maw={150}>
                    {userName}
                  </Text>
                )}
                <IconChevronDown size={14} />
              </Group>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconEdit size={16} />}
                onClick={() => setEditModalOpened(true)}
              >
                Editar perfil
              </Menu.Item>
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
        onClose={() => setEditModalOpened(false)}
        title="Editar Perfil"
        size="lg"
        centered
      >
        <Stack>
          {formFields.length > 0
            ? formFields.map((field: any) => renderField(field))
            : (
              <>
                <TextInput
                  label="Nombre"
                  value={editData.nombre || ""}
                  onChange={(e) => handleChange("nombre", e.target.value)}
                />
                <TextInput
                  label="Correo"
                  value={editData.correo || ""}
                  onChange={(e) => handleChange("correo", e.target.value)}
                />
                <TextInput
                  label="Teléfono"
                  value={editData.telefono || ""}
                  onChange={(e) => handleChange("telefono", e.target.value)}
                />
              </>
            )}

          <Button
            onClick={handleSave}
            loading={saving || photoUploadStatus === "uploading"}
          >
            Guardar cambios
          </Button>
        </Stack>
      </Modal>
    </>
  );
};

export default DashboardHeader;

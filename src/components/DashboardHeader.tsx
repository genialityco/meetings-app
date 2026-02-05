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
  Paper,
  Divider,
  Grid,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconEdit, IconLogout, IconChevronDown } from "@tabler/icons-react";
import { UserContext } from "../context/UserContext";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { doc, setDoc } from "firebase/firestore";
import { storage, db } from "../firebase/firebaseConfig";
import { showNotification } from "@mantine/notifications";
import NotificationsMenu from "../pages/dashboard/NotificationsMenu";

interface DashboardHeaderProps {
  eventImage: string;
  dashboardLogo: string;
  eventName: string;
  notifications: any[];
  formFields: any[];
  eventConfig?: any;
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
  eventConfig,
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

      // Normalize NIT and sync companyId
      const nitNorm = normalizeNit(dataToUpdate.company_nit);
      if (nitNorm) {
        dataToUpdate.company_nit = nitNorm;
        dataToUpdate.companyId = nitNorm;
      }
      // Compat: empresa = razon social
      if (dataToUpdate.company_razonSocial) {
        dataToUpdate.empresa = String(dataToUpdate.company_razonSocial).trim();
      }
      // Clean contacto if present
      if (dataToUpdate.contacto) delete dataToUpdate.contacto;

      dataToUpdate.updatedAt = new Date().toISOString();
      await updateUser(uid, dataToUpdate);

      // Sync company doc in events/{eventId}/companies/{nitNorm}
      // Include all fields from the company step dynamically
      const eventId = dataToUpdate.eventId || currentUser?.data?.eventId;
      if (eventId && nitNorm) {
        const steps = eventConfig?.registrationForm?.steps || [];
        const companyStep = steps.find((s: any) =>
          (s.fields || []).includes("company_nit")
        );
        const companyFieldNames: string[] = companyStep?.fields || ["company_nit", "company_razonSocial"];

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

        await setDoc(
          doc(db, "events", eventId, "companies", nitNorm),
          companyDoc,
          { merge: true }
        );
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
                // Separar campo de foto
                const photoFields = formFields.filter(
                  (f: any) => f.name === "photoURL" || f.type === "photo"
                );

                // Detectar campos de empresa dinámicamente desde los steps del registrationForm
                const steps = eventConfig?.registrationForm?.steps || [];
                const companyStep = steps.find((s: any) =>
                  (s.fields || []).includes("company_nit")
                );
                const companyFieldNames: Set<string> = new Set(
                  companyStep?.fields || ["company_nit", "company_razonSocial", "company_logo", "empresa"]
                );
                const companyStepTitle = companyStep?.title || "Datos de empresa";

                const companyFields = formFields.filter(
                  (f: any) => companyFieldNames.has(f.name) && !photoFields.includes(f)
                );

                // El resto son campos personales/networking (agrupados por step si hay steps)
                const nonPhotoNonCompanyFields = formFields.filter(
                  (f: any) =>
                    !photoFields.includes(f) &&
                    !companyFields.includes(f) &&
                    f.name !== CONSENTIMIENTO_FIELD_NAME
                );

                // Agrupar campos restantes por step
                const otherSteps = steps.filter(
                  (s: any) => s !== companyStep
                );
                const fieldsByStep: { title: string; fields: any[] }[] = [];

                if (otherSteps.length > 0) {
                  for (const step of otherSteps) {
                    const stepFieldNames = new Set(step.fields || []);
                    const stepFields = nonPhotoNonCompanyFields.filter(
                      (f: any) => stepFieldNames.has(f.name)
                    );
                    if (stepFields.length > 0) {
                      fieldsByStep.push({ title: step.title || "Otros datos", fields: stepFields });
                    }
                  }
                  // Campos no asignados a ningún step
                  const allAssigned = new Set(fieldsByStep.flatMap((g) => g.fields.map((f: any) => f.name)));
                  const unassigned = nonPhotoNonCompanyFields.filter((f: any) => !allAssigned.has(f.name));
                  if (unassigned.length > 0) {
                    fieldsByStep.push({ title: "Otros datos", fields: unassigned });
                  }
                } else {
                  // Sin steps, todo en una sección
                  if (nonPhotoNonCompanyFields.length > 0) {
                    fieldsByStep.push({ title: "Datos personales", fields: nonPhotoNonCompanyFields });
                  }
                }

                return (
                  <>
                    {/* Foto */}
                    {photoFields.filter(isFieldVisible).length > 0 && (
                      <Paper withBorder radius="md" p="md">
                        {photoFields.filter(isFieldVisible).map((field: any) => renderField(field))}
                      </Paper>
                    )}

                    {/* Secciones por step */}
                    {fieldsByStep.map((group) => {
                      const visibleFields = group.fields.filter(isFieldVisible);
                      if (visibleFields.length === 0) return null;
                      return (
                        <Paper key={group.title} withBorder radius="md" p="md">
                          <Divider
                            label={<Text fw={600} size="sm">{group.title}</Text>}
                            labelPosition="left"
                            mb="sm"
                          />
                          <Grid gutter="sm">
                            {visibleFields.map((field: any) => (
                              <Grid.Col
                                key={field.name}
                                span={
                                  field.type === "textarea" ||
                                  field.type === "richtext" ||
                                  field.name === "descripcion" ||
                                  field.type === "multiselect"
                                    ? 12
                                    : 6
                                }
                              >
                                {renderField(field)}
                              </Grid.Col>
                            ))}
                          </Grid>
                        </Paper>
                      );
                    })}

                    {/* Datos de empresa */}
                    {(() => {
                      const visibleCompanyFields = companyFields.filter(isFieldVisible);
                      if (visibleCompanyFields.length === 0) return null;
                      return (
                        <Paper withBorder radius="md" p="md">
                          <Divider
                            label={<Text fw={600} size="sm">{companyStepTitle}</Text>}
                            labelPosition="left"
                            mb="sm"
                          />
                          <Grid gutter="sm">
                            {visibleCompanyFields.map((field: any) => (
                              <Grid.Col
                                key={field.name}
                                span={
                                  field.type === "textarea" ||
                                  field.type === "richtext" ||
                                  field.type === "multiselect"
                                    ? 12
                                    : 6
                                }
                              >
                                {renderField(field)}
                              </Grid.Col>
                            ))}
                          </Grid>
                          <Text size="xs" c="dimmed" mt="xs">
                            Al guardar, la información de la empresa se actualiza para todos los representantes.
                          </Text>
                        </Paper>
                      );
                    })()}
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
                  <Grid.Col span={6}>
                    <TextInput
                      label="Correo"
                      value={editData.correo || ""}
                      onChange={(e) => handleChange("correo", e.target.value)}
                    />
                  </Grid.Col>
                  <Grid.Col span={6}>
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
    </>
  );
};

export default DashboardHeader;

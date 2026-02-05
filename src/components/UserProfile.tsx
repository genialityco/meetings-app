import { useState, useContext, useEffect } from "react";
import {
  Card,
  Title,
  Text,
  Button,
  Modal,
  Stack,
  TextInput,
  Textarea,
  Divider,
  Group,
  Loader,
  SimpleGrid,
  Collapse,
  UnstyledButton,
  FileInput,
  Avatar,
  Alert,
} from "@mantine/core";
import { FaChevronDown, FaChevronUp } from "react-icons/fa";
import { UserContext } from "../context/UserContext";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../firebase/firebaseConfig";

const normalizeNit = (v = "") => String(v || "").replace(/\D/g, "");

// --- Subir imagen a Firebase Storage ---
const uploadProfilePicture = async (file: File, uid: string) => {
  const storageRef = ref(storage, `profilePictures/${uid}/${file.name}`);
  await uploadBytes(storageRef, file);
  const photoURL = await getDownloadURL(storageRef);
  return photoURL;
};

const UserProfile = () => {
  const { currentUser, updateUser, logout, userLoading } =
    useContext(UserContext);
  const uid = currentUser?.uid;

  const [editModalOpened, setEditModalOpened] = useState(false);
  const [editProfileData, setEditProfileData] = useState<any>({});
  const [openedCollapse, setOpenedCollapse] = useState(false);
  const [profilePicPreview, setProfilePicPreview] = useState<string | null>(
    null
  );

  // estados de foto
  const [photoUploadStatus, setPhotoUploadStatus] = useState<
    "idle" | "ready" | "uploading" | "done" | "error"
  >("idle");
  const [photoUploadError, setPhotoUploadError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!currentUser?.data) return;

    setEditProfileData(currentUser.data);

    if (currentUser.data.photoURL) {
      setProfilePicPreview(currentUser.data.photoURL);
      setPhotoUploadStatus("done");
    } else {
      setProfilePicPreview(null);
      setPhotoUploadStatus("idle");
    }
  }, [currentUser]);

  // Selección/captura de foto
  const handleProfilePictureChange = (file: File | null) => {
    setPhotoUploadError("");

    if (file) {
      setEditProfileData((prev: any) => ({ ...prev, _photoFile: file }));
      setProfilePicPreview(URL.createObjectURL(file));
      setPhotoUploadStatus("ready");
    } else {
      setEditProfileData((prev: any) => {
        const next = { ...prev };
        delete next._photoFile;
        return next;
      });
      // no borramos photoURL existente, solo quitamos “archivo nuevo”
      setPhotoUploadStatus(currentUser?.data?.photoURL ? "done" : "idle");
    }
  };

  // Guardar cambios
  const saveProfileChanges = async () => {
    if (!uid) return;

    setSaving(true);
    setPhotoUploadError("");

    try {
      const dataToUpdate: any = { ...editProfileData };

      // 1) Foto (si hay archivo nuevo)
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
          // si falla, no bloqueamos guardar el resto:
          delete dataToUpdate._photoFile;
        }
      }

      // 2) Normalizar NIT (si lo usan)
      if (dataToUpdate.company_nit) {
        dataToUpdate.company_nit = normalizeNit(dataToUpdate.company_nit);
      }

      // 3) Compatibilidad: empresa = razon social
      if (dataToUpdate.company_razonSocial) {
        dataToUpdate.empresa = String(dataToUpdate.company_razonSocial).trim();
      }

      // 4) Limpieza opcional
      if (dataToUpdate.contacto) delete dataToUpdate.contacto;

      await updateUser(uid, dataToUpdate);
      setEditModalOpened(false);
    } catch (error) {
      console.error("Error al actualizar el perfil:", error);
    } finally {
      setSaving(false);
    }
  };

  if (userLoading) return <Loader />;

  const data = currentUser?.data || {};
  const empresaLabel = data.company_razonSocial || data.empresa || "—";

  return (
    <Card shadow="md" style={{ margin: "20px auto" }}>
      <UnstyledButton
        onClick={() => setOpenedCollapse((o) => !o)}
        style={{ width: "100%" }}
      >
        <Group justify="space-between">
          <Title order={3}>Ver mi Información</Title>
          <div>{openedCollapse ? <FaChevronUp size={16} /> : <FaChevronDown size={16} />}</div>
        </Group>
      </UnstyledButton>

      <Collapse in={openedCollapse}>
        <Divider my="md" />

        {currentUser?.data ? (
          <>
            <Group justify="center" mb="md">
              <Avatar src={data.photoURL || profilePicPreview} size={150} radius="50%">
                {!data.photoURL && !profilePicPreview && data?.nombre ? data.nombre[0] : "U"}
              </Avatar>
            </Group>

            <SimpleGrid cols={2} spacing="md">
              <Text>
                <strong>Nombre:</strong> {data.nombre || "—"}
              </Text>
              <Text>
                <strong>Cédula:</strong> {data.cedula || "—"}
              </Text>

              <Text>
                <strong>Empresa:</strong> {empresaLabel}
              </Text>
              <Text>
                <strong>NIT:</strong> {data.company_nit || "—"}
              </Text>

              <Text>
                <strong>Necesidad:</strong> {data.necesidad || "—"}
              </Text>

              <Text>
                <strong>Correo:</strong> {data.correo || "—"}
              </Text>
              <Text>
                <strong>Teléfono:</strong> {data.telefono || "—"}
              </Text>

              <div style={{ fontSize: "16px", lineHeight: 1.6 }}>
                <strong>Descripción:</strong> {data.descripcion || ""}
              </div>
            </SimpleGrid>

            <Group mt="md" justify="space-between">
              <Button onClick={() => setEditModalOpened(true)} color="blue">
                Editar Perfilddd
              </Button>

              <Button
                onClick={() => {
                  logout();
                  if (data?.eventId) window.location.assign(`/event/${data.eventId}`);
                }}
                color="red"
              >
                Cerrar Sesión
              </Button>
            </Group>
          </>
        ) : (
          <Text ta="center">Cargando perfil...</Text>
        )}
      </Collapse>

      {/* Modal de Edición */}
      <Modal
        opened={editModalOpened}
        onClose={() => setEditModalOpened(false)}
        title="Editar Perfil"
        centered
      >
        <Stack>
          <Group justify="center">
            <Avatar src={profilePicPreview || data.photoURL} size={150} radius="50%">
              {!profilePicPreview && !data.photoURL && data?.nombre ? data.nombre[0] : "U"}
            </Avatar>
          </Group>

          {/* Foto */}
          <FileInput
            label="Cambiar foto de perfil"
            accept="image/png,image/jpeg"
            onChange={handleProfilePictureChange}
          />

          <Group justify="space-between" mt={-8}>
            <Text size="xs" c="dimmed">
              {photoUploadStatus === "idle" && "Opcional. Puedes tomarla con la cámara o elegir de galería."}
              {photoUploadStatus === "ready" && "Imagen lista para subir."}
              {photoUploadStatus === "uploading" && "Subiendo imagen..."}
              {photoUploadStatus === "done" && "Imagen cargada correctamente ✅"}
              {photoUploadStatus === "error" && "No se pudo subir la imagen ❌"}
            </Text>
            {photoUploadStatus === "uploading" ? <Loader size="xs" /> : null}
          </Group>

          {photoUploadError ? (
            <Alert color="red" variant="light">
              {photoUploadError}
            </Alert>
          ) : null}

          {/* Datos personales */}
          <TextInput
            label="Cédula"
            value={editProfileData.cedula || ""}
            onChange={(e) =>
              setEditProfileData((p: any) => ({ ...p, cedula: e.target.value }))
            }
          />
          <TextInput
            label="Nombre"
            value={editProfileData.nombre || ""}
            onChange={(e) =>
              setEditProfileData((p: any) => ({ ...p, nombre: e.target.value }))
            }
          />

          {/* Empresa (nuevo modelo) */}
          <TextInput
            label="NIT (solo números)"
            value={editProfileData.company_nit || ""}
            onChange={(e) =>
              setEditProfileData((p: any) => ({
                ...p,
                company_nit: normalizeNit(e.target.value),
              }))
            }
            description="Si tu evento usa empresa por NIT, este campo identifica tu empresa."
          />
          <TextInput
            label="Razón social"
            value={editProfileData.company_razonSocial || editProfileData.empresa || ""}
            onChange={(e) =>
              setEditProfileData((p: any) => ({
                ...p,
                company_razonSocial: e.target.value,
              }))
            }
          />

          <TextInput
            label="Cargo"
            value={editProfileData.cargo || ""}
            onChange={(e) =>
              setEditProfileData((p: any) => ({ ...p, cargo: e.target.value }))
            }
          />

          <Textarea
            label="Descripción"
            value={editProfileData.descripcion || ""}
            onChange={(e) =>
              setEditProfileData((p: any) => ({ ...p, descripcion: e.target.value }))
            }
            minRows={3}
          />

          <TextInput
            label="Correo"
            value={editProfileData.correo || ""}
            onChange={(e) =>
              setEditProfileData((p: any) => ({ ...p, correo: e.target.value }))
            }
          />

          <TextInput
            label="Teléfono"
            value={editProfileData.telefono || ""}
            onChange={(e) =>
              setEditProfileData((p: any) => ({ ...p, telefono: e.target.value }))
            }
          />

          <Button onClick={saveProfileChanges} color="green" loading={saving || photoUploadStatus === "uploading"}>
            Guardar cambios
          </Button>
        </Stack>
      </Modal>
    </Card>
  );
};

export default UserProfile;

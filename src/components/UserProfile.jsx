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
  ActionIcon,
  FileInput,
  Avatar,
} from "@mantine/core";
import { FaChevronDown, FaChevronUp } from "react-icons/fa";
import { UserContext } from "../context/UserContext";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../firebase/firebaseConfig";

// --- Función para subir la imagen a Firebase Storage ---
const uploadProfilePicture = async (file, uid) => {
  const storageRef = ref(storage, `profilePictures/${uid}/${file.name}`);
  await uploadBytes(storageRef, file);
  const photoURL = await getDownloadURL(storageRef);
  return photoURL;
};

const UserProfile = () => {
  const { currentUser, updateUser, logout, userLoading } = useContext(UserContext);
  const uid = currentUser?.uid;

  const [editModalOpened, setEditModalOpened] = useState(false);
  const [editProfileData, setEditProfileData] = useState({});
  const [openedCollapse, setOpenedCollapse] = useState(false);
  const [profilePicPreview, setProfilePicPreview] = useState(null);

  useEffect(() => {
    if (currentUser?.data) {
      setEditProfileData(currentUser.data);
      if (currentUser.data.photoURL) {
        setProfilePicPreview(currentUser.data.photoURL);
      }
    }
  }, [currentUser]);

  // Selección o captura de la foto de perfil
  const handleProfilePictureChange = (file) => {
    if (file) {
      setEditProfileData({ ...editProfileData, photo: file });
      setProfilePicPreview(URL.createObjectURL(file));
    }
  };

  // Guarda cambios (correo/teléfono van en la raíz)
  const saveProfileChanges = async () => {
    if (!uid) return;
    try {
      const dataToUpdate = { ...editProfileData };

      if (dataToUpdate.photo) {
        const photoURL = await uploadProfilePicture(dataToUpdate.photo, uid);
        dataToUpdate.photoURL = photoURL;
        delete dataToUpdate.photo;
      }

      // Asegura que NO incluya contacto anidado (opcional: limpia el objeto)
      if (dataToUpdate.contacto) delete dataToUpdate.contacto;

      await updateUser(uid, dataToUpdate);
      setEditModalOpened(false);
    } catch (error) {
      console.error("Error al actualizar el perfil:", error);
    }
  };

  if (userLoading) return <Loader />;

  return (
    <Card shadow="md" style={{ margin: "20px auto" }}>
      <UnstyledButton onClick={() => setOpenedCollapse((o) => !o)} style={{ width: "100%" }}>
        <Group position="apart">
          <Title order={3}>Ver mi Información</Title>
          <div>
            {openedCollapse ? <FaChevronUp size={16} /> : <FaChevronDown size={16} />}
          </div>
        </Group>
      </UnstyledButton>
      <Collapse in={openedCollapse}>
        <Divider my="md" />
        {currentUser?.data ? (
          <>
            <Group justify="center" mb="md">
              <Avatar
                src={profilePicPreview}
                alt="Foto de perfil"
                size={150}
                radius="50%"
              >
                {!profilePicPreview && currentUser.data.nombre ? currentUser.data.nombre[0] : "U"}
              </Avatar>
            </Group>
            <SimpleGrid
              cols={2}
              spacing="md"
              breakpoints={[{ maxWidth: "sm", cols: 1 }]}
            >
              <Text>
                <strong>Nombre:</strong> {currentUser.data.nombre}
              </Text>
              <Text>
                <strong>Cédula:</strong> {currentUser.data.cedula || "No proporcionada"}
              </Text>
              <Text>
                <strong>Empresa:</strong> {currentUser.data.empresa}
              </Text>
              {/* <Text>
                <strong>Cargo:</strong> {currentUser.data.cargo}
              </Text> */}
             
              {/* <Text span={2}>
                <strong>Interés:</strong> {currentUser.data.interesPrincipal}
              </Text> */}
              <Text span={2}>
                <strong>Necesidad:</strong> {currentUser.data.necesidad}
              </Text>
              <Text span={2}>
                <strong>Correo:</strong>{" "}
                {currentUser.data.correo || "No proporcionado"}
              </Text>
              <Text span={2}>
                <strong>Teléfono:</strong>{" "}
                {currentUser.data.telefono || "No proporcionado"}
              </Text>
               <div
              style={{ fontSize: "16px", lineHeight: 1.6 }}
              dangerouslySetInnerHTML={{
                __html: `<strong>Descripción:</strong> ${currentUser.data.descripcion || ""}`,
              }}
            ></div>
            </SimpleGrid>
            <Group mt="md" position="apart">
              <Button onClick={() => setEditModalOpened(true)} color="blue">
                Editar Perfil
              </Button>
              <Button
                onClick={() => {
                  logout();
                  if (currentUser?.data?.eventId) {
                    window.location.assign(`/event/${currentUser.data.eventId}`);
                  }
                }}
                color="red"
              >
                Cerrar Sesión
              </Button>
            </Group>
          </>
        ) : (
          <Text align="center">Cargando perfil...</Text>
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
          <Group position="center">
            <Avatar
              src={profilePicPreview}
              alt="Vista previa"
              size={150}
              radius="50%"
            >
              {!profilePicPreview && currentUser?.data?.nombre ? currentUser.data.nombre[0] : "U"}
            </Avatar>
          </Group>
          {/* Foto de perfil */}
          <FileInput
            label="Cambiar foto de perfil"
            accept="image/png,image/jpeg"
            inputProps={{ capture: "user" }}
            onChange={handleProfilePictureChange}
          />
          <TextInput
            label="Cédula"
            value={editProfileData.cedula || ""}
            onChange={(e) =>
              setEditProfileData({ ...editProfileData, cedula: e.target.value })
            }
          />
          <TextInput
            label="Nombre"
            value={editProfileData.nombre || ""}
            onChange={(e) =>
              setEditProfileData({ ...editProfileData, nombre: e.target.value })
            }
          />
          <TextInput
            label="Empresa"
            value={editProfileData.empresa || ""}
            onChange={(e) =>
              setEditProfileData({ ...editProfileData, empresa: e.target.value })
            }
          />
          <TextInput
            label="Cargo"
            value={editProfileData.cargo || ""}
            onChange={(e) =>
              setEditProfileData({ ...editProfileData, cargo: e.target.value })
            }
          />
          <Textarea
            label="Descripción"
            value={editProfileData.descripcion || ""}
            onChange={(e) =>
              setEditProfileData({ ...editProfileData, descripcion: e.target.value })
            }
          />
          <TextInput
            label="Correo de contacto (opcional)"
            value={editProfileData.correo || ""}
            onChange={(e) =>
              setEditProfileData({ ...editProfileData, correo: e.target.value })
            }
          />
          <TextInput
            label="Teléfono de contacto (opcional)"
            value={editProfileData.telefono || ""}
            onChange={(e) =>
              setEditProfileData({ ...editProfileData, telefono: e.target.value })
            }
          />
          <Button onClick={saveProfileChanges} color="green">
            Guardar cambios
          </Button>
        </Stack>
      </Modal>
    </Card>
  );
};

export default UserProfile;

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
import { storage } from "../firebase/firebaseConfig"; // Asegúrate de que la ruta sea correcta
import { useNavigate } from "react-router-dom";

// Función para subir la imagen a Firebase Storage
const uploadProfilePicture = async (file, uid) => {
  const storageRef = ref(storage, `profilePictures/${uid}/${file.name}`);
  await uploadBytes(storageRef, file);
  const photoURL = await getDownloadURL(storageRef);
  return photoURL;
};

const UserProfile = () => {
  const { currentUser, updateUser, logout, userLoading } = useContext(UserContext);
  const uid = currentUser?.uid;
  const navigate = useNavigate();

  const [editModalOpened, setEditModalOpened] = useState(false);
  const [editProfileData, setEditProfileData] = useState({});
  const [openedCollapse, setOpenedCollapse] = useState(false);
  const [profilePicPreview, setProfilePicPreview] = useState(null);

  useEffect(() => {
    if (currentUser?.data) {
      setEditProfileData(currentUser.data);
      // Si ya existe una foto de perfil, se asigna a la previsualización
      if (currentUser.data.photoURL) {
        setProfilePicPreview(currentUser.data.photoURL);
      }
    }
  }, [currentUser]);

  // Maneja la selección o captura de la foto de perfil
  const handleProfilePictureChange = (file) => {
    if (file) {
      setEditProfileData({ ...editProfileData, photo: file });
      setProfilePicPreview(URL.createObjectURL(file));
    }
  };

  // Guarda los cambios y, en caso de haber seleccionado una foto, la sube a Firebase Storage
  const saveProfileChanges = async () => {
    if (!uid) return;
    try {
      // Crear una copia de los datos a actualizar
      const dataToUpdate = { ...editProfileData };
  
      if (dataToUpdate.photo) {
        const photoURL = await uploadProfilePicture(dataToUpdate.photo, uid);
        dataToUpdate.photoURL = photoURL;
        delete dataToUpdate.photo;
      }
  
      await updateUser(uid, dataToUpdate);
      setEditModalOpened(false);
    } catch (error) {
      console.error("Error al actualizar el perfil:", error);
    }
  };
  

  if (userLoading) return <Loader />;

  return (
    <Card shadow="md" style={{ maxWidth: 800, margin: "20px auto" }}>
      <UnstyledButton onClick={() => setOpenedCollapse((o) => !o)}>
        <Group position="apart" noWrap style={{ width: "100%" }}>
          <Title order={3}>Ver mi Información</Title>
          <ActionIcon variant="transparent">
            {openedCollapse ? <FaChevronUp size={16} /> : <FaChevronDown size={16} />}
          </ActionIcon>
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
                <strong>Cédula:</strong> {currentUser.data.cedula}
              </Text>
              <Text>
                <strong>Empresa:</strong> {currentUser.data.empresa}
              </Text>
              <Text>
                <strong>Cargo:</strong> {currentUser.data.cargo}
              </Text>
              <Text span={2}>
                <strong>Descripción:</strong> {currentUser.data.descripcion}
              </Text>
              <Text span={2}>
                <strong>Interés:</strong> {currentUser.data.interesPrincipal}
              </Text>
              <Text span={2}>
                <strong>Necesidad:</strong> {currentUser.data.necesidad}
              </Text>
              <Text span={2}>
                <strong>Contacto:</strong>{" "}
                {currentUser.data.contacto?.correo || "No proporcionado"} -{" "}
                {currentUser.data.contacto?.telefono || "No proporcionado"}
              </Text>
            </SimpleGrid>
            <Group mt="md" position="apart">
              <Button onClick={() => setEditModalOpened(true)} color="blue">
                Editar Perfil
              </Button>
              <Button
                onClick={() => {
                  logout();
                  if (currentUser?.data?.eventId) {
                    navigate(`/event/${currentUser.data.eventId}`);
                  } else {
                    navigate("/event");
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
          {/* Campo para seleccionar o tomar una foto de perfil */}
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
            value={editProfileData.contacto?.correo || ""}
            onChange={(e) =>
              setEditProfileData({
                ...editProfileData,
                contacto: { ...editProfileData.contacto, correo: e.target.value },
              })
            }
          />
          <TextInput
            label="Teléfono de contacto (opcional)"
            value={editProfileData.contacto?.telefono || ""}
            onChange={(e) =>
              setEditProfileData({
                ...editProfileData,
                contacto: { ...editProfileData.contacto, telefono: e.target.value },
              })
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

import { Modal, Text } from "@mantine/core";

export default function AvatarModal({ opened, image, onClose }) {
  return (
    <Modal opened={opened} onClose={onClose} centered title="Foto de perfil">
      {image ? (
        <img src={image} alt="Foto de perfil ampliada" style={{ width: "100%", maxWidth: "500px", display: "block", margin: "0 auto" }} />
      ) : (
        <Text ta="center">No hay imagen disponible</Text>
      )}
    </Modal>
  );
}

import { useState, useContext } from "react";
import { Modal, TextInput, Button, Stack } from "@mantine/core";
import { collection, addDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { AdminAuthContext } from "../../context/AdminAuthContext";

const CreateOrganizationModal = ({ opened, onClose, refreshOrgs, setGlobalMessage }) => {
  const { adminUser } = useContext(AdminAuthContext);
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(false);

  const createOrganization = async () => {
    if (!orgName.trim()) {
      setGlobalMessage("El nombre de la organización es obligatorio.");
      return;
    }
    try {
      setLoading(true);
      const newOrg = {
        name: orgName.trim(),
        createdBy: adminUser?.uid || null,
        owners: adminUser?.uid ? [adminUser.uid] : [],
        createdAt: new Date(),
      };

      await addDoc(collection(db, "organizations"), newOrg);
      setGlobalMessage("Organización creada exitosamente.");
      refreshOrgs();
      onClose();
      setOrgName("");
    } catch (error) {
      console.error(error);
      setGlobalMessage("Error al crear la organización.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Crear Nueva Organización" centered>
      <Stack>
        <TextInput
          label="Nombre de la Organización"
          placeholder="Ej: Cámara de Comercio"
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          required
        />
        <Button onClick={createOrganization} fullWidth loading={loading}>
          Crear Organización
        </Button>
      </Stack>
    </Modal>
  );
};

export default CreateOrganizationModal;

/* eslint-disable react/prop-types */
// AttendeesListModal.jsx
import { useEffect, useState } from "react";
import { Modal, Table, Button, Loader, Text } from "@mantine/core";
import {
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";

const AttendeesListModal = ({ opened, onClose, event, setGlobalMessage }) => {
  const [attendees, setAttendees] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (opened && event) {
      fetchAttendees();
    }
  }, [opened, event]);

  const fetchAttendees = async () => {
    try {
      setLoading(true);
      // Busca en "users" los que tengan "eventId" = event.id
      const q = query(
        collection(db, "users"),
        where("eventId", "==", event.id)
      );
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      }));
      setAttendees(list);
    } catch (error) {
      console.error("Error fetching attendees:", error);
      setGlobalMessage("Error al obtener asistentes.");
    } finally {
      setLoading(false);
    }
  };

  // Eliminar completamente al usuario de la colección
  const removeAttendee = async (attendeeId) => {
    try {
      await deleteDoc(doc(db, "users", attendeeId));
      setGlobalMessage("Asistente eliminado correctamente.");
      fetchAttendees();
    } catch (error) {
      console.error("Error removing attendee:", error);
      setGlobalMessage("Error al eliminar el asistente.");
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`Asistentes - ${event?.eventName}`}
    >
      {loading ? (
        <Loader />
      ) : attendees.length === 0 ? (
        <Text>No hay asistentes registrados para este evento.</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Nombre</Table.Th>
              <Table.Th>Empresa</Table.Th>
              <Table.Th>Cédula</Table.Th>
              <Table.Th>Teléfono</Table.Th>
              <Table.Th>Acciones</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {attendees.map((a) => (
              <Table.Tr key={a.id}>
                <Table.Td>{a.nombre}</Table.Td>
                <Table.Td>{a.empresa}</Table.Td>
                <Table.Td>{a.cedula}</Table.Td>
                <Table.Td>{a.contacto.telefono}</Table.Td>
                <Table.Td>
                  <Button color="red" onClick={() => removeAttendee(a.id)}>
                    Eliminar
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Modal>
  );
};

export default AttendeesListModal;

/* eslint-disable react/prop-types */
// MeetingsListModal.jsx
import { useEffect, useState } from "react";
import { Modal, Table, Button, Loader, Text } from "@mantine/core";
import {
  collection,
  query,
  getDocs,
  deleteDoc,
  doc,
  getDoc,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";

const MeetingsListModal = ({ opened, onClose, event, setGlobalMessage }) => {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (opened && event) {
      fetchMeetings();
    }
  }, [opened, event]);

  const fetchMeetings = async () => {
    try {
      setLoading(true);
      const q = query(collection(db, "events", event.id, "meetings"));
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      }));

      // 🔸 Vamos a "enriquecer" la info de participantes
      const enrichedList = [];
      for (const meeting of list) {
        const participantsData = [];
        for (const participantId of meeting.participants || []) {
          const pDoc = await getDoc(doc(db, "users", participantId));
          if (pDoc.exists()) {
            const pData = pDoc.data();
            participantsData.push({
              id: participantId,
              nombre: pData.nombre,
              empresa: pData.empresa,
              // cualquier otro campo que quieras mostrar
            });
          } else {
            // El documento del usuario no existe
            participantsData.push({ id: participantId, nombre: "Desconocido" });
          }
        }
        // Creamos un nuevo objeto con la info enriquecida
        enrichedList.push({
          ...meeting,
          participantsData,
        });
      }

      setMeetings(enrichedList);
    } catch (error) {
      console.error("Error fetching meetings:", error);
      setGlobalMessage("Error al obtener reuniones.");
    } finally {
      setLoading(false);
    }
  };

  // Ejemplo de "cancelar" eliminando el documento
  // Si prefieres marcar un campo "status: canceled", cambia la lógica
  const cancelMeeting = async (meetingId) => {
    try {
      await deleteDoc(doc(db, "events", event.id, "meetings", meetingId));
      setGlobalMessage("Reunión cancelada (eliminada).");
      fetchMeetings(); // Actualizar la lista
    } catch (error) {
      console.error("Error canceling meeting:", error);
      setGlobalMessage("Error al cancelar la reunión.");
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`Reuniones - ${event?.eventName}`}
    >
      {loading ? (
        <Loader />
      ) : meetings.length === 0 ? (
        <Text>No hay reuniones asignadas para este evento.</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Hora</Table.Th>
              <Table.Th>Mesa</Table.Th>
              <Table.Th>Participantes</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Acciones</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {meetings.map((m) => (
              <Table.Tr key={m.id}>
                <Table.Td>{m.timeSlot}</Table.Td>
                <Table.Td>{m.tableAssigned}</Table.Td>
                <Table.Td>
                  {m.participantsData?.map((p) => (
                    <div key={p.id}>
                      <strong>{p.nombre}</strong> - {p.empresa}
                    </div>
                  ))}
                </Table.Td>
                <Table.Td>{m.status || "N/A"}</Table.Td>
                <Table.Td>
                  <Button color="red" onClick={() => cancelMeeting(m.id)}>
                    Cancelar
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

export default MeetingsListModal;

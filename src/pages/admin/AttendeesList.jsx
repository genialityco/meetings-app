import { Card, Table, Button, Loader, Text, Group, Title } from "@mantine/core";
import {
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { useEffect, useState } from "react";
import PropTypes from "prop-types";

const AttendeesList = ({ event, setGlobalMessage, exportToExcel }) => {
  const [attendees, setAttendees] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (event) fetchAttendees();
    // eslint-disable-next-line
  }, [event]);

  const fetchAttendees = async () => {
    try {
      setLoading(true);
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
      console.log(error);
      setGlobalMessage("Error al obtener asistentes.");
    } finally {
      setLoading(false);
    }
  };

  const removeAttendee = async (attendeeId) => {
    try {
      await deleteDoc(doc(db, "users", attendeeId));
      setGlobalMessage("Asistente eliminado correctamente.");
      setAttendees((prev) => prev.filter((a) => a.id !== attendeeId));
    } catch (error) {
      console.log(error);

      setGlobalMessage("Error al eliminar el asistente.");
    }
  };

  return (
    <Card shadow="sm" p="lg" withBorder mt="md">
      <Group position="apart" mb="md">
        <Title order={5}>Asistentes del evento</Title>
        <Button onClick={() => exportToExcel(attendees)}>
          Exportar a Excel (XLSX)
        </Button>
      </Group>
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
              <Table.Th>Cargo</Table.Th>
              <Table.Th>Tipo asistente</Table.Th>
              <Table.Th>Correo</Table.Th>
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
                <Table.Td>{a.cargo}</Table.Td>
                <Table.Td>{a.tipoAsistente}</Table.Td>
                <Table.Td>{a.contacto?.correo}</Table.Td>
                <Table.Td>{a.contacto?.telefono}</Table.Td>
                <Table.Td>
                  <Button
                    color="red"
                    size="xs"
                    onClick={() => {
                      if (
                        window.confirm(
                          "¿Estás seguro que deseas eliminar este asistente?"
                        )
                      ) {
                        removeAttendee(a.id);
                      }
                    }}
                  >
                    Eliminar
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Card>
  );
};

AttendeesList.propTypes = {
  event: PropTypes.object.isRequired,
  setGlobalMessage: PropTypes.func.isRequired,
  exportToExcel: PropTypes.func.isRequired,
};

export default AttendeesList;

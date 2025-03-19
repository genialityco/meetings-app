import { useState, useEffect, useRef } from "react";
import {
  Container,
  Title,
  Paper,
  Text,
  Flex,
  Table,
  Card,
  Tabs,
} from "@mantine/core";
import { db } from "../firebase/firebaseConfig";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  getDocs,
} from "firebase/firestore";
import anime from "animejs";
import { useParams } from "react-router-dom";

// Función para generar los intervalos de horarios
const generateTimeSlots = (start, end, duration) => {
  const slots = [];
  let currentTime = new Date(`1970-01-01T${start}:00`);
  const endTime = new Date(`1970-01-01T${end}:00`);

  while (currentTime < endTime) {
    slots.push(currentTime.toTimeString().substring(0, 5));
    currentTime.setMinutes(currentTime.getMinutes() + duration);
  }

  return slots;
};

const MatrixPage = () => {
  const { eventId } = useParams(); // Obtener el eventId de la URL
  const [config, setConfig] = useState(null);
  const [agenda, setAgenda] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [participantsInfo, setParticipantsInfo] = useState({});
  const [matrix, setMatrix] = useState([]);
  const [matrixUsuarios, setMatrixUsuarios] = useState([]);
  const [asistentes, setAsistentes] = useState([]);
  const tableRefs = useRef([]);

  // 🔹 Cargar Configuración del Evento desde Firestore
  useEffect(() => {
    if (!eventId) return;

    const fetchConfig = async () => {
      const configRef = doc(db, "events", eventId);
      const configSnap = await getDoc(configRef);
      if (configSnap.exists()) {
        setConfig(configSnap.data());
      }
    };

    fetchConfig();
  }, [eventId]);

  // 🔹 Cargar la Agenda en Tiempo Real Filtrada por Evento
  useEffect(() => {
    if (!config || !eventId) return;

    const q = query(
      collection(db, "agenda"),
      where("eventId", "==", eventId),
      orderBy("startTime")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const agendaData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setAgenda(agendaData);
    });

    return () => unsubscribe();
  }, [config, eventId]);

  // 🔹 Cargar las Reuniones en Tiempo Real desde "events/{eventId}/meetings"
  useEffect(() => {
    if (!config || !eventId) return;

    const q = query(
      collection(db, "events", eventId, "meetings"),
      where("status", "==", "accepted")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const meetingsData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        timeSlot: doc.data().timeSlot.match(/\d{2}:\d{2}/)[0], // Extraer HH:MM
      }));
      setMeetings(meetingsData);
    });

    return () => unsubscribe();
  }, [config, eventId]);

  // 🔹 Cargar la Lista de Asistentes al Evento
  useEffect(() => {
    if (!eventId) return;

    const fetchAsistentes = async () => {
      const usersSnapshot = await getDocs(
        query(collection(db, "users"), where("eventId", "==", eventId))
      );
      const usersList = usersSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setAsistentes(usersList);
    };

    fetchAsistentes();
  }, [eventId]);

  // 🔹 Cargar Información de Participantes en Tiempo Real
  useEffect(() => {
    if (meetings.length === 0) return;

    const fetchParticipants = async () => {
      const usersData = {};
      for (const meeting of meetings) {
        for (const participantId of meeting.participants) {
          if (!usersData[participantId]) {
            const userDoc = await getDoc(doc(db, "users", participantId));
            if (userDoc.exists()) {
              usersData[participantId] = userDoc.data();
            }
          }
        }
      }
      setParticipantsInfo(usersData);
    };

    fetchParticipants();
  }, [meetings]);

  // 🔹 Construcción de la Matriz Filtrada por Evento
  useEffect(() => {
    if (!config || agenda.length === 0) return;

    const { numTables, meetingDuration, startTime, endTime } = config.config;
    const timeSlots = generateTimeSlots(startTime, endTime, meetingDuration);

    // Crear matriz vacía (mesas × horarios)
    const newMatrix = Array.from({ length: numTables }, () =>
      Array(timeSlots.length).fill({
        status: "available",
        participants: [],
      })
    );

    // 🔸 Mapear la agenda en la matriz
    agenda.forEach((slot) => {
      const tableIndex = slot.tableNumber - 1;
      const timeSlotIndex = timeSlots.indexOf(slot.startTime);

      if (tableIndex >= 0 && timeSlotIndex >= 0) {
        newMatrix[tableIndex][timeSlotIndex] = {
          status: slot.available ? "available" : "occupied",
          participants: [],
        };
      }
    });

    // 🔸 Mapear las reuniones en la matriz
    meetings.forEach((meeting) => {
      const tableIndex = Number(meeting.tableAssigned) - 1;
      const normalizedTimeSlot = meeting.timeSlot.trim();

      const timeSlotIndex = timeSlots.findIndex(
        (slot) => slot === normalizedTimeSlot
      );

      if (tableIndex >= 0 && timeSlotIndex >= 0) {
        newMatrix[tableIndex][timeSlotIndex] = {
          status: "accepted",
          participants: meeting.participants.map((id) =>
            participantsInfo[id]
              ? `${participantsInfo[id].nombre} (${participantsInfo[id].empresa})`
              : "Cargando..."
          ),
        };
      } else {
        console.warn("Error asignando reunión:", meeting);
      }
    });

    // 🔹 Verificar la matriz final antes de actualizar el estado
    console.log("Matriz generada:", newMatrix);
    setMatrix([...newMatrix]); // Forzar actualización
  }, [config, agenda, meetings, participantsInfo]);

  // 🔹 Construcción de la Matriz por Usuario
  useEffect(() => {
    if (
      !config ||
      meetings.length === 0 ||
      asistentes.length === 0 ||
      Object.keys(participantsInfo).length === 0
    )
      return;

    const { meetingDuration, startTime, endTime } = config.config;
    const timeSlots = generateTimeSlots(startTime, endTime, meetingDuration);

    const newMatrixUsuarios = asistentes.map((asistente) => {
      const row = timeSlots.map((slot) => {
        const meetingForSlot = meetings.find(
          (meeting) =>
            meeting.timeSlot === slot &&
            meeting.participants.includes(asistente.id)
        );
        return meetingForSlot
          ? {
              status: "accepted",
              table: meetingForSlot.tableAssigned,
              participants: meetingForSlot.participants.filter(
                (pid) => pid !== asistente.id
              ),
            }
          : { status: "available" };
      });

      return { asistente, row };
    });

    setMatrixUsuarios(newMatrixUsuarios);
  }, [config, meetings, asistentes, participantsInfo]);

  // 🔹 Animación de colores con Anime.js
  useEffect(() => {
    tableRefs.current.forEach((ref, index) => {
      if (ref) {
        anime({
          targets: ref,
          backgroundColor: getColor(
            matrix[Math.floor(index / matrix[0].length)][
              index % matrix[0].length
            ].status
          ),
          duration: 500,
          easing: "easeInOutQuad",
        });
      }
    });
  }, [matrix]);

  // 🔹 Función para asignar colores según el estado
  const getColor = (status) => {
    switch (status) {
      case "available":
        return "#d3d3d3"; // Gris suave
      case "occupied":
        return "#ffa500"; // Naranja
      case "accepted":
        return "#4caf50"; // Verde
      default:
        return "#d3d3d3";
    }
  };

  return (
    <Container fluid>
      <Title order={2} mt="md" mb="md" align="center">
        Matriz Rueda de Negocios - Evento {config?.eventName || "Desconocido"}
      </Title>
      <Tabs defaultValue="mesas">
        <Tabs.List>
          <Tabs.Tab value="mesas">Por Mesas</Tabs.Tab>
          <Tabs.Tab value="usuarios">Por Usuarios</Tabs.Tab>
        </Tabs.List>

        {/* Vista por mesas */}
        <Tabs.Panel value="mesas" pt="md">
          <Paper
            shadow="md"
            radius="md"
            style={{ margin: "0 auto", maxWidth: "90%" }}
          >
            <Flex gap="lg" justify="center" align="center" wrap="wrap">
              {matrix.map((table, tableIndex) => (
                <Card
                  key={`table-${tableIndex}`}
                  shadow="sm"
                  radius="md"
                  style={{ minWidth: "200px" }}
                >
                  <Title order={5} align="center">{`Mesa ${
                    tableIndex + 1
                  }`}</Title>
                  <Table striped highlightOnHover>
                    <Table.Tbody>
                      {table.map((slot, slotIndex) => (
                        <Table.Tr
                          key={`${tableIndex}-${slotIndex}`}
                          ref={(el) =>
                            (tableRefs.current[
                              tableIndex * matrix[0].length + slotIndex
                            ] = el)
                          }
                          style={{
                            backgroundColor: getColor(slot.status),
                            borderRadius: "5px",
                          }}
                        >
                          <Table.Td
                            style={{
                              padding: "8px",
                              textAlign: "center",
                              fontWeight: "bold",
                            }}
                          >
                            {
                              generateTimeSlots(
                                config.config.startTime,
                                config.config.endTime,
                                config.config.meetingDuration
                              )[slotIndex]
                            }
                          </Table.Td>
                          <Table.Td
                            style={{ padding: "8px", textAlign: "center" }}
                          >
                            {slot.status === "available" ? (
                              "Disponible"
                            ) : (
                              <>
                                {slot.participants.map((p, index) => (
                                  <Text size="xs" key={index}>
                                    {p}
                                  </Text>
                                ))}
                              </>
                            )}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Card>
              ))}
            </Flex>
          </Paper>
        </Tabs.Panel>

        {/* Vista por Usuarios */}
        <Tabs.Panel value="usuarios" pt="md">
          <Flex gap="lg" justify="center" align="center" wrap="wrap">
            {matrixUsuarios.map(({ asistente, row }) => (
              <Card
                key={asistente.id}
                shadow="sm"
                radius="md"
                style={{ minWidth: "300px", margin: "10px" }}
              >
                <Title order={5} align="center" mb="sm">
                  {asistente.nombre}
                </Title>
                <Table striped highlightOnHover>
                  <Table.Tbody
                    style={{
                      padding: "8px",
                      textAlign: "center",
                      fontWeight: "bold",
                    }}
                  >
                    {generateTimeSlots(
                      config.config.startTime,
                      config.config.endTime,
                      config.config.meetingDuration
                    ).map((slot, index) => {
                      const cell = row[index];
                      return (
                        <Table.Tr
                          key={index}
                          style={{ backgroundColor: getColor(cell.status) }}
                        >
                          <Table.Td>{slot}</Table.Td>
                          <Table.Td>
                            {cell.status === "accepted" ? (
                              <>
                                <div>{`Mesa ${cell.table}`}</div>
                                <div>
                                  {cell.participants.map((pid, idx) => (
                                    <Text key={idx} size="xs">
                                      {participantsInfo[pid]
                                        ? `${participantsInfo[pid].nombre} (${participantsInfo[pid].empresa})`
                                        : "Cargando..."}
                                    </Text>
                                  ))}
                                </div>
                              </>
                            ) : (
                              "Disponible"
                            )}
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Card>
            ))}
          </Flex>
        </Tabs.Panel>
      </Tabs>
    </Container>
  );
};

export default MatrixPage;

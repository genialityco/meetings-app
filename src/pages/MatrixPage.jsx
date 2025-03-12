import { useState, useEffect, useRef } from "react";
import { Container, Title, Paper, Text, Flex, Table, Card } from "@mantine/core";
import { db } from "../firebase/firebaseConfig";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import anime from "animejs";

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
  const [config, setConfig] = useState(null);
  const [agenda, setAgenda] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [participantsInfo, setParticipantsInfo] = useState({});
  const [matrix, setMatrix] = useState([]);
  const tableRefs = useRef([]);

  // Cargar Configuración desde Firestore
  useEffect(() => {
    const fetchConfig = async () => {
      const configRef = doc(db, "config", "meetingConfig");
      const configSnap = await getDoc(configRef);
      if (configSnap.exists()) {
        setConfig(configSnap.data());
      }
    };

    fetchConfig();
  }, []);

  // Cargar la Agenda en Tiempo Real
  useEffect(() => {
    if (!config) return;

    const q = query(collection(db, "agenda"), orderBy("startTime"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const agendaData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setAgenda(agendaData);
    });

    return () => unsubscribe();
  }, [config]);

  // Cargar las Reuniones en Tiempo Real
  useEffect(() => {
    if (!config) return;

    const q = query(
      collection(db, "meetings"),
      where("status", "==", "accepted")
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const meetingsData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        timeSlot: doc.data().timeSlot.match(/\d{2}:\d{2}/)[0],
      }));
      setMeetings(meetingsData);
    });

    return () => unsubscribe();
  }, [config]);

  // Cargar Información de Participantes en Tiempo Real
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

  // Construcción de la Matriz con Datos Reales
  useEffect(() => {
    if (!config || agenda.length === 0) return;

    const { numTables, meetingDuration, startTime, endTime } = config;
    const timeSlots = generateTimeSlots(startTime, endTime, meetingDuration);

    // Crear matriz vacía
    const newMatrix = Array.from({ length: numTables }, () =>
      Array(timeSlots.length).fill({
        status: "available",
        participants: [],
      })
    );

    // Mapear la agenda en la matriz
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

    // Mapear las reuniones en la matriz
    meetings.forEach((meeting) => {
      const tableIndex = Number(meeting.tableAssigned) - 1;
      const timeSlotIndex = timeSlots.indexOf(meeting.timeSlot);

      if (tableIndex >= 0 && timeSlotIndex >= 0) {
        newMatrix[tableIndex][timeSlotIndex] = {
          status: "accepted",
          participants: meeting.participants.map((id) =>
            participantsInfo[id]
              ? `${participantsInfo[id].nombre} (${participantsInfo[id].empresa})`
              : "Cargando..."
          ),
        };
      }
    });

    setMatrix(newMatrix);
  }, [config, agenda, meetings, participantsInfo]);

  // Animación de colores con Anime.js
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

  // Función para asignar colores según el estado
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
        Matriz Rueda de Negocios
      </Title>
      <Paper shadow="md" radius="md" style={{ margin: "0 auto", maxWidth: "90%" }}>
        <Flex gap="lg" justify="center" align="center" wrap="wrap">
          {matrix.map((table, tableIndex) => (
            <Card key={`table-${tableIndex}`} shadow="sm" radius="md" style={{ minWidth: "200px" }}>
              <Title order={5} align="center">{`Mesa ${tableIndex + 1}`}</Title>
              <Table striped highlightOnHover>
                <tbody>
                  {table.map((slot, slotIndex) => (
                    <tr
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
                      <td style={{ padding: "8px", textAlign: "center", fontWeight: "bold" }}>
                        {generateTimeSlots(config.startTime, config.endTime, config.meetingDuration)[slotIndex]}
                      </td>
                      <td style={{ padding: "8px", textAlign: "center" }}>
                        {slot.status === "available" ? (
                          "Disponible"
                        ) : (
                          <>
                            {slot.participants.map((p, index) => (
                              <Text size="xs" key={index}>{p}</Text>
                            ))}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ))}
        </Flex>
      </Paper>
    </Container>
  );
};

export default MatrixPage;

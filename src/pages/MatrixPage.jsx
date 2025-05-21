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

// Genera los slots de tiempo según configuración
const generateTimeSlots = (start, end, meetingDuration, breakTime) => {
  const slots = [];
  let currentTime = new Date(`1970-01-01T${start}:00`);
  const endTimeObj = new Date(`1970-01-01T${end}:00`);

  while (currentTime < endTimeObj) {
    slots.push(currentTime.toTimeString().substring(0, 5));
    currentTime.setMinutes(
      currentTime.getMinutes() + meetingDuration + breakTime
    );
  }

  return slots;
};

// Verifica si un slot (por su hora de inicio y duración) se solapa con algún bloque de descanso
const slotOverlapsBreakBlock = (slotStart, meetingDuration, breakBlocks = []) => {
  const [h, m] = slotStart.split(":").map(Number);
  const slotStartMin = h * 60 + m;
  const slotEndMin = slotStartMin + meetingDuration;

  return breakBlocks.some((block) => {
    const [sh, sm] = block.start.split(":").map(Number);
    const [eh, em] = block.end.split(":").map(Number);
    const blockStartMin = sh * 60 + sm;
    const blockEndMin = eh * 60 + em;

    return (
      // Empieza dentro del bloque
      (slotStartMin >= blockStartMin && slotStartMin < blockEndMin) ||
      // Termina dentro del bloque
      (slotEndMin > blockStartMin && slotEndMin <= blockEndMin) ||
      // Abarca completamente el bloque
      (slotStartMin <= blockStartMin && slotEndMin >= blockEndMin)
    );
  });
};

const MatrixPage = () => {
  const { eventId } = useParams();
  const [config, setConfig] = useState(null);
  const [agenda, setAgenda] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [participantsInfo, setParticipantsInfo] = useState({});
  const [matrix, setMatrix] = useState([]);
  const [matrixUsuarios, setMatrixUsuarios] = useState([]);
  const [asistentes, setAsistentes] = useState([]);
  const tableRefs = useRef([]);

  // Carga configuración del evento
  useEffect(() => {
    if (!eventId) return;
    (async () => {
      const ref = doc(db, "events", eventId);
      const snap = await getDoc(ref);
      if (snap.exists()) setConfig(snap.data());
    })();
  }, [eventId]);

  // Suscripción a agenda
  useEffect(() => {
    if (!config) return;
    const q = query(
      collection(db, "agenda"),
      where("eventId", "==", eventId),
      orderBy("startTime")
    );
    return onSnapshot(q, (snap) => {
      setAgenda(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [config, eventId]);

  // Suscripción a reuniones aceptadas
  useEffect(() => {
    if (!config) return;
    const q = query(
      collection(db, "events", eventId, "meetings"),
      where("status", "==", "accepted")
    );
    return onSnapshot(q, (snap) => {
      setMeetings(snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        timeSlot: d.data().timeSlot.match(/\d{2}:\d{2}/)[0],
      })));
    });
  }, [config, eventId]);

  // Carga asistentes registrados al evento
  useEffect(() => {
    if (!eventId) return;
    (async () => {
      const snap = await getDocs(
        query(collection(db, "users"), where("eventId", "==", eventId))
      );
      setAsistentes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    })();
  }, [eventId]);

  // Carga info de participantes de cada reunión
  useEffect(() => {
    if (meetings.length === 0) return;
    (async () => {
      const users = {};
      for (const mtg of meetings) {
        for (const pid of mtg.participants) {
          if (!users[pid]) {
            const snap = await getDoc(doc(db, "users", pid));
            if (snap.exists()) users[pid] = snap.data();
          }
        }
      }
      setParticipantsInfo(users);
    })();
  }, [meetings]);

  // Construye matriz por mesas, incluyendo bloques de descanso
  useEffect(() => {
    if (!config) return;
    const {
      numTables,
      meetingDuration,
      breakTime,
      startTime,
      endTime,
      breakBlocks = []
    } = config.config;

    const timeSlots = generateTimeSlots(startTime, endTime, meetingDuration, breakTime);

    // Inicializa matriz con estados 'available' o 'break'
    const baseMatrix = Array.from({ length: numTables }, () =>
      timeSlots.map(slot => ({
        status: slotOverlapsBreakBlock(slot, meetingDuration, breakBlocks)
          ? "break"
          : "available",
        participants: []
      }))
    );

    // Marca slots según datos de agenda
    agenda.forEach(slot => {
      const tIdx = slot.tableNumber - 1;
      const sIdx = timeSlots.indexOf(slot.startTime);
      if (tIdx >= 0 && sIdx >= 0) {
        baseMatrix[tIdx][sIdx] = {
          status: slot.available ? "available" : "occupied",
          participants: []
        };
      }
    });

    // Marca reuniones aceptadas
    meetings.forEach(mtg => {
      const tIdx = Number(mtg.tableAssigned) - 1;
      const sIdx = timeSlots.indexOf(mtg.timeSlot.trim());
      if (tIdx >= 0 && sIdx >= 0) {
        baseMatrix[tIdx][sIdx] = {
          status: "accepted",
          participants: mtg.participants.map(id =>
            participantsInfo[id]
              ? `${participantsInfo[id].nombre} (${participantsInfo[id].empresa})`
              : "Cargando..."
          )
        };
      }
    });

    setMatrix(baseMatrix);
  }, [config, agenda, meetings, participantsInfo]);

  // Construye matriz por usuarios, también considerando descansos
  useEffect(() => {
    if (!config) return;
    const {
      meetingDuration,
      breakTime,
      startTime,
      endTime,
      breakBlocks = []
    } = config.config;
    const timeSlots = generateTimeSlots(startTime, endTime, meetingDuration, breakTime);

    const usersMatrix = asistentes.map(user => {
      const row = timeSlots.map(slot => {
        if (slotOverlapsBreakBlock(slot, meetingDuration, breakBlocks)) {
          return { status: "break" };
        }
        const mtg = meetings.find(m =>
          m.timeSlot === slot &&
          m.participants.includes(user.id)
        );
        if (mtg) {
          return {
            status: "accepted",
            table: mtg.tableAssigned,
            participants: mtg.participants.filter(pid => pid !== user.id)
          };
        }
        return { status: "available" };
      });
      return { asistente: user, row };
    });

    setMatrixUsuarios(usersMatrix);
  }, [config, asistentes, meetings, participantsInfo]);

  // Animación de fondo de celdas
  useEffect(() => {
    matrix.flat().forEach((_, idx) => {
      const ref = tableRefs.current[idx];
      if (ref) {
        anime({
          targets: ref,
          backgroundColor: getColor(matrix[Math.floor(idx / matrix[0].length)][idx % matrix[0].length].status),
          duration: 500,
          easing: "easeInOutQuad"
        });
      }
    });
  }, [matrix]);

  // Colores según estado
  const getColor = status => {
    switch (status) {
      case "available": return "#d3d3d3";
      case "occupied":  return "#ffa500";
      case "accepted":  return "#4caf50";
      case "break":     return "#90caf9";
      default:          return "#d3d3d3";
    }
  };

  return (
    <Container fluid>
      <Title order={2} mt="md" mb="md" align="center">
        Matriz Rueda de Negocios — Evento {config?.eventName || "Desconocido"}
      </Title>
      <Tabs defaultValue="mesas">
        <Tabs.List>
          <Tabs.Tab value="mesas">Por Mesas</Tabs.Tab>
          <Tabs.Tab value="usuarios">Por Usuarios</Tabs.Tab>
        </Tabs.List>

        {/* Vista por Mesas */}
        <Tabs.Panel value="mesas" pt="md">
          <Paper shadow="md" radius="md" style={{ margin: "0 auto", maxWidth: "90%" }}>
            <Flex gap="lg" justify="center" align="center" wrap="wrap">
              {matrix.map((table, ti) => (
                <Card key={ti} shadow="sm" radius="md" style={{ minWidth: 200 }}>
                  <Title order={5} align="center">Mesa {ti + 1}</Title>
                  <Table striped highlightOnHover>
                    <Table.Tbody>
                      {table.map((cell, si) => (
                        <Table.Tr
                          key={`${ti}-${si}`}
                          ref={el => tableRefs.current[ti * matrix[0].length + si] = el}
                          style={{ backgroundColor: getColor(cell.status), borderRadius: 5 }}
                        >
                          <Table.Td style={{ padding: 8, textAlign: "center", fontWeight: "bold" }}>
                            {generateTimeSlots(
                              config.config.startTime,
                              config.config.endTime,
                              config.config.meetingDuration,
                              config.config.breakTime
                            )[si]}
                          </Table.Td>
                          <Table.Td style={{ padding: 8, textAlign: "center" }}>
                            {cell.status === "available" && "Disponible"}
                            {cell.status === "occupied"  && "Ocupado"}
                            {cell.status === "break"     && "Descanso"}
                            {cell.status === "accepted"   && cell.participants.map((p, i) => (
                              <Text size="xs" key={i}>{p}</Text>
                            ))}
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
              <Card key={asistente.id} shadow="sm" radius="md" style={{ minWidth: 300, margin: 10 }}>
                <Title order={5} align="center" mb="sm">{asistente.nombre}</Title>
                <Table striped highlightOnHover>
                  <Table.Tbody>
                    {generateTimeSlots(
                      config.config.startTime,
                      config.config.endTime,
                      config.config.meetingDuration,
                      config.config.breakTime
                    ).map((slot, i) => {
                      const cell = row[i];
                      return (
                        <Table.Tr key={i} style={{ backgroundColor: getColor(cell.status) }}>
                          <Table.Td>{slot}</Table.Td>
                          <Table.Td>
                            {cell.status === "accepted" ? (
                              <>
                                <div>Mesa {cell.table}</div>
                                {cell.participants.map((pid, idx) => (
                                  <Text key={idx} size="xs">
                                    {participantsInfo[pid]
                                      ? `${participantsInfo[pid].nombre} (${participantsInfo[pid].empresa})`
                                      : "Cargando..."}
                                  </Text>
                                ))}
                              </>
                            ) : cell.status === "break" ? (
                              "Descanso"
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

import { useState, useEffect, useRef } from "react";
import {
  Container,
  Title,
  Text,
  Flex,
  Table,
  Card,
  Tabs,
  ScrollArea,
  Divider,
  Badge,
  Chip,
  Alert,
  TextInput,
  Select,
} from "@mantine/core";
import { db } from "../../firebase/firebaseConfig";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  updateDoc,
} from "firebase/firestore";
import anime from "animejs";
import { useParams } from "react-router-dom";
import QuickMeetingModal from "./QuickMeetingModal";

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
const slotOverlapsBreakBlock = (
  slotStart,
  meetingDuration,
  breakBlocks = []
) => {
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

const statusLabels = {
  available: { label: "Disponible", color: "white" },
  occupied: { label: "Ocupado", color: "yellow" },
  break: { label: "Descanso", color: "blue" },
  accepted: { label: "Reservada", color: "white" },
};

function StatusBadge({ status }) {
  const st = statusLabels[status] || statusLabels.available;
  return (
    <Badge color={st.color} variant="light" radius="sm" size="sm">
      {st.label}
    </Badge>
  );
}

function ParticipantsChips({ participants }) {
  return (
    <Flex gap="xs" wrap="wrap">
      {participants.map((p, i) => (
        <Chip
          key={i}
          checked
          size="xs"
          radius="sm"
          color="teal"
          style={{ pointerEvents: "none" }}
        >
          {p}
        </Chip>
      ))}
    </Flex>
  );
}

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
  const [typeFilter, setTypeFilter] = useState("");

  const [quickModal, setQuickModal] = useState({
    opened: false,
    slot: null,
    defaultUser: null,
  });
  const [creatingMeeting, setCreatingMeeting] = useState(false);
  const [globalMessage, setGlobalMessage] = useState("");
  const [userSearch, setUserSearch] = useState("");

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
      setAgenda(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
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
      setMeetings(
        snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
          timeSlot: d.data().timeSlot.match(/\d{2}:\d{2}/)[0],
        }))
      );
    });
  }, [config, eventId]);

  // Carga asistentes registrados al evento
  useEffect(() => {
    if (!eventId) return;
    (async () => {
      const snap = await getDocs(
        query(collection(db, "users"), where("eventId", "==", eventId))
      );
      setAsistentes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
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
      breakBlocks = [],
    } = config.config;

    const timeSlots = generateTimeSlots(
      startTime,
      endTime,
      meetingDuration,
      breakTime
    );

    // Inicializa matriz con estados 'available' o 'break'
    const baseMatrix = Array.from({ length: numTables }, () =>
      timeSlots.map((slot) => ({
        status: slotOverlapsBreakBlock(slot, meetingDuration, breakBlocks)
          ? "break"
          : "available",
        participants: [],
      }))
    );

    // Marca slots según datos de agenda
    agenda.forEach((slot) => {
      const tIdx = slot.tableNumber - 1;
      const sIdx = timeSlots.indexOf(slot.startTime);
      if (tIdx >= 0 && sIdx >= 0) {
        baseMatrix[tIdx][sIdx] = {
          status: slot.available ? "available" : "occupied",
          participants: [],
        };
      }
    });

    // Marca reuniones aceptadas
    meetings.forEach((mtg) => {
      const tIdx = Number(mtg.tableAssigned) - 1;
      const sIdx = timeSlots.indexOf(mtg.timeSlot.trim());
      if (tIdx >= 0 && sIdx >= 0) {
        baseMatrix[tIdx][sIdx] = {
          status: "accepted",
          participants: mtg.participants.map((id) =>
            participantsInfo[id]
              ? `${participantsInfo[id].nombre} (${participantsInfo[id].empresa})`
              : "Cargando..."
          ),
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
      breakBlocks = [],
    } = config.config;
    const timeSlots = generateTimeSlots(
      startTime,
      endTime,
      meetingDuration,
      breakTime
    );

    const usersMatrix = asistentes.map((user) => {
      const row = timeSlots.map((slot) => {
        if (slotOverlapsBreakBlock(slot, meetingDuration, breakBlocks)) {
          return { status: "break" };
        }
        const mtg = meetings.find(
          (m) => m.timeSlot === slot && m.participants.includes(user.id)
        );
        if (mtg) {
          return {
            status: "accepted",
            table: mtg.tableAssigned,
            participants: mtg.participants.filter((pid) => pid !== user.id),
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
          backgroundColor: getColor(
            matrix[Math.floor(idx / matrix[0].length)][idx % matrix[0].length]
              .status
          ),
          duration: 500,
          easing: "easeInOutQuad",
        });
      }
    });
  }, [matrix]);

  // Colores según estado
  const getColor = (status) => {
    switch (status) {
      case "available":
        return "#d3d3d3";
      case "occupied":
        return "#ffa500";
      case "accepted":
        return "#4caf50";
      case "break":
        return "#90caf9";
      default:
        return "#d3d3d3";
    }
  };

  const handleQuickCreateMeeting = async ({ user1, user2, slot }) => {
    setCreatingMeeting(true);
    try {
      // 1. Crear el documento en meetings
      const meetingRef = await addDoc(
        collection(db, "events", eventId, "meetings"),
        {
          eventId,
          requesterId: user1,
          receiverId: user2,
          status: "accepted",
          createdAt: new Date(),
          timeSlot: `${slot.startTime} - ${slot.endTime}`,
          tableAssigned: slot.tableNumber.toString(),
          participants: [user1, user2],
        }
      );

      // 2. Actualizar el slot en agenda
      await updateDoc(doc(db, "agenda", slot.id), {
        available: false,
        meetingId: meetingRef.id,
      });

      setGlobalMessage("¡Reunión creada correctamente!");
      setQuickModal({ opened: false, slot: null, defaultUser: null });
    } catch (e) {
      setGlobalMessage("Error creando la reunión.");
      console.error(e);
    }
    setCreatingMeeting(false);
  };

  const filteredMatrixUsuarios = matrixUsuarios.filter(({ asistente }) => {
    const matchesName = (asistente.nombre || "")
      .toLowerCase()
      .includes(userSearch.toLowerCase());
    const matchesType =
      !typeFilter ||
      (asistente.tipoAsistente || "").toLowerCase() === typeFilter;
    return matchesName && matchesType;
  });

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

        <Tabs.Panel value="mesas" pt="md">
          <ScrollArea>
            <Flex gap="lg" justify="center" align="flex-start" wrap="wrap">
              {matrix.map((table, ti) => (
                <Card
                  key={ti}
                  shadow="md"
                  radius="lg"
                  style={{
                    minWidth: 260,
                    maxWidth: 330,
                    margin: "0 16px 16px 0",
                    background: "#f9fafb",
                    border: "1px solid #e5e7eb",
                    boxShadow: "0 2px 12px #0001",
                  }}
                >
                  <Title order={5} align="center" mb="xs">
                    Mesa {ti + 1}
                  </Title>
                  <Divider mb="sm" />
                  <Table
                    striped
                    highlightOnHover
                    horizontalSpacing="sm"
                    verticalSpacing={8}
                    style={{ borderRadius: 12, overflow: "hidden" }}
                  >
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Hora</Table.Th>
                        <Table.Th>Estado</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {table.map((cell, si) => (
                        <Table.Tr
                          key={`${ti}-${si}`}
                          ref={(el) =>
                            (tableRefs.current[ti * matrix[0].length + si] = el)
                          }
                          style={{
                            backgroundColor: getColor(cell.status),
                            borderRadius: 5,
                            cursor:
                              cell.status === "available"
                                ? "pointer"
                                : "default",
                          }}
                          onClick={() =>
                            cell.status === "available" &&
                            setQuickModal({
                              opened: true,
                              slot: {
                                ...agenda.find(
                                  (s) =>
                                    s.tableNumber === ti + 1 &&
                                    s.startTime ===
                                      generateTimeSlots(
                                        config.config.startTime,
                                        config.config.endTime,
                                        config.config.meetingDuration,
                                        config.config.breakTime
                                      )[si]
                                ),
                              },
                              defaultUser: null,
                            })
                          }
                        >
                          <Table.Td style={{ fontWeight: 500 }}>
                            {
                              generateTimeSlots(
                                config.config.startTime,
                                config.config.endTime,
                                config.config.meetingDuration,
                                config.config.breakTime
                              )[si]
                            }
                          </Table.Td>
                          <Table.Td>
                            <StatusBadge status={cell.status} />
                            {cell.status === "accepted" && (
                              <ParticipantsChips
                                participants={cell.participants}
                              />
                            )}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Card>
              ))}
            </Flex>
          </ScrollArea>
        </Tabs.Panel>

        {/* Vista por Usuarios */}
        <Tabs.Panel value="usuarios" pt="md">
          <Flex gap="md" mb="md" wrap="wrap">
            <TextInput
              placeholder="Buscar usuario por nombre..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.currentTarget.value)}
              style={{ maxWidth: 250 }}
            />
            <Select
              placeholder="Filtrar por tipo"
              value={typeFilter}
              onChange={setTypeFilter}
              data={[
                { value: "", label: "Todos" },
                { value: "comprador", label: "Comprador" },
                { value: "vendedor", label: "Vendedor" },
              ]}
              style={{ maxWidth: 180 }}
              clearable
            />
          </Flex>

          <ScrollArea>
            <Flex gap="lg" justify="center" align="flex-start" wrap="wrap">
              {filteredMatrixUsuarios.map(({ asistente, row }) => (
                <Card
                  key={asistente.id}
                  shadow="md"
                  radius="lg"
                  style={{
                    minWidth: 300,
                    maxWidth: 400,
                    margin: "0 16px 16px 0",
                    background: "#f8fafc",
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <Title order={5} align="center" mb="xs">
                    {asistente.nombre}
                  </Title>
                  <Divider mb="sm" />
                  <Table striped highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Hora</Table.Th>
                        <Table.Th>Detalle</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {generateTimeSlots(
                        config.config.startTime,
                        config.config.endTime,
                        config.config.meetingDuration,
                        config.config.breakTime
                      ).map((slot, i) => {
                        const cell = row[i];
                        return (
                          <Table.Tr
                            key={i}
                            style={{
                              backgroundColor: getColor(cell.status),
                              cursor:
                                cell.status === "available"
                                  ? "pointer"
                                  : "default",
                            }}
                            onClick={() =>
                              cell.status === "available" &&
                              setQuickModal({
                                opened: true,
                                slot: {
                                  ...agenda.find(
                                    (s) =>
                                      s.tableNumber === cell.table ||
                                      s.startTime === slot
                                  ),
                                  startTime: slot,
                                },
                                defaultUser: asistente,
                              })
                            }
                          >
                            <Table.Td>{slot}</Table.Td>
                            <Table.Td>
                              <StatusBadge status={cell.status} />
                              {cell.status === "accepted" && (
                                <>
                                  <Text size="xs" mb={2}>
                                    Mesa {cell.table}
                                  </Text>
                                  <ParticipantsChips
                                    participants={cell.participants.map((pid) =>
                                      participantsInfo[pid]
                                        ? `${participantsInfo[pid].nombre} (${participantsInfo[pid].empresa})`
                                        : "Cargando..."
                                    )}
                                  />
                                </>
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
          </ScrollArea>
        </Tabs.Panel>
      </Tabs>
      <QuickMeetingModal
        opened={quickModal.opened}
        onClose={() =>
          setQuickModal({ opened: false, slot: null, defaultUser: null })
        }
        slot={quickModal.slot}
        defaultUser={quickModal.defaultUser}
        assistants={asistentes}
        onCreate={handleQuickCreateMeeting}
        loading={creatingMeeting}
      />
      {globalMessage && (
        <Alert
          mt="md"
          title="Aviso"
          color="green"
          withCloseButton
          onClose={() => setGlobalMessage("")}
        >
          {globalMessage}
        </Alert>
      )}
    </Container>
  );
};

export default MatrixPage;

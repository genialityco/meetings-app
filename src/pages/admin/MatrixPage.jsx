import { useState, useEffect, useRef, useMemo } from "react";
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
  Tooltip,
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
  runTransaction,
} from "firebase/firestore";
import { useParams } from "react-router-dom";
import QuickMeetingModal from "./QuickMeetingModal";
import EditMeetingModal from "./EditMeetingModal";

// ----------------- Utilidades -------------------
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
      (slotStartMin >= blockStartMin && slotStartMin < blockEndMin) ||
      (slotEndMin > blockStartMin && slotEndMin <= blockEndMin) ||
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

// Retorna asistentes libres para ese slot (o que ya estaban en esa reunión)
function getAvailableUsersForSlot(assistants, meetings, slot, meeting = null) {
  // Busca participantes ocupados en ese mismo slot, ignorando la reunión actual (si existe)
  const occupiedIds = new Set();
  meetings.forEach((m) => {
    if (
      (!meeting || m.id !== meeting.id) &&
      m.timeSlot &&
      m.timeSlot.startsWith(slot.startTime)
    ) {
      m.participants.forEach((pid) => occupiedIds.add(pid));
    }
  });

  // Los asistentes libres o que ya están en la reunión actual
  const allowedIds = meeting?.participants || [];
  return assistants.filter(
    (a) => !occupiedIds.has(a.id) || allowedIds.includes(a.id)
  );
}

// ----------------- Componente principal -------------------
const MatrixPage = () => {
  const { eventId } = useParams();
  const [config, setConfig] = useState(null);
  const [agenda, setAgenda] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [participantsInfo, setParticipantsInfo] = useState({});
  const [asistentes, setAsistentes] = useState([]);
  const [matrix, setMatrix] = useState([]);
  const [matrixUsuarios, setMatrixUsuarios] = useState([]);
  const [meetingsRemontadas, setMeetingsRemontadas] = useState([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [quickModal, setQuickModal] = useState({
    opened: false,
    slot: null,
    defaultUser: null,
  });
  const [editModal, setEditModal] = useState({
    opened: false,
    meeting: null,
    slot: null,
    lockedUserId: null,
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
        }))
      );
    });
  }, [config, eventId]);

  // Carga asistentes registrados al evento (solo 1 vez)
  useEffect(() => {
    if (!eventId) return;
    (async () => {
      const snap = await getDocs(
        query(collection(db, "users"), where("eventId", "==", eventId))
      );
      setAsistentes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    })();
  }, [eventId]);

  // Carga rápida de info de participantes usando asistentes (más eficiente)
  useEffect(() => {
    if (asistentes.length === 0) return;
    const users = {};
    asistentes.forEach((a) => (users[a.id] = a));
    setParticipantsInfo(users);
  }, [asistentes]);

  // Detecta reuniones huérfanas/sobreescritas
  useEffect(() => {
    if (meetings.length === 0 || agenda.length === 0) {
      setMeetingsRemontadas([]);
      return;
    }
    const meetingIdsEnAgenda = new Set(
      agenda.map((a) => a.meetingId).filter(Boolean)
    );
    const huerfanas = meetings.filter((mtg) => !meetingIdsEnAgenda.has(mtg.id));
    setMeetingsRemontadas(huerfanas);
  }, [meetings, agenda]);

  // MEMOIZA timeSlots (se calcula solo si la config cambia)
  const timeSlots = useMemo(
    () =>
      config
        ? generateTimeSlots(
            config.config.startTime,
            config.config.endTime,
            config.config.meetingDuration,
            config.config.breakTime
          )
        : [],
    [config]
  );

  // MEMOIZA matriz por mesas
  const memoMatrix = useMemo(() => {
    if (!config) return [];
    const {
      numTables,
      meetingDuration,
      breakTime,
      startTime,
      endTime,
      breakBlocks = [],
    } = config.config;

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
      const [startTime] = mtg.timeSlot.split(" - ");
      const tIdx = Number(mtg.tableAssigned) - 1;
      const sIdx = timeSlots.indexOf(startTime);
      if (tIdx >= 0 && sIdx >= 0) {
        baseMatrix[tIdx][sIdx] = {
          status: "accepted",
          participants: mtg.participants.map((id) =>
            participantsInfo[id]
              ? `${participantsInfo[id].empresa} (${participantsInfo[id].nombre})`
              : id
          ),
          meetingId: mtg.id,
          meetingData: mtg,
        };
      }
    });

    return baseMatrix;
  }, [config, agenda, meetings, participantsInfo, timeSlots]);

  // MEMOIZA matriz por usuarios
  const memoMatrixUsuarios = useMemo(() => {
    if (!config || asistentes.length === 0) return [];
    const {
      meetingDuration,
      breakTime,
      startTime,
      endTime,
      breakBlocks = [],
    } = config.config;

    return asistentes.map((user) => {
      const row = timeSlots.map((slot) => {
        if (slotOverlapsBreakBlock(slot, meetingDuration, breakBlocks)) {
          return { status: "break" };
        }
        // Solo compara el startTime
        const mtg = meetings.find((m) => {
          if (!m.timeSlot) return false;
          const [start] = m.timeSlot.split(" - ");
          return start === slot && m.participants.includes(user.id);
        });

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
  }, [config, asistentes, meetings, participantsInfo, timeSlots]);

  // Tabla usuarios filtrada
  const filteredMatrixUsuarios = useMemo(
    () =>
      memoMatrixUsuarios.filter(({ asistente }) => {
        const searchTerm = userSearch.toLowerCase();
        const matchesSearch =
          (asistente.nombre || "").toLowerCase().includes(searchTerm) ||
          (asistente.empresa || "").toLowerCase().includes(searchTerm);
        const matchesType =
          !typeFilter ||
          (asistente.tipoAsistente || "").toLowerCase() ===
            typeFilter.toLowerCase();

        return matchesSearch && matchesType;
      }),
    [memoMatrixUsuarios, userSearch, typeFilter]
  );

  // ----------------- Acciones rápidas -------------------

  const handleQuickCreateMeeting = async ({ user1, user2, slot }) => {
    setCreatingMeeting(true);
    try {
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

  const handleEditMeeting = async ({ meetingId, user1, user2 }) => {
    setCreatingMeeting(true);
    try {
      await updateDoc(doc(db, "events", eventId, "meetings", meetingId), {
        participants: [user1, user2],
        requesterId: user1,
        receiverId: user2,
      });

      setGlobalMessage("¡Reunión actualizada!");
      setEditModal({ opened: false, meeting: null, slot: null });
    } catch (e) {
      setGlobalMessage("Error actualizando la reunión.");
      console.error(e);
    }
    setCreatingMeeting(false);
  };

  const handleCancelMeeting = async (meetingId, slotId) => {
    if (!window.confirm("¿Seguro que quieres cancelar esta reunión?")) return;
    setCreatingMeeting(true);
    try {
      await updateDoc(doc(db, "events", eventId, "meetings", meetingId), {
        status: "cancelled",
      });
      if (slotId) {
        await updateDoc(doc(db, "agenda", slotId), {
          available: true,
          meetingId: null,
        });
      }
      setGlobalMessage("¡Reunión cancelada!");
      setEditModal({ opened: false, meeting: null, slot: null });
    } catch (e) {
      setGlobalMessage("Error cancelando la reunión.");
      console.error(e);
    }
    setCreatingMeeting(false);
  };

  const handleSwapMeetings = async (meetingA, slotA, meetingB, slotB) => {
    setCreatingMeeting(true);
    try {
      // Usa una transacción para evitar inconsistencia
      await runTransaction(db, async (transaction) => {
        // 1. Actualiza meetingA con datos de meetingB
        transaction.update(
          doc(db, "events", eventId, "meetings", meetingA.id),
          {
            timeSlot: meetingB.timeSlot,
            tableAssigned: meetingB.tableAssigned,
          }
        );
        // 2. Actualiza meetingB con datos de meetingA
        transaction.update(
          doc(db, "events", eventId, "meetings", meetingB.id),
          {
            timeSlot: meetingA.timeSlot,
            tableAssigned: meetingA.tableAssigned,
          }
        );

        // 3. Actualiza la agenda
        // slotA debe ahora tener el id de meetingB
        transaction.update(doc(db, "agenda", slotA.id), {
          meetingId: meetingB.id,
        });
        // slotB debe tener el id de meetingA
        transaction.update(doc(db, "agenda", slotB.id), {
          meetingId: meetingA.id,
        });
      });

      setGlobalMessage("¡Reuniones intercambiadas exitosamente!");
    } catch (e) {
      setGlobalMessage("Error intercambiando reuniones.");
      console.error(e);
    }
    setCreatingMeeting(false);
  };

  // ----------------- Render -------------------

  return (
    <Container fluid>
      <Title order={2} mt="md" mb="md" align="center">
        Matriz Rueda de Negocios — Evento {config?.eventName || "Desconocido"}
      </Title>

      {meetingsRemontadas.length > 0 && (
        <Card mt="md" shadow="md" p="md" withBorder>
          <Title order={5} mb="xs">
            Reuniones huérfanas / sobreescritas ({meetingsRemontadas.length})
          </Title>
          <Text size="sm" mb="sm">
            Estas reuniones existen en la base, pero ya no están asociadas a
            ningún slot de agenda. Pueden ser reuniones antiguas, remontadas o
            mal referenciadas.
          </Text>
          <ScrollArea h={220}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Hora</Table.Th>
                  <Table.Th>Mesa</Table.Th>
                  <Table.Th>Participantes</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {meetingsRemontadas.map((mtg) => (
                  <Table.Tr key={mtg.id}>
                    <Table.Td>{mtg.timeSlot}</Table.Td>
                    <Table.Td>{mtg.tableAssigned}</Table.Td>
                    <Table.Td>
                      <ParticipantsChips
                        participants={mtg.participants.map((pid) =>
                          participantsInfo[pid]
                            ? `${participantsInfo[pid].empresa} (${participantsInfo[pid].nombre})`
                            : pid
                        )}
                      />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Card>
      )}

      <Tabs defaultValue="mesas">
        <Tabs.List>
          <Tabs.Tab value="mesas">Por Mesas</Tabs.Tab>
          <Tabs.Tab value="usuarios">Por Usuarios</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="mesas" pt="md">
          <ScrollArea>
            <Flex gap="lg" justify="center" align="flex-start" wrap="wrap">
              {memoMatrix.map((table, ti) => (
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
                          style={{
                            backgroundColor: getColor(cell.status),
                            borderRadius: 5,
                            cursor:
                              cell.status === "available"
                                ? "pointer"
                                : "default",
                          }}
                          onClick={() => {
                            if (cell.status === "available") {
                              setQuickModal({
                                opened: true,
                                slot: {
                                  ...agenda.find(
                                    (s) =>
                                      s.tableNumber === ti + 1 &&
                                      s.startTime === timeSlots[si]
                                  ),
                                },
                                defaultUser: null,
                              });
                            } else if (cell.status === "accepted") {
                              const [startTime, endTime] =
                                cell.meetingData.timeSlot.split(" - ");
                              setEditModal({
                                opened: true,
                                meeting: cell.meetingData,
                                slot: {
                                  tableNumber: cell.meetingData.tableAssigned,
                                  startTime,
                                  endTime,
                                  id: agenda.find(
                                    (s) =>
                                      s.tableNumber ===
                                        Number(
                                          cell.meetingData.tableAssigned
                                        ) && s.startTime === startTime
                                  )?.id,
                                },
                                lockedUserId: null,
                              });
                            }
                          }}
                        >
                          <Table.Td style={{ fontWeight: 500 }}>
                            {timeSlots[si]}
                          </Table.Td>
                          <Table.Td>
                            <StatusBadge status={cell.status} />
                            {cell.status === "accepted" && (
                              <Tooltip
                                multiline
                                width={320}
                                withArrow
                                label={
                                  <>
                                    <b>Participantes:</b>
                                    {cell.meetingData?.participants?.map(
                                      (pid, idx) => {
                                        const info = participantsInfo[pid];
                                        if (!info)
                                          return <div key={pid}>{pid}</div>;
                                        return (
                                          <div
                                            key={pid}
                                            style={{ marginBottom: 6 }}
                                          >
                                            <b>
                                              {info.empresa} ({info.nombre})
                                            </b>
                                            <div>
                                              <span
                                                style={{ color: "#6c6c6c" }}
                                              >
                                                Descripción:{" "}
                                              </span>
                                              {info.descripcion || (
                                                <i>No especificada</i>
                                              )}
                                            </div>
                                            <div>
                                              <span
                                                style={{ color: "#6c6c6c" }}
                                              >
                                                Necesidad:{" "}
                                              </span>
                                              {info.necesidad || (
                                                <i>No especificada</i>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      }
                                    )}
                                  </>
                                }
                              >
                                <div>
                                  <ParticipantsChips
                                    participants={cell.participants.map((pid) =>
                                      participantsInfo[pid]
                                        ? `${participantsInfo[pid].empresa} (${participantsInfo[pid].nombre})`
                                        : pid
                                    )}
                                  />
                                </div>
                              </Tooltip>
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
                    {asistente.nombre} ({asistente.empresa})
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
                      {timeSlots.map((slot, i) => {
                        const cell = row[i];
                        return (
                          <Table.Tr
                            key={i}
                            style={{
                              backgroundColor: getColor(cell.status),
                              cursor:
                                cell.status === "available"
                                  ? "pointer"
                                  : cell.status === "accepted"
                                  ? "pointer"
                                  : "default",
                            }}
                            onClick={() => {
                              if (cell.status === "available") {
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
                                });
                              } else if (cell.status === "accepted") {
                                const meeting = meetings.find((m) => {
                                  if (!m.timeSlot) return false;
                                  const [start] = m.timeSlot.split(" - ");
                                  return (
                                    start === slot &&
                                    m.participants.includes(asistente.id)
                                  );
                                });

                                if (meeting) {
                                  const [startTime, endTime] =
                                    meeting.timeSlot.split(" - ");
                                  setEditModal({
                                    opened: true,
                                    meeting: meeting,
                                    slot: {
                                      tableNumber: meeting.tableAssigned,
                                      startTime,
                                      endTime,
                                      id: agenda.find(
                                        (s) =>
                                          s.tableNumber ===
                                            Number(meeting.tableAssigned) &&
                                          s.startTime === startTime
                                      )?.id,
                                    },
                                    lockedUserId: asistente.id,
                                  });
                                }
                              }
                            }}
                          >
                            <Table.Td>{slot}</Table.Td>
                            <Table.Td>
                              <StatusBadge status={cell.status} />
                              {cell.status === "accepted" && (
                                <>
                                  <Text size="xs" mb={2}>
                                    Mesa {cell.table}
                                  </Text>
                                  <Tooltip
                                    multiline
                                    width={340}
                                    withArrow
                                    label={
                                      <div>
                                        <div style={{ marginBottom: 12 }}>
                                          <b>Usuario:</b>
                                          <div>
                                            <b>
                                              {asistente.empresa} (
                                              {asistente.nombre})
                                            </b>
                                          </div>
                                          <div>
                                            <span style={{ color: "#6c6c6c" }}>
                                              Descripción:{" "}
                                            </span>
                                            {asistente.descripcion || (
                                              <i>No especificada</i>
                                            )}
                                          </div>
                                          <div>
                                            <span style={{ color: "#6c6c6c" }}>
                                              Necesidad:{" "}
                                            </span>
                                            {asistente.necesidad || (
                                              <i>No especificada</i>
                                            )}
                                          </div>
                                        </div>
                                        <Divider my={4} />
                                        <div>
                                          <b>Contraparte:</b>
                                          {cell.participants.map((pid) => {
                                            const info = participantsInfo[pid];
                                            if (!info)
                                              return <div key={pid}>{pid}</div>;
                                            return (
                                              <div
                                                key={pid}
                                                style={{ marginBottom: 6 }}
                                              >
                                                <b>
                                                  {info.empresa} ({info.nombre})
                                                </b>
                                                <div>
                                                  <span
                                                    style={{ color: "#6c6c6c" }}
                                                  >
                                                    Descripción:{" "}
                                                  </span>
                                                  {info.descripcion || (
                                                    <i>No especificada</i>
                                                  )}
                                                </div>
                                                <div>
                                                  <span
                                                    style={{ color: "#6c6c6c" }}
                                                  >
                                                    Necesidad:{" "}
                                                  </span>
                                                  {info.necesidad || (
                                                    <i>No especificada</i>
                                                  )}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    }
                                  >
                                    <div>
                                      <ParticipantsChips
                                        participants={[
                                          `${asistente.empresa} (${asistente.nombre})`,
                                          ...cell.participants.map((pid) =>
                                            participantsInfo[pid]
                                              ? `${participantsInfo[pid].empresa} (${participantsInfo[pid].nombre})`
                                              : pid
                                          ),
                                        ]}
                                      />
                                    </div>
                                  </Tooltip>
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
        assistants={getAvailableUsersForSlot(
          asistentes,
          meetings,
          quickModal.slot || {}
        )}
        onCreate={handleQuickCreateMeeting}
        loading={creatingMeeting}
      />

      <EditMeetingModal
        opened={editModal.opened}
        onClose={() =>
          setEditModal({ opened: false, meeting: null, slot: null })
        }
        slot={editModal.slot}
        meeting={editModal.meeting}
        assistants={getAvailableUsersForSlot(
          asistentes,
          meetings,
          editModal.slot || {},
          editModal.meeting
        )}
        onUpdate={handleEditMeeting}
        onCancel={handleCancelMeeting}
        loading={creatingMeeting}
        lockedUserId={editModal.lockedUserId}
        onSwapMeetings={handleSwapMeetings}
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

// ----------------- Helper de color -------------------
function getColor(status) {
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
}

export default MatrixPage;

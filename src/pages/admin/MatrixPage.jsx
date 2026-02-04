import { useState, useEffect, useMemo } from "react";
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
  Menu,
  Button,
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
import { useDashboardData } from "../dashboard/useDashboardData";

// ----------- UTILIDADES -----------

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

function getAvailableUsersForSlot(assistants, meetings, slot, meeting = null) {
  if (!slot || !slot.startTime) return [];
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
  const allowedIds = meeting?.participants || [];
  return assistants.filter(
    (a) => !occupiedIds.has(a.id) || allowedIds.includes(a.id)
  );
}

function haySolapamiento(slotA, slotB) {
  if (!slotA || !slotB) return false;
  const [aStart, aEnd] = slotA.split(" - ").map((t) => t.trim());
  const [bStart, bEnd] = slotB.split(" - ").map((t) => t.trim());
  function toMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }
  const aStartMin = toMinutes(aStart);
  const aEndMin = toMinutes(aEnd);
  const bStartMin = toMinutes(bStart);
  const bEndMin = toMinutes(bEnd);
  return aStartMin < bEndMin && bStartMin < aEndMin;
}

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

// ----------- COMPONENTE PRINCIPAL -----------

const MatrixPage = () => {
  const { eventId } = useParams();
  const dashboard = useDashboardData(eventId);

  const [config, setConfig] = useState(null);
  const [agenda, setAgenda] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [participantsInfo, setParticipantsInfo] = useState({});
  const [asistentes, setAsistentes] = useState([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [quickModal, setQuickModal] = useState({
    opened: false,
    slotsDisponibles: [],
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
  const [pendingMeetings, setPendingMeetings] = useState([]);

  // Carga configuración evento
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
      collection(db, "events", eventId, "agenda"),
      orderBy("startTime")
    );
    return onSnapshot(q, (snap) => {
      setAgenda(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [config, eventId]);

  // Suscripción a reuniones aceptadas y pendientes
  useEffect(() => {
    if (!config) return;
    const q = query(
      collection(db, "events", eventId, "meetings"),
      where("status", "in", ["accepted", "pending"])
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

  // Carga asistentes
  useEffect(() => {
    if (!eventId) return;
    (async () => {
      const snap = await getDocs(
        query(collection(db, "users"), where("eventId", "==", eventId))
      );
      setAsistentes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    })();
  }, [eventId]);

  // Map para info rápida
  useEffect(() => {
    if (asistentes.length === 0) return;
    const users = {};
    asistentes.forEach((a) => (users[a.id] = a));
    setParticipantsInfo(users);
  }, [asistentes]);

  // Solicitudes pendientes
  useEffect(() => {
    if (!eventId) return;
    const q = query(
      collection(db, "events", eventId, "meetings"),
      where("status", "==", "pending")
    );
    return onSnapshot(q, (snap) => {
      setPendingMeetings(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [eventId]);

  // Memoize timeSlots
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

  // Memoize matriz por mesas
  const memoMatrix = useMemo(() => {
  if (!config) return [];
  const { numTables, meetingDuration, breakBlocks = [] } = config.config;

  const baseMatrix = Array.from({ length: numTables }, () =>
    timeSlots.map((slot) => ({
      status: slotOverlapsBreakBlock(slot, meetingDuration, breakBlocks)
        ? "break"
        : "available",
      participants: [],
    }))
  );

  agenda.forEach((slot) => {
    const tIdx = slot.tableNumber - 1;
    const sIdx = timeSlots.indexOf(slot.startTime);
    // ✅ Añade validación para tIdx < numTables
    if (tIdx >= 0 && tIdx < numTables && sIdx >= 0) {
      baseMatrix[tIdx][sIdx] = {
        status: slot.available ? "available" : "occupied",
        participants: [],
      };
    }
  });

  meetings.forEach((mtg) => {
    if (mtg.status !== "accepted" || !mtg.timeSlot) return;
    const [startTime] = mtg.timeSlot.split(" - ");
    const tIdx = Number(mtg.tableAssigned) - 1;
    const sIdx = timeSlots.indexOf(startTime);
    // ✅ Añade validación para tIdx < numTables
    if (tIdx >= 0 && tIdx < numTables && sIdx >= 0) {
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

  // Memoize matriz por usuarios
  const memoMatrixUsuarios = useMemo(() => {
    if (!config || asistentes.length === 0) return [];
    const { meetingDuration, breakBlocks = [] } = config.config;

    return asistentes.map((user) => {
      const row = timeSlots.map((slot) => {
        if (slotOverlapsBreakBlock(slot, meetingDuration, breakBlocks)) {
          return { status: "break" };
        }
        const mtg = meetings.find((m) => {
          if (!m.timeSlot) return false;
          const [start] = m.timeSlot.split(" - ");
          return start === slot && m.participants.includes(user.id);
        });

        if (mtg && mtg.status === "accepted") {
          return {
            status: "accepted",
            table: mtg.tableAssigned,
            participants: mtg.participants.filter((pid) => pid !== user.id),
          };
        } else if (mtg && mtg.status === "pending") {
          return {
            status: "pending",
            table: mtg.tableAssigned,
            participants: mtg.participants.filter((pid) => pid !== user.id),
          };
        }
        return { status: "available" };
      });
      return { asistente: user, row };
    });
  }, [config, asistentes, meetings, participantsInfo, timeSlots]);

  // Filtrado usuarios
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

  // --------- FILTRAR SLOTS DISPONIBLES PARA EDICIÓN ---------
  const slotsDisponiblesParaEdicion = useMemo(() => {
    if (!editModal.meeting || !editModal.slot) return [];

    return agenda.filter((slotItem) => {
      const isSameTime = slotItem.startTime === editModal.slot.startTime;
      const isAvailable = slotItem.available;
      const isCurrentTable =
        slotItem.tableNumber === Number(editModal.meeting.tableAssigned);
      return isSameTime && (isAvailable || isCurrentTable);
    });
  }, [agenda, editModal.meeting, editModal.slot]);
  //------------------------------------------------------------

  // ------------ FUNCIONES DE CREACION, EDICIÓN, CANCELACIÓN, INTERCAMBIO ------------
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
      await updateDoc(doc(db, "events", eventId, "agenda", slot.id), {
        available: false,
        meetingId: meetingRef.id,
      });

      // --- Notificar a ambos participantes ---
      const receiver = asistentes.find((a) => a.id === user2);
      const requester = asistentes.find((a) => a.id === user1);
      const slotStr = `${slot.startTime} - ${slot.endTime}`;
      const mesa = slot.tableNumber;

      if (receiver && requester) {
        // WhatsApp
        dashboard.sendMeetingAcceptedWhatsapp(receiver.telefono, requester, {
          timeSlot: slotStr,
          tableAssigned: mesa,
        });
        dashboard.sendMeetingAcceptedWhatsapp(requester.telefono, receiver, {
          timeSlot: slotStr,
          tableAssigned: mesa,
        });
        // SMS
        dashboard.sendSms(
          `¡Tu reunión ha sido aceptada!\nCon: ${requester.nombre}\nEmpresa: ${requester.empresa}\nHorario: ${slotStr}\nMesa: ${mesa}`,
          receiver.telefono
        );
        dashboard.sendSms(
          `¡Tu reunión ha sido aceptada!\nCon: ${receiver.nombre}\nEmpresa: ${receiver.empresa}\nHorario: ${slotStr}\nMesa: ${mesa}`,
          requester.telefono
        );
      }

      setGlobalMessage("¡Reunión creada correctamente!");
      setQuickModal({ opened: false, slot: null, defaultUser: null });
    } catch (e) {
      setGlobalMessage("Error creando la reunión.");
      console.error(e);
    }
    setCreatingMeeting(false);
  };

  const handleEditMeeting = async ({ meetingId, user1, user2, slot }) => {
    setCreatingMeeting(true);

    try {
      // Buscar reuniones aceptadas que tengan conflicto con el nuevo slot para user1 y user2
      const reunionesAceptadas = meetings.filter(
        (m) => m.status === "accepted" && m.id !== meetingId
      );

      const nuevoSlotStr = `${slot.startTime} - ${slot.endTime}`;

      const hayConflicto = (userId) =>
        reunionesAceptadas.some(
          (m) =>
            m.participants.includes(userId) &&
            haySolapamiento(m.timeSlot, nuevoSlotStr)
        );

      if (hayConflicto(user1)) {
        setGlobalMessage(
          `El participante 1 no está disponible en el horario seleccionado.`
        );
        setCreatingMeeting(false);
        return;
      }
      if (hayConflicto(user2)) {
        setGlobalMessage(
          `El participante 2 no está disponible en el horario seleccionado.`
        );
        setCreatingMeeting(false);
        return;
      }

      // Obtener la reunión actual para liberar su slot anterior
      const meetingActual = meetings.find((m) => m.id === meetingId);

      if (!meetingActual) {
        setGlobalMessage("Reunión no encontrada.");
        setCreatingMeeting(false);
        return;
      }

      // Buscar slot agenda actual (para liberar)
      const slotActual = agenda.find(
        (s) =>
          s.tableNumber === Number(meetingActual.tableAssigned) &&
          s.startTime === meetingActual.timeSlot.split(" - ")[0]
      );

      // Actualizar reunión con nuevos datos
      await updateDoc(doc(db, "events", eventId, "meetings", meetingId), {
        participants: [user1, user2],
        requesterId: user1,
        receiverId: user2,
        timeSlot: nuevoSlotStr,
        tableAssigned: slot.tableNumber.toString(),
      });

      // Liberar slot anterior si existe y no es el mismo que el nuevo
      if (slotActual && slotActual.id !== slot.id) {
        await updateDoc(doc(db, "events", eventId, "agenda", slotActual.id), {
          available: true,
          meetingId: null,
        });
      }

      // Marcar nuevo slot como ocupado
      await updateDoc(doc(db, "events", eventId, "agenda", slot.id), {
        available: false,
        meetingId,
      });

      // Opcional: notificar a ambos participantes (como haces en creación)
      const receiver = asistentes.find((a) => a.id === user2);
      const requester = asistentes.find((a) => a.id === user1);
      const mesa = slot.tableNumber;

      if (receiver && requester) {
        dashboard.sendMeetingAcceptedWhatsapp(receiver.telefono, requester, {
          timeSlot: nuevoSlotStr,
          tableAssigned: mesa,
        });
        dashboard.sendMeetingAcceptedWhatsapp(requester.telefono, receiver, {
          timeSlot: nuevoSlotStr,
          tableAssigned: mesa,
        });
        dashboard.sendSms(
          `¡Tu reunión ha sido actualizada!\nCon: ${requester.nombre}\nEmpresa: ${requester.empresa}\nHorario: ${nuevoSlotStr}\nMesa: ${mesa}`,
          receiver.telefono
        );
        dashboard.sendSms(
          `¡Tu reunión ha sido actualizada!\nCon: ${receiver.nombre}\nEmpresa: ${receiver.empresa}\nHorario: ${nuevoSlotStr}\nMesa: ${mesa}`,
          requester.telefono
        );
      }

      setGlobalMessage("¡Reunión actualizada correctamente!");
      setEditModal({ opened: false, meeting: null, slot: null });
    } catch (e) {
      setGlobalMessage("Error actualizando la reunión.");
      console.error(e);
    }

    setCreatingMeeting(false);
  };

  // ----------- CANCEL Y AGENDAR PENDIENTE EN SLOTS SOLO DEL USUARIO -----------
  const handleCancelMeeting = async (meetingId, slotId) => {
    setCreatingMeeting(true);
    console.log("[handleCancelMeeting] Iniciando cancelación:", {
      meetingId,
      slotId,
    });

    try {
      const cancelledMeeting = meetings.find((m) => m.id === meetingId);
      if (!cancelledMeeting) {
        console.error(
          "[handleCancelMeeting] No se encontró la reunión a cancelar:",
          meetingId
        );
        throw new Error("No se encontró la reunión a cancelar.");
      }
      console.log(
        "[handleCancelMeeting] Reunión a cancelar:",
        cancelledMeeting
      );

      // Notifica por WhatsApp y SMS a todos los participantes
      for (const participantId of cancelledMeeting.participants) {
        const participant = asistentes.find((a) => a.id === participantId);
        const otherId = cancelledMeeting.participants.find(
          (id) => id !== participantId
        );
        const other = asistentes.find((a) => a.id === otherId);
        try {
          if (participant) {
            console.log(
              `[handleCancelMeeting] Notificando a participante (${participantId}):`,
              participant
            );
            // WhatsApp
            dashboard.sendMeetingCancelledWhatsapp(
              participant.telefono,
              other,
              {
                timeSlot: cancelledMeeting.timeSlot,
                tableAssigned: cancelledMeeting.tableAssigned,
              }
            );
            // // SMS
            // dashboard.sendSms(
            //   `¡Tu reunión ha sido cancelada!\nCon: ${other?.nombre || ""}\nEmpresa: ${other?.empresa || ""}\nHorario: ${cancelledMeeting.timeSlot}\nMesa: ${cancelledMeeting.tableAssigned}`,
            //   participant.telefono
            // );
          }
        } catch (error) {
          console.error(
            `[handleCancelMeeting] Error notificando a ${participantId} (${participant?.nombre}):`,
            error
          );
        }
      }

      // 1. Marca la reunión como cancelada
      console.log(
        "[handleCancelMeeting] Marcando reunión como cancelada en Firestore..."
      );
      await updateDoc(doc(db, "events", eventId, "meetings", meetingId), {
        status: "cancelled",
      });

      // 2. Libera el slot
      if (slotId) {
        console.log("[handleCancelMeeting] Liberando slot en agenda:", slotId);
        await updateDoc(doc(db, "events", eventId, "agenda", slotId), {
          available: true,
          meetingId: null,
        });
      }

      // 3. Busca solicitudes pendientes y re-agenda en el slot liberado
      const userId = cancelledMeeting.participants[0];
      const slotLiberado = agenda.find((s) => s.id === slotId);

      const pendientesRecibidas = pendingMeetings.filter(
        (req) => req.receiverId === userId
      );
      console.log(
        "[handleCancelMeeting] Pendientes recibidas para el usuario:",
        pendientesRecibidas
      );

      // Excluye la reunión cancelada en el array de aceptadas
      const reunionesAceptadas = meetings.filter(
        (m) => m.status === "accepted" && m.id !== meetingId
      );

      const slotStr = slotLiberado
        ? `${slotLiberado.startTime} - ${slotLiberado.endTime}`
        : null;

      if (slotLiberado && slotStr) {
        for (const solicitud of pendientesRecibidas) {
          const requesterId = solicitud.requesterId;
          const solicitanteOcupado = reunionesAceptadas.some(
            (m) =>
              m.participants.includes(requesterId) &&
              haySolapamiento(m.timeSlot, slotStr)
          );
          const receiverOcupado = reunionesAceptadas.some(
            (m) =>
              m.participants.includes(userId) &&
              haySolapamiento(m.timeSlot, slotStr)
          );

          if (!solicitanteOcupado && !receiverOcupado) {
            console.log(
              `[handleCancelMeeting] Agendando solicitud pendiente (ID: ${solicitud.id}) en el slot liberado.`
            );
            // Acepta la solicitud pendiente
            await updateDoc(
              doc(db, "events", eventId, "meetings", solicitud.id),
              {
                status: "accepted",
                timeSlot: slotStr,
                tableAssigned: slotLiberado.tableNumber.toString(),
              }
            );
            await updateDoc(doc(db, "events", eventId, "agenda", slotLiberado.id), {
              available: false,
              meetingId: solicitud.id,
            });

            // Notifica a ambas partes por WhatsApp y SMS
            const receiver = asistentes.find((a) => a.id === userId);
            const requester = asistentes.find((a) => a.id === requesterId);

            if (receiver && requester) {
              console.log(
                `[handleCancelMeeting] Notificando a ambas partes por WhatsApp/SMS...`
              );
              // WhatsApp
              dashboard.sendMeetingAcceptedWhatsapp(
                receiver.telefono,
                requester,
                { timeSlot: slotStr, tableAssigned: slotLiberado.tableNumber }
              );
              dashboard.sendMeetingAcceptedWhatsapp(
                requester.telefono,
                receiver,
                { timeSlot: slotStr, tableAssigned: slotLiberado.tableNumber }
              );
              // SMS
              dashboard.sendSms(
                `¡Tu reunión ha sido aceptada!\nCon: ${requester.nombre}\nEmpresa: ${requester.empresa}\nHorario: ${slotStr}\nMesa: ${slotLiberado.tableNumber}`,
                receiver.telefono
              );
              dashboard.sendSms(
                `¡Tu reunión ha sido aceptada!\nCon: ${receiver.nombre}\nEmpresa: ${receiver.empresa}\nHorario: ${slotStr}\nMesa: ${slotLiberado.tableNumber}`,
                requester.telefono
              );
            }

            setGlobalMessage(
              "¡Solicitud pendiente agendada automáticamente en el slot liberado!"
            );
            setEditModal({ opened: false, meeting: null, slot: null });
            setCreatingMeeting(false);
            console.log(
              "[handleCancelMeeting] Finalizó, solicitud re-agendada correctamente."
            );
            return;
          }
        }
      }

      setGlobalMessage("¡Reunión cancelada!");
      setEditModal({ opened: false, meeting: null, slot: null });
      setCreatingMeeting(false);
      console.log(
        "[handleCancelMeeting] Finalizó, reunión cancelada sin reasignar slot."
      );
    } catch (e) {
      setGlobalMessage("Error cancelando la reunión.");
      setCreatingMeeting(false);
      console.error("[handleCancelMeeting] Error general:", e);
    }
  };

  const handleSwapMeetings = async (meetingA, slotA, meetingB, slotB) => {
    setCreatingMeeting(true);
    try {
      await runTransaction(db, async (transaction) => {
        transaction.update(
          doc(db, "events", eventId, "meetings", meetingA.id),
          {
            timeSlot: meetingB.timeSlot,
            tableAssigned: meetingB.tableAssigned,
          }
        );
        transaction.update(
          doc(db, "events", eventId, "meetings", meetingB.id),
          {
            timeSlot: meetingA.timeSlot,
            tableAssigned: meetingA.tableAssigned,
          }
        );
        transaction.update(doc(db, "events", eventId, "agenda", slotA.id), {
          meetingId: meetingB.id,
        });
        transaction.update(doc(db, "events", eventId, "agenda", slotB.id), {
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

  // Helper color
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

        {/* Panel Mesas */}
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
                                      (pid) => {
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

        {/* Panel Usuarios */}
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

                  <Menu withinPortal position="bottom-start">
                    <Menu.Target>
                      <Button
                        variant="light"
                        size="xs"
                        color="yellow"
                        mb="sm"
                        disabled={
                          !pendingMeetings.some(
                            (m) => m.receiverId === asistente.id
                          )
                        }
                      >
                        Solicitudes pendientes (
                        {
                          pendingMeetings.filter(
                            (m) => m.receiverId === asistente.id
                          ).length
                        }
                        )
                      </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {pendingMeetings
                        .filter((m) => m.receiverId === asistente.id)
                        .map((m) => {
                          const requester = asistentes.find(
                            (a) => a.id === m.requesterId
                          );
                          return (
                            <Menu.Item key={m.id}>
                              <div>
                                <b>
                                  {requester
                                    ? `${requester.empresa} (${requester.nombre})`
                                    : m.requesterId}
                                </b>
                                <div style={{ fontSize: 11, color: "#777" }}>
                                  {m.timeSlot || "Sin horario"}
                                </div>
                              </div>
                            </Menu.Item>
                          );
                        })}
                      {pendingMeetings.filter(
                        (m) => m.receiverId === asistente.id
                      ).length === 0 && (
                        <Menu.Item disabled>No hay pendientes</Menu.Item>
                      )}
                    </Menu.Dropdown>
                  </Menu>

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
                                // Slots disponibles para esa hora
                                const slotsDelHorario = agenda.filter(
                                  (s) => s.startTime === slot && s.available
                                );
                                setQuickModal({
                                  opened: true,
                                  slotsDisponibles: slotsDelHorario,
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
                                    meeting,
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
          setQuickModal({
            opened: false,
            slotsDisponibles: [],
            defaultUser: null,
          })
        }
        slotsDisponibles={quickModal.slotsDisponibles || []}
        defaultUser={quickModal.defaultUser}
        assistants={getAvailableUsersForSlot(
          asistentes,
          meetings,
          quickModal.slotsDisponibles?.[0] || {}
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
        allMeetings={meetings}
        agenda={agenda}
        participantsInfo={participantsInfo}
        slotsDisponibles={slotsDisponiblesParaEdicion} // Aquí está el filtro aplicado
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

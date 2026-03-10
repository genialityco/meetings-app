import { useEffect, useContext, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  doc,
  getDoc,
  updateDoc,
  addDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  runTransaction,
} from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import { UserContext } from "../context/UserContext";
import {
  Loader,
  Container,
  Paper,
  Text,
  Button,
  Stack,
  Select,
  Group,
  Card,
  Badge,
  Divider,
  Center,
  Box,
} from "@mantine/core";

const API_WP_URL = "https://apiwhatsapp.geniality.com.co/api/send";
const CLIENT_ID = "genialitybussinesstest";

// Reutilizamos esta función
const slotOverlapsBreakBlock = (
  slotStart,
  meetingDuration,
  breakBlocks = []
) => {
  const [h, m] = slotStart.split(":").map(Number);
  const slotStartMin = h * 60 + m;
  const slotEndMin = slotStartMin + meetingDuration;
  return breakBlocks.some((b) => {
    const [sh, sm] = b.start.split(":").map(Number);
    const [eh, em] = b.end.split(":").map(Number);
    const bs = sh * 60 + sm,
      be = eh * 60 + em;
    return slotStartMin < be && slotEndMin > bs;
  });
};

export default function MeetingAutoResponse() {
  const { eventId, meetingId, action } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useContext(UserContext);

  const [status, setStatus] = useState(
    action === "accept" ? "Cargando horarios..." : "Procesando..."
  );
  const [availableSlots, setAvailableSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(action === "accept");
  const [confirmLoading, setConfirmLoading] = useState(false);

  //  Añadidos para selects y confirmación
  const [selectedRange, setSelectedRange] = useState(null);
  const [selectedSlotId, setSelectedSlotId] = useState(null);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const [requesterName, setRequesterName] = useState("");
  
  // Estados para validación
  const [isValidating, setIsValidating] = useState(true);
  const [validationError, setValidationError] = useState(null);
  
  // Estados para rechazo
  const [showRejectConfirmation, setShowRejectConfirmation] = useState(false);
  const [rejectLoading, setRejectLoading] = useState(false);

  // 1) Agrupo slots por rango
  const groupedSlots = useMemo(() => {
    const map = {};
    for (const slot of availableSlots) {
      const rangeKey = `${slot.startTime} – ${slot.endTime}`;
      if (!map[rangeKey]) {
        map[rangeKey] = {
          startTime: slot.startTime,
          endTime: slot.endTime,
          slots: [],
        };
      }
      map[rangeKey].slots.push(slot);
    }
    return Object.entries(map).map(([rangeKey, grp]) => ({
      id: rangeKey,
      ...grp,
    }));
  }, [availableSlots]);

  // 2) Preselección al cargar los slots
  useEffect(() => {
    if (groupedSlots.length > 0) {
      const first = groupedSlots[0];
      setSelectedRange(first.id);
      setSelectedSlotId(first.slots[0]?.id || null);
    }
  }, [groupedSlots]);

  // --------------------------------------------------------
  // Función de validación de sesión y propiedad de reunión
  // --------------------------------------------------------
  async function validateUserAndMeeting() {
    try {
      setIsValidating(true);
      
      // 1. Validar que el usuario tiene sesión activa
      if (!currentUser?.uid && !auth.currentUser?.uid) {
        setValidationError(
          "No tienes una sesión activa. Por favor inicia sesión para continuar."
        );
        setTimeout(() => navigate(`/event/${eventId}`), 3000);
        return false;
      }

      const userId = currentUser?.uid || auth.currentUser?.uid;

      // 2. Obtener datos de la reunión
      const mtgRef = doc(db, "events", eventId, "meetings", meetingId);
      const mtgSnap = await getDoc(mtgRef);

      if (!mtgSnap.exists()) {
        setValidationError("La reunión no existe.");
        setTimeout(() => navigate(`/event/${eventId}`), 3000);
        return false;
      }

      const meetingData = mtgSnap.data();
      const { receiverId, requesterId, status: meetingStatus } = meetingData;

      // 3. Validar que la reunión pertenece al usuario actual
      if (receiverId !== userId) {
        setValidationError(
          "No tienes permiso para acceder a esta reunión. Esta reunión no te fue solicitada."
        );
        setTimeout(() => navigate(`/event/${eventId}`), 3000);
        return false;
      }

      // 4. Validar que la reunión no ha sido procesada aún
      if (meetingStatus && meetingStatus !== "pending") {
        setValidationError(
          `Esta reunión ya fue ${
            meetingStatus === "accepted"
              ? "aceptada"
              : meetingStatus === "rejected"
              ? "rechazada"
              : "procesada"
          }.`
        );
        setTimeout(() => navigate(`/event/${eventId}`), 3000);
        return false;
      }

      // 5. Cargar el nombre del solicitante
      const userSnap = await getDoc(doc(db, "users", requesterId));
      if (userSnap.exists()) {
        setRequesterName(userSnap.data().nombre);
      }

      setValidationError(null);
      setIsValidating(false);
      return true;
    } catch (e) {
      console.error("Error en validación:", e);
      setValidationError("Error al validar. Por favor intenta de nuevo.");
      setTimeout(() => navigate(`/event/${eventId}`), 3000);
      return false;
    }
  }

  useEffect(() => {
    // Validar sesión y propiedad antes de procesar
    validateUserAndMeeting().then((isValid) => {
      if (isValid) {
        if (action === "accept") {
          loadSlots();
        } else {
          // Para rechazo, mostrar confirmación en lugar de procesar automáticamente
          setShowRejectConfirmation(true);
          setStatus("");
        }
      }
    });
    // eslint-disable-next-line
  }, []);

  // --------------------------------------------------------
  // cargar y filtrar slots como antes...
  // --------------------------------------------------------
  async function loadSlots() {
    try {
      const mtgRef = doc(db, "events", eventId, "meetings", meetingId);
      const mtgSnap = await getDoc(mtgRef);
      if (!mtgSnap.exists()) throw new Error("Reunión no existe");
      const { requesterId, receiverId } = mtgSnap.data();

      // Carga el nombre del solicitante
      const userSnap = await getDoc(doc(db, "users", requesterId));
      if (userSnap.exists()) {
        setRequesterName(userSnap.data().nombre);
      }

      // ocupados...
      const accSn = await getDocs(
        query(
          collection(db, "events", eventId, "meetings"),
          where("status", "==", "accepted"),
          where("participants", "array-contains-any", [requesterId, receiverId])
        )
      );
      const occupied = accSn.docs
        .map((d) => d.data().timeSlot)
        .filter(Boolean)
        .map((ts) => {
          const [s, e] = ts.split(" - ");
          const [sh, sm] = s.split(":").map(Number);
          const [eh, em] = e.split(":").map(Number);
          return { start: sh * 60 + sm, end: eh * 60 + em };
        });

      const eventSnap = await getDoc(doc(db, "events", eventId));
      const config = eventSnap.exists() ? eventSnap.data().config || {} : {};
      const duration = config.meetingDuration || 20;
      const breaks = config.breakBlocks || [];

      const now = new Date();
      const agSn = await getDocs(
        query(
          collection(db, "events", eventId, "agenda"),
          where("available", "==", true),
          orderBy("startTime")
        )
      );
      const slots = agSn.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((slot) => {
          const [h, m] = slot.startTime.split(":").map(Number);
          const dt = new Date(now);
          dt.setHours(h, m, 0, 0);
          if (dt <= now) return false;
          if (slotOverlapsBreakBlock(slot.startTime, duration, breaks))
            return false;
          const startMin = h * 60 + m,
            endMin = startMin + duration;
          if (occupied.some((r) => startMin < r.end && endMin > r.start))
            return false;
          return true;
        });

      setAvailableSlots(slots);
      setStatus("");
    } catch (e) {
      console.error(e);
      setStatus("Error cargando horarios.");
      setTimeout(() => navigate(`/event/${eventId}`), 2000);
    } finally {
      setLoadingSlots(false);
    }
  }

  async function processReject() {
    try {
      setRejectLoading(true);
      const mtgRef = doc(db, "events", eventId, "meetings", meetingId);
      await updateDoc(mtgRef, {
        status: "rejected",
      });

      const mtgData = (await getDoc(mtgRef)).data();

      // Obtener datos del solicitante y del receptor (quien rechaza)
      const requesterSnap = await getDoc(doc(db, "users", mtgData.requesterId));
      const receiverSnap = await getDoc(doc(db, "users", mtgData.receiverId));
      const requester = requesterSnap.exists() ? requesterSnap.data() : {};
      const receiver = receiverSnap.exists() ? receiverSnap.data() : {};

      // Obtener nombre del evento
      const eventSnap = await getDoc(doc(db, "events", eventId));
      const evName = eventSnap.exists() ? eventSnap.data().eventName || "" : "";

      await addDoc(collection(db, "notifications"), {
        userId: mtgData.requesterId,
        title: "Reunión rechazada",
        message: `${receiver?.nombre || "Un participante"} ha rechazado tu solicitud de reunión.`,
        timestamp: new Date(),
        read: false,
        type: "meeting_rejected",
      });

      // Enviar WhatsApp al solicitante informando del rechazo
      if (requester?.telefono) {
        const phone = (requester.telefono || "").toString().replace(/[^\d]/g, "");
        const eventLine = evName ? `📌 *Evento:* ${evName}\n` : "";
        const message =
          `😔 *Solicitud de reunión rechazada*\n\n` +
          eventLine +
          `*${receiver?.nombre || "Un participante"}* ha rechazado tu solicitud de reunión.\n\n` +
          `👤 *Nombre:* ${receiver?.nombre || ""}\n` +
          `🏢 *Empresa:* ${receiver?.empresa || ""}\n\n` +
          `Puedes enviar solicitudes a otros participantes desde el dashboard del evento.`;

        fetch(API_WP_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: CLIENT_ID,
            phone: `57${phone}`,
            message,
          }),
        }).catch(() => {});
      }

      setStatus("Reunión rechazada.");
    } catch (e) {
      console.error(e);
      setStatus("Error al rechazar.");
    } finally {
      setRejectLoading(false);
      setTimeout(() => navigate(`/event/${eventId}`), 2000);
    }
  }

  // --------------------------------------------------------
  // Genera el lockId con el mismo formato que useDashboardData
  // --------------------------------------------------------
  function buildLockId(evId, userId, dateISO, start, end) {
    const d = String(dateISO || "").replace(/-/g, "");
    return `${evId}_${userId}_${d}_${start}-${end}`;
  }

  // --------------------------------------------------------
  // confirmWithSlot se dispara tras confirmar
  // --------------------------------------------------------
  async function confirmWithSlot(slot) {
    setConfirmLoading(true);
    try {
      const mtgRef = doc(db, "events", eventId, "meetings", meetingId);
      const slotRef = doc(db, "events", eventId, "agenda", slot.id);

      // Obtener la fecha del evento para los lockIds
      const eventDocSnap = await getDoc(doc(db, "events", eventId));
      const eventDateISO =
        eventDocSnap.exists()
          ? String(eventDocSnap.data()?.eventDate || "").trim() ||
            new Date().toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10);

      let requesterId, receiverId;

      // TRANSACCIÓN: valida, crea locks, actualiza meeting y ocupa slot
      await runTransaction(db, async (tx) => {
        // 1. Validar que la reunión sigue pendiente
        const mtgSnap = await tx.get(mtgRef);
        if (!mtgSnap.exists()) throw new Error("La reunión no existe.");
        const mtg = mtgSnap.data();

        if (mtg.status !== "pending") {
          throw new Error(
            `Esta reunión ya fue ${
              mtg.status === "accepted"
                ? "aceptada"
                : mtg.status === "rejected"
                ? "rechazada"
                : "procesada"
            }.`
          );
        }

        requesterId = mtg.requesterId;
        receiverId = mtg.receiverId;

        // 2. Validar que el slot sigue disponible
        const sSnap = await tx.get(slotRef);
        if (!sSnap.exists()) throw new Error("El horario seleccionado no existe.");
        if (sSnap.data().available !== true)
          throw new Error("Este horario ya fue tomado por otra persona. Por favor recarga la página y elige otro.");

        // 3. Crear referencias de locks
        const reqLockRef = doc(
          db,
          "locks",
          buildLockId(eventId, requesterId, eventDateISO, slot.startTime, slot.endTime)
        );
        const recLockRef = doc(
          db,
          "locks",
          buildLockId(eventId, receiverId, eventDateISO, slot.startTime, slot.endTime)
        );

        // 4. Verificar que ninguno tiene ya una reunión en ese horario
        const [reqLockSnap, recLockSnap] = await Promise.all([
          tx.get(reqLockRef),
          tx.get(recLockRef),
        ]);

        if (reqLockSnap.exists())
          throw new Error("El solicitante ya tiene una reunión en ese horario.");
        if (recLockSnap.exists())
          throw new Error("Ya tienes una reunión confirmada en ese horario. Elige otro.");

        // 5. Escribir todo de forma atómica
        tx.set(reqLockRef, {
          eventId,
          userId: requesterId,
          meetingId,
          date: eventDateISO,
          start: slot.startTime,
          end: slot.endTime,
          createdAt: new Date(),
        });
        tx.set(recLockRef, {
          eventId,
          userId: receiverId,
          meetingId,
          date: eventDateISO,
          start: slot.startTime,
          end: slot.endTime,
          createdAt: new Date(),
        });
        tx.update(mtgRef, {
          status: "accepted",
          timeSlot: `${slot.startTime} - ${slot.endTime}`,
          tableAssigned: slot.tableNumber.toString(),
          slotId: slot.id,
          lockIds: [reqLockRef.id, recLockRef.id],
          updatedAt: new Date(),
        });
        tx.update(slotRef, { available: false, meetingId });
      });

      const mtgData = (await getDoc(mtgRef)).data();

      // Obtener datos de ambos participantes y nombre del evento
      const requesterSnap = await getDoc(doc(db, "users", mtgData.requesterId));
      const receiverSnap = await getDoc(doc(db, "users", mtgData.receiverId));
      const requester = requesterSnap.exists() ? requesterSnap.data() : {};
      const receiver = receiverSnap.exists() ? receiverSnap.data() : {};

      const eventSnap = await getDoc(doc(db, "events", eventId));
      const evName = eventSnap.exists() ? eventSnap.data().eventName || "" : "";

      // Notificación in-app
      await addDoc(collection(db, "notifications"), {
        userId: mtgData.requesterId,
        title: "Reunión aceptada",
        message: `${receiver?.nombre || "Un participante"} ha aceptado tu reunión para ${slot.startTime} en mesa ${slot.tableNumber}.`,
        timestamp: new Date(),
        read: false,
        type: "meeting_accepted",
      });

      // Enviar WhatsApp a ambos participantes
      const accepterName = receiver?.nombre || "";
      const meetingInfo = {
        timeSlot: `${slot.startTime} - ${slot.endTime}`,
        tableAssigned: String(slot.tableNumber),
      };

      const buildAcceptedMsg = (otherParticipant) => {
        const eventLine = evName ? `📌 *Evento:* ${evName}\n` : "";
        const acceptedLine = accepterName
          ? `✅ *${accepterName}* ha aceptado la reunión.\n\n`
          : "";
        return (
          `🤝 *¡Reunión confirmada!*\n\n` +
          eventLine +
          acceptedLine +
          `👤 *Con:* ${otherParticipant?.nombre || ""}\n` +
          `🏢 *Empresa:* ${otherParticipant?.empresa || ""}\n` +
          `🕐 *Horario:* ${meetingInfo.timeSlot}\n` +
          `🪑 *Mesa:* ${meetingInfo.tableAssigned}\n\n` +
          `¡Te esperamos!`
        );
      };

      if (requester?.telefono) {
        const phone = (requester.telefono || "").toString().replace(/[^\d]/g, "");
        fetch(API_WP_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: CLIENT_ID,
            phone: `57${phone}`,
            message: buildAcceptedMsg(receiver),
          }),
        }).catch(() => {});
      }
      if (receiver?.telefono) {
        const phone = (receiver.telefono || "").toString().replace(/[^\d]/g, "");
        fetch(API_WP_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: CLIENT_ID,
            phone: `57${phone}`,
            message: buildAcceptedMsg(requester),
          }),
        }).catch(() => {});
      }

      setStatus("Reunión confirmada.");
    } catch (e) {
      console.error(e);
      // Mostrar el mensaje específico del error de transacción al usuario
      const msg = e?.message || "";
      if (
        msg.includes("ya fue") ||
        msg.includes("ya tienes") ||
        msg.includes("ya fue tomado") ||
        msg.includes("solicitante ya tiene")
      ) {
        setStatus(msg);
      } else {
        setStatus("Error al confirmar. Por favor intenta de nuevo.");
      }
    } finally {
      setConfirmLoading(false);
      setTimeout(() => {
        const dest =
          currentUser?.data || auth.currentUser
            ? `/dashboard/${eventId}`
            : `/event/${eventId}`;
        navigate(dest);
      }, 1500);
    }
  }

  // --------------------------------------------------------
  // Construyo opciones para los selects
  // --------------------------------------------------------
  const rangeOptions = groupedSlots.map((g) => ({
    value: g.id,
    label: `${g.startTime} – ${g.endTime}`,
  }));
  const tableOptions = selectedRange
    ? (groupedSlots.find((g) => g.id === selectedRange)?.slots || []).map(
        (s) => ({
          value: s.id,
          label: `Mesa ${s.tableNumber}`,
        })
      )
    : [];

  // slot elegido completo
  const chosenSlot =
    groupedSlots
      .find((g) => g.id === selectedRange)
      ?.slots.find((s) => s.id === selectedSlotId) || null;

  // -------------------------------------------------------------------
  // Renderizado
  // -------------------------------------------------------------------
  return (
    <Container size="sm" py="xl">
      <Paper radius="lg" shadow="md" p={0} style={{ overflow: "hidden" }}>
        {validationError ? (
          <Box p="xl" style={{ backgroundColor: "#ffe0e0" }}>
            <Center mb="lg">
              <Text size="xl" weight={700} color="red">
                ⚠️ Error de validación
              </Text>
            </Center>
            <Text align="center" mb="md" size="sm">
              {validationError}
            </Text>
            <Text align="center" size="xs" color="dimmed">
              Serás redirigido en breve...
            </Text>
          </Box>
        ) : showRejectConfirmation && !isValidating ? (
          <Stack spacing={0}>
            <Box p="xl" style={{ backgroundColor: "#fff5f5", borderBottom: "1px solid #ffe0e0" }}>
              <Text size="lg" weight={700} align="center" mb="xs">
                ¿Deseas rechazar esta reunión?
              </Text>
              <Divider my="md" />
              <Card shadow="none" p="md" style={{ backgroundColor: "white", border: "1px solid #e9ecef" }}>
                <Group spacing="sm">
                  <Box style={{ flex: 1 }}>
                    <Text size="sm" color="dimmed" weight={500}>
                      Solicitud de:
                    </Text>
                    <Text size="md" weight={700} mt={4}>
                      {requesterName}
                    </Text>
                  </Box>
                  <Badge color="orange" variant="dot" size="lg">
                    Pendiente
                  </Badge>
                </Group>
              </Card>
            </Box>
            <Group p="lg" position="right" spacing="md">
              <Button
                variant="light"
                size="md"
                onClick={() => {
                  setShowRejectConfirmation(false);
                  navigate(`/event/${eventId}`);
                }}
                disabled={rejectLoading}
              >
                Cancelar
              </Button>
              <Button
                color="red"
                size="md"
                loading={rejectLoading}
                onClick={processReject}
              >
                Rechazar reunión
              </Button>
            </Group>
          </Stack>
        ) : isValidating || loadingSlots || status ? (
          <Box p="xl">
            <Center mb="lg">
              <Loader />
            </Center>
            <Text align="center" size="sm" color="dimmed">
              {status || "Validando acceso..."}
            </Text>
          </Box>
        ) : availableSlots.length > 0 && !showConfirmation ? (
          <Stack spacing={0}>
            <Box p="xl" style={{ backgroundColor: "#f8f9fa", borderBottom: "1px solid #e9ecef" }}>
              <Text size="lg" weight={700} align="center">
                Selecciona un horario disponible
              </Text>
              <Text size="sm" color="dimmed" align="center" mt={4}>
                Reunión con <b>{requesterName}</b>
              </Text>
            </Box>
            <Stack p="xl" spacing="lg">
              <Select
                label="Horario"
                placeholder="Selecciona un horario"
                data={rangeOptions}
                value={selectedRange}
                onChange={(v) => {
                  setSelectedRange(v);
                  const first = groupedSlots.find((g) => g.id === v)?.slots[0];
                  setSelectedSlotId(first?.id || null);
                }}
                disabled={confirmLoading}
                required
                searchable
                clearable={false}
              />
              <Select
                label="Mesa"
                placeholder="Selecciona una mesa"
                data={tableOptions}
                value={selectedSlotId}
                onChange={setSelectedSlotId}
                disabled={!selectedRange || confirmLoading}
                required
                searchable
                clearable={false}
              />
              <Button
                fullWidth
                size="lg"
                loading={confirmLoading}
                onClick={() => setShowConfirmation(true)}
                mt="md"
              >
                Confirmar datos
              </Button>
            </Stack>
          </Stack>
        ) : showConfirmation ? (
          <Stack spacing={0}>
            <Box p="xl" style={{ backgroundColor: "#e7f5ff", borderBottom: "1px solid #a5d8ff" }}>
              <Text size="lg" weight={700} align="center" mb="xs">
                ✓ Confirmación de reunión
              </Text>
            </Box>
            <Stack p="xl" spacing="lg">
              <Card shadow="none" p="md" style={{ backgroundColor: "#f0f9ff", border: "1px solid #bae6fd" }}>
                <Stack spacing="sm">
                  <Group position="apart">
                    <Text size="sm" color="dimmed" weight={500}>
                      Con:
                    </Text>
                    <Text weight={700}>{requesterName}</Text>
                  </Group>
                  <Divider />
                  <Group position="apart">
                    <Text size="sm" color="dimmed" weight={500}>
                      Horario:
                    </Text>
                    <Badge size="lg">
                      {chosenSlot?.startTime} – {chosenSlot?.endTime}
                    </Badge>
                  </Group>
                  <Divider />
                  <Group position="apart">
                    <Text size="sm" color="dimmed" weight={500}>
                      Mesa:
                    </Text>
                    <Badge color="blue" size="lg">
                      Mesa {chosenSlot?.tableNumber}
                    </Badge>
                  </Group>
                </Stack>
              </Card>
              <Text size="sm" color="dimmed" align="center" style={{ fontStyle: "italic" }}>
                Por favor verifica los datos antes de confirmar
              </Text>
            </Stack>
            <Group p="lg" position="right" spacing="md">
              <Button
                variant="light"
                size="md"
                onClick={() => setShowConfirmation(false)}
              >
                Volver
              </Button>
              <Button
                color="green"
                size="md"
                loading={confirmLoading}
                onClick={() => confirmWithSlot(chosenSlot)}
              >
                Confirmar reunión
              </Button>
            </Group>
          </Stack>
        ) : (
          <Box p="xl">
            <Center>
              <Text size="md" color="dimmed" weight={500}>
                No hay horarios disponibles en este momento
              </Text>
            </Center>
          </Box>
        )}
      </Paper>
    </Container>
  );
}

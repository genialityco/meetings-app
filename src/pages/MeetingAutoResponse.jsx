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
} from "@mantine/core";

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

  useEffect(() => {
    if (action === "accept") loadSlots();
    else processReject();
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
          collection(db, "agenda"),
          where("eventId", "==", eventId),
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
      setTimeout(() => navigate("/"), 2000);
    } finally {
      setLoadingSlots(false);
    }
  }

  async function processReject() {
    try {
      const mtgRef = doc(db, "events", eventId, "meetings", meetingId);
      await updateDoc(mtgRef, { status: "rejected" });
      await addDoc(collection(db, "notifications"), {
        userId: (await getDoc(mtgRef)).data().requesterId,
        title: "Reunión rechazada",
        message: "Tu reunión fue rechazada automáticamente.",
        timestamp: new Date(),
        read: false,
      });
      setStatus("Reunión rechazada.");
    } catch {
      setStatus("Error al rechazar.");
    } finally {
      setTimeout(() => navigate("/"), 2000);
    }
  }

  // --------------------------------------------------------
  // confirmWithSlot se dispara tras confirmar
  // --------------------------------------------------------
  async function confirmWithSlot(slot) {
    setConfirmLoading(true);
    try {
      const mtgRef = doc(db, "events", eventId, "meetings", meetingId);
      await updateDoc(mtgRef, {
        status: "accepted",
        timeSlot: `${slot.startTime} - ${slot.endTime}`,
        tableAssigned: slot.tableNumber.toString(),
      });
      await updateDoc(doc(db, "agenda", slot.id), {
        available: false,
        meetingId,
      });
      await addDoc(collection(db, "notifications"), {
        userId: (await getDoc(mtgRef)).data().requesterId,
        title: "Reunión aceptada",
        message: `Tu reunión fue aceptada para ${slot.startTime} en mesa ${slot.tableNumber}.`,
        timestamp: new Date(),
        read: false,
      });
      setStatus("Reunión confirmada.");
    } catch (e) {
      console.error(e);
      setStatus("Error al confirmar.");
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
    <Container>
      <Paper shadow="md" p="xl" style={{ maxWidth: 500, margin: "40px auto" }}>
        {loadingSlots || status ? (
          <>
            <Text align="center" mb="md">
              {status}
            </Text>
            {loadingSlots && <Loader />}
          </>
        ) : availableSlots.length > 0 && !showConfirmation ? (
          <>
            <Text align="center" mb="md">
              Selecciona un horario disponible:
            </Text>
            <Stack>
              <Select
                label="Hora"
                data={rangeOptions}
                value={selectedRange}
                onChange={(v) => {
                  setSelectedRange(v);
                  // preseleccionar mesa al cambiar rango
                  const first = groupedSlots.find((g) => g.id === v)?.slots[0];
                  setSelectedSlotId(first?.id || null);
                }}
                disabled={confirmLoading}
                required
              />
              <Select
                label="Mesa"
                data={tableOptions}
                value={selectedSlotId}
                onChange={setSelectedSlotId}
                disabled={!selectedRange || confirmLoading}
                required
              />
              <Button
                fullWidth
                mt="md"
                loading={confirmLoading}
                onClick={() => setShowConfirmation(true)}
              >
                Confirmar datos
              </Button>
            </Stack>
          </>
        ) : showConfirmation ? (
          <>
            <Text align="center" mb="md">
              Vas a agendar una reunión con <b>{requesterName}</b> a las{" "}
              <b>
                {chosenSlot?.startTime} – {chosenSlot?.endTime}
              </b>{" "}
              (Mesa {chosenSlot?.tableNumber}).
            </Text>
            <Group position="right">
              <Button
                variant="default"
                onClick={() => setShowConfirmation(false)}
              >
                Volver
              </Button>
              <Button
                loading={confirmLoading}
                onClick={() => confirmWithSlot(chosenSlot)}
              >
                Aceptar
              </Button>
            </Group>
          </>
        ) : (
          <Text align="center">No hay horarios disponibles.</Text>
        )}
      </Paper>
    </Container>
  );
}

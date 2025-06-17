import { useEffect, useContext, useState } from "react";
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
import { Loader, Container, Paper, Text, Button, Stack } from "@mantine/core";

// Reutilizamos esta función
const slotOverlapsBreakBlock = (slotStart, meetingDuration, breakBlocks=[]) => {
  const [h,m] = slotStart.split(":").map(Number);
  const slotStartMin = h*60 + m;
  const slotEndMin = slotStartMin + meetingDuration;
  return breakBlocks.some(b=>{
    const [sh,sm]=b.start.split(":").map(Number);
    const [eh,em]=b.end.split(":").map(Number);
    const bs=sh*60+sm, be=eh*60+em;
    return (slotStartMin<be && slotEndMin>bs);
  });
};

export default function MeetingAutoResponse() {
  const { eventId, meetingId, action } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useContext(UserContext);

  const [status, setStatus] = useState(
    action==="accept" ? "Cargando horarios..." : "Procesando..."
  );
  const [availableSlots, setAvailableSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(action==="accept");
  const [confirmLoading, setConfirmLoading] = useState(false);

  useEffect(() => {
    if (action === "accept") {
      loadSlots();
    } else {
      processReject();
    }
    // eslint-disable-next-line
  }, []);

  async function loadSlots() {
    try {
      // 1. Datos reunión y participantes
      const mtgRef = doc(db, "events", eventId, "meetings", meetingId);
      const mtgSnap = await getDoc(mtgRef);
      if (!mtgSnap.exists()) throw new Error("Reunión no existe");
      const { requesterId, receiverId } = mtgSnap.data();

      // 2. Reuniones ya aceptadas → rangos ocupados
      const accQ = query(
        collection(db, "events", eventId, "meetings"),
        where("status", "==", "accepted"),
        where("participants", "array-contains-any", [requesterId, receiverId])
      );
      const accSn = await getDocs(accQ);
      const occupied = accSn.docs
        .map(d => d.data().timeSlot)
        .filter(Boolean)
        .map(ts => {
          const [s,e] = ts.split(" - ");
          const [sh,sm] = s.split(":").map(Number);
          const [eh,em] = e.split(":").map(Number);
          return { start: sh*60+sm, end: eh*60+em };
        });

      // 3. Configuración
      const eventSnap = await getDoc(doc(db,"events",eventId));
      const config = eventSnap.exists()? eventSnap.data().config||{} : {};
      const duration = config.meetingDuration||20;
      const breaks   = config.breakBlocks||[];

      // 4. Carga agenda y filtra
      const now = new Date();
      const agQ = query(
        collection(db,"agenda"),
        where("eventId","==",eventId),
        where("available","==",true),
        orderBy("startTime")
      );
      const agSn = await getDocs(agQ);
      const slots = agSn.docs
        .map(d=>({ id:d.id, ...d.data() }))
        .filter(slot=>{
          // a) No en pasado
          const [h,m] = slot.startTime.split(":").map(Number);
          const dt = new Date(now); dt.setHours(h,m,0,0);
          if (dt <= now) return false;
          // b) No choque descansos
          if (slotOverlapsBreakBlock(slot.startTime, duration, breaks)) return false;
          // c) No choque con occupied
          const slotStart = h*60 + m;
          const slotEnd   = slotStart + duration;
          if (occupied.some(r=> slotStart<r.end && slotEnd>r.start)) return false;
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

  async function confirmWithSlot(slot) {
    setConfirmLoading(true);
    try {
      const mtgRef = doc(db, "events", eventId, "meetings", meetingId);
      // 1. Update meeting
      await updateDoc(mtgRef, {
        status: "accepted",
        timeSlot: `${slot.startTime} - ${slot.endTime}`,
        tableAssigned: slot.tableNumber.toString(),
      });
      // 2. Block agenda
      await updateDoc(doc(db,"agenda",slot.id), {
        available: false,
        meetingId,
      });
      // 3. Notify requester
      const mtgSnap = await getDoc(mtgRef);
      const { requesterId } = mtgSnap.data();
      await addDoc(collection(db,"notifications"), {
        userId: requesterId,
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
        const dest = currentUser?.data || auth.currentUser
          ? `/dashboard/${eventId}`
          : `/event/${eventId}`;
        navigate(dest);
      }, 1500);
    }
  }

  return (
    <Container>
      <Paper shadow="md" p="xl" style={{ maxWidth: 500, margin: "40px auto" }}>
        {loadingSlots || status ? (
          <>
            <Text align="center" mb="md">{status}</Text>
            {loadingSlots && <Loader />}
          </>
        ) : availableSlots.length > 0 ? (
          <>
            <Text align="center" mb="md">Selecciona un horario disponible:</Text>
            <Stack>
              {availableSlots.map(slot => (
                <Button
                  key={slot.id}
                  loading={confirmLoading}
                  disabled={confirmLoading}
                  onClick={() => confirmWithSlot(slot)}
                >
                  {slot.startTime} – {slot.endTime} (Mesa {slot.tableNumber})
                </Button>
              ))}
            </Stack>
          </>
        ) : (
          <Text align="center">No hay horarios disponibles.</Text>
        )}
      </Paper>
    </Container>
  );
}

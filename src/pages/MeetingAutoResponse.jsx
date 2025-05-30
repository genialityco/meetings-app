/* eslint-disable no-unused-vars */
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
import { db } from "../firebase/firebaseConfig";
import { UserContext } from "../context/UserContext";
import { Loader, Container, Paper, Text } from "@mantine/core";

const MeetingAutoResponse = () => {
  const { eventId, meetingId, action } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useContext(UserContext);
  const [status, setStatus] = useState("Procesando...");

  useEffect(() => {
    const processMeeting = async () => {
      if (!eventId || !meetingId || !["accept", "reject"].includes(action)) {
        setStatus("Enlace inválido.");
        setTimeout(() => navigate("/"), 2000);
        return;
      }
      try {
        const mtgRef = doc(db, "events", eventId, "meetings", meetingId);
        const mtgSnap = await getDoc(mtgRef);
        if (!mtgSnap.exists()) {
          setStatus("La reunión no existe.");
          setTimeout(() => navigate("/"), 2000);
          return;
        }
        const data = mtgSnap.data();
        let newStatus = action === "accept" ? "accepted" : "rejected";

        if (newStatus === "accepted") {
          // Obtener configuración del evento
          const eventRef = doc(db, "events", eventId);
          const eventSnap = await getDoc(eventRef);
          const eventConfig = eventSnap.exists() ? eventSnap.data().config || {} : {};

          // Buscar reuniones aceptadas para estos participantes
          const meetingsQuery = query(
            collection(db, "events", eventId, "meetings"),
            where("participants", "array-contains-any", [
              data.requesterId,
              data.receiverId,
            ]),
            where("status", "==", "accepted")
          );
          const meetingsSnap = await getDocs(meetingsQuery);
          const occupied = new Set(meetingsSnap.docs.map((d) => d.data().timeSlot));

          // Buscar slot disponible en agenda
          const agendaQuery = query(
            collection(db, "agenda"),
            where("eventId", "==", eventId),
            where("available", "==", true),
            orderBy("startTime")
          );
          const agendaSnap = await getDocs(agendaQuery);

          const now = new Date();
          let chosen = null,
            chosenDoc = null;
          for (const d of agendaSnap.docs) {
            const slot = d.data();
            const slotStr = `${slot.startTime} - ${slot.endTime}`;
            if (occupied.has(slotStr)) continue;

            // Validar que no esté en el pasado
            const [slotHour, slotMin] = slot.startTime.split(":").map(Number);
            const slotStartDate = new Date(now);
            slotStartDate.setHours(slotHour, slotMin, 0, 0);
            if (slotStartDate <= now) continue;

            // Validar que no esté en descanso
            const breakBlocks = eventConfig.breakBlocks || [];
            const meetingDuration = eventConfig.meetingDuration || 20;
            const overlapsBreak = breakBlocks.some((block) => {
              const [sh, sm] = block.start.split(":").map(Number);
              const [eh, em] = block.end.split(":").map(Number);
              const blockStartMin = sh * 60 + sm;
              const blockEndMin = eh * 60 + em;
              const slotStartMin = slotHour * 60 + slotMin;
              const slotEndMin = slotStartMin + meetingDuration;
              return (
                (slotStartMin >= blockStartMin && slotStartMin < blockEndMin) ||
                (slotEndMin > blockStartMin && slotEndMin <= blockEndMin) ||
                (slotStartMin <= blockStartMin && slotEndMin >= blockEndMin)
              );
            });
            if (overlapsBreak) continue;

            chosen = slot;
            chosenDoc = d;
            break;
          }

          if (!chosen) {
            setStatus("No hay slots libres fuera de descansos y horarios pasados.");
            setTimeout(() => navigate("/"), 2500);
            return;
          }

          // Actualizar reunión y agenda
          await updateDoc(mtgRef, {
            status: "accepted",
            tableAssigned: chosen.tableNumber.toString(),
            timeSlot: `${chosen.startTime} - ${chosen.endTime}`,
          });

          await updateDoc(doc(db, "agenda", chosenDoc.id), {
            available: false,
            meetingId,
          });

          // Notificación al solicitante
          await addDoc(collection(db, "notifications"), {
            userId: data.requesterId,
            title: "Reunión aceptada",
            message: "Tu reunión fue aceptada automáticamente.",
            timestamp: new Date(),
            read: false,
          });

          setStatus("La reunión fue aceptada correctamente.");
        } else {
          // Solo rechazar
          await updateDoc(mtgRef, { status: newStatus });
          await addDoc(collection(db, "notifications"), {
            userId: data.requesterId,
            title: "Reunión rechazada",
            message: "Tu reunión fue rechazada automáticamente.",
            timestamp: new Date(),
            read: false,
          });
          setStatus("La reunión fue rechazada correctamente.");
        }

        setTimeout(() => {
          if (currentUser?.data) {
            navigate(`/dashboard/${eventId}`);
          } else {
            navigate(`/landing/${eventId}`);
          }
        }, 2000);
      } catch (e) {
        setStatus("Ocurrió un error al procesar la solicitud.");
        setTimeout(() => navigate("/"), 2000);
      }
    };
    processMeeting();
    // eslint-disable-next-line
  }, [eventId, meetingId, action, currentUser, navigate]);

  return (
    <Container>
      <Paper shadow="md" p="xl" style={{ maxWidth: 500, margin: "40px auto" }}>
        <Text align="center" mb="md">
          {status}
        </Text>
        {status === "Procesando..." && <Loader />}
      </Paper>
    </Container>
  );
};

export default MeetingAutoResponse;

import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp } from "firebase-admin/app";
//import fetch from "node-fetch"; // ⚠️ Asegúrate de agregarlo en package.json

initializeApp();

export const notifyMeetings = onRequest(async (req, res) => {
  const db = getFirestore();
  const eventId = "Y1jcc3z7dqr9BbFfENz5"; // 🔒 Fijo por ahora
  const now = new Date();
  //const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  console.log("🕒 Buscando reuniones para el evento:", eventId);

  try {
    const eventRef = db.collection("events").doc(eventId);
    const eventDoc = await eventRef.get();

    if (!eventDoc.exists) {
      console.log("❌ Evento no encontrado");
      return res.status(404).send("Evento no encontrado");
    }

    const eventData = eventDoc.data();

    const eventDate = new Date(eventData.config.eventDate);// Firestore Timestamp → Date
    const meetingsRef = eventRef.collection("meetings");
    const meetingsSnap = await meetingsRef.where("status", "==", "accepted").get();

    if (meetingsSnap.empty) {
      console.log("❌ No hay reuniones aceptadas");
      return res.status(200).send("No hay reuniones aceptadas");
    }

    const notifications = [];

    for (const doc of meetingsSnap.docs) {
      const meeting = doc.data();
      const [startStr] = meeting.timeSlot.split(" - ");
      const [hour, minute] = startStr.split(":").map(Number);

      // Combina la fecha del evento con la hora de la reunión
      const meetingStart = new Date(eventDate);
      meetingStart.setHours(hour, minute, 0, 0);

      const diff = meetingStart.getTime() - new Date(now.getTime() - 5 * 60 * 60 * 1000);
      console.log(`⏰ Reunión ${doc.id} empieza a las ${meetingStart.toISOString()} (diferencia: ${Math.round(diff / 60000)} minutos)`);
      if (diff > 0 && diff <= 5 * 60 * 1000) {
        console.log(`📅 Reunión ${doc.id} empieza en ${Math.round(diff / 60000)} minutos`);

        // Obtener los usuarios
        for (const uid of meeting.participants) {
          const userDoc = await db.collection("users").doc(uid).get();

          if (!userDoc.exists) {
            console.log(`⚠️ Usuario no encontrado: ${uid}`);
            continue;
          }

          const user = userDoc.data();
          const phone = user.telefono?.replace(/\D/g, ""); // limpiar el número
          if (!phone) {
            console.log(`⚠️ Usuario ${user.nombre} no tiene teléfono`);
            continue;
          }

          const message = `👋 Hola ${user.nombre?.trim() || "asistente"}!
Tu reunión asignada (${meeting.timeSlot}) del evento ${eventData.eventName  || "GENIALITY"} empezará en menos de 5 minutos.
Por favor dirígete a tu mesa asignada (${meeting.tableAssigned}).`;
          console.log(`📲 Enviando WhatsApp a ${user.nombre} ${message} (${phone})...`);
          try {
            const resp = await fetch("https://apiwhatsapp.geniality.com.co/api/send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clientId: "genialitybussiness",
                phone: `57${phone}`,
                message,
              }),
            });

            if (resp.ok) {
              console.log(`✅ WhatsApp enviado a ${user.nombre} (${phone})`);
              notifications.push({ uid, phone, message, meetingId: doc.id });
            } else {
              console.log(`❌ Error enviando WhatsApp a ${phone}:`, await resp.text());
            }
          } catch (err) {
            console.error(`💥 Error en envío de WhatsApp a ${phone}:`, err);
          }
        }
      }
    }

    console.log("✅ Notificaciones enviadas:", notifications.length);
    return res.status(200).json({ count: notifications.length, notifications });

  } catch (error) {
    console.error("💥 Error en notifyMeetings:", error);
    return res.status(500).send(error.message);
  }
});

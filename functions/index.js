import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp();

export const notifyMeetingsScheduled = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "America/Bogota",
    memory: "256MiB",
    region: "us-central1",
  },
  async () => {
    const db = getFirestore();
    const eventId = "Y1jcc3z7dqr9BbFfENz5";

    const nowUTC = new Date();
    const nowBogota = new Date(nowUTC.toLocaleString("en-US", { timeZone: "America/Bogota" }));

    console.log("🕒 Buscando reuniones para el evento:", eventId);
    console.log("⏰ Hora actual en Bogotá:", nowBogota.toLocaleString("es-CO"));

    try {
      const eventRef = db.collection("events").doc(eventId);
      const eventDoc = await eventRef.get();

      if (!eventDoc.exists) {
        console.log("❌ Evento no encontrado");
        return null;
      }

      const eventData = eventDoc.data();
      const eventDate = new Date(eventData.config.eventDate);
      const meetingsRef = eventRef.collection("meetings");
      const meetingsSnap = await meetingsRef.where("status", "==", "accepted").get();

      if (meetingsSnap.empty) {
        console.log("❌ No hay reuniones aceptadas");
        return null;
      }

      const notifications = [];

      for (const doc of meetingsSnap.docs) {
        const meeting = doc.data();
        const [startStr] = meeting.timeSlot.split(" - ");
        const [hour, minute] = startStr.split(":").map(Number);

        const meetingStart = new Date(eventDate);
        meetingStart.setHours(hour, minute, 0, 0);

        const diff = meetingStart.getTime() - nowBogota.getTime();
        const diffMinutes = Math.round(diff / 60000);

        console.log(`⏰ Reunión ${doc.id}: ${diffMinutes} minutos`);

        if (diff > 0 && diff <= 5 * 60 * 1000) {
          console.log(`📅 Notificando reunión ${doc.id}`);

          for (const uid of meeting.participants) {
            const userDoc = await db.collection("users").doc(uid).get();

            if (!userDoc.exists) {
              console.log(`⚠️ Usuario no encontrado: ${uid}`);
              continue;
            }

            const user = userDoc.data();
            const phone = user.telefono?.replace(/\D/g, "");

            if (!phone) {
              console.log(`⚠️ Usuario ${user.nombre} no tiene teléfono`);
              continue;
            }

            const message = `👋 Hola ${user.nombre?.trim() || "asistente"}!
Tu reunión asignada (${meeting.timeSlot}) del evento ${eventData.eventName || "GENIALITY"} empezará en menos de 5 minutos.
Por favor dirígete a tu mesa asignada (${meeting.tableAssigned}).`;

            console.log(`📲 Enviando WhatsApp a ${user.nombre} (${phone})...`);

            try {
              const resp = await fetch("https://apiwhatsapp.geniality.com.co/api/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  clientId: "genialitybussinesstest",
                  phone: `57${phone}`,
                  message,
                }),
              });

              if (resp.ok) {
                console.log(`✅ WhatsApp enviado a ${user.nombre}`);
                notifications.push({ uid, phone, meetingId: doc.id });
              } else {
                const errorText = await resp.text();
                console.log(`❌ Error enviando WhatsApp:`, errorText);
              }
            } catch (err) {
              console.error(`💥 Error en WhatsApp:`, err);
            }
          }
        }
      }

      console.log(`✅ Notificaciones enviadas: ${notifications.length}`);
      return null;
    } catch (error) {
      console.error("💥 Error:", error);
      throw error;
    }
  }
);
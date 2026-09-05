import { doc, setDoc, increment, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";

/**
 * Incrementa (en events/{eventId}/analytics/whatsappClicks) el contador total
 * y el de la ubicación donde se dio clic. Complementa el evento GA4
 * "whatsapp_sent" para que los admins del evento vean el dato sin necesitar
 * acceso a Google Analytics.
 */
export function logWhatsAppClick(eventId: string | undefined | null, location: string): void {
  if (!eventId) return;
  const ref = doc(db, "events", eventId, "analytics", "whatsappClicks");
  setDoc(
    ref,
    {
      total: increment(1),
      [location]: increment(1),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  ).catch((e) => console.error("Error registrando clic de WhatsApp:", e));
}

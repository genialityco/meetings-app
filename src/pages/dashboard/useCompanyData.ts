import { useState, useEffect, useContext, useCallback } from "react";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { UserContext } from "../../context/UserContext";
import type { Company, Product } from "./types";

const API_WP_URL = "https://apiwhatsapp.geniality.com.co/api/send";
const CLIENT_ID = "genialitybussinesstest";

export interface CompanyRepresentative {
  id: string;
  nombre: string;
  cargo?: string;
  correo?: string;
  telefono?: string;
  photoURL?: string;
  empresa?: string;
  descripcion?: string;
  interesPrincipal?: string;
  [key: string]: any;
}

export function useCompanyData(eventId?: string, companyNit?: string) {
  const { currentUser } = useContext(UserContext);
  const uid = currentUser?.uid;

  const [company, setCompany] = useState<Company | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [representatives, setRepresentatives] = useState<CompanyRepresentative[]>([]);
  const [eventConfig, setEventConfig] = useState<any>(null);
  const [eventName, setEventName] = useState("");
  const [eventImage, setEventImage] = useState("");
  const [dashboardLogo, setDashboardLogo] = useState("");
  const [loading, setLoading] = useState(true);

  // 1. Event config (for theme + event info)
  useEffect(() => {
    if (!eventId) return;
    (async () => {
      const snap = await getDoc(doc(db, "events", eventId));
      if (snap.exists()) {
        const data = snap.data();
        setEventConfig(data.config || {});
        setEventName(data.eventName || "");
        setEventImage(data.eventImage || "");
        setDashboardLogo(data.dashboardLogo || "");
      }
    })();
  }, [eventId]);

  // 2. Company doc
  useEffect(() => {
    if (!eventId || !companyNit) return;
    (async () => {
      const snap = await getDoc(
        doc(db, "events", eventId, "companies", companyNit),
      );
      if (snap.exists()) {
        setCompany({ nitNorm: snap.id, ...snap.data() } as Company);
      }
      setLoading(false);
    })();
  }, [eventId, companyNit]);

  // 3. Products (real-time, filtered client-side)
  useEffect(() => {
    if (!eventId || !companyNit) return;
    const q = query(collection(db, "events", eventId, "products"));
    return onSnapshot(q, (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }) as Product)
        .filter((p) => p.companyId === companyNit);
      setProducts(list);
    });
  }, [eventId, companyNit]);

  // 4. Representatives (users from that company)
  useEffect(() => {
    if (!eventId || !companyNit) return;
    const q = query(collection(db, "users"), where("eventId", "==", eventId));
    return onSnapshot(q, (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as CompanyRepresentative))
        .filter(
          (u) =>
            u.companyId === companyNit ||
            u.company_nit === companyNit,
        );
      setRepresentatives(list);
    });
  }, [eventId, companyNit]);

  // Send meeting request (simplified version)
  const sendMeetingRequest = useCallback(
    async (
      receiverId: string,
      receiverPhone: string,
      context?: { productId?: string; companyId?: string | null; contextNote?: string },
    ) => {
      if (!uid || !eventId) throw new Error("Missing uid/eventId");

      const data: any = {
        eventId,
        requesterId: uid,
        receiverId,
        status: "pending",
        createdAt: new Date(),
        participants: [uid, receiverId],
      };
      if (context?.productId) data.productId = context.productId;
      if (context?.companyId) data.companyId = context.companyId;
      if (context?.contextNote) data.contextNote = context.contextNote;

      const meetingDoc = await addDoc(
        collection(db, "events", eventId, "meetings"),
        data,
      );

      const requester = currentUser?.data;
      const meetingId = meetingDoc.id;
      const baseUrl = window.location.origin;

      const acceptUrl = `${baseUrl}/meeting-response/${eventId}/${meetingId}/accept`;
      const rejectUrl = `${baseUrl}/meeting-response/${eventId}/${meetingId}/reject`;
      const landingUrl = `${baseUrl}/event/${eventId}`;

      const contextLine = context?.contextNote
        ? `\n📋 *Contexto:* ${context.contextNote}\n`
        : "";

      const eventLine = eventName ? `📌 *Evento:* ${eventName}\n\n` : "";

      const message =
        `📩 *Nueva solicitud de reunión*\n\n` +
        eventLine +
        `Has recibido una solicitud de reunión de:\n\n` +
        `👤 *Nombre:* ${requester?.nombre || ""}\n` +
        `🏢 *Empresa:* ${requester?.empresa || ""}\n` +
        `💼 *Cargo:* ${requester?.cargo || ""}\n` +
        `📧 *Correo:* ${requester?.correo || ""}\n` +
        `📞 *Teléfono:* ${requester?.telefono || ""}\n` +
        contextLine +
        `\n*Opciones:*\n` +
        `✅ *Aceptar:* \n${acceptUrl}\n\n` +
        `❌ *Rechazar:* \n${rejectUrl}\n\n` +
        `🔗 Ir al evento: \n${landingUrl}`;

      fetch(API_WP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: CLIENT_ID,
          phone: `57${receiverPhone.replace(/[^\d]/g, "")}`,
          message,
        }),
      }).catch(() => {});

      await addDoc(collection(db, "notifications"), {
        userId: receiverId,
        title: "Nueva solicitud de reunión",
        message: `${requester?.nombre || "Alguien"} te ha enviado una solicitud de reunión.`,
        timestamp: new Date(),
        read: false,
        type: "meeting_request",
      });
    },
    [uid, eventId, currentUser, eventName],
  );

  return {
    company,
    products,
    representatives,
    eventConfig,
    eventName,
    eventImage,
    dashboardLogo,
    loading,
    currentUser,
    sendMeetingRequest,
  };
}

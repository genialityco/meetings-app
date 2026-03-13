import { useState, useEffect, useContext, useMemo, useRef, useCallback } from "react";
import {
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  query,
  where,
  getDocs,
  orderBy,
  getDoc,
  deleteDoc,
  writeBatch,
  runTransaction,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { UserContext } from "../../context/UserContext";
import { AgendaSlot, Assistant, Meeting, Notification, Company, EventPolicies, DEFAULT_POLICIES, MeetingContext } from "./types";
import { showNotification } from "@mantine/notifications";
import { serverTimestamp } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "../../firebase/firebaseConfig";
import { sendWhatsAppMessage as sendWhatsAppAPI } from "../../utils/whatsappService";
import { meetingAnalytics, profileAnalytics, trackError, trackEvent } from "../../utils/analytics";

type Product = {
  id: string;
  eventId: string;
  ownerUserId: string;
  ownerName?: string;
  ownerCompany?: string;
  ownerPhone?: string | null;
  companyId?: string | null;
  title: string;
  description: string;
  imageUrl?: string | null;
  createdAt?: any;
  updatedAt?: any;
};

// Helpers (puedes moverlos a helpers.ts si prefieres)
function slotOverlapsBreakBlock(
  slotStart: string,
  meetingDuration: number,
  breakBlocks: { start: string; end: string }[] = [],
) {
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
}

function formatPhoneNumber(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("3")) {
    return "57" + digits;
  }
  if (digits.length === 12 && digits.startsWith("57")) {
    return digits;
  }
  if (digits.length === 11 && digits.startsWith("03")) {
    return "57" + digits.slice(1);
  }
  return digits;
}

async function sendSms(text: string, phone: string) {
  const url = "https://www.onurix.com/api/v1/sms/send";
  const data = new URLSearchParams();
  data.append("client", "7121");
  data.append("key", "145d2b857deea633450f5af2b42350c52288e309682f7a1904272");
  data.append("phone", formatPhoneNumber(phone));
  data.append("sms", text);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: data,
    });

    const json = await response.json();
    // console.log("✅ SMS enviado:", json);
  } catch (err) {
    // console.error("❌ Error al enviar SMS:", err);
  }
}

function downloadVCard(participant: Assistant) {
  const vCard = `BEGIN:VCARD
VERSION:3.0
N:${participant.nombre};;;;
FN:${participant.nombre}
TEL;TYPE=CELL:${participant.telefono || ""}
EMAIL:${participant.correo || ""}
END:VCARD`;
  const blob = new Blob([vCard], { type: "text/vcard" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${participant.nombre}.vcf`;
  link.click();
}

function sendWhatsAppMessage(participant: Assistant) {
  console.log("entro en send wp");
  if (!participant.telefono) {
    alert("No hay número de teléfono para WhatsApp");
    return;
  }
  const phone = participant.telefono.replace(/[^\d]/g, "");
  const message = encodeURIComponent(
    "Hola, me gustaría contactarte sobre la reunión.",
  );
  window.open(`https://wa.me/57${phone}?text=${message}`, "_blank");
}

async function sendMeetingAcceptedWhatsapp(
  toPhone: string,
  otherParticipant: Assistant,
  meetingInfo: { timeSlot?: string; tableAssigned?: string; meetingDate?: string },
  eventName?: string,
  acceptedByName?: string,
  whatsappApiVersion: "v1" | "v2" = "v1",
  requesterData?: any,
) {
  if (!toPhone) return;
  const phone = toPhone.replace(/[^\d]/g, "");
  
  // Si es API v2, usar el endpoint de confirmación
  if (whatsappApiVersion === "v2") {
    const { sendMeetingConfirmation } = await import("../../utils/whatsappService");
    
    // Formatear fecha si existe
    let dateStr = "";
    if (meetingInfo.meetingDate) {
      const [year, month, day] = meetingInfo.meetingDate.split("-").map(Number);
      const date = new Date(year, month - 1, day);
      dateStr = date.toLocaleDateString("es-ES", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
    }
    
    const schedule = dateStr 
      ? `${dateStr} - ${meetingInfo.timeSlot || ""}`
      : meetingInfo.timeSlot || "";
    
    await sendMeetingConfirmation({
      phone,
      eventName: eventName || "Evento",
      acceptedBy: acceptedByName || "El participante",
      meetingWith: otherParticipant?.nombre || "Participante",
      company: otherParticipant?.empresa || "Empresa",
      schedule,
      table: meetingInfo.tableAssigned || "N/A",
    });
    
    return;
  }
  
  // API v1: usar el método anterior
  // Formatear fecha si existe
  let dateStr = "";
  if (meetingInfo.meetingDate) {
    const [year, month, day] = meetingInfo.meetingDate.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    dateStr = date.toLocaleDateString("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }
  
  const eventLine = eventName ? `📌 *Evento:* ${eventName}\n` : "";
  const acceptedLine = acceptedByName
    ? `✅ *${acceptedByName}* ha aceptado la reunión.\n\n`
    : "";
  const dateLine = dateStr ? `📅 *Día:* ${dateStr}\n` : "";
  
  const message =
    `🤝 *¡Reunión confirmada!*\n\n` +
    eventLine +
    acceptedLine +
    `👤 *Con:* ${otherParticipant?.nombre || ""}\n` +
    `🏢 *Empresa:* ${otherParticipant?.empresa || ""}\n` +
    dateLine +
    `🕐 *Horario:* ${meetingInfo.timeSlot || ""}\n` +
    `🪑 *Mesa:* ${meetingInfo.tableAssigned || ""}\n\n` +
    `¡Te esperamos!`;

  await sendWhatsAppAPI({
    apiVersion: whatsappApiVersion,
    phone,
    message,
    metadata: {
      eventName: eventName || "Evento",
      requesterName: requesterData?.nombre || otherParticipant?.nombre || "",
      requesterCompany: requesterData?.empresa || otherParticipant?.empresa || "",
      requesterPosition: requesterData?.cargo || "",
      requesterEmail: requesterData?.correo || "",
      requesterPhone: requesterData?.telefono || "",
    },
  });
}

async function sendMeetingCancelledWhatsapp(
  toPhone: string,
  otherParticipant: Assistant,
  meetingInfo: { timeSlot?: string; tableAssigned?: string; meetingDate?: string },
  eventName?: string,
  cancelledByName?: string,
  whatsappApiVersion: "v1" | "v2" = "v1",
) {
  if (!toPhone) return;
  const phone = (toPhone || "").toString().replace(/[^\d]/g, "");
  
  // Si es API v2, usar el endpoint de cancelación
  if (whatsappApiVersion === "v2") {
    const { sendMeetingCancellation } = await import("../../utils/whatsappService");
    
    // Formatear fecha si existe
    let dateStr = "";
    if (meetingInfo.meetingDate) {
      const [year, month, day] = meetingInfo.meetingDate.split("-").map(Number);
      const date = new Date(year, month - 1, day);
      dateStr = date.toLocaleDateString("es-ES", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
    }
    
    await sendMeetingCancellation({
      phone,
      eventName: eventName || "Evento",
      meetingWith: otherParticipant?.nombre || "Participante",
      company: otherParticipant?.empresa || "Empresa",
      day: dateStr || "Fecha no especificada",
      schedule: meetingInfo.timeSlot || "Horario no especificado",
      table: meetingInfo.tableAssigned || "N/A",
    });
    
    return;
  }
  
  // API v1: usar el método anterior
  // Formatear fecha si existe
  let dateStr = "";
  if (meetingInfo.meetingDate) {
    const [year, month, day] = meetingInfo.meetingDate.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    dateStr = date.toLocaleDateString("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }
  
  const eventLine = eventName ? `📌 *Evento:* ${eventName}\n` : "";
  const cancelledLine = cancelledByName
    ? `❌ *${cancelledByName}* ha cancelado la reunión.\n\n`
    : "";
  const dateLine = dateStr ? `📅 *Día:* ${dateStr}\n` : "";
  
  const message =
    `⚠️ *Reunión cancelada*\n\n` +
    eventLine +
    cancelledLine +
    `👤 *Con:* ${otherParticipant?.nombre || ""}\n` +
    `🏢 *Empresa:* ${otherParticipant?.empresa || ""}\n` +
    dateLine +
    `🕐 *Horario:* ${meetingInfo.timeSlot || ""}\n` +
    `🪑 *Mesa:* ${meetingInfo.tableAssigned || ""}\n`;

  await sendWhatsAppAPI({
    apiVersion: whatsappApiVersion,
    phone,
    message,
    metadata: {
      eventName: eventName || "Evento",
      requesterName: otherParticipant?.nombre || "",
      requesterCompany: otherParticipant?.empresa || "",
    },
  });
}

async function sendMeetingRejectedWhatsapp(
  toPhone: string,
  rejectedByParticipant: Assistant,
  eventName?: string,
  whatsappApiVersion: "v1" | "v2" = "v1",
) {
  if (!toPhone) return;
  const phone = (toPhone || "").toString().replace(/[^\d]/g, "");
  
  // Si es API v2, usar el endpoint de rechazo
  if (whatsappApiVersion === "v2") {
    const { sendMeetingRejection } = await import("../../utils/whatsappService");
    
    await sendMeetingRejection({
      phone,
      eventName: eventName || "Evento",
      rejectedByName: rejectedByParticipant?.nombre || "Un participante",
      rejectedByCompany: rejectedByParticipant?.empresa || "Empresa",
    });
    
    return;
  }
  
  // API v1: usar el método anterior
  const eventLine = eventName ? `📌 *Evento:* ${eventName}\n` : "";
  const message =
    `😔 *Solicitud de reunión rechazada*\n\n` +
    eventLine +
    `*${rejectedByParticipant?.nombre || "Un participante"}* ha rechazado tu solicitud de reunión.\n\n` +
    `👤 *Nombre:* ${rejectedByParticipant?.nombre || ""}\n` +
    `🏢 *Empresa:* ${rejectedByParticipant?.empresa || ""}\n\n` +
    `Puedes enviar solicitudes a otros participantes desde el dashboard del evento.`;

  await sendWhatsAppAPI({
    apiVersion: whatsappApiVersion,
    phone,
    message,
    metadata: {
      eventName: eventName || "Evento",
      requesterName: rejectedByParticipant?.nombre || "",
      requesterCompany: rejectedByParticipant?.empresa || "",
    },
  });
}

async function uploadProductImage(
  eventId: string,
  ownerUserId: string,
  productId: string,
  file: File,
) {
  const storageRef = ref(
    storage,
    `eventProducts/${eventId}/${ownerUserId}/${productId}/${file.name}`,
  );
  await uploadBytes(storageRef, file);
  return await getDownloadURL(storageRef);
}

export function useDashboardData(eventId?: string) {
  const { currentUser } = useContext(UserContext);
  const uid = currentUser?.uid as string | undefined;

  // ---------------------- ESTADOS PRINCIPALES ----------------------
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [filteredAssistants, setFilteredAssistants] = useState<Assistant[]>([]);
  const [acceptedMeetings, setAcceptedMeetings] = useState<Meeting[]>([]);
  const [cancelledMeetings, setCancelledMeetings] = useState<Meeting[]>([]);
  const [loadingMeetings, setLoadingMeetings] = useState(true);
  const [pendingRequests, setPendingRequests] = useState<Meeting[]>([]);
  const [sentRequests, setSentRequests] = useState<Meeting[]>([]);
  const [sentRejectedRequests, setSentRejectedRequests] = useState<Meeting[]>([]);
  const [acceptedRequests, setAcceptedRequests] = useState<Meeting[]>([]);
  const [rejectedRequests, setRejectedRequests] = useState<Meeting[]>([]);
  const [takenRequests, setTakenRequests] = useState<Meeting[]>([]);

  const [participantsInfo, setParticipantsInfo] = useState<{
    [userId: string]: Assistant;
  }>({});
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const shownToastIds = useRef<Set<string>>(new Set());
  const [solicitarReunionHabilitado, setSolicitarReunionHabilitado] =
    useState<boolean>(true);
  const [eventConfig, setEventConfig] = useState<any>(null);
  const [eventImage, setEventImage] = useState<string>("");
  const [dashboardLogo, setDashboardLogo] = useState<string>("");
  const [eventName, setEventName] = useState<string>("");
  const [formFields, setFormFields] = useState<any[]>([]);
  const [companyGroups, setCompanyGroups] = useState<any[]>([]);
  const [availableAsistents, setAvailableAsistents] = useState<Assistant[]>([]);

  // Modales y acciones de UI
  const [avatarModalOpened, setAvatarModalOpened] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [pendingVisible, setPendingVisible] = useState(true);
  const [expandedMeetingId, setExpandedMeetingId] = useState<string | null>(
    null,
  );
  const [showOnlyToday, setShowOnlyToday] = useState(true);
  const [slotModalOpened, setSlotModalOpened] = useState(false);
  const [meetingToAccept, setMeetingToAccept] = useState<any>(null);
  const [meetingToEdit, setMeetingToEdit] = useState<any>(null);
  const [availableSlots, setAvailableSlots] = useState<any[]>([]);
  const [prepareSlotSelectionLoading, setPrepareSlotSelectionLoading] =
    useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [selectedRange, setSelectedRange] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [confirmModalOpened, setConfirmModalOpened] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [interestFilter, setInterestFilter] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [policies, setPolicies] = useState<EventPolicies>(DEFAULT_POLICIES);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [globalDateFilter, setGlobalDateFilter] = useState<string | null>(null);
  const [affinityScores, setAffinityScores] = useState<Record<string, number>>({});

  // ---------------------- EFECTOS PRINCIPALES ----------------------

  // 1. Configuración del evento (eventConfig + policies)
  useEffect(() => {
    if (!eventId) return;
    (async () => {
      const ref = doc(db, "events", eventId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        const config = data.config || {};
        setEventConfig(config);
        setEventImage(data.eventImage || "");
        setDashboardLogo(data.dashboardLogo || "");
        setEventName(data.eventName || "");
        setFormFields(config.formFields || []);
        setPolicies({ ...DEFAULT_POLICIES, ...(config.policies || {}) });
      }
    })();
  }, [eventId]);

  // 1b. Suscripción real-time a empresas del evento
  useEffect(() => {
    if (!eventId) return;
    return onSnapshot(
      collection(db, "events", eventId, "companies"),
      (snap) => {
        const list = snap.docs.map((d) => ({
          nitNorm: d.id,
          ...d.data(),
        })) as Company[];
        setCompanies(list);
      }
    );
  }, [eventId]);

  // 2. Notificaciones del usuario
  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, "notifications"),
      where("userId", "==", uid),
      orderBy("timestamp", "desc"),
    );
    return onSnapshot(q, (snap) => {
      const nots = snap.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as Notification,
      );

      // Mostrar toast solo para notificaciones no leídas que no se hayan mostrado aún
      nots.forEach((n) => {
        if (!n.read && !shownToastIds.current.has(n.id)) {
          shownToastIds.current.add(n.id);
          showNotification({
            title: n.title,
            message: n.message,
            color: "teal",
            autoClose: 6000,
          });
        }
      });

      setNotifications(nots);
    });
  }, [uid]);

  const markNotificationRead = useCallback(async (notifId: string) => {
    await updateDoc(doc(db, "notifications", notifId), { read: true });
  }, []);

  const markAllNotificationsRead = useCallback(async () => {
    const unread = notifications.filter((n) => !n.read);
    await Promise.all(
      unread.map((n) => updateDoc(doc(db, "notifications", n.id), { read: true }))
    );
  }, [notifications]);

  // 3. Configuración global para habilitar solicitudes
  useEffect(() => {
    (async () => {
      const cfgRef = doc(db, "config", "generalSettings");
      const cfgSnap = await getDoc(cfgRef);
      if (cfgSnap.exists()) {
        setSolicitarReunionHabilitado(
          cfgSnap.data().solicitarReunionHabilitado,
        );
      }
    })();
  }, []);

  // 3b. Cargar scores de afinidad del usuario
  useEffect(() => {
    if (!uid || !eventId) return;
    
    const unsubscribe = onSnapshot(
      collection(db, "users", uid, "affinityScores"),
      (snap) => {
        const scores: Record<string, number> = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          if (data.targetUserId && typeof data.score === "number") {
            scores[data.targetUserId] = data.score;
          }
        });
        setAffinityScores(scores);
        console.log(`Loaded ${snap.size} affinity scores`);
      },
      (error) => {
        console.error("Error loading affinity scores:", error);
      }
    );
    
    return unsubscribe;
  }, [uid, eventId]);

  // 4. Cargar lista de asistentes
  useEffect(() => {
    if (!eventId) return;
    const q = query(collection(db, "users"), where("eventId", "==", eventId));
    return onSnapshot(q, (snap) => {
      const today = new Date().toISOString().split("T")[0];
      const list = snap.docs
        .filter((d) => d.id !== uid)
        .map((d) => {
          const data = d.data();
          let last;
          if (data.lastConnection?.toDate) {
            last = data.lastConnection.toDate();
          } else if (typeof data.lastConnection === "string") {
            last = new Date(data.lastConnection);
          } else if (data.lastConnection instanceof Date) {
            last = data.lastConnection;
          }

          const lastDateTimeStr = last
            ? last.toLocaleString("es-CO", {
                dateStyle: "short",
                timeStyle: "short",
              })
            : null;

          return {
            id: d.id,
            ...data,
            lastConnectionDateTime: lastDateTimeStr,
            connectedToday: last?.toISOString().split("T")[0] === today,
          } as Assistant;
        })
        .sort((a, b) => {
          // Ordenar por createdAt: más antiguo primero
          if (a.createdAt && b.createdAt) {
            // Si ambos tienen createdAt, ordenar del más antiguo al más reciente
            const timeA = a.createdAt.toMillis
              ? a.createdAt.toMillis()
              : new Date(a.createdAt).getTime();
            const timeB = b.createdAt.toMillis
              ? b.createdAt.toMillis()
              : new Date(b.createdAt).getTime();
            return timeA - timeB;
          }
          // Los que tienen createdAt van primero
          if (a.createdAt) return -1;
          if (b.createdAt) return 1;
          // Si ninguno tiene createdAt, mantener orden original
          return 0;
        });

      setAssistants(list);
      setFilteredAssistants(list);
    });
  }, [uid, eventId]);

  // 5. Filtro de asistentes por searchTerm y showOnlyToday
  // Filtrar asistentes usando todos los campos visibles en formFields
  useEffect(() => {
    const term = searchTerm.toLowerCase();
    let filtered = assistants.filter((a) =>
      formFields.some((f) => {
        const value = (a[f.name] ?? "").toString().toLowerCase();
        return value.includes(term);
      }),
    );
    // (puedes mantener el filtro por interés si quieres)
    if (interestFilter) {
      filtered = filtered.filter(
        (a) =>
          a[formFields.find((f) => f.name === "interesPrincipal")?.name] ===
          interestFilter,
      );
    }

    // Filtro por discoveryMode: "by_role" muestra solo roles opuestos, "all" muestra todos
    if (policies.discoveryMode === "by_role" && currentUser?.data?.tipoAsistente) {
      const tipoField = formFields.find((f) => f.name === "tipoAsistente")?.name;
      if (tipoField) {
        filtered = filtered.filter(
          (a) => a[tipoField] !== currentUser?.data?.tipoAsistente,
        );
      }
    }

    setFilteredAssistants(filtered);
  }, [assistants, searchTerm, interestFilter, formFields, policies.discoveryMode]);

  // 6. Solicitudes enviadas por usuario actual (pendientes + rechazadas)
  useEffect(() => {
    if (!uid || !eventId) return;
    const col = collection(db, "events", eventId, "meetings");
    const qPending = query(
      col,
      where("requesterId", "==", uid),
      where("status", "==", "pending"),
    );
    const qRejected = query(
      col,
      where("requesterId", "==", uid),
      where("status", "==", "rejected"),
    );

    const unsub1 = onSnapshot(qPending, (snap) => {
      setSentRequests(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Meeting),
      );
    });
    const unsub2 = onSnapshot(qRejected, (snap) => {
      setSentRejectedRequests(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Meeting),
      );
    });

    return () => {
      unsub1();
      unsub2();
    };
  }, [uid, eventId]);

  // 7. Reuniones aceptadas
  useEffect(() => {
    if (!uid || !eventId) return;
    setLoadingMeetings(true); // <- ACTIVA loading
    const q = query(
      collection(db, "events", eventId, "meetings"),
      where("status", "==", "accepted"),
      where("participants", "array-contains", uid),
    );
    return onSnapshot(q, async (snap) => {
      const mts: Meeting[] = [];
      const info: { [key: string]: Assistant } = {};
      for (const d of snap.docs) {
        const m = { id: d.id, ...d.data() } as Meeting;
        m.timeSlot = typeof m.timeSlot === "string" ? m.timeSlot : "";
        mts.push(m);
        const other = m.requesterId === uid ? m.receiverId : m.requesterId;
        if (other && !info[other]) {
          try {
            const uSnap = await getDoc(doc(db, "users", other));
            if (uSnap.exists()) info[other] = uSnap.data() as Assistant;
          } catch (e) {}
        }
      }
      setAcceptedMeetings(mts);
      setParticipantsInfo(info);
      setLoadingMeetings(false); // <- DESACTIVA loading
    });
  }, [uid, eventId]);

  // 7b. Reuniones canceladas
  useEffect(() => {
    if (!uid || !eventId) return;
    const q = query(
      collection(db, "events", eventId, "meetings"),
      where("status", "==", "cancelled"),
      where("participants", "array-contains", uid),
    );
    return onSnapshot(q, async (snap) => {
      const mts: Meeting[] = [];
      for (const d of snap.docs) {
        const m = { id: d.id, ...d.data() } as Meeting;
        m.timeSlot = typeof m.timeSlot === "string" ? m.timeSlot : "";
        mts.push(m);
        // Cargar info del participante si no está cargada
        const other = m.requesterId === uid ? m.receiverId : m.requesterId;
        if (other && !participantsInfo[other]) {
          try {
            const uSnap = await getDoc(doc(db, "users", other));
            if (uSnap.exists()) {
              setParticipantsInfo((prev) => ({
                ...prev,
                [other]: uSnap.data() as Assistant,
              }));
            }
          } catch (e) {}
        }
      }
      setCancelledMeetings(mts);
    });
  }, [uid, eventId]);

  // 8. Solicitudes donde usuario es receptor
  useEffect(() => {
    if (!uid || !eventId) return;
    const q = query(
      collection(db, "events", eventId, "meetings"),
      where("receiverId", "==", uid),
    );
    return onSnapshot(q, (snap) => {
      const pend: Meeting[] = [],
        acc: Meeting[] = [],
        tak: Meeting[] = [],
        rej: Meeting[] = [];
      snap.docs.forEach((d) => {
        const r = { id: d.id, ...d.data() } as Meeting;
        if (r.status === "pending") pend.push(r);
        if (r.status === "accepted") acc.push(r);
        if (r.status === "rejected") rej.push(r);
        if (r.status === "taken") tak.push(r);
      });
      setPendingRequests(pend);
      setAcceptedRequests(acc);
      setRejectedRequests(rej);
      setTakenRequests(tak);
    });
  }, [uid, eventId]);

  useEffect(() => {
    if (!eventId) return;
    const q = query(
      collection(db, "events", eventId, "products"),
      orderBy("createdAt", "desc"),
    );

    return onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      })) as Product[];
      setProducts(list);
    });
  }, [eventId]);

  // ---------------------- ACCIONES PRINCIPALES ----------------------

  const cancelSentMeeting = async (
    meetingId: string,
    mode: "cancel" | "delete" = "cancel",
  ) => {
    if (!eventId) {
      showNotification({
        title: "Error",
        message: "No se encontró el evento.",
        color: "red",
      });
      return;
    }
    try {
      const ref = doc(db, "events", eventId, "meetings", meetingId);

      if (mode === "delete") {
        await deleteDoc(ref);
        showNotification({
          title: "Solicitud eliminada",
          message: "La solicitud fue eliminada correctamente.",
          color: "teal",
        });
      } else {
        await updateDoc(ref, { status: "cancelled" });
        showNotification({
          title: "Solicitud cancelada",
          message: "La solicitud fue cancelada correctamente.",
          color: "teal",
        });
      }
    } catch (err) {
      showNotification({
        title: "Error",
        message: "No se pudo cancelar o eliminar la solicitud.",
        color: "red",
      });
    }
  };

  const sendMeetingRequest = async (
    assistantId: string,
    assistantPhone: string,
    groupId: string | null = null,
    context?: MeetingContext,
  ) => {
    // Validar que haya usuario logueado
    if (!uid || !eventId) {
      showNotification({
        title: "Error",
        message: "Debes iniciar sesión para enviar solicitudes de reunión",
        color: "red",
      });
      return Promise.reject(new Error("No user logged in"));
    }
    
    // Validar que exista currentUser con datos
    if (!currentUser?.data) {
      showNotification({
        title: "Error",
        message: "No se encontró tu información de usuario. Redirigiendo al evento...",
        color: "red",
      });
      setTimeout(() => {
        window.location.href = `/event/${eventId}`;
      }, 1500);
      return Promise.reject(new Error("User data not found"));
    }
    
    try {
      // Validar que el receptor exista en Firestore antes de crear la reunión
      const receiverSnap = await getDoc(doc(db, "users", assistantId));
      if (!receiverSnap.exists()) {
        showNotification({
          title: "Error",
          message: "El asistente al que intentas enviar la solicitud ya no existe.",
          color: "red",
        });
        return Promise.reject(new Error("Receiver not found"));
      }

      const data: any = {
        eventId,
        requesterId: uid,
        receiverId: assistantId,
        status: "pending",
        createdAt: new Date(),
        participants: [uid, assistantId],
      };
      if (groupId) {
        data.groupId = groupId;
      }
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

      // Rutas sin base URL para API V2
      const acceptPath = `/meeting-response/${eventId}/${meetingId}/accept`;
      const rejectPath = `/meeting-response/${eventId}/${meetingId}/reject`;

      const contextLine = context?.contextNote
        ? `\n📋 *Mensaje:* ${context.contextNote}\n`
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
        `🔗 Ir al evento: \n${landingUrl}\n\n` +
        `_⚠️ Si los enlaces no están activos, responde primero a este chat y luego haz clic en el enlace._`;

      // WhatsApp backend - usar API configurada en políticas
      const whatsappApiVersion = policies.whatsappApiVersion || "v1";
      await sendWhatsAppAPI({
        apiVersion: whatsappApiVersion,
        phone: assistantPhone.replace(/[^\d]/g, ""),
        message: whatsappApiVersion === "v2" && context?.contextNote ? context.contextNote : message, // v2 usa contextNote, v1 usa mensaje completo
        metadata: {
          eventName: eventName || "Evento",
          requesterName: requester?.nombre || "",
          requesterCompany: requester?.empresa || "",
          requesterPosition: requester?.cargo || "",
          requesterEmail: requester?.correo || "",
          requesterPhone: requester?.telefono || "",
          acceptUrl: acceptPath, // Solo la ruta
          cancelUrl: rejectPath, // Solo la ruta
          contextNote: context?.contextNote, // Agregar contextNote a metadata para v2
        },
      });

      // Notificación en la app
      const notificationMessage = context?.contextNote
        ? `${requester?.nombre || "Alguien"} te ha enviado una solicitud de reunión.\n\nMensaje: "${context.contextNote}"`
        : `${requester?.nombre || "Alguien"} te ha enviado una solicitud de reunión.`;
      
      await addDoc(collection(db, "notifications"), {
        userId: assistantId,
        title: "Nueva solicitud de reunión",
        message: notificationMessage,
        timestamp: new Date(),
        read: false,
        type: "meeting_request",
      });

      // Trackear evento de analytics
      meetingAnalytics.requestSent(assistantId, !!context?.contextNote);

      return Promise.resolve();
    } catch (e) {
      // console.error(e);
      trackError(e instanceof Error ? e.message : String(e), 'useDashboardData.sendMeetingRequest');
      return Promise.reject(e);
    }
  };

  const cancelMeeting = async (meeting: Meeting) => {
    try {
      // 1. Leer datos completos de la reunión para obtener lockIds
      const mtgRef = doc(db, "events", meeting.eventId, "meetings", meeting.id);
      const mtgSnap = await getDoc(mtgRef);
      const mtgData = mtgSnap.exists() ? mtgSnap.data() : {};
      const lockIds: string[] = mtgData.lockIds || [];

      // 2. Cancela la reunión en Firestore
      await updateDoc(mtgRef, { status: "cancelled" });

      // 3. Libera el slot (si existe)
      const slotId = meeting.slotId || mtgData.slotId;
      if (slotId && eventId) {
        await updateDoc(doc(db, "events", eventId, "agenda", slotId), {
          available: true,
          meetingId: null,
        });
      }

      // 4. Eliminar locks para liberar el horario
      for (const lid of lockIds) {
        try {
          await deleteDoc(doc(db, "locks", lid));
        } catch (e) {
          console.warn("No se pudo eliminar lock:", lid, e);
        }
      }

      // 5. Obtén datos de los participantes (si no los tienes)
      let requester = meeting.requester || null;
      let receiver = meeting.receiver || null;

      if (!requester || !receiver) {
        const reqSnap = await getDoc(doc(db, "users", meeting.requesterId));
        const recSnap = await getDoc(doc(db, "users", meeting.receiverId));
        requester = reqSnap.exists() ? reqSnap.data() : {};
        receiver = recSnap.exists() ? recSnap.data() : {};
      }

      // 6. Determinar quién cancela (el usuario actual)
      const cancellerName = currentUser?.data?.nombre || "";

      // 7. Notifica a ambos por WhatsApp
      const whatsappApiVersion = policies.whatsappApiVersion || "v1";
      if (requester?.telefono) {
        await sendMeetingCancelledWhatsapp(requester.telefono, receiver, {
          timeSlot: meeting.timeSlot,
          tableAssigned: meeting.tableAssigned,
          meetingDate: meeting.meetingDate,
        }, eventName, cancellerName, whatsappApiVersion);
      }
      if (receiver?.telefono) {
        await sendMeetingCancelledWhatsapp(receiver.telefono, requester, {
          timeSlot: meeting.timeSlot,
          tableAssigned: meeting.tableAssigned,
          meetingDate: meeting.meetingDate,
        }, eventName, cancellerName, whatsappApiVersion);
      }

      // 7. Notifica por la app
      await addDoc(collection(db, "notifications"), {
        userId: meeting.requesterId,
        title: "Reunión cancelada",
        message: "Tu reunión fue cancelada.",
        timestamp: new Date(),
        read: false,
        type: "meeting_cancelled",
      });
      await addDoc(collection(db, "notifications"), {
        userId: meeting.receiverId,
        title: "Reunión cancelada",
        message: "Tu reunión fue cancelada.",
        timestamp: new Date(),
        read: false,
        type: "meeting_cancelled",
      });

      // Trackear evento de analytics
      meetingAnalytics.cancelled(meeting.id, 'user_cancelled');

      return true; // <-- IMPORTANTE
    } catch (err) {
      console.error("Error en cancelMeeting:", err);
      trackError(err instanceof Error ? err.message : String(err), 'useDashboardData.cancelMeeting');
      throw err; // <-- IMPORTANTE
    }
  };

  const updateMeetingStatus = async (meetingId: string, newStatus: string) => {
    if (!uid || !eventId || !eventConfig) return;
    try {
      const mtgRef = doc(db, "events", eventId, "meetings", meetingId);
      const mtgSnap = await getDoc(mtgRef);
      if (!mtgSnap.exists()) return;

      const data = mtgSnap.data();
      if (data.status === "accepted") return alert("Ya está aceptada.");

      if (newStatus === "accepted") {
        // Lógica de slots y confirmación automática
        const accQ = query(
          collection(db, "events", eventId, "meetings"),
          where("participants", "array-contains-any", [
            data.requesterId,
            data.receiverId,
          ]),
          where("status", "==", "accepted"),
        );
        const accSn = await getDocs(accQ);
        const occupied = new Set(accSn.docs.map((d) => d.data().timeSlot));

        const limit = eventConfig.maxMeetingsPerUser ?? Infinity;
        const requesterCount = accSn.docs.filter((d) =>
          d.data().participants.includes(data.requesterId),
        ).length;
        const receiverCount = accSn.docs.filter((d) =>
          d.data().participants.includes(data.receiverId),
        ).length;

        if (requesterCount >= limit) {
          return alert(
            `El solicitante ya alcanzó el límite de ${limit} citas.`,
          );
        }
        if (receiverCount >= limit) {
          return alert(`El receptor ya alcanzó el límite de ${limit} citas.`);
        }

        // Buscar slot disponible
        const agQ = query(
          collection(db, "events", eventId!, "agenda"),
          where("available", "==", true),
          orderBy("startTime"),
        );
        const agSn = await getDocs(agQ);

        const now = new Date();
        let chosen: any = null,
          chosenDoc: any = null;

        for (const d of agSn.docs) {
          const slot = d.data();
          const slotStr = `${slot.startTime} - ${slot.endTime}`;
          if (occupied.has(slotStr)) continue;

          const [slotHour, slotMin] = slot.startTime.split(":").map(Number);
          const slotStartDate = new Date(now);
          slotStartDate.setHours(slotHour, slotMin, 0, 0);
          if (slotStartDate <= now) continue;

          if (
            slotOverlapsBreakBlock(
              slot.startTime,
              eventConfig.meetingDuration,
              eventConfig.breakBlocks,
            )
          ) {
            continue;
          }

          chosen = slot;
          chosenDoc = d;
          break;
        }

        if (!chosen) {
          return alert(
            "No hay slots libres fuera de descansos y horarios pasados.",
          );
        }

        // 3. Actualizar reunión y agenda
        const meetingDate = chosen.date || eventConfig.eventDates?.[0] || eventConfig.eventDate;
        await updateDoc(mtgRef, {
          status: "accepted",
          tableAssigned: chosen.tableNumber.toString(),
          timeSlot: `${chosen.startTime} - ${chosen.endTime}`,
          meetingDate: meetingDate,
        });

        await updateDoc(doc(db, "events", eventId, "agenda", chosenDoc.id), {
          available: false,
          meetingId,
        });

        // 4. Notificar al solicitante
        await addDoc(collection(db, "notifications"), {
          userId: data.requesterId,
          title: "Reunión aceptada",
          message: "Tu reunión fue aceptada.",
          timestamp: new Date(),
          read: false,
          type: "meeting_accepted",
        });

        // 5. Enviar SMS a ambos participantes
        const requesterSnap = await getDoc(doc(db, "users", data.requesterId));
        const receiverSnap = await getDoc(doc(db, "users", data.receiverId));
        const requester = requesterSnap.exists()
          ? (requesterSnap.data() as Assistant)
          : null;
        const receiver = receiverSnap.exists()
          ? (receiverSnap.data() as Assistant)
          : null;

        // if (requester?.telefono) {
        //   await sendSms(
        //     `Tu reunión con ${
        //       receiver?.nombre || "otro participante"
        //     } ha sido aceptada para ${chosen.startTime} en la mesa ${
        //       chosen.tableNumber
        //     }.`,
        //     requester.telefono
        //   );
        // }
        // if (receiver?.telefono) {
        //   await sendSms(
        //     `Tu reunión con ${
        //       requester?.nombre || "otro participante"
        //     } ha sido aceptada para ${chosen.startTime} en la mesa ${
        //       chosen.tableNumber
        //     }.`,
        //     receiver.telefono
        //   );
        // }

        // Enviar WhatsApp a ambos participantes
        const whatsappApiVersion = policies.whatsappApiVersion || "v1";
        const accepterName = receiver?.nombre || "";
        if (requester && receiver) {
          await sendMeetingAcceptedWhatsapp(
            requester.telefono || "",
            receiver,
            {
              timeSlot: `${chosen.startTime} - ${chosen.endTime}`,
              tableAssigned: chosen.tableNumber,
              meetingDate: meetingDate,
            },
            eventName,
            accepterName,
            whatsappApiVersion,
            requester,
          );
          await sendMeetingAcceptedWhatsapp(
            receiver.telefono || "",
            requester,
            {
              timeSlot: `${chosen.startTime} - ${chosen.endTime}`,
              tableAssigned: chosen.tableNumber,
              meetingDate: meetingDate,
            },
            eventName,
            accepterName,
            whatsappApiVersion,
            receiver,
          );
        }
        
        // Trackear evento de analytics
        meetingAnalytics.accepted(meetingId);
      } else {
        // Rechazar reunión
        await updateDoc(mtgRef, { status: newStatus });

        // Obtener datos del receptor (quien rechaza) y solicitante
        const requesterSnap = await getDoc(doc(db, "users", data.requesterId));
        const receiverSnap = await getDoc(doc(db, "users", data.receiverId));
        const requester = requesterSnap.exists()
          ? (requesterSnap.data() as Assistant)
          : null;
        const receiver = receiverSnap.exists()
          ? (receiverSnap.data() as Assistant)
          : null;

        await addDoc(collection(db, "notifications"), {
          userId: data.requesterId,
          title: "Reunión rechazada",
          message: `${receiver?.nombre || "Un participante"} ha rechazado tu solicitud de reunión.`,
          timestamp: new Date(),
          read: false,
          type: "meeting_rejected",
        });

        // Enviar WhatsApp al solicitante informando del rechazo
        const whatsappApiVersion = policies.whatsappApiVersion || "v1";
        if (requester?.telefono && receiver) {
          await sendMeetingRejectedWhatsapp(
            requester.telefono,
            receiver,
            eventName,
            whatsappApiVersion,
          );
        }
        
        // Trackear evento de analytics
        meetingAnalytics.rejected(meetingId);
      }
    } catch (e) {
      // console.error(e);
      trackError(e instanceof Error ? e.message : String(e), 'useDashboardData.updateMeetingStatus');
    }
  };

  const changeMeetingAssistantId = async (
    newAssistantId: string,
    meetingId: string,
  ) => {
    try {
      if (!uid || !eventId || !eventConfig) return;

      const mtgRef = doc(db, "events", eventId, "meetings", meetingId);
      const mtgSnap = await getDoc(mtgRef);

      if (!mtgSnap.exists()) throw new Error("Meeting does not exist.");

      const meetingData = mtgSnap.data() as Meeting;

      // 1️⃣ Extraer receiverId anterior
      const oldReceiverId = meetingData.receiverId;

      // 2️⃣ Actualizar el array participants (reemplazar el anterior por el nuevo)
      const updatedParticipants = meetingData.participants.map((p: string) =>
        p === oldReceiverId ? newAssistantId : p,
      );

      // 3️⃣ Actualizar en Firestore
      await updateDoc(mtgRef, {
        receiverId: newAssistantId,
        participants: updatedParticipants,
        updatedAt: new Date(),
      });
    } catch (error) {
      console.error("❌ Error al actualizar el asistente receptor:", error);
    }
  };

  const changeAssistant = async (
    requester: Assistant,
    timeSlot: string,
    tableAssigned: string,
  ) => {
    try {
      if (!eventId) return;
      
      // 1️⃣ Obtener los IDs de todos los asistentes del grupo
      const employees = companyGroups
        .filter(
          (e) =>
            e.empresa?.trim().toLowerCase() ===
            currentUser?.data?.empresa?.trim().toLowerCase(),
        )
        .flatMap((e) => e.asistentes);

      // 2️⃣ Buscar meetings aceptadas en el mismo slot con alguno de esos asistentes
      const meetingsSnap = await getDocs(
        query(
          collection(db, "events", eventId, "meetings"),
          where("status", "==", "accepted"),
          where(
            "participants",
            "array-contains-any",
            employees.map((e) => e.id),
          ),
          where("timeSlot", "==", timeSlot),
        ),
      );

      // 3️⃣ Extraer los IDs de los asistentes que ya están ocupados
      const busyIds = new Set<string>();
      meetingsSnap.forEach((doc) => {
        const data = doc.data();
        if (Array.isArray(data.participants)) {
          data.participants.forEach((p: string) => busyIds.add(p));
        }
      });

      const available = employees.filter((a) => !busyIds.has(a.id)); // excluir los ocupados

      // 5️⃣ Guardar en el estado
      setAvailableAsistents(available);
    } catch (error) {
      console.error("Error al cambiar asistente:", error);
    }
  };

  // Seleccionar slots disponibles para aceptar/reagendar reuniones
  const prepareSlotSelection = async (meetingId: string, isEdit = false, selectedDate?: string) => {
    setPrepareSlotSelectionLoading(true);

    try {
      if (isEdit) {
        setMeetingToEdit(meetingId);
        setMeetingToAccept(null);
      } else {
        setMeetingToEdit(null);
      }

      const mtgRef = doc(db, "events", eventId!, "meetings", meetingId);
      const mtgSnap = await getDoc(mtgRef);
      if (!mtgSnap.exists()) throw new Error("Reunión no existe");
      const { requesterId, receiverId } = mtgSnap.data();

      if (!isEdit) {
        setMeetingToAccept({ id: meetingId, requesterId, receiverId });
      }

      // Soporte multi-día: usar eventDates si existe, sino eventDate
      const eventDates = eventConfig.eventDates || [eventConfig.eventDate];
      const eventDayISO = selectedDate || eventDates[0]; // Usar fecha seleccionada o primera fecha
      
      // Establecer la fecha seleccionada en el estado si no está definida
      if (!selectedDate) {
        setSelectedDate(eventDayISO);
      }
      
      const eventDate = parseISODate(eventDayISO);

      // Obtener configuración específica del día (si existe)
      const dayConfig = eventConfig.dailyConfig?.[eventDayISO] || {
        startTime: eventConfig.startTime,
        endTime: eventConfig.endTime,
        breakBlocks: eventConfig.breakBlocks || [],
      };

      // Para saber si el evento es hoy y así bloquear horas pasadas solo en ese caso
      const today = new Date();
      const todayMid = new Date(today);
      todayMid.setHours(0, 0, 0, 0);
      const eventMid = new Date(eventDate);
      eventMid.setHours(0, 0, 0, 0);
      const isEventToday = todayMid.getTime() === eventMid.getTime();
      const now = new Date();

      // Reuniones aceptadas (mismo día del evento)
      // meetingDate: "YYYY-MM-DD"
      let accSn;
      try {
        accSn = await getDocs(
          query(
            collection(db, "events", eventId!, "meetings"),
            where("status", "==", "accepted"),
            where("participants", "array-contains-any", [
              requesterId,
              receiverId,
            ]),
            where("meetingDate", "==", eventDayISO),
          ),
        );
      } catch {
        accSn = await getDocs(
          query(
            collection(db, "events", eventId!, "meetings"),
            where("status", "==", "accepted"),
            where("participants", "array-contains-any", [
              requesterId,
              receiverId,
            ]),
          ),
        );
      }

      const occupiedRanges = accSn.docs
        .map((d) => d.data().timeSlot as string | undefined)
        .filter(Boolean)
        .map((ts) => {
          const [s, e] = ts!.split(" - ");
          const [sh, sm] = s.split(":").map(Number);
          const [eh, em] = e.split(":").map(Number);
          return { start: sh * 60 + sm, end: eh * 60 + em };
        });

      // Agenda de slots disponibles - FILTRAR POR FECHA
      if (!eventId) throw new Error("Event ID is required");
      
      let agendaQuery = query(
        collection(db, "events", eventId, "agenda"),
        where("available", "==", true),
        orderBy("startTime"),
      );
      
      // Agregar filtro por fecha si el campo existe
      try {
        agendaQuery = query(
          collection(db, "events", eventId, "agenda"),
          where("available", "==", true),
          where("date", "==", eventDayISO),
          orderBy("startTime"),
        );
      } catch (e) {
        // Si falla (índice no existe o campo no existe), usar query sin filtro de fecha
        console.warn("Usando query sin filtro de fecha:", e);
      }
      
      const agSn = await getDocs(agendaQuery);

      // Cargar slots bloqueados del usuario actual (requesterId o receiverId)
      const blockedSlotsRequester = await getDocs(
        query(
          collection(db, "users", requesterId, "blockedSlots"),
          where("eventId", "==", eventId),
          where("date", "==", eventDayISO)
        )
      );
      
      const blockedSlotsReceiver = await getDocs(
        query(
          collection(db, "users", receiverId, "blockedSlots"),
          where("eventId", "==", eventId),
          where("date", "==", eventDayISO)
        )
      );

      // Crear set de slots bloqueados (por startTime)
      const blockedTimes = new Set<string>();
      blockedSlotsRequester.docs.forEach((d) => {
        const data = d.data();
        blockedTimes.add(data.startTime);
      });
      blockedSlotsReceiver.docs.forEach((d) => {
        const data = d.data();
        blockedTimes.add(data.startTime);
      });

      const filtered = agSn.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<AgendaSlot, "id">) }))
        .filter((slot) => {
          // Filtrar por fecha si el slot tiene el campo date
          if (slot.date && slot.date !== eventDayISO) return false;
          
          // Filtrar slots bloqueados por cualquiera de los participantes
          if (blockedTimes.has(slot.startTime)) return false;
          
          const [h, m] = slot.startTime.split(":").map(Number);

          // la fecha/hora del slot con la FECHA DEL EVENTO (y no con hoy)
          const slotDateTime = new Date(eventDate);
          slotDateTime.setHours(h, m, 0, 0);

          // Regla: solo bloquear slots pasados si el evento es hoy
          // Si el evento es futuro, muestra todos los slots del evento
          if (isEventToday && slotDateTime <= now) return false;

          // Respeta bloques de descanso del día específico
          if (
            slotOverlapsBreakBlock(
              slot.startTime,
              eventConfig.meetingDuration,
              dayConfig.breakBlocks, // Usar breakBlocks del día específico
            )
          )
            return false;

          // verificación de solape con aceptadas del mismo día (ocupadas en minutos)
          const slotStart = h * 60 + m;
          const slotEnd = slotStart + eventConfig.meetingDuration;
          if (
            occupiedRanges.some((r) => slotStart < r.end && slotEnd > r.start)
          )
            return false;

          return true;
        });

      // Filtro adicional: si tableMode es "fixed", solo mostrar slots de la mesa fija del receiver
      let finalSlots = filtered;
      if (policies?.tableMode === "fixed") {
        const receiver = assistants.find((a: Assistant) => a.id === receiverId);
        const receiverCompanyId = receiver?.companyId || receiver?.company_nit;
        const receiverCompany = companies.find((c: Company) => c.nitNorm === receiverCompanyId);
        const fixedTable = receiverCompany?.fixedTable;

        if (fixedTable) {
          finalSlots = filtered.filter(
            (slot) => String(slot.tableNumber) === fixedTable,
          );
        }
      }

      setAvailableSlots(finalSlots);
      setSlotModalOpened(true);
    } finally {
      setPrepareSlotSelectionLoading(false);
    }
  };

  function parseISODate(dateStr: string): Date {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  // Confirmar la selección de slot para la reunión
  const confirmAcceptWithSlot = async (meetingId: string, slot: any) => {
    // Helpers locales (evitas duplicados en el archivo)
    const hmToMinutes = (hm: string) => {
      const [h, m] = hm.split(":").map(Number);
      return h * 60 + m;
    };
    const lockId = (
      eventId: string,
      userId: string,
      dateISO: string,
      start: string,
      end: string,
    ) => {
      const d = String(dateISO || "").replace(/-/g, ""); // "2025-10-16" -> "20251016"
      return `${eventId}_${userId}_${d}_${start}-${end}`;
    };

    setConfirmLoading(true);
    const isEdit = meetingToEdit === meetingId;

    try {
      if (!eventId || !meetingId || !slot?.id) {
        alert("No se seleccionó correctamente el horario. Intenta de nuevo.");
        return;
      }

      // 0) Determinar la fecha del evento para normalizar
      // Soporte multi-día: usar la fecha del slot si existe, sino usar eventDate
      const eventDateISO: string = slot.date || 
        (eventConfig?.eventDates?.[0]) ||
        String(eventConfig?.eventDate || "").trim() ||
        new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

      const mtgRef = doc(db, "events", eventId, "meetings", meetingId);
      const slotRef = doc(db, "events", eventId, "agenda", slot.id);

      // 1) TRANSACCIÓN: valida, crea locks, actualiza meeting y ocupa slot
      await runTransaction(db, async (tx) => {
        // a) Cargar meeting
        const mtgSnap = await tx.get(mtgRef);
        if (!mtgSnap.exists()) throw new Error("Reunión no existe");
        const mtg = mtgSnap.data() as any;

        const requesterId: string | undefined = mtg.requesterId;
        const receiverId: string | undefined = mtg.receiverId;
        if (!requesterId || !receiverId)
          throw new Error("Datos de la reunión incompletos");

        // b) Validar slot
        const sSnap = await tx.get(slotRef);
        if (!sSnap.exists()) throw new Error("Slot no encontrado");
        const sData = sSnap.data() as any;
        if (sData.available !== true)
          throw new Error("El slot ya está ocupado");

        // c) Si es edición, liberar slot previo y locks previos (si existen)
        const prevSlotId: string | undefined = mtg.slotId;
        const prevLockIds: string[] | undefined = mtg.lockIds;

        if (isEdit) {
          if (prevSlotId) {
            const prevSlotRef = doc(db, "events", eventId, "agenda", prevSlotId);
            const prevSlotSnap = await tx.get(prevSlotRef);
            if (prevSlotSnap.exists()) {
              tx.update(prevSlotRef, { available: true, meetingId: null });
            }
          }
          if (Array.isArray(prevLockIds)) {
            for (const lid of prevLockIds) {
              const lref = doc(db, "locks", lid);
              const lsnap = await tx.get(lref);
              if (lsnap.exists()) {
                tx.delete(lref);
              }
            }
          }
        }

        // d) Crea locks por persona+franja
        const start = slot.startTime;
        const end = slot.endTime;

        const reqLockRef = doc(
          db,
          "locks",
          lockId(eventId, requesterId, eventDateISO, start, end),
        );
        const recLockRef = doc(
          db,
          "locks",
          lockId(eventId, receiverId, eventDateISO, start, end),
        );

        // Check if locks already exist, then create them
        const reqLockSnap = await tx.get(reqLockRef);
        const recLockSnap = await tx.get(recLockRef);

        if (reqLockSnap.exists()) {
          throw new Error("Requester already has a meeting in this time slot");
        }
        if (recLockSnap.exists()) {
          throw new Error("Receiver already has a meeting in this time slot");
        }

        tx.set(reqLockRef, {
          eventId,
          userId: requesterId,
          meetingId,
          date: eventDateISO,
          start,
          end,
          createdAt: new Date(),
        });
        tx.set(recLockRef, {
          eventId,
          userId: receiverId,
          meetingId,
          date: eventDateISO,
          start,
          end,
          createdAt: new Date(),
        });

        // e) Actualiza meeting con datos normalizados y referencias para futuras ediciones
        const updatePayload: any = {
          timeSlot: `${start} - ${end}`,
          tableAssigned: String(slot.tableNumber),
          meetingDate: eventDateISO,
          startMinutes: hmToMinutes(start),
          endMinutes: hmToMinutes(end),
          slotId: slot.id,
          lockIds: [reqLockRef.id, recLockRef.id],
          updatedAt: new Date(),
        };
        if (!isEdit) {
          updatePayload.status = "accepted";
        }
        tx.update(mtgRef, updatePayload);

        // f) Ocupa el slot
        tx.update(slotRef, { available: false, meetingId });
      });

      // 2) Si existe groupId: marca otras meetings del grupo como "taken" (fuera de la TX por simplicidad)
      const mtgAfter = await getDoc(mtgRef);
      const { requesterId, receiverId, groupId } = (mtgAfter.data() ||
        {}) as Partial<Meeting> & {
        groupId?: string;
      };

      if (groupId) {
        const groupMeetingsSnap = await getDocs(
          query(
            collection(db, "events", eventId, "meetings"),
            where("groupId", "==", groupId),
          ),
        );
        const batch = writeBatch(db);
        groupMeetingsSnap.docs.forEach((d) => {
          if (d.id === meetingId) {
            // ya quedó accepted en la transacción
            batch.update(d.ref, { status: "accepted" });
            return;
          }
          batch.update(d.ref, { status: "taken" });
        });
        await batch.commit();
      }

      // 3) Notificaciones/SMS/WhatsApp (igual que tu versión)
      const [reqSnap, recvSnap] = await Promise.all([
        requesterId
          ? getDoc(doc(db, "users", requesterId))
          : Promise.resolve(null as any),
        receiverId
          ? getDoc(doc(db, "users", receiverId))
          : Promise.resolve(null as any),
      ]);
      const requester = reqSnap?.exists()
        ? (reqSnap.data() as Assistant)
        : null;
      const receiver = recvSnap?.exists()
        ? (recvSnap.data() as Assistant)
        : null;

      // Formatear fecha para notificaciones
      let dateStr = "";
      if (eventDateISO) {
        const [year, month, day] = eventDateISO.split("-").map(Number);
        const date = new Date(year, month - 1, day);
        dateStr = date.toLocaleDateString("es-ES", {
          weekday: "long",
          day: "numeric",
          month: "long",
        });
      }

      const notificationsBatch = isEdit
        ? [
            {
              userId: requesterId!,
              title: "Reunión modificada",
              message: `Tu reunión con ${receiver?.nombre || ""} fue movida a ${dateStr ? `${dateStr}, ` : ""}${
                slot.startTime
              } (Mesa ${slot.tableNumber}).`,
              type: "meeting_modified" as const,
            },
            {
              userId: receiverId!,
              title: "Reunión modificada",
              message: `Has cambiado la reunión con ${
                requester?.nombre || ""
              } a ${dateStr ? `${dateStr}, ` : ""}${slot.startTime} (Mesa ${slot.tableNumber}).`,
              type: "meeting_modified" as const,
            },
          ]
        : [
            {
              userId: requesterId!,
              title: "Reunión aceptada",
              message: `Tu reunión con ${
                receiver?.nombre || ""
              } fue aceptada para ${dateStr ? `${dateStr}, ` : ""}${slot.startTime} en Mesa ${
                slot.tableNumber
              }.`,
              type: "meeting_accepted" as const,
            },
            {
              userId: receiverId!,
              title: "Reunión confirmada",
              message: `Has aceptado la reunión con ${
                requester?.nombre || ""
              } para ${dateStr ? `${dateStr}, ` : ""}${slot.startTime} en Mesa ${slot.tableNumber}.`,
              type: "meeting_accepted" as const,
            },
          ];

      for (const notif of notificationsBatch) {
        await addDoc(collection(db, "notifications"), {
          ...notif,
          timestamp: new Date(),
          read: false,
        });
      }

      const smsMsg = isEdit
        ? `Tu reunión fue movida a ${slot.startTime} en Mesa ${slot.tableNumber}.`
        : `Tu reunión fue aceptada para ${slot.startTime} en Mesa ${slot.tableNumber}.`;

      if (requester?.telefono) await sendSms(smsMsg, requester.telefono);
      if (receiver?.telefono) await sendSms(smsMsg, receiver.telefono);

      // El receptor (uid actual) es quien acepta
      const whatsappApiVersion = policies.whatsappApiVersion || "v1";
      const accepterName = receiver?.nombre || requester?.nombre || "";

      if (requester?.telefono) {
        await sendMeetingAcceptedWhatsapp(requester.telefono, receiver!, {
          timeSlot: `${slot.startTime} - ${slot.endTime}`,
          tableAssigned: slot.tableNumber,
          meetingDate: eventDateISO,
        }, eventName, accepterName, whatsappApiVersion, requester);
      }
      if (receiver?.telefono) {
        await sendMeetingAcceptedWhatsapp(receiver.telefono, requester!, {
          timeSlot: `${slot.startTime} - ${slot.endTime}`,
          tableAssigned: slot.tableNumber,
          meetingDate: eventDateISO,
        }, eventName, accepterName, whatsappApiVersion, receiver);
      }

      // 4) Cierra los modales y limpia estado
      setSlotModalOpened(false);
      setConfirmModalOpened(false);
      setMeetingToEdit(null);
      setMeetingToAccept(null);
    } catch (e: any) {
      console.error("❌ confirmAcceptWithSlot:", e?.message || e);
      // Mensaje amigable para colisión por locks/slot
      const msg = /already exists|Slot already taken|ya está ocupado/i.test(
        String(e?.message),
      )
        ? "El horario escogido ya no está disponible o la persona ya tiene reunión en esa franja."
        : "No se pudo confirmar la reunión. Intenta de nuevo.";
      // Opcional: showNotification({ title: "Error", message: msg, color: "red" });
      alert(msg);
    } finally {
      setConfirmLoading(false);
    }
  };

  // ---- Agrupadores y selects de slots para el modal ----
  const groupedSlots = useMemo(() => {
    const map: any = {};
    for (const slot of availableSlots) {
      const range = `${slot.startTime}–${slot.endTime}`;
      if (!map[range]) {
        map[range] = {
          startTime: slot.startTime,
          endTime: slot.endTime,
          slots: [],
        };
      }
      map[range].slots.push(slot);
    }
    return Object.entries(map).map(([range, grp]: any) => ({
      id: range,
      range,
      ...grp,
    }));
  }, [availableSlots]);

  const tableOptions = selectedRange
    ? (groupedSlots.find((g) => g.id === selectedRange)?.slots || []).map(
        (s: any) => ({
          value: s.id,
          label: `Mesa ${s.tableNumber}`,
        }),
      )
    : [];

  const chosenSlot =
    selectedRange && selectedSlotId
      ? groupedSlots
          .find((g) => g.id === selectedRange)
          ?.slots.find((s: any) => s.id === selectedSlotId) || null
      : null;

  const currentRequesterName = meetingToAccept
    ? assistants.find((a) => a.id === meetingToAccept.requesterId)?.nombre
    : meetingToEdit
      ? (() => {
          const meeting = acceptedMeetings.find((m) => m.id === meetingToEdit);
          if (!meeting) return "";
          const otherId =
            meeting.requesterId === uid
              ? meeting.receiverId
              : meeting.requesterId;
          return assistants.find((a) => a.id === otherId)?.nombre || "";
        })()
      : "";

  const interestOptions = Array.from(
    new Set(assistants.map((a) => a.interesPrincipal).filter(Boolean)),
  ).map((i) => ({
    value: i,
    label: i,
  }));

  const createProduct = async (payload: {
    title: string;
    description: string;
    category?: string;
    imageFile?: File | null;
  }) => {
    if (!uid || !eventId) throw new Error("Missing uid/eventId");

    const owner = currentUser?.data || {};
    const base: any = {
      eventId,
      ownerUserId: uid,
      ownerName: owner.nombre || owner.name || "",
      ownerCompany: owner.empresa || owner.company || "",
      ownerPhone: owner.telefono || owner.contacto?.telefono || null,
      companyId: owner.companyId || owner.company_nit || null,
      title: payload.title.trim(),
      description: payload.description.trim(),
      category: payload.category?.trim() || "",
      imageUrl: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const docRef = await addDoc(
      collection(db, "events", eventId, "products"),
      base,
    );

    if (payload.imageFile) {
      const url = await uploadProductImage(
        eventId,
        uid,
        docRef.id,
        payload.imageFile,
      );
      await updateDoc(docRef, { imageUrl: url, updatedAt: serverTimestamp() });
    }

    return docRef.id;
  };

  const updateProduct = async (
    productId: string,
    payload: { title: string; description: string; category?: string; imageFile?: File | null },
  ) => {
    if (!uid || !eventId) throw new Error("Missing uid/eventId");

    const pRef = doc(db, "events", eventId, "products", productId);
    const patch: any = {
      title: payload.title.trim(),
      description: payload.description.trim(),
      category: payload.category?.trim() || "",
      updatedAt: serverTimestamp(),
    };

    if (payload.imageFile) {
      patch.imageUrl = await uploadProductImage(
        eventId,
        uid,
        productId,
        payload.imageFile,
      );
    }

    await updateDoc(pRef, patch);
  };

  const deleteProduct = async (productId: string) => {
    if (!eventId) throw new Error("Missing eventId");
    await deleteDoc(doc(db, "events", eventId, "products", productId));
  };

  // Manejar cambio de fecha en el modal de slots
  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    // Limpiar selecciones actuales
    setSelectedRange(null);
    setSelectedSlotId(null);
    // Recargar slots para la nueva fecha
    if (meetingToAccept?.id || meetingToEdit) {
      const meetingId = meetingToEdit || meetingToAccept?.id;
      const isEdit = !!meetingToEdit;
      prepareSlotSelection(meetingId, isEdit, date);
    }
  };

  // Filtrar reuniones y solicitudes por fecha global
  const filteredAcceptedMeetings = useMemo(() => {
    if (!globalDateFilter) return acceptedMeetings;
    return acceptedMeetings.filter(m => m.meetingDate === globalDateFilter);
  }, [acceptedMeetings, globalDateFilter]);

  const filteredCancelledMeetings = useMemo(() => {
    if (!globalDateFilter) return cancelledMeetings;
    return cancelledMeetings.filter(m => m.meetingDate === globalDateFilter);
  }, [cancelledMeetings, globalDateFilter]);

  const filteredPendingRequests = useMemo(() => {
    if (!globalDateFilter) return pendingRequests;
    return pendingRequests.filter(m => m.meetingDate === globalDateFilter);
  }, [pendingRequests, globalDateFilter]);

  const filteredSentRequests = useMemo(() => {
    if (!globalDateFilter) return sentRequests;
    return sentRequests.filter(m => m.meetingDate === globalDateFilter);
  }, [sentRequests, globalDateFilter]);

  const filteredAcceptedRequests = useMemo(() => {
    if (!globalDateFilter) return acceptedRequests;
    return acceptedRequests.filter(m => m.meetingDate === globalDateFilter);
  }, [acceptedRequests, globalDateFilter]);

  const filteredRejectedRequests = useMemo(() => {
    if (!globalDateFilter) return rejectedRequests;
    return rejectedRequests.filter(m => m.meetingDate === globalDateFilter);
  }, [rejectedRequests, globalDateFilter]);

  const filteredSentRejectedRequests = useMemo(() => {
    if (!globalDateFilter) return sentRejectedRequests;
    return sentRejectedRequests.filter(m => m.meetingDate === globalDateFilter);
  }, [sentRejectedRequests, globalDateFilter]);

  // ---------------------- RETORNO ----------------------

  return {
    uid,
    currentUser,
    assistants,
    filteredAssistants,
    acceptedMeetings: filteredAcceptedMeetings,
    cancelledMeetings: filteredCancelledMeetings,
    loadingMeetings,
    pendingRequests: filteredPendingRequests,
    cancelSentMeeting,
    sentRequests: filteredSentRequests,
    sentRejectedRequests: filteredSentRejectedRequests,
    acceptedRequests: filteredAcceptedRequests,
    rejectedRequests: filteredRejectedRequests,
    participantsInfo,
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
    solicitarReunionHabilitado,
    eventConfig,
    eventImage,
    dashboardLogo,
    eventName,
    affinityScores,

    searchTerm,
    setSearchTerm,
    showOnlyToday,
    setShowOnlyToday,
    interestFilter,
    setInterestFilter,
    interestOptions,

    sendMeetingRequest,
    updateMeetingStatus,
    prepareSlotSelection,
    downloadVCard,
    sendSms,
    sendWhatsAppMessage,
    sendMeetingAcceptedWhatsapp,
    sendMeetingCancelledWhatsapp,
    sendMeetingRejectedWhatsapp,
    confirmAcceptWithSlot,
    cancelMeeting,
    changeAssistant,
    changeMeetingAssistantId,

    setTakenRequests,
    takenRequests,
    availableAsistents,
    setAvailableAsistents,
    setCompanyGroups,
    companyGroups,
    avatarModalOpened,
    setAvatarModalOpened,
    selectedImage,
    setSelectedImage,
    pendingVisible,
    setPendingVisible,
    expandedMeetingId,
    setExpandedMeetingId,
    slotModalOpened,
    setSlotModalOpened,
    meetingToAccept,
    setMeetingToAccept,
    meetingToEdit,
    setMeetingToEdit,
    availableSlots,
    setAvailableSlots,
    prepareSlotSelectionLoading,
    setPrepareSlotSelectionLoading,
    confirmLoading,
    setConfirmLoading,
    selectedRange,
    setSelectedRange,
    tableOptions,
    selectedSlotId,
    setSelectedSlotId,
    groupedSlots,
    chosenSlot,
    confirmModalOpened,
    setConfirmModalOpened,
    currentRequesterName,
    formFields,
    products,
    createProduct,
    updateProduct,
    deleteProduct,
    companies,
    policies,
    selectedDate,
    setSelectedDate,
    handleDateChange,
    globalDateFilter,
    setGlobalDateFilter,
  };
}

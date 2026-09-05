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
  runTransaction,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { UserContext } from "../../context/UserContext";
import { Assistant, Meeting, Notification, Company, EventPolicies, DEFAULT_POLICIES, MeetingContext } from "./types";
import { normalizeTipoAsistente, isVendedor } from "../../utils/attendeeRole";
import { getEventDayKeys } from "../../utils/eventDays";
import { showNotification, notifications as mantineNotifications } from "@mantine/notifications";
import { serverTimestamp } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "../../firebase/firebaseConfig";
import { sendWhatsAppMessage as sendWhatsAppAPI } from "../../utils/whatsappService";
import { meetingAnalytics, profileAnalytics, trackError, trackEvent } from "../../utils/analytics";
import {
  parseISODate,
  slotOverlapsBreakBlock,
  sendSms,
  sendMeetingAcceptedWhatsapp,
  computeAvailableSlots,
  createConfirmedMeeting,
  notifyMeetingConfirmed,
  getTableLabel,
  checkContactMeetingLimit as checkContactMeetingLimitShared,
  checkRoleMeetingLimit as checkRoleMeetingLimitShared,
  createMeetingRequestDoc,
  pickAvailableCompanyAdvisor,
  notifyCompanyAdvisors,
  getCompanyAdvisors,
} from "./meetingSlotEngine";

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
  window.open(`https://wa.me/${phone}?text=${message}`, "_blank");
}

async function sendMeetingCancelledWhatsapp(
  toPhone: string,
  otherParticipant: Assistant,
  meetingInfo: { timeSlot?: string; tableAssigned?: string; meetingDate?: string },
  eventName?: string,
  cancelledByName?: string,
  whatsappApiVersion: "v1" | "v2" = "v1",
  fallbackInfo?: { enabled: boolean; email: string; subject: string; logoUrl?: string }
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
      fallbackInfo,
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
    fallbackInfo,
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
  fallbackInfo?: { enabled: boolean; email: string; subject: string }
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
      fallbackInfo,
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
    fallbackInfo,
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
  const [standbyMeetings, setStandbyMeetings] = useState<Meeting[]>([]);
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
  const [showOnlyToday, setShowOnlyToday] = useState(false);
  const [filterByRole, setFilterByRole] = useState(false);
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
  const [pendingMeetingRequest, setPendingMeetingRequest] = useState<{
    assistantId: string;
    assistantPhone: string;
    context?: MeetingContext;
  } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [interestFilter, setInterestFilter] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [policies, setPolicies] = useState<EventPolicies>(DEFAULT_POLICIES);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [globalDateFilter, setGlobalDateFilter] = useState<string | null>(null);
  const [affinityScores, setAffinityScores] = useState<Record<string, number>>({});
  const [myStandVisits, setMyStandVisits] = useState<Set<string>>(new Set());

  // ---------------------- EFECTOS PRINCIPALES ----------------------

  // 1. Configuración del evento (eventConfig + policies) — real-time para reflejar cambios de admin
  useEffect(() => {
    if (!eventId) return;
    return onSnapshot(doc(db, "events", eventId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const config = data.config || {};
        setEventConfig({ ...config, eventType: data.eventType });
        setEventImage(data.eventImage || "");
        setDashboardLogo(data.dashboardLogo || "");
        setEventName(data.eventName || "");
        setFormFields(config.formFields || []);
        setPolicies({ ...DEFAULT_POLICIES, ...(config.policies || {}) });
      }
    });
  }, [eventId]);

  // 1a. Al cargar un evento multi-día, "Mis reuniones"/"Solicitudes" arrancan filtradas
  // en el día actual del evento (en vez de "Todos los días") si hoy es uno de sus días.
  // Solo se auto-selecciona una vez: si el asistente cambia el filtro después (incluido
  // volver a "Todos los días"), no se lo pisamos en el siguiente snapshot de eventConfig.
  const didAutoSelectGlobalDay = useRef(false);
  useEffect(() => {
    if (didAutoSelectGlobalDay.current || !eventConfig) return;
    didAutoSelectGlobalDay.current = true;
    const days = getEventDayKeys(eventConfig);
    const today = new Date().toISOString().slice(0, 10);
    if (days.length > 1 && days.includes(today)) {
      setGlobalDateFilter(today);
    }
  }, [eventConfig]);

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

  // 1c. Stands ya visitados por el usuario (para los badges "Visitado" en
  // CompaniesView). Lectura puntual por empresa en vez de collectionGroup:
  // no requiere índices ni reglas adicionales. Se refresca al montar el
  // dashboard (p. ej. al volver de StandVisitScanPage) y cuando cambia la
  // lista de empresas.
  useEffect(() => {
    if (!eventId || !uid || !policies.standVisitsEnabled || companies.length === 0) return;
    let cancelled = false;
    Promise.all(
      companies.map((c) =>
        getDoc(doc(db, "events", eventId, "companies", c.nitNorm, "visits", uid))
          .then((snap) => (snap.exists() ? c.nitNorm : null))
          .catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return;
      setMyStandVisits(new Set(results.filter(Boolean) as string[]));
    });
    return () => {
      cancelled = true;
    };
  }, [eventId, uid, policies.standVisitsEnabled, companies]);

  // 2. Notificaciones del usuario
  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, "notifications"),
      where("userId", "==", uid),
      orderBy("timestamp", "desc"),
    );
    // El snapshot inicial trae TODAS las notificaciones sin leer que ya existían en
    // Firestore (potencialmente varias, acumuladas de días previos del evento) -esas
    // no deben mostrarse como toast, solo alimentar la lista/campanita. Si se tostean
    // igual que las nuevas, cada vez que el asistente recarga o reabre el dashboard
    // (shownToastIds vive solo en memoria, se reinicia) revive y dispara de nuevo TODAS
    // esas notificaciones viejas de golpe -el efecto "de reguero" reportado. Solo se
    // tostean los docChanges tipo "added" de snapshots POSTERIORES al primero, o sea,
    // notificaciones que llegan de verdad en tiempo real mientras el asistente ya está
    // con el dashboard abierto.
    let isFirstSnapshot = true;
    return onSnapshot(q, (snap) => {
      const nots = snap.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as Notification,
      );

      if (!isFirstSnapshot) {
        snap.docChanges().forEach((change) => {
          if (change.type !== "added") return;
          const n = { id: change.doc.id, ...change.doc.data() } as Notification;
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
      }
      isFirstSnapshot = false;

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
    });
  }, [uid, eventId]);

  // 5. Filtro de asistentes por rol/interés (sin filtro de texto — cada vista aplica el suyo)
  useEffect(() => {
    let filtered = [...assistants];

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
        const myTipo = normalizeTipoAsistente(currentUser?.data?.tipoAsistente);
        filtered = filtered.filter(
          (a) => normalizeTipoAsistente(a[tipoField]) !== myTipo,
        );
      }
    }

    // Enriquecer empresa cuando el campo está vacío en el user doc
    filtered = filtered.map((a) => {
      if (a.empresa) return a;
      // Caso 1: tiene NIT → buscar en colección de empresas del evento
      const nit = a.companyId;
      if (nit && companies.length > 0) {
        const companyDoc = companies.find((c) => c.nitNorm === nit);
        const razonSocial = companyDoc?.razonSocial as string | undefined;
        if (razonSocial) return { ...a, empresa: razonSocial };
      }
      // Caso 2: sin NIT → usar company_razonSocial guardado directamente en el doc
      const razonDirecta = (a as any).company_razonSocial as string | undefined;
      if (razonDirecta?.trim()) return { ...a, empresa: razonDirecta.trim() };
      return a;
    });

    setFilteredAssistants(filtered);
  }, [assistants, interestFilter, formFields, policies.discoveryMode, companies]);

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
        const isStandby = m.checkInStatus === "standby";
        if (!isStandby) {
          mts.push(m);
        }
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

  // 7b. Reuniones en standby (check-in pendiente)
  useEffect(() => {
    if (!uid || !eventId) return;
    const q = query(
      collection(db, "events", eventId, "meetings"),
      where("status", "==", "accepted"),
      where("checkInStatus", "==", "standby"),
      where("participants", "array-contains", uid),
    );
    return onSnapshot(q, async (snap) => {
      const mts: Meeting[] = [];
      for (const d of snap.docs) {
        const m = { id: d.id, ...d.data() } as Meeting;
        m.timeSlot = typeof m.timeSlot === "string" ? m.timeSlot : "";
        mts.push(m);
        const other = m.requesterId === uid ? m.receiverId : m.requesterId;
        if (other && !participantsInfo[other]) {
          try {
            const uSnap = await getDoc(doc(db, "users", other));
            if (uSnap.exists()) {
              setParticipantsInfo((prev) => ({ ...prev, [other]: uSnap.data() as Assistant }));
            }
          } catch (e) {}
        }
      }
      setStandbyMeetings(mts);
    });
  }, [uid, eventId]);

  // 7c. Reuniones canceladas
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

  // ---------------------- Etapa 1: Agenda agregada de empresa ----------------------
  // "Asesor" = cualquier persona asociada a la empresa (por companyId), sin importar
  // su tipoAsistente. No todas las empresas registran a su contacto como "vendedor"
  // (ej. solo tiene un comprador vinculado), y esa persona debe poder seguir
  // recibiendo/atendiendo solicitudes de reunión dirigidas a su empresa.
  const myCompanyNit = currentUser?.data?.companyId as string | undefined;
  const isCompanyAdvisor = !!myCompanyNit;

  const getCompanyAdvisorIds = useCallback(
    (nit: string | null | undefined): string[] => {
      if (!nit) return [];
      const ids = assistants.filter((a) => a.companyId === nit).map((a) => a.id);
      // `assistants` excluye al usuario actual (ver efecto de carga de asistentes), así
      // que si el propio usuario pertenece a esta empresa hay que agregarlo aparte.
      if (isCompanyAdvisor && uid && myCompanyNit === nit && !ids.includes(uid)) {
        ids.push(uid);
      }
      return ids;
    },
    [assistants, isCompanyAdvisor, uid, myCompanyNit],
  );

  const [companyMeetings, setCompanyMeetings] = useState<Meeting[]>([]);

  // 8b. Reuniones aceptadas de todos los asesores de mi empresa (vista "Empresa" en Mis Reuniones)
  useEffect(() => {
    if (!eventId || !isCompanyAdvisor || !myCompanyNit) {
      setCompanyMeetings([]);
      return;
    }
    const advisorIds = getCompanyAdvisorIds(myCompanyNit);
    if (advisorIds.length === 0) {
      setCompanyMeetings([]);
      return;
    }

    // Firestore limita "array-contains-any" a 10 valores: particionamos si hay más asesores.
    const chunks: string[][] = [];
    for (let i = 0; i < advisorIds.length; i += 10) {
      chunks.push(advisorIds.slice(i, i + 10));
    }

    const results: Record<number, Meeting[]> = {};
    const unsubs = chunks.map((chunk, idx) =>
      onSnapshot(
        query(
          collection(db, "events", eventId, "meetings"),
          where("participants", "array-contains-any", chunk),
          where("status", "==", "accepted"),
        ),
        async (snap) => {
          const mts: Meeting[] = [];
          for (const d of snap.docs) {
            const m = { id: d.id, ...d.data() } as Meeting;
            mts.push(m);
            for (const p of [m.requesterId, m.receiverId]) {
              if (p && !participantsInfo[p]) {
                try {
                  const uSnap = await getDoc(doc(db, "users", p));
                  if (uSnap.exists()) {
                    setParticipantsInfo((prev) => ({ ...prev, [p]: uSnap.data() as Assistant }));
                  }
                } catch (e) {}
              }
            }
          }
          results[idx] = mts;
          setCompanyMeetings(Object.values(results).flat());
        },
      ),
    );

    return () => unsubs.forEach((u) => u());
  }, [eventId, isCompanyAdvisor, myCompanyNit, getCompanyAdvisorIds]);

  const [companyPendingRequests, setCompanyPendingRequests] = useState<Meeting[]>([]);

  // Etapa 2: solicitudes dirigidas a mi empresa, aún sin reclamar por ningún asesor
  // (receiverId null). Visibles para cualquier asesor; el primero en aceptar se la queda
  // (ver el guard de status "pending" en confirmAcceptWithSlot).
  useEffect(() => {
    if (!eventId || !isCompanyAdvisor || !myCompanyNit) {
      setCompanyPendingRequests([]);
      return;
    }
    const q = query(
      collection(db, "events", eventId, "meetings"),
      where("companyId", "==", myCompanyNit),
      where("status", "==", "pending"),
      where("receiverId", "==", null),
    );
    return onSnapshot(q, (snap) => {
      setCompanyPendingRequests(
        snap.docs.map((d) => ({ id: d.id, ...d.data(), isCompanyRequest: true }) as Meeting),
      );
    });
  }, [eventId, isCompanyAdvisor, myCompanyNit]);

  // Notifica (WhatsApp + notificación in-app) a los demás asesores de una empresa cuando
  // una reunión con companyId cambia de estado (creada/aceptada/cancelada/rechazada).
  // No incluye lógica de silencio (Etapa 3); respeta los mismos gates de policy que el
  // resto de notificaciones de reunión.
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

  // Valida la política "maxMeetingsPerContact" (lógica compartida en meetingSlotEngine.ts,
  // también usada por useCompanyData.ts): si ya se alcanzó el máximo de reuniones con
  // esta persona (o cualquier representante de su misma empresa), muestra el error y
  // devuelve false para que el llamador aborte.
  const checkContactMeetingLimit = async (receiverId: string, receiverData: any): Promise<boolean> => {
    if (!uid || !eventId) return true;
    try {
      await checkContactMeetingLimitShared({
        eventId,
        userId: uid,
        receiverId,
        receiverData,
        limit: policies.maxMeetingsPerContact,
      });
      return true;
    } catch {
      return false;
    }
  };

  // Delegado en la lógica compartida de meetingSlotEngine.ts (usada también
  // por useCompanyData.ts), para no duplicar la validación de "maxMeetingsPerRole".
  const checkRoleMeetingLimit = async (date?: string | null): Promise<boolean> => {
    if (!uid || !eventId) return true;
    return checkRoleMeetingLimitShared({
      eventId,
      userId: uid,
      policies,
      myTipoAsistente: currentUser?.data?.tipoAsistente,
      date,
    });
  };

  // Solicitud directa a una persona (flujo individual "de siempre"). Delegada por
  // completo en la lógica compartida de meetingSlotEngine.ts (createMeetingRequestDoc),
  // la misma que usan las solicitudes de empresa y useCompanyData.ts (CompanyLanding) —
  // ver §"Solicitudes dirigidas a empresa / asesores" en ese archivo.
  const sendMeetingRequest = async (
    assistantId: string,
    assistantPhone: string,
    context?: MeetingContext,
  ) => {
    if (!uid || !eventId) {
      showNotification({
        title: "Error",
        message: "Debes iniciar sesión para enviar solicitudes de reunión",
        color: "red",
      });
      return Promise.reject(new Error("No user logged in"));
    }

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
      const receiverSnap = await getDoc(doc(db, "users", assistantId));
      if (!receiverSnap.exists()) {
        showNotification({
          title: "Error",
          message: "El asistente al que intentas enviar la solicitud ya no existe.",
          color: "red",
        });
        return Promise.reject(new Error("Receiver not found"));
      }

      if (!(await checkContactMeetingLimit(assistantId, receiverSnap.data()))) {
        return Promise.reject(new Error("Meeting limit reached"));
      }

      if (!(await checkRoleMeetingLimit())) {
        return Promise.reject(new Error("Role meeting limit reached"));
      }

      await createMeetingRequestDoc({
        eventId,
        requesterId: uid,
        advisorId: assistantId,
        advisorPhone: assistantPhone,
        companyNit: context?.companyId || null,
        context,
        policies,
        eventName,
        dashboardLogo,
      });

      meetingAnalytics.requestSent(assistantId, !!context?.contextNote);
      return Promise.resolve();
    } catch (e) {
      trackError(e instanceof Error ? e.message : String(e), 'useDashboardData.sendMeetingRequest');
      return Promise.reject(e);
    }
  };

  // Punto de entrada único para solicitudes de reunión 1:1: si la política
  // schedulingMode es "requester_picks", abre el selector de horario para que
  // el solicitante elija el slot y la reunión quede confirmada de inmediato.
  // Si no, delega en el flujo clásico (solicitud pendiente por aceptar).
  const requestMeetingWithSlotPicker = async (
    assistantId: string,
    assistantPhone: string,
    context?: MeetingContext,
  ): Promise<{ deferred: boolean } | void> => {
    if (policies.schedulingMode !== "requester_picks") {
      return sendMeetingRequest(assistantId, assistantPhone, context);
    }

    const receiverSnap = await getDoc(doc(db, "users", assistantId));
    if (!receiverSnap.exists()) {
      showNotification({
        title: "Error",
        message: "El asistente al que intentas enviar la solicitud ya no existe.",
        color: "red",
      });
      return Promise.reject(new Error("Receiver not found"));
    }

    if (!(await checkContactMeetingLimit(assistantId, receiverSnap.data()))) {
      return Promise.reject(new Error("Meeting limit reached"));
    }

    if (!(await checkRoleMeetingLimit())) {
      return Promise.reject(new Error("Role meeting limit reached"));
    }

    setPendingMeetingRequest({ assistantId, assistantPhone, context });
    await prepareSlotSelectionForRequest(assistantId);
    return { deferred: true };
  };

  // Crea la reunión ya "accepted" con el slot elegido por el solicitante y notifica a ambos.
  const confirmSendMeetingRequestWithSlot = async (slot: any, message?: string): Promise<boolean> => {
    if (!pendingMeetingRequest || !eventId || !uid || !slot?.id) return false;
    const { assistantId, context } = pendingMeetingRequest;
    // El mensaje se captura en el mismo modal de selección de horario (ver
    // SlotModal), no en un paso separado — se agrega aquí al contexto justo
    // antes de confirmar.
    const finalContext = message?.trim() ? { ...context, contextNote: message.trim() } : context;

    if (!(await checkRoleMeetingLimit(slot.date))) {
      return false;
    }

    // Re-valida "maxMeetingsPerContact" justo antes de crear la reunión: el check
    // inicial (en requestMeetingWithSlotPicker/sendMeetingRequestToCompany) pudo
    // quedar desactualizado si el modal de horario estuvo abierto un rato (otra
    // reunión creada mientras tanto, o la política se activó recién).
    const receiverSnap = await getDoc(doc(db, "users", assistantId));
    if (!(await checkContactMeetingLimit(assistantId, receiverSnap.data()))) {
      return false;
    }

    setConfirmLoading(true);
    const notifId = `request-meeting-${assistantId}-${Date.now()}`;
    mantineNotifications.show({
      id: notifId,
      title: "Agendando reunión",
      message: "Estamos confirmando el horario y la mesa, espera un momento...",
      loading: true,
      autoClose: false,
      withCloseButton: false,
    });

    try {
      const { meetingId, eventDateISO } = await createConfirmedMeeting({
        eventId,
        eventConfig,
        requesterId: uid,
        receiverId: assistantId,
        slot,
        context: finalContext,
        receiverGroupIds: resolveReceiverGroupIds(assistantId),
      });

      await notifyMeetingConfirmed({
        requesterId: uid,
        receiverId: assistantId,
        slot,
        eventDateISO,
        isEdit: false,
        policies,
        eventName,
        acceptedByName: null,
        tableNames: eventConfig?.tableNames,
      });

      meetingAnalytics.requestSent(assistantId, !!finalContext?.contextNote);
      meetingAnalytics.accepted(meetingId);

      setSlotModalOpened(false);
      setConfirmModalOpened(false);
      setPendingMeetingRequest(null);

      mantineNotifications.update({
        id: notifId,
        title: "Reunión confirmada",
        message: "La reunión fue agendada y confirmada correctamente.",
        color: "teal",
        loading: false,
        autoClose: 4000,
        withCloseButton: true,
      });

      return true;
    } catch (e: any) {
      console.error("❌ confirmSendMeetingRequestWithSlot:", e?.message || e);
      const msg = /already exists|Slot already taken|ya está ocupado/i.test(String(e?.message))
        ? "El horario escogido ya no está disponible o la persona ya tiene reunión en esa franja."
        : "No se pudo confirmar la reunión. Verifica tu conexión e intenta de nuevo.";
      mantineNotifications.update({
        id: notifId,
        title: "Error al agendar la reunión",
        message: msg,
        color: "red",
        loading: false,
        autoClose: 6000,
        withCloseButton: true,
      });
      return false;
    } finally {
      setConfirmLoading(false);
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

      // 5. Obtén datos de los participantes
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
      const fallbackEnabled = policies.fallbackEmailOnWaFailure ?? false;

      if (policies.whatsappNotificationsEnabled !== false) {
        if (requester?.telefono) {
          await sendMeetingCancelledWhatsapp(requester.telefono, receiver, {
            timeSlot: meeting.timeSlot,
            tableAssigned: meeting.tableAssigned,
            meetingDate: meeting.meetingDate,
          }, eventName, cancellerName, whatsappApiVersion, {
            enabled: fallbackEnabled,
            email: requester.correo || "",
            subject: `Cancelación de reunión - ${eventName}`,
            logoUrl: dashboardLogo || "",
          });
        }
        if (receiver?.telefono) {
          await sendMeetingCancelledWhatsapp(receiver.telefono, requester, {
            timeSlot: meeting.timeSlot,
            tableAssigned: meeting.tableAssigned,
            meetingDate: meeting.meetingDate,
          }, eventName, cancellerName, whatsappApiVersion, {
            enabled: fallbackEnabled,
            email: receiver.correo || "",
            subject: `Cancelación de reunión - ${eventName}`,
            logoUrl: dashboardLogo || "",
          });
        }
      }

      // 8. Notifica por la app
      if (policies.dashboardNotificationsEnabled !== false) {
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
      }

      // 8b. Notificar también a los demás asesores de la empresa (Etapa 1: fan-out)
      if (meeting.companyId) {
        await notifyCompanyAdvisors({
          eventId: meeting.eventId || eventId!,
          companyNit: meeting.companyId,
          excludeUids: [meeting.requesterId, meeting.receiverId as string],
          policies,
          whatsappBuilder: (advisor) => ({
            phone: advisor.telefono || "",
            message: `La reunión de tu compañero${cancellerName ? ` (cancelada por ${cancellerName})` : ""} fue cancelada.`,
          }),
          dashboardNotif: {
            title: "Reunión cancelada",
            message: "Se canceló una reunión de un compañero de tu empresa.",
            type: "meeting_cancelled",
          },
        });
      }

      // 9. Si la política autoReassignOnCancel está activa, llamar la función Firebase
      if (policies.autoReassignOnCancel) {
        //console.log("++++----entro a asignar reunion")
        try {
          await fetch("https://cancelandreassign-6eaymlz5eq-uc.a.run.app", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eventId: meeting.eventId || eventId,
              meetingId: meeting.id,
              cancelledByUserId: uid,
            }),
          });
        } catch (e) {
          console.warn("autoReassign failed (non-blocking):", e);
        }
      }

      meetingAnalytics.cancelled(meeting.id, 'user_cancelled');
      return true;
    } catch (err) {
      console.error("Error en cancelMeeting:", err);
      trackError(err instanceof Error ? err.message : String(err), 'useDashboardData.cancelMeeting');
      throw err;
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
        if (policies.dashboardNotificationsEnabled !== false) {
          await addDoc(collection(db, "notifications"), {
            userId: data.requesterId,
            title: "Reunión aceptada",
            message: "Tu reunión fue aceptada.",
            timestamp: new Date(),
            read: false,
            type: "meeting_accepted",
          });
        }

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
        const fallbackEnabled = policies.fallbackEmailOnWaFailure ?? false;
        
        if (policies.whatsappNotificationsEnabled !== false && requester && receiver) {
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
            { enabled: fallbackEnabled, email: requester.correo || "", subject: `Confirmación de reunión - ${eventName}`, logoUrl: dashboardLogo || "" }
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
            { enabled: fallbackEnabled, email: receiver.correo || "", subject: `Confirmación de reunión - ${eventName}`, logoUrl: dashboardLogo || "" }
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

        if (policies.dashboardNotificationsEnabled !== false) {
          await addDoc(collection(db, "notifications"), {
            userId: data.requesterId,
            title: "Reunión rechazada",
            message: `${receiver?.nombre || "Un participante"} ha rechazado tu solicitud de reunión.`,
            timestamp: new Date(),
            read: false,
            type: "meeting_rejected",
          });
        }

        // Enviar WhatsApp al solicitante informando del rechazo
        const whatsappApiVersion = policies.whatsappApiVersion || "v1";
        const fallbackEnabled = policies.fallbackEmailOnWaFailure ?? false;
        if (policies.whatsappNotificationsEnabled !== false && requester?.telefono && receiver) {
          await sendMeetingRejectedWhatsapp(
            requester.telefono,
            receiver,
            eventName,
            whatsappApiVersion,
            { enabled: fallbackEnabled, email: requester.correo || "", subject: `Reunión rechazada - ${eventName}` }
          );
        }

        // Notificar también a los demás asesores de la empresa (Etapa 1: fan-out)
        if (data.companyId) {
          await notifyCompanyAdvisors({
            eventId: eventId!,
            companyNit: data.companyId,
            excludeUids: [data.requesterId, data.receiverId],
            policies,
            whatsappBuilder: (advisor) => ({
              phone: advisor.telefono || "",
              message: `${receiver?.nombre || "Un compañero"} rechazó una solicitud de reunión de la empresa.`,
            }),
            dashboardNotif: {
              title: "Reunión rechazada",
              message: "Se rechazó una solicitud de reunión de tu empresa.",
              type: "meeting_rejected",
            },
          });
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

  // Resuelve la mesa fija (si existe) de la empresa del receptor, para el filtro de tableMode "fixed"
  const resolveFixedTableForReceiver = (receiverId: string): string | null => {
    const receiver = assistants.find((a: Assistant) => a.id === receiverId);
    const receiverCompanyId = receiver?.companyId;
    const receiverCompany = companies.find((c: Company) => c.nitNorm === receiverCompanyId);
    return receiverCompany?.fixedTable || null;
  };

  // Si la empresa del receptor tiene "agenda compartida" activa, devuelve los
  // uids de sus representantes VENDEDORES (para que una cita de cualquiera
  // bloquee el horario para todo el equipo comercial); si no, solo [receiverId].
  // Se filtra por rol vendedor para no atar el calendario de un compañero
  // registrado como comprador bajo el mismo companyId (mismo NIT, rol distinto).
  const resolveReceiverGroupIds = (receiverId: string): string[] => {
    const receiver = assistants.find((a: Assistant) => a.id === receiverId);
    const receiverCompanyId = receiver?.companyId;
    const receiverCompany = companies.find((c: Company) => c.nitNorm === receiverCompanyId);
    if (!receiverCompany?.sharedAgenda || !receiverCompanyId) return [receiverId];
    const teammates = assistants
      .filter((a: Assistant) => a.companyId === receiverCompanyId && isVendedor(a.tipoAsistente))
      .map((a) => a.id);
    return teammates.includes(receiverId) ? teammates : [receiverId];
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

      if (!eventId) throw new Error("Event ID is required");

      const receiverFixedTable = resolveFixedTableForReceiver(receiverId);
      const receiverGroupIds = resolveReceiverGroupIds(receiverId);
      const { slots, eventDayISO } = await computeAvailableSlots({
        eventId,
        eventConfig,
        policies,
        requesterId,
        receiverId,
        selectedDate,
        receiverFixedTable,
        receiverGroupIds,
      });

      // Siempre reflejar el día resultante en el estado (aunque ya venga en el
      // parámetro `selectedDate`): el <Select> del modal está controlado por
      // este estado, así que si solo se asignara cuando faltaba, cambiar de
      // día mediante ese selector rebotaría de vuelta al día anterior (mismo
      // bug que había en useCompanyData.ts para la vista de empresa).
      setSelectedDate(selectedDate || eventDayISO);
      setAvailableSlots(slots);
      setSlotModalOpened(true);
    } finally {
      setPrepareSlotSelectionLoading(false);
    }
  };

  // Igual que prepareSlotSelection pero para una solicitud nueva (aún no existe
  // el documento de la reunión): el requester es el usuario actual.
  const prepareSlotSelectionForRequest = async (receiverId: string, selectedDate?: string) => {
    setPrepareSlotSelectionLoading(true);
    try {
      if (!eventId || !uid) throw new Error("Event ID / usuario requerido");
      setMeetingToAccept(null);
      setMeetingToEdit(null);

      const receiverFixedTable = resolveFixedTableForReceiver(receiverId);
      const receiverGroupIds = resolveReceiverGroupIds(receiverId);
      const { slots, eventDayISO } = await computeAvailableSlots({
        eventId,
        eventConfig,
        policies,
        requesterId: uid,
        receiverId,
        selectedDate,
        receiverFixedTable,
        receiverGroupIds,
      });

      // Siempre reflejar el día resultante en el estado (aunque ya venga en el
      // parámetro `selectedDate`): el <Select> del modal está controlado por
      // este estado, así que si solo se asignara cuando faltaba, cambiar de
      // día mediante ese selector rebotaría de vuelta al día anterior (mismo
      // bug que había en useCompanyData.ts para la vista de empresa).
      setSelectedDate(selectedDate || eventDayISO);
      setAvailableSlots(slots);
      setSlotModalOpened(true);
    } finally {
      setPrepareSlotSelectionLoading(false);
    }
  };

  // Cuenta reuniones activas (pendientes o aceptadas) de un asesor, como requester o
  // receiver, para elegir al de menor carga en el modo "sin aceptación" de empresa.
  // Solicitud de empresa: punto de entrada único tanto para "solicitar a la
  // empresa" (sin advisorId, ver meetingSlotEngine.createMeetingRequestDoc) como
  // para "solicitar a un asesor puntual dentro de la vista de empresa" (con
  // advisorId, delega en requestMeetingWithSlotPicker — el mismo flujo que
  // cualquier solicitud individual, solo etiquetado con companyNit).
  const sendMeetingRequestToCompany = async (
    companyNit: string,
    context?: MeetingContext,
    advisorId?: string,
  ): Promise<{ deferred: boolean } | void> => {
    if (!uid || !eventId) {
      showNotification({
        title: "Error",
        message: "Debes iniciar sesión para enviar solicitudes de reunión",
        color: "red",
      });
      return Promise.reject(new Error("No user logged in"));
    }

    if (advisorId) {
      const advisorSnap = await getDoc(doc(db, "users", advisorId));
      if (!advisorSnap.exists()) {
        showNotification({
          title: "Error",
          message: "El asistente al que intentas enviar la solicitud ya no existe.",
          color: "red",
        });
        return Promise.reject(new Error("Receiver not found"));
      }
      return requestMeetingWithSlotPicker(advisorId, advisorSnap.data()?.telefono || "", {
        ...context,
        companyId: companyNit,
      });
    }

    // Validar que la empresa tenga al menos un asesor antes de crear cualquier
    // solicitud: sin este check, una empresa sin asesores (ej. sólo compradores
    // asociados) generaría una solicitud "fantasma" que nadie puede ver ni
    // reclamar (con aceptación), o un mensaje de "sin disponibilidad" engañoso
    // (sin aceptación) cuando el problema real es que no hay ningún asesor.
    const advisors = await getCompanyAdvisors(eventId, companyNit);
    if (advisors.length === 0) {
      showNotification({
        title: "Sin asesores",
        message: "Esta empresa no tiene asesores disponibles para recibir la solicitud.",
        color: "red",
      });
      return Promise.reject(new Error("No advisors available"));
    }

    // Sin advisorId no hay un receptor puntual todavía (se elige más abajo), pero
    // la política "maxMeetingsPerContact" también debe frenar solicitudes a la
    // empresa en general: se valida contra el grupo de la empresa completa
    // (contactCompanyId) usando companyNit como id sintético.
    if (!(await checkContactMeetingLimit(companyNit, { companyId: companyNit }))) {
      return Promise.reject(new Error("Meeting limit reached"));
    }

    if (policies.schedulingMode === "requester_picks") {
      if (!(await checkRoleMeetingLimit())) {
        return Promise.reject(new Error("Role meeting limit reached"));
      }
      const picked = await pickAvailableCompanyAdvisor({ eventId, eventConfig, policies, requesterId: uid, companyNit });
      if (!picked) {
        showNotification({
          title: "Sin disponibilidad",
          message: "Ningún asesor de la empresa tiene horarios libres en este momento.",
          color: "red",
        });
        return Promise.reject(new Error("No availability"));
      }
      setPendingMeetingRequest({
        assistantId: picked.receiverId,
        assistantPhone: picked.receiverPhone,
        context: { ...context, companyId: companyNit },
      });
      setSelectedDate(picked.eventDayISO);
      setAvailableSlots(picked.slots);
      setSlotModalOpened(true);
      return { deferred: true };
    }

    await createMeetingRequestDoc({
      eventId,
      requesterId: uid,
      companyNit,
      context,
      policies,
      eventName,
      dashboardLogo,
    });
    meetingAnalytics.requestSent(companyNit, !!context?.contextNote);
    return Promise.resolve();
  };

  // Confirmar la selección de slot para la reunión
  const confirmAcceptWithSlot = async (meetingId: string, slot: any): Promise<boolean> => {
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
    const notifId = `accept-meeting-${meetingId}`;

    mantineNotifications.show({
      id: notifId,
      title: isEdit ? "Actualizando reunión" : "Agendando reunión",
      message: "Estamos confirmando el horario y la mesa, espera un momento...",
      loading: true,
      autoClose: false,
      withCloseButton: false,
    });

    try {
      if (!eventId || !meetingId || !slot?.id) {
        mantineNotifications.update({
          id: notifId,
          title: "Error",
          message: "No se seleccionó correctamente el horario. Intenta de nuevo.",
          color: "red",
          loading: false,
          autoClose: 5000,
          withCloseButton: true,
        });
        return false;
      }

      // 0) Determinar la fecha del evento para normalizar
      // Soporte multi-día: usar la fecha del slot si existe, sino usar eventDate
      const eventDateISO: string = slot.date || 
        (eventConfig?.eventDates?.[0]) ||
        String(eventConfig?.eventDate || "").trim() ||
        new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

      const mtgRef = doc(db, "events", eventId, "meetings", meetingId);
      const slotRef = doc(db, "events", eventId, "agenda", slot.id);

      // Pre-read meeting to get participants (needed for standby check outside transaction)
      const mtgPreSnap = await getDoc(mtgRef);
      if (!mtgPreSnap.exists()) throw new Error("Reunión no existe");
      const mtgPreData = mtgPreSnap.data() as any;
      const preRequesterId: string = mtgPreData.requesterId;
      // Solicitud de empresa sin reclamar: receiverId es null hasta que alguien la acepta,
      // en cuyo caso el receptor efectivo será el usuario actual (uid).
      const preReceiverId: string | null = mtgPreData.receiverId || null;
      const preIsCompanyClaim = !preReceiverId && !!mtgPreData.companyId;
      const effectivePreReceiverId = preReceiverId || (preIsCompanyClaim ? uid : undefined);

      // Pre-read checkedIn status outside transaction (users collection has restricted read rules)
      let reqCheckedIn = false;
      let recCheckedIn = false;
      // Read policy directly from Firestore to avoid stale eventConfig closure
      const eventDocSnap = await getDoc(doc(db, "events", eventId));
      const standbyRequired = eventDocSnap.exists()
        ? eventDocSnap.data()?.config?.policies?.standbyCheckInRequired === true
        : false;
      console.log("[confirmAcceptWithSlot] standbyRequired:", standbyRequired, "eventId:", eventId);
      if (standbyRequired && !isEdit) {
        const [reqUserSnap, recUserSnap] = await Promise.all([
          getDoc(doc(db, "users", preRequesterId)),
          effectivePreReceiverId
            ? getDoc(doc(db, "users", effectivePreReceiverId))
            : Promise.resolve(null),
        ]);
        reqCheckedIn = reqUserSnap.exists() ? !!reqUserSnap.data()?.checkIns?.[eventDateISO] : false;
        recCheckedIn = recUserSnap?.exists() ? !!recUserSnap.data()?.checkIns?.[eventDateISO] : false;
        console.log("[confirmAcceptWithSlot] reqCheckedIn:", reqCheckedIn, "recCheckedIn:", recCheckedIn);
      }

      // 1) TRANSACCIÓN: valida, crea locks, actualiza meeting y ocupa slot
      await runTransaction(db, async (tx) => {
        // a) Cargar meeting
        const mtgSnap = await tx.get(mtgRef);
        if (!mtgSnap.exists()) throw new Error("Reunión no existe");
        const mtg = mtgSnap.data() as any;

        // Evita que dos aceptaciones simultáneas (p. ej. dos asesores de la misma empresa)
        // generen dos reuniones: si no es una edición, la reunión debe seguir "pending".
        if (!isEdit && mtg.status !== "pending") {
          throw new Error(
            "Esta reunión ya no está disponible (alguien más la aceptó o fue cancelada).",
          );
        }

        const requesterId: string | undefined = mtg.requesterId;
        // Solicitud de empresa sin reclamar (receiverId null): quien acepta se convierte
        // en el receptor, seteado atómicamente dentro de esta misma transacción.
        const isCompanyClaim = !mtg.receiverId && !!mtg.companyId;
        const receiverId: string | undefined = mtg.receiverId || (isCompanyClaim ? uid : undefined);
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

        // d) Crea locks por persona+franja (uno por cada representante de la
        // empresa del receptor, si tiene "agenda compartida" activa)
        const start = slot.startTime;
        const end = slot.endTime;

        const reqLockRef = doc(
          db,
          "locks",
          lockId(eventId, requesterId, eventDateISO, start, end),
        );
        const receiverGroupIds = resolveReceiverGroupIds(receiverId);
        const recLockRefs = receiverGroupIds.map((gid) =>
          doc(db, "locks", lockId(eventId, gid, eventDateISO, start, end)),
        );

        // Check if locks already exist, then create them
        const reqLockSnap = await tx.get(reqLockRef);
        const recLockSnaps = await Promise.all(recLockRefs.map((ref) => tx.get(ref)));

        if (reqLockSnap.exists()) {
          throw new Error("Requester already has a meeting in this time slot");
        }
        if (recLockSnaps.some((s) => s.exists())) {
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
        recLockRefs.forEach((ref, i) => {
          tx.set(ref, {
            eventId,
            userId: receiverGroupIds[i],
            meetingId,
            date: eventDateISO,
            start,
            end,
            createdAt: new Date(),
          });
        });

        // e) Actualiza meeting con datos normalizados y referencias para futuras ediciones
        const updatePayload: any = {
          timeSlot: `${start} - ${end}`,
          tableAssigned: String(slot.tableNumber),
          meetingDate: eventDateISO,
          startMinutes: hmToMinutes(start),
          endMinutes: hmToMinutes(end),
          slotId: slot.id,
          lockIds: [reqLockRef.id, ...recLockRefs.map((r) => r.id)],
          updatedAt: new Date(),
        };
        if (!isEdit) {
          // Use pre-read checkedIn values (read outside transaction to avoid permission issues)
          updatePayload.status = "accepted";
          if (standbyRequired) {
            updatePayload.checkInStatus = (reqCheckedIn && recCheckedIn) ? "ready" : "standby";
          } else {
            updatePayload.checkInStatus = "ready";
          }
          if (isCompanyClaim) {
            updatePayload.receiverId = receiverId;
            updatePayload.participants = [requesterId, receiverId];
          }
        }
        tx.update(mtgRef, updatePayload);

        // f) Ocupa el slot
        tx.update(slotRef, { available: false, meetingId });
      });

      // Cancel standby meeting that was using this slot (if any)
      if (slot.isStandbySlot) {
        const standbySnap = await getDocs(
          query(
            collection(db, "events", eventId, "meetings"),
            where("status", "==", "accepted"),
            where("checkInStatus", "==", "standby"),
            where("slotId", "==", slot.id)
          )
        );
        for (const d of standbySnap.docs) {
          await updateDoc(d.ref, { status: "cancelled" });
        }
      }

      const mtgAfter = await getDoc(mtgRef);
      const { requesterId, receiverId, companyId } = (mtgAfter.data() || {}) as Partial<Meeting>;

      // 2) Notificaciones/SMS/WhatsApp
      await notifyMeetingConfirmed({
        requesterId: requesterId!,
        receiverId: receiverId!,
        slot,
        eventDateISO,
        isEdit,
        policies,
        eventName,
        tableNames: eventConfig?.tableNames,
      });

      // 2b. Notificar también a los demás asesores de la empresa (Etapa 1: fan-out)
      if (companyId) {
        await notifyCompanyAdvisors({
          eventId: eventId!,
          companyNit: companyId,
          excludeUids: [requesterId as string, receiverId as string],
          policies,
          whatsappBuilder: (advisor) => ({
            phone: advisor.telefono || "",
            message: `Un compañero de tu empresa aceptó una reunión (${slot.startTime} - ${slot.endTime}, mesa ${slot.tableNumber}).`,
          }),
          dashboardNotif: {
            title: "Reunión aceptada",
            message: "Un compañero de tu empresa aceptó una reunión.",
            type: "meeting_accepted",
          },
        });
      }

      // 4) Cierra los modales y limpia estado
      setSlotModalOpened(false);
      setConfirmModalOpened(false);
      setMeetingToEdit(null);
      setMeetingToAccept(null);

      mantineNotifications.update({
        id: notifId,
        title: isEdit ? "Reunión actualizada" : "Reunión agendada",
        message: isEdit
          ? "La reunión fue movida al nuevo horario y mesa correctamente."
          : "La reunión fue aceptada y agendada correctamente.",
        color: "teal",
        loading: false,
        autoClose: 4000,
        withCloseButton: true,
      });

      return true;
    } catch (e: any) {
      console.error("❌ confirmAcceptWithSlot:", e?.message || e);
      // Mensaje amigable para colisión por locks/slot
      const msg = /already exists|Slot already taken|ya está ocupado/i.test(
        String(e?.message),
      )
        ? "El horario escogido ya no está disponible o la persona ya tiene reunión en esa franja."
        : "No se pudo confirmar la reunión. Verifica tu conexión e intenta de nuevo.";
      mantineNotifications.update({
        id: notifId,
        title: "Error al agendar la reunión",
        message: msg,
        color: "red",
        loading: false,
        autoClose: 6000,
        withCloseButton: true,
      });

      return false;
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
          label: getTableLabel(s.tableNumber, eventConfig?.tableNames),
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
      : pendingMeetingRequest
        ? assistants.find((a) => a.id === pendingMeetingRequest.assistantId)?.nombre || ""
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
      companyId: owner.companyId || null,
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
    } else if (pendingMeetingRequest) {
      prepareSlotSelectionForRequest(pendingMeetingRequest.assistantId, date);
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
    const combined = [...pendingRequests, ...companyPendingRequests];
    if (!globalDateFilter) return combined;
    return combined.filter(m => m.meetingDate === globalDateFilter);
  }, [pendingRequests, companyPendingRequests, globalDateFilter]);

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
    eventId,
    uid,
    currentUser,
    assistants,
    filteredAssistants,
    acceptedMeetings: filteredAcceptedMeetings,
    standbyMeetings,
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
    filterByRole,
    setFilterByRole,
    interestFilter,
    setInterestFilter,
    interestOptions,

    sendMeetingRequest,
    requestMeetingWithSlotPicker,
    sendMeetingRequestToCompany,
    confirmSendMeetingRequestWithSlot,
    pendingMeetingRequest,
    setPendingMeetingRequest,
    updateMeetingStatus,
    prepareSlotSelection,
    prepareSlotSelectionForRequest,
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
    myStandVisits,
    policies,
    selectedDate,
    setSelectedDate,
    handleDateChange,
    globalDateFilter,
    setGlobalDateFilter,

    companyMeetings,
    isCompanyAdvisor,
    myCompanyNit,
    getCompanyAdvisorIds,
  };
}

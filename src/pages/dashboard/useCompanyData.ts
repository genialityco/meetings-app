import { useState, useEffect, useMemo, useContext, useCallback } from "react";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { UserContext } from "../../context/UserContext";
import { Company, Product, EventPolicies, DEFAULT_POLICIES, MeetingContext, StandVisit } from "./types";
import { resolveCheckInDay, isCheckedInOnDay } from "../../utils/eventDays";
import { showNotification } from "@mantine/notifications";
import { sendWhatsAppMessage as sendWhatsAppAPI } from "../../utils/whatsappService";
import {
  computeAvailableSlots,
  createConfirmedMeeting,
  notifyMeetingConfirmed,
  getTableLabel,
  countMeetingsWithContact,
} from "./meetingSlotEngine";

export type VisitLookupResult =
  | { kind: "ready"; attendee: any }
  | { kind: "already-visited"; attendee: any }
  | { kind: "error"; message: string };

export type VisitConfirmResult =
  | { kind: "success"; attendeeName: string }
  | { kind: "error"; message: string };

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

export function useCompanyData(
  eventId?: string,
  companyNit?: string,
  options?: { subscribeToVisits?: boolean },
) {
  const { currentUser } = useContext(UserContext);
  const uid = currentUser?.uid;
  const subscribeToVisits = options?.subscribeToVisits ?? false;

  const [company, setCompany] = useState<Company | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [representatives, setRepresentatives] = useState<CompanyRepresentative[]>([]);
  const [visits, setVisits] = useState<StandVisit[]>([]);
  const [eventConfig, setEventConfig] = useState<any>(null);
  const [eventName, setEventName] = useState("");
  const [eventImage, setEventImage] = useState<string | null>(null);
  const [dashboardLogo, setDashboardLogo] = useState("");
  const [policies, setPolicies] = useState<EventPolicies>(DEFAULT_POLICIES);
  const [loading, setLoading] = useState(true);
  const [userMeetings, setUserMeetings] = useState<any[]>([]);

  // Estado del selector de horario/mesa (flujo "el solicitante elige horario")
  const [slotModalOpened, setSlotModalOpened] = useState(false);
  const [availableSlots, setAvailableSlots] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [confirmModalOpened, setConfirmModalOpened] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [prepareSlotSelectionLoading, setPrepareSlotSelectionLoading] = useState(false);
  const [pendingMeetingRequest, setPendingMeetingRequest] = useState<{
    receiverId: string;
    receiverPhone: string;
    context?: MeetingContext;
  } | null>(null);

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
        setPolicies({ ...DEFAULT_POLICIES, ...(data.config?.policies || {}) });
      }
    })();
  }, [eventId]);

  // 2. Company doc
  useEffect(() => {
    if (!eventId || !companyNit) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const snap = await getDoc(
          doc(db, "events", eventId, "companies", companyNit),
        );
        if (snap.exists()) {
          setCompany({ nitNorm: snap.id, ...snap.data() } as Company);
        }
      } catch (error) {
        console.error("Error fetching company doc:", error);
      } finally {
        setLoading(false);
      }
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

  // 5. Visitas al stand (real-time). Solo se suscribe cuando el llamador lo pide
  // explícitamente (p. ej. MyCompanyTab.tsx, la vista del propio representante) —
  // CompanyLanding.tsx no debe pedir esto, ya que la lista de visitantes no es pública.
  useEffect(() => {
    if (!eventId || !companyNit || !subscribeToVisits) return;
    const q = query(
      collection(db, "events", eventId, "companies", companyNit, "visits"),
      orderBy("visitedAt", "desc"),
    );
    return onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as StandVisit);
      setVisits(list);
    });
  }, [eventId, companyNit, subscribeToVisits]);

  // Busca y valida al asistente escaneado por el representante del stand
  // (dirección inversa a StandVisitScanPage.tsx, donde es el propio visitante
  // quien escanea el QR fijo del stand), SIN registrar nada todavía — eso
  // permite mostrarle sus datos al vendedor antes de confirmar la visita.
  const lookupAttendeeForVisit = useCallback(
    async (scannedUserId: string): Promise<VisitLookupResult> => {
      if (!eventId || !companyNit) {
        return { kind: "error", message: "No se encontró la información del stand." };
      }
      try {
        const attendeeSnap = await getDoc(doc(db, "users", scannedUserId));
        if (!attendeeSnap.exists()) {
          return { kind: "error", message: "Este código no corresponde a un asistente del evento." };
        }
        const attendeeData = { id: scannedUserId, ...(attendeeSnap.data() as any) };
        if (attendeeData.eventId !== eventId) {
          return { kind: "error", message: "Este código no corresponde a un asistente de este evento." };
        }
        const checkInDay = resolveCheckInDay(eventConfig);
        if (!isCheckedInOnDay(attendeeData, checkInDay)) {
          return { kind: "error", message: "El asistente debe hacer check-in hoy antes de registrar la visita." };
        }
        const attendeeCompanyNit = attendeeData.companyId || attendeeData.company_nit;
        if (attendeeCompanyNit === companyNit) {
          return { kind: "error", message: "No puedes registrar una visita de tu propio stand." };
        }

        const visitRef = doc(db, "events", eventId, "companies", companyNit, "visits", scannedUserId);
        const visitSnap = await getDoc(visitRef);
        if (visitSnap.exists()) {
          return { kind: "already-visited", attendee: attendeeData };
        }

        return { kind: "ready", attendee: attendeeData };
      } catch (e) {
        console.error("Error al buscar asistente escaneado:", e);
        return { kind: "error", message: "Ocurrió un error al buscar el asistente. Intenta de nuevo." };
      }
    },
    [eventId, companyNit, eventConfig],
  );

  // Confirma (escribe) la visita para un asistente ya validado por lookupAttendeeForVisit.
  const confirmVisit = useCallback(
    async (attendee: any): Promise<VisitConfirmResult> => {
      if (!eventId || !companyNit) {
        return { kind: "error", message: "No se encontró la información del stand." };
      }
      try {
        const attendeeName = attendee.nombre || "Asistente";
        const visitRef = doc(db, "events", eventId, "companies", companyNit, "visits", attendee.id);
        await setDoc(visitRef, {
          attendeeId: attendee.id,
          attendeeName,
          attendeeEmpresa: attendee.empresa || attendee.company_razonSocial || "",
          visitedAt: new Date(),
        });
        return { kind: "success", attendeeName };
      } catch (e) {
        console.error("Error al registrar visita:", e);
        return { kind: "error", message: "Ocurrió un error al registrar la visita. Intenta de nuevo." };
      }
    },
    [eventId, companyNit],
  );

  // Cargar reuniones del usuario actual para ver si hay solicitudes pendientes
  useEffect(() => {
    if (!eventId || !companyNit) return;
    let unsubscribeMeetings = () => {};
    if (currentUser?.uid) {
      const qMeetings = query(
        collection(db, "events", eventId, "meetings"),
        where("participants", "array-contains", currentUser.uid),
      );
      unsubscribeMeetings = onSnapshot(qMeetings, (snap) => {
        const meetingsData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setUserMeetings(meetingsData);
      });
    }

    return () => {
      unsubscribeMeetings();
    };
  }, [eventId, companyNit, currentUser?.uid]);

  // Valida la política "maxMeetingsPerContact": si ya se alcanzó el máximo de
  // reuniones con esta persona (o cualquier representante de su misma empresa),
  // muestra el error y lanza para que el llamador aborte.
  const checkContactMeetingLimit = useCallback(
    async (receiverId: string, receiverData: any) => {
      const limit = policies.maxMeetingsPerContact;
      if (!limit || !uid || !eventId) return;

      const receiverCompanyId = receiverData?.companyId || receiverData?.company_nit || null;
      const count = await countMeetingsWithContact({
        eventId,
        userId: uid,
        contactId: receiverId,
        contactCompanyId: receiverCompanyId,
      });

      if (count >= limit) {
        showNotification({
          title: "Límite de reuniones alcanzado",
          message: `Ya tienes ${count} reunión(es) con esta persona o empresa. El máximo permitido es ${limit}.`,
          color: "red",
        });
        throw new Error("Meeting limit reached");
      }
    },
    [policies.maxMeetingsPerContact, uid, eventId],
  );

  // Send meeting request (simplified version)
  const sendMeetingRequest = useCallback(
    async (
      receiverId: string,
      receiverPhone: string,
      context?: { productId?: string; companyId?: string | null; contextNote?: string },
    ) => {
      // Validar que haya usuario logueado
      if (!uid || !eventId) {
        showNotification({
          title: "Error",
          message: "Debes iniciar sesión para enviar solicitudes de reunión",
          color: "red",
        });
        throw new Error("No user logged in");
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
        throw new Error("User data not found");
      }

      // Validar que el receptor exista en Firestore antes de crear la reunión
      const receiverSnap = await getDoc(doc(db, "users", receiverId));
      if (!receiverSnap.exists()) {
        showNotification({
          title: "Error",
          message: "El asistente al que intentas enviar la solicitud ya no existe.",
          color: "red",
        });
        throw new Error("Receiver not found");
      }

      await checkContactMeetingLimit(receiverId, receiverSnap.data());

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
        `🔗 Ir al evento: \n${landingUrl}`;

      const whatsappApiVersion = policies.whatsappApiVersion || "v1";
      if (policies.whatsappNotificationsEnabled !== false) {
        await sendWhatsAppAPI({
          apiVersion: whatsappApiVersion,
          phone: receiverPhone.replace(/[^\d]/g, ""),
          message: whatsappApiVersion === "v2" ? (context?.contextNote || "Sin mensaje adicional") : message,
          metadata: {
            eventName: eventName || "Evento",
            requesterName: requester?.nombre || "",
            requesterCompany: requester?.empresa || "",
            requesterPosition: requester?.cargo || "",
            requesterEmail: requester?.correo || "",
            requesterPhone: requester?.telefono || "",
            acceptUrl: acceptPath,
            cancelUrl: rejectPath,
          },
        });
      }

      if (policies.dashboardNotificationsEnabled !== false) {
        await addDoc(collection(db, "notifications"), {
          userId: receiverId,
          title: "Nueva solicitud de reunión",
          message: `${requester?.nombre || "Alguien"} te ha enviado una solicitud de reunión.`,
          timestamp: new Date(),
          read: false,
          type: "meeting_request",
        });
      }
    },
    [uid, eventId, currentUser, eventName, policies, checkContactMeetingLimit],
  );

  // Selector de horario para que el solicitante elija slot/mesa. El receptor
  // es siempre un representante de `company` (la página desde la que se
  // pide); la mesa fija puede venir del propio representante o, si no la
  // tiene, de la empresa.
  const prepareSlotSelectionForRequest = useCallback(
    async (receiverId: string, dateOverride?: string) => {
      if (!eventId || !uid) return;
      setPrepareSlotSelectionLoading(true);
      try {
        const receiver = representatives.find((r) => r.id === receiverId);
        const receiverFixedTable = receiver?.fixedTable || company?.fixedTable || null;
        const { slots, eventDayISO } = await computeAvailableSlots({
          eventId,
          eventConfig,
          policies,
          requesterId: uid,
          receiverId,
          selectedDate: dateOverride,
          receiverFixedTable,
        });
        if (!dateOverride) setSelectedDate(eventDayISO);
        setAvailableSlots(slots);
        setSlotModalOpened(true);
      } finally {
        setPrepareSlotSelectionLoading(false);
      }
    },
    [eventId, uid, eventConfig, policies, company, representatives],
  );

  const requestMeetingWithSlotPicker = useCallback(
    async (
      receiverId: string,
      receiverPhone: string,
      context?: { productId?: string; companyId?: string | null; contextNote?: string },
    ): Promise<{ deferred: boolean } | void> => {
      if (policies.schedulingMode !== "requester_picks") {
        return sendMeetingRequest(receiverId, receiverPhone, context);
      }

      const receiverSnap = await getDoc(doc(db, "users", receiverId));
      if (!receiverSnap.exists()) {
        showNotification({
          title: "Error",
          message: "El asistente al que intentas enviar la solicitud ya no existe.",
          color: "red",
        });
        throw new Error("Receiver not found");
      }
      await checkContactMeetingLimit(receiverId, receiverSnap.data());

      setPendingMeetingRequest({ receiverId, receiverPhone, context });
      await prepareSlotSelectionForRequest(receiverId);
      return { deferred: true };
    },
    [policies.schedulingMode, sendMeetingRequest, prepareSlotSelectionForRequest, checkContactMeetingLimit],
  );

  const confirmSendMeetingRequestWithSlot = useCallback(
    async (slot: any): Promise<boolean> => {
      if (!pendingMeetingRequest || !eventId || !uid || !slot?.id) return false;
      const { receiverId, context } = pendingMeetingRequest;

      setConfirmLoading(true);
      try {
        const { eventDateISO } = await createConfirmedMeeting({
          eventId,
          eventConfig,
          requesterId: uid,
          receiverId,
          slot,
          context,
        });

        await notifyMeetingConfirmed({
          requesterId: uid,
          receiverId,
          slot,
          eventDateISO,
          isEdit: false,
          policies,
          eventName,
          acceptedByName: null,
          tableNames: eventConfig?.tableNames,
        });

        setSlotModalOpened(false);
        setConfirmModalOpened(false);
        setPendingMeetingRequest(null);
        showNotification({
          title: "Reunión confirmada",
          message: "La reunión fue agendada y confirmada correctamente.",
          color: "teal",
        });
        return true;
      } catch (e) {
        const msg = /already exists|Slot already taken|ya está ocupado/i.test(String((e as any)?.message))
          ? "El horario escogido ya no está disponible o la persona ya tiene reunión en esa franja."
          : "No se pudo confirmar la reunión. Verifica tu conexión e intenta de nuevo.";
        showNotification({ title: "Error al agendar la reunión", message: msg, color: "red" });
        return false;
      } finally {
        setConfirmLoading(false);
      }
    },
    [pendingMeetingRequest, eventId, uid, eventConfig, policies, eventName],
  );

  const groupedSlots = useMemo(() => {
    const map: any = {};
    for (const slot of availableSlots) {
      const range = `${slot.startTime}–${slot.endTime}`;
      if (!map[range]) {
        map[range] = { startTime: slot.startTime, endTime: slot.endTime, slots: [] };
      }
      map[range].slots.push(slot);
    }
    return Object.entries(map).map(([range, grp]: any) => ({ id: range, range, ...grp }));
  }, [availableSlots]);

  const tableOptions = selectedRange
    ? (groupedSlots.find((g) => g.id === selectedRange)?.slots || []).map((s: any) => ({
        value: s.id,
        label: getTableLabel(s.tableNumber, eventConfig?.tableNames),
      }))
    : [];

  const chosenSlot =
    selectedRange && selectedSlotId
      ? groupedSlots.find((g) => g.id === selectedRange)?.slots.find((s: any) => s.id === selectedSlotId) || null
      : null;

  const chosenSlotTableLabel = getTableLabel(chosenSlot?.tableNumber, eventConfig?.tableNames);

  return {
    company,
    products,
    representatives,
    visits,
    lookupAttendeeForVisit,
    confirmVisit,
    eventConfig,
    eventName,
    eventImage,
    dashboardLogo,
    loading,
    currentUser,
    userMeetings,
    sendMeetingRequest,
    requestMeetingWithSlotPicker,
    prepareSlotSelectionForRequest,
    confirmSendMeetingRequestWithSlot,
    pendingMeetingRequest,
    setPendingMeetingRequest,
    slotModalOpened,
    setSlotModalOpened,
    availableSlots,
    selectedDate,
    selectedRange,
    setSelectedRange,
    selectedSlotId,
    setSelectedSlotId,
    confirmModalOpened,
    setConfirmModalOpened,
    confirmLoading,
    prepareSlotSelectionLoading,
    groupedSlots,
    tableOptions,
    chosenSlot,
    chosenSlotTableLabel,
  };
}

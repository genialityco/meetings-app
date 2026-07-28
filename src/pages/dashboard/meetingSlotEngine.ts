// Motor compartido de selección de horario/mesa y confirmación de reuniones.
// Usado tanto por useDashboardData.ts (dashboard principal) como por
// useCompanyData.ts (CompanyLanding / Mi empresa), para no duplicar la lógica
// de disponibilidad, locks y notificaciones en dos hooks distintos.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  runTransaction,
  addDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { AgendaSlot, Assistant, EventPolicies, MeetingContext } from "./types";
import { sendWhatsAppMessage as sendWhatsAppAPI } from "../../utils/whatsappService";

export function parseISODate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Nombre real de la mesa (ej. "Expositor 1") si el evento tiene tableNames configurados; si no, "Mesa N". */
export function getTableLabel(tableNumber: string | number | undefined, tableNames?: string[]): string {
  if (tableNumber === undefined || tableNumber === null || tableNumber === "") return "";
  const idx = Number(tableNumber) - 1;
  const name = tableNames && idx >= 0 ? tableNames[idx] : undefined;
  return name || `Mesa ${tableNumber}`;
}

/**
 * Cuenta cuántas reuniones (pendientes o aceptadas, sin contar rechazadas/canceladas)
 * ya existen entre `userId` y un contacto — ya sea la misma persona (`contactId`) o
 * cualquier otro representante de la misma empresa (`contactCompanyId`), para hacer
 * cumplir la política "maxMeetingsPerContact" (límite de reuniones por contacto).
 */
export async function countMeetingsWithContact(params: {
  eventId: string;
  userId: string;
  contactId: string;
  contactCompanyId?: string | null;
}): Promise<number> {
  const { eventId, userId, contactId, contactCompanyId } = params;

  let companyMemberIds: Set<string> | null = null;
  if (contactCompanyId) {
    companyMemberIds = new Set<string>();
    const [byCompanyId, byCompanyNit] = await Promise.all([
      getDocs(query(collection(db, "users"), where("eventId", "==", eventId), where("companyId", "==", contactCompanyId))),
      getDocs(query(collection(db, "users"), where("eventId", "==", eventId), where("company_nit", "==", contactCompanyId))),
    ]);
    byCompanyId.docs.forEach((d) => companyMemberIds!.add(d.id));
    byCompanyNit.docs.forEach((d) => companyMemberIds!.add(d.id));
  }

  const meetingsSnap = await getDocs(
    query(collection(db, "events", eventId, "meetings"), where("participants", "array-contains", userId)),
  );

  let count = 0;
  meetingsSnap.docs.forEach((d) => {
    const m = d.data() as any;
    if (m.status === "rejected" || m.status === "cancelled" || m.status === "taken") return;
    const otherId = m.requesterId === userId ? m.receiverId : m.requesterId;
    if (otherId === contactId) {
      count++;
      return;
    }
    if (companyMemberIds?.has(otherId)) count++;
  });

  return count;
}

export function slotOverlapsBreakBlock(
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

export async function sendSms(text: string, phone: string, apiVersion: "v1" | "v2" = "v1") {
  // La API v2 no tiene un endpoint genérico de "enviar texto libre": sendWhatsAppMessage
  // con apiVersion "v2" siempre pega contra /api/send-meeting-request (la plantilla de
  // "nueva solicitud de reunión"), sin importar el contenido de `message`. Usar sendSms
  // aquí para avisos de confirmación/reagendado terminaba mandando, además del mensaje
  // correcto, un WhatsApp de "solicitud de reunión" de más. En v2 este aviso corto se
  // omite — el mensaje completo y correcto ya lo manda sendMeetingAcceptedWhatsapp con
  // el endpoint de confirmación real.
  if (apiVersion === "v2") return;
  await sendWhatsAppAPI({
    apiVersion,
    phone,
    message: text,
  });
}

export async function sendMeetingAcceptedWhatsapp(
  toPhone: string,
  otherParticipant: Assistant,
  meetingInfo: { timeSlot?: string; tableAssigned?: string; meetingDate?: string },
  eventName?: string,
  acceptedByName?: string,
  whatsappApiVersion: "v1" | "v2" = "v1",
  requesterData?: any,
  fallbackInfo?: { enabled: boolean; email: string; subject: string; logoUrl?: string }
) {
  if (!toPhone) return;
  const phone = toPhone.replace(/[^\d]/g, "");

  // Si es API v2, usar el endpoint de confirmación
  if (whatsappApiVersion === "v2") {
    const { sendMeetingConfirmation } = await import("../../utils/whatsappService");

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
      fallbackInfo,
    });

    return;
  }

  // API v1: usar el método anterior
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
    fallbackInfo,
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

export interface ComputeAvailableSlotsParams {
  eventId: string;
  eventConfig: any;
  policies: EventPolicies;
  requesterId: string;
  receiverId: string;
  selectedDate?: string;
  /** Mesa fija de la empresa del receptor (o null/undefined si no tiene). Ya resuelta por el caller. */
  receiverFixedTable?: string | null;
}

export interface ComputeAvailableSlotsResult {
  slots: AgendaSlot[];
  eventDayISO: string;
}

/**
 * Calcula los slots de agenda disponibles para una pareja requester/receiver,
 * respetando reuniones aceptadas, slots bloqueados, bloques de descanso, horas
 * pasadas y mesa fija. No escribe estado de React: el caller decide qué hacer
 * con el resultado.
 */
export async function computeAvailableSlots(
  params: ComputeAvailableSlotsParams,
): Promise<ComputeAvailableSlotsResult> {
  const { eventId, eventConfig, requesterId, receiverId, selectedDate, receiverFixedTable } = params;

  // Soporte multi-día: usar eventDates si existe, sino eventDate
  const eventDates = eventConfig.eventDates || [eventConfig.eventDate];
  const eventDayISO = selectedDate || eventDates[0];

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
  let accSn;
  try {
    accSn = await getDocs(
      query(
        collection(db, "events", eventId, "meetings"),
        where("status", "==", "accepted"),
        where("participants", "array-contains-any", [requesterId, receiverId]),
        where("meetingDate", "==", eventDayISO),
      ),
    );
  } catch {
    accSn = await getDocs(
      query(
        collection(db, "events", eventId, "meetings"),
        where("status", "==", "accepted"),
        where("participants", "array-contains-any", [requesterId, receiverId]),
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
  let agendaQuery = query(
    collection(db, "events", eventId, "agenda"),
    where("available", "==", true),
    orderBy("startTime"),
  );

  try {
    agendaQuery = query(
      collection(db, "events", eventId, "agenda"),
      where("available", "==", true),
      where("date", "==", eventDayISO),
      orderBy("startTime"),
    );
  } catch (e) {
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
      if (slot.date && slot.date !== eventDayISO) return false;
      if (blockedTimes.has(slot.startTime)) return false;

      const [h, m] = slot.startTime.split(":").map(Number);
      const slotDateTime = new Date(eventDate);
      slotDateTime.setHours(h, m, 0, 0);

      if (isEventToday && slotDateTime <= now) return false;

      if (
        slotOverlapsBreakBlock(
          slot.startTime,
          eventConfig.meetingDuration,
          dayConfig.breakBlocks,
        )
      )
        return false;

      const slotStart = h * 60 + m;
      const slotEnd = slotStart + eventConfig.meetingDuration;
      if (occupiedRanges.some((r) => slotStart < r.end && slotEnd > r.start)) return false;

      return true;
    });

  // Filtro adicional: si el receptor (o su empresa) tiene mesa fija asignada,
  // solo se muestran/asignan slots de esa mesa — sin importar el tableMode
  // global, para que convivan asistentes fijos y de pool en el mismo evento.
  let finalSlots = filtered;
  if (receiverFixedTable) {
    finalSlots = filtered.filter((slot) => String(slot.tableNumber) === receiverFixedTable);
  }

  // Si no hay slots libres y la política de standby está activa, incluir slots ocupados por reuniones en standby
  if (finalSlots.length === 0 && eventConfig?.policies?.standbyCheckInRequired) {
    const standbySnap = await getDocs(
      query(
        collection(db, "events", eventId, "meetings"),
        where("status", "==", "accepted"),
        where("checkInStatus", "==", "standby")
      )
    );
    const standbySlotIds = new Set(standbySnap.docs.map((d) => d.data().slotId).filter(Boolean));
    const allAgendaSnap = await getDocs(
      query(
        collection(db, "events", eventId, "agenda"),
        where("date", "==", eventDayISO),
        orderBy("startTime")
      )
    );
    const standbySlots = allAgendaSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s: any) => standbySlotIds.has(s.id));
    return {
      slots: standbySlots.map((s: any) => ({ ...s, isStandbySlot: true })),
      eventDayISO,
    };
  }

  return { slots: finalSlots, eventDayISO };
}

export interface CreateConfirmedMeetingParams {
  eventId: string;
  eventConfig: any;
  requesterId: string;
  receiverId: string;
  slot: any;
  context?: MeetingContext;
}

export interface CreateConfirmedMeetingResult {
  meetingId: string;
  eventDateISO: string;
}

/**
 * Crea una reunión ya "accepted" (sin paso de aceptar), reservando mesa+locks
 * en una sola transacción. No escribe nada en Firestore hasta que la
 * transacción confirma, así que si el usuario cancela el picker antes de
 * llegar aquí, no queda nada que limpiar.
 */
export async function createConfirmedMeeting(
  params: CreateConfirmedMeetingParams,
): Promise<CreateConfirmedMeetingResult> {
  const { eventId, eventConfig, requesterId, receiverId, slot, context } = params;

  const hmToMinutes = (hm: string) => {
    const [h, m] = hm.split(":").map(Number);
    return h * 60 + m;
  };
  const lockId = (uid: string, dateISO: string, start: string, end: string) => {
    const d = String(dateISO || "").replace(/-/g, "");
    return `${eventId}_${uid}_${d}_${start}-${end}`;
  };

  const eventDateISO: string =
    slot.date ||
    eventConfig?.eventDates?.[0] ||
    String(eventConfig?.eventDate || "").trim() ||
    new Date().toISOString().slice(0, 10);

  const slotRef = doc(db, "events", eventId, "agenda", slot.id);

  const receiverSnap = await getDoc(doc(db, "users", receiverId));
  if (!receiverSnap.exists()) {
    throw new Error("Receiver not found");
  }

  // Si ya existe una solicitud "pending" entre este par (p. ej. creada antes de
  // que el solicitante terminara de elegir horario), se reutiliza ese mismo
  // documento en vez de crear una reunión duplicada — evita que quede una
  // "pending" huérfana (con su notificación de solicitud ya enviada) al lado
  // de una "accepted" nueva.
  let meetingRef = doc(collection(db, "events", eventId, "meetings"));
  try {
    const existingPendingSnap = await getDocs(
      query(
        collection(db, "events", eventId, "meetings"),
        where("requesterId", "==", requesterId),
        where("receiverId", "==", receiverId),
        where("status", "==", "pending"),
      ),
    );
    if (!existingPendingSnap.empty) {
      meetingRef = existingPendingSnap.docs[0].ref;
    }
  } catch (e) {
    console.warn("No se pudo verificar solicitudes pendientes previas:", e);
  }

  // Pre-lee fuera de la transacción (reglas de Firestore restringen lectura de `users` dentro de tx)
  let reqCheckedIn = false;
  let recCheckedIn = false;
  const eventDocSnap = await getDoc(doc(db, "events", eventId));
  const standbyRequired = eventDocSnap.exists()
    ? eventDocSnap.data()?.config?.policies?.standbyCheckInRequired === true
    : false;
  if (standbyRequired) {
    const [reqUserSnap, recUserSnap] = await Promise.all([
      getDoc(doc(db, "users", requesterId)),
      getDoc(doc(db, "users", receiverId)),
    ]);
    reqCheckedIn = reqUserSnap.exists() ? !!reqUserSnap.data()?.checkIns?.[eventDateISO] : false;
    recCheckedIn = recUserSnap.exists() ? !!recUserSnap.data()?.checkIns?.[eventDateISO] : false;
  }

  await runTransaction(db, async (tx) => {
    const sSnap = await tx.get(slotRef);
    if (!sSnap.exists()) throw new Error("Slot no encontrado");
    const sData = sSnap.data() as any;
    if (sData.available !== true) throw new Error("El slot ya está ocupado");

    const start = slot.startTime;
    const end = slot.endTime;

    const reqLockRef = doc(db, "locks", lockId(requesterId, eventDateISO, start, end));
    const recLockRef = doc(db, "locks", lockId(receiverId, eventDateISO, start, end));

    const reqLockSnap = await tx.get(reqLockRef);
    const recLockSnap = await tx.get(recLockRef);

    if (reqLockSnap.exists()) throw new Error("Requester already has a meeting in this time slot");
    if (recLockSnap.exists()) throw new Error("Receiver already has a meeting in this time slot");

    tx.set(reqLockRef, {
      eventId,
      userId: requesterId,
      meetingId: meetingRef.id,
      date: eventDateISO,
      start,
      end,
      createdAt: new Date(),
    });
    tx.set(recLockRef, {
      eventId,
      userId: receiverId,
      meetingId: meetingRef.id,
      date: eventDateISO,
      start,
      end,
      createdAt: new Date(),
    });

    const meetingData: any = {
      eventId,
      requesterId,
      receiverId,
      status: "accepted",
      createdAt: new Date(),
      participants: [requesterId, receiverId],
      timeSlot: `${start} - ${end}`,
      tableAssigned: String(slot.tableNumber),
      meetingDate: eventDateISO,
      startMinutes: hmToMinutes(start),
      endMinutes: hmToMinutes(end),
      slotId: slot.id,
      lockIds: [reqLockRef.id, recLockRef.id],
      updatedAt: new Date(),
      checkInStatus: standbyRequired ? (reqCheckedIn && recCheckedIn ? "ready" : "standby") : "ready",
    };
    if (context?.productId) meetingData.productId = context.productId;
    if (context?.companyId) meetingData.companyId = context.companyId;
    if (context?.contextNote) meetingData.contextNote = context.contextNote;

    tx.set(meetingRef, meetingData);
    tx.update(slotRef, { available: false, meetingId: meetingRef.id });
  });

  // Si el slot elegido era un slot "standby", cancela la reunión que lo tenía en espera
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

  return { meetingId: meetingRef.id, eventDateISO };
}

export interface NotifyMeetingConfirmedParams {
  requesterId: string;
  receiverId: string;
  slot: any;
  eventDateISO: string;
  isEdit: boolean;
  policies: EventPolicies;
  eventName?: string;
  /** Pasa `null` explícitamente para omitir la línea "X ha aceptado la reunión" (flujo instantáneo, nadie "aceptó"). */
  acceptedByName?: string | null;
  /** event.config.tableNames — para mostrar el nombre real de la mesa (ej. "Expositor 1") en vez del número */
  tableNames?: string[];
}

/** Notificaciones in-app + SMS + WhatsApp a ambos participantes tras confirmar una reunión. */
export async function notifyMeetingConfirmed(params: NotifyMeetingConfirmedParams) {
  const { requesterId, receiverId, slot, eventDateISO, isEdit, policies, eventName, acceptedByName, tableNames } = params;
  const tableLabel = getTableLabel(slot.tableNumber, tableNames);

  const [reqSnap, recvSnap] = await Promise.all([
    getDoc(doc(db, "users", requesterId)),
    getDoc(doc(db, "users", receiverId)),
  ]);
  const requester = reqSnap.exists() ? (reqSnap.data() as Assistant) : null;
  const receiver = recvSnap.exists() ? (recvSnap.data() as Assistant) : null;

  let dateStr = "";
  if (eventDateISO) {
    const [year, month, day] = eventDateISO.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    dateStr = date.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  }

  const notificationsBatch = isEdit
    ? [
        {
          userId: requesterId,
          title: "Reunión modificada",
          message: `Tu reunión con ${receiver?.nombre || ""} fue movida a ${dateStr ? `${dateStr}, ` : ""}${slot.startTime} (${tableLabel}).`,
          type: "meeting_modified" as const,
        },
        {
          userId: receiverId,
          title: "Reunión modificada",
          message: `Has cambiado la reunión con ${requester?.nombre || ""} a ${dateStr ? `${dateStr}, ` : ""}${slot.startTime} (${tableLabel}).`,
          type: "meeting_modified" as const,
        },
      ]
    : [
        {
          userId: requesterId,
          title: "Reunión aceptada",
          message: `Tu reunión con ${receiver?.nombre || ""} fue aceptada para ${dateStr ? `${dateStr}, ` : ""}${slot.startTime} en ${tableLabel}.`,
          type: "meeting_accepted" as const,
        },
        {
          userId: receiverId,
          title: "Reunión confirmada",
          message: `Has aceptado la reunión con ${requester?.nombre || ""} para ${dateStr ? `${dateStr}, ` : ""}${slot.startTime} en ${tableLabel}.`,
          type: "meeting_accepted" as const,
        },
      ];

  if (policies.dashboardNotificationsEnabled !== false) {
    for (const notif of notificationsBatch) {
      await addDoc(collection(db, "notifications"), {
        ...notif,
        timestamp: new Date(),
        read: false,
      });
    }
  }

  const whatsappApiVersion = policies.whatsappApiVersion || "v1";
  const smsMsg = isEdit
    ? `Tu reunión fue movida a ${slot.startTime} en ${tableLabel}.`
    : `Tu reunión fue aceptada para ${slot.startTime} en ${tableLabel}.`;

  const accepterName =
    acceptedByName === null ? "" : acceptedByName ?? (receiver?.nombre || requester?.nombre || "");
  const fallbackEnabled = policies.fallbackEmailOnWaFailure ?? false;

  if (policies.whatsappNotificationsEnabled !== false) {
    if (requester?.telefono) await sendSms(smsMsg, requester.telefono, whatsappApiVersion);
    if (receiver?.telefono) await sendSms(smsMsg, receiver.telefono, whatsappApiVersion);

    if (requester?.telefono) {
      await sendMeetingAcceptedWhatsapp(
        requester.telefono,
        receiver!,
        { timeSlot: `${slot.startTime} - ${slot.endTime}`, tableAssigned: tableLabel, meetingDate: eventDateISO },
        eventName,
        accepterName,
        whatsappApiVersion,
        requester,
        { enabled: fallbackEnabled, email: requester.correo || "", subject: `Confirmación de reunión - ${eventName}` }
      );
    }
    if (receiver?.telefono) {
      await sendMeetingAcceptedWhatsapp(
        receiver.telefono,
        requester!,
        { timeSlot: `${slot.startTime} - ${slot.endTime}`, tableAssigned: tableLabel, meetingDate: eventDateISO },
        eventName,
        accepterName,
        whatsappApiVersion,
        receiver,
        { enabled: fallbackEnabled, email: receiver?.correo || "", subject: `Confirmación de reunión - ${eventName}` }
      );
    }
  }
}

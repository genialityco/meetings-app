import { useState, useEffect, useContext, useMemo } from "react";
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
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { UserContext } from "../../context/UserContext";
import { AgendaSlot, Assistant, Meeting, Notification } from "./types";
import { showNotification } from "@mantine/notifications";

// Helpers (puedes moverlos a helpers.ts si prefieres)
function slotOverlapsBreakBlock(
  slotStart: string,
  meetingDuration: number,
  breakBlocks: { start: string; end: string }[] = []
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
  if (!participant.telefono) {
    alert("No hay número de teléfono para WhatsApp");
    return;
  }
  const phone = participant.telefono.replace(/[^\d]/g, "");
  const message = encodeURIComponent(
    "Hola, me gustaría contactarte sobre la reunión."
  );
  window.open(`https://wa.me/57${phone}?text=${message}`, "_blank");
}

async function sendMeetingAcceptedWhatsapp(
  toPhone: string,
  otherParticipant: Assistant,
  meetingInfo: { timeSlot?: string; tableAssigned?: string }
) {
  if (!toPhone) return;
  const phone = toPhone.replace(/[^\d]/g, "");
  const message =
    `¡Tu reunión ha sido aceptada!\n\n` +
    `Con: ${otherParticipant?.nombre || ""}\n` +
    `Empresa: ${otherParticipant?.empresa || ""}\n` +
    `Horario: ${meetingInfo.timeSlot || ""}\n` +
    `Mesa: ${meetingInfo.tableAssigned || ""}\n` +
    `¡Te esperamos!`;

  await fetch("https://apiwhatsapp.geniality.com.co/api/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: "genialitybussiness",
      phone: `57${phone}`,
      message,
    }),
  }).catch(() => {});
}

async function sendMeetingCancelledWhatsapp(
  toPhone: string,
  otherParticipant: Assistant,
  meetingInfo: { timeSlot?: string; tableAssigned?: string }
) {
  if (!toPhone) return;
  const phone = (toPhone || "").toString().replace(/[^\d]/g, "");
  const message =
    `¡Tu reunión ha sido cancelada!\n\n` +
    `Con: ${otherParticipant?.nombre || ""}\n` +
    `Empresa: ${otherParticipant?.empresa || ""}\n` +
    `Horario: ${meetingInfo.timeSlot || ""}\n` +
    `Mesa: ${meetingInfo.tableAssigned || ""}\n`;

  await fetch("https://apiwhatsapp.geniality.com.co/api/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: "genialitybussiness",
      phone: `57${phone}`,
      message,
    }),
  }).catch(() => {});
}

export function useDashboardData(eventId?: string) {
  const { currentUser } = useContext(UserContext);
  const uid = currentUser?.uid as string | undefined;

  // ---------------------- ESTADOS PRINCIPALES ----------------------
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [filteredAssistants, setFilteredAssistants] = useState<Assistant[]>([]);
  const [acceptedMeetings, setAcceptedMeetings] = useState<Meeting[]>([]);
  const [loadingMeetings, setLoadingMeetings] = useState(true);
  const [pendingRequests, setPendingRequests] = useState<Meeting[]>([]);
  const [sentRequests, setSentRequests] = useState<Meeting[]>([]);
  const [acceptedRequests, setAcceptedRequests] = useState<Meeting[]>([]);
  const [rejectedRequests, setRejectedRequests] = useState<Meeting[]>([]);
  const [participantsInfo, setParticipantsInfo] = useState<{
    [userId: string]: Assistant;
  }>({});
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [solicitarReunionHabilitado, setSolicitarReunionHabilitado] =
    useState<boolean>(true);
  const [eventConfig, setEventConfig] = useState<any>(null);
  const [formFields, setFormFields] = useState([]);

  // Modales y acciones de UI
  const [avatarModalOpened, setAvatarModalOpened] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [pendingVisible, setPendingVisible] = useState(true);
  const [expandedMeetingId, setExpandedMeetingId] = useState<string | null>(
    null
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

  // ---------------------- EFECTOS PRINCIPALES ----------------------

  // 1. Configuración del evento (eventConfig)
  useEffect(() => {
    if (!eventId) return;
    (async () => {
      const ref = doc(db, "events", eventId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const config = snap.data().config || {};
        setEventConfig(config);
        setFormFields(config.formFields || []);
      }
    })();
  }, [eventId]);

  // 2. Notificaciones del usuario
  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, "notifications"),
      where("userId", "==", uid),
      orderBy("timestamp", "desc")
    );
    return onSnapshot(q, (snap) => {
      const nots = snap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as Notification)
      );

      // Mostrar notificaciones tipo toast solo las no leídas
      nots.forEach((n) => {
        if (!n.read) {
          showNotification({
            title: n.title,
            message: n.message,
            color: "teal", // o el color que prefieras
            autoClose: 6000,
            // icon: <AlgúnIconoOpcional />,
          });
          // Si quieres marcarlas como leídas después de mostrar:
          updateDoc(doc(db, "notifications", n.id), { read: true });
        }
      });

      setNotifications(nots);
    });
  }, [uid]);

  // 3. Configuración global para habilitar solicitudes
  useEffect(() => {
    (async () => {
      const cfgRef = doc(db, "config", "generalSettings");
      const cfgSnap = await getDoc(cfgRef);
      if (cfgSnap.exists()) {
        setSolicitarReunionHabilitado(
          cfgSnap.data().solicitarReunionHabilitado
        );
      }
    })();
  }, []);

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
      })
    );
    // (puedes mantener el filtro por interés si quieres)
    if (interestFilter) {
      filtered = filtered.filter(
        (a) =>
          a[formFields.find((f) => f.name === "interesPrincipal")?.name] ===
          interestFilter
      );
    }

    //Filtro tipo de tipoAsistente para ver los tipos de asistentes diferentes a mi
    if (currentUser?.data?.tipoAsistente) {
      filtered = filtered.filter(
        (a) =>
          a[formFields.find((f) => f.name === "tipoAsistente")?.name] !==
          currentUser?.data?.tipoAsistente
      );

      console.log(
        filtered.filter(
          (a) => !a[formFields.find((f) => f.name === "empresa")?.name]
        )
      );
    }

    setFilteredAssistants(filtered);
  }, [assistants, searchTerm, interestFilter, formFields]);

  // 6. Solicitudes enviadas por usuario actual (pendientes)
  useEffect(() => {
    if (!uid || !eventId) return;
    const q = query(
      collection(db, "events", eventId, "meetings"),
      where("requesterId", "==", uid),
      where("status", "==", "pending")
    );
    return onSnapshot(q, (snap) => {
      setSentRequests(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as Meeting))
      );
    });
  }, [uid, eventId]);

  // 7. Reuniones aceptadas
  useEffect(() => {
    if (!uid || !eventId) return;
    setLoadingMeetings(true); // <- ACTIVA loading
    const q = query(
      collection(db, "events", eventId, "meetings"),
      where("status", "==", "accepted"),
      where("participants", "array-contains", uid)
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

  // 8. Solicitudes donde usuario es receptor
  useEffect(() => {
    if (!uid || !eventId) return;
    const q = query(
      collection(db, "events", eventId, "meetings"),
      where("receiverId", "==", uid)
    );
    return onSnapshot(q, (snap) => {
      const pend: Meeting[] = [],
        acc: Meeting[] = [],
        rej: Meeting[] = [];
      snap.docs.forEach((d) => {
        const r = { id: d.id, ...d.data() } as Meeting;
        if (r.status === "pending") pend.push(r);
        if (r.status === "accepted") acc.push(r);
        if (r.status === "rejected") rej.push(r);
      });
      setPendingRequests(pend);
      setAcceptedRequests(acc);
      setRejectedRequests(rej);
    });
  }, [uid, eventId]);

  // ---------------------- ACCIONES PRINCIPALES ----------------------
  const cancelSentMeeting = async (
    meetingId: string,
    mode: "cancel" | "delete" = "cancel"
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
    assistantPhone: string
  ) => {
    if (!uid || !eventId) return Promise.reject();
    try {
      const meetingDoc = await addDoc(
        collection(db, "events", eventId, "meetings"),
        {
          eventId,
          requesterId: uid,
          receiverId: assistantId,
          status: "pending",
          createdAt: new Date(),
          participants: [uid, assistantId],
        }
      );

      const requester = currentUser?.data;
      const meetingId = meetingDoc.id;
      const baseUrl = window.location.origin;

      const acceptUrl = `${baseUrl}/meeting-response/${eventId}/${meetingId}/accept`;
      const rejectUrl = `${baseUrl}/meeting-response/${eventId}/${meetingId}/reject`;
      const landingUrl = `${baseUrl}/event/${eventId}`;

      const message =
        `Has recibido una solicitud de reunión de:\n` +
        `Nombre: ${requester?.nombre || ""}\n` +
        `Empresa: ${requester?.empresa || ""}\n` +
        `Cargo: ${requester?.cargo || ""}\n` +
        `Correo: ${requester?.correo || ""}\n` +
        `Teléfono: ${requester?.telefono || ""}\n\n` +
        `Opciones:\n` +
        `*1. Aceptar:* ${acceptUrl}\n` +
        `*2. Rechazar:* ${rejectUrl}\n` +
        `3. Ir a la landing: ${landingUrl}`;

      // WhatsApp backend
      fetch("https://apiwhatsapp.geniality.com.co/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "genialitybussiness",

          phone: `57${assistantPhone.replace(/[^\d]/g, "")}`,
          message,
        }),
      }).catch(() => {});

      // Notificación en la app
      await addDoc(collection(db, "notifications"), {
        userId: assistantId,
        title: "Nueva solicitud de reunión",
        message: `${
          requester?.nombre || "Alguien"
        } te ha enviado una solicitud de reunión.`,
        timestamp: new Date(),
        read: false,
      });
      return Promise.resolve();
    } catch (e) {
      // console.error(e);
      return Promise.reject(e);
    }
  };

  const cancelMeeting = async (meeting) => {
    try {
      // 1. Cancela la reunión en Firestore
      await updateDoc(
        doc(db, "events", meeting.eventId, "meetings", meeting.id),
        { status: "cancelled" }
      );

      // 2. Libera el slot (si existe)
      if (meeting.slotId) {
        await updateDoc(doc(db, "agenda", meeting.slotId), {
          available: true,
          meetingId: null,
        });
      }

      // 3. Obtén datos de los participantes (si no los tienes)
      let requester = meeting.requester || null;
      let receiver = meeting.receiver || null;

      if (!requester || !receiver) {
        const reqSnap = await getDoc(doc(db, "users", meeting.requesterId));
        const recSnap = await getDoc(doc(db, "users", meeting.receiverId));
        requester = reqSnap.exists() ? reqSnap.data() : {};
        receiver = recSnap.exists() ? recSnap.data() : {};
      }

      // 4. Notifica a ambos por WhatsApp
      if (requester?.telefono) {
        console.log("Enviando requester");
        await sendMeetingCancelledWhatsapp(requester.telefono, receiver, {
          timeSlot: meeting.timeSlot,
          tableAssigned: meeting.tableAssigned,
        });
      }
      if (receiver?.telefono) {
        console.log("Enviando reciver");

        await sendMeetingCancelledWhatsapp(receiver.telefono, requester, {
          timeSlot: meeting.timeSlot,
          tableAssigned: meeting.tableAssigned,
        });
      }

      // 5. Notifica por la app
      await addDoc(collection(db, "notifications"), {
        userId: meeting.requesterId,
        title: "Reunión cancelada",
        message: "Tu reunión fue cancelada.",
        timestamp: new Date(),
        read: false,
      });
      await addDoc(collection(db, "notifications"), {
        userId: meeting.receiverId,
        title: "Reunión cancelada",
        message: "Tu reunión fue cancelada.",
        timestamp: new Date(),
        read: false,
      });

      return true; // <-- IMPORTANTE
    } catch (err) {
      console.error("Error en cancelMeeting:", err);
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
          where("status", "==", "accepted")
        );
        const accSn = await getDocs(accQ);
        const occupied = new Set(accSn.docs.map((d) => d.data().timeSlot));

        const limit = eventConfig.maxMeetingsPerUser ?? Infinity;
        const requesterCount = accSn.docs.filter((d) =>
          d.data().participants.includes(data.requesterId)
        ).length;
        const receiverCount = accSn.docs.filter((d) =>
          d.data().participants.includes(data.receiverId)
        ).length;

        if (requesterCount >= limit) {
          return alert(
            `El solicitante ya alcanzó el límite de ${limit} citas.`
          );
        }
        if (receiverCount >= limit) {
          return alert(`El receptor ya alcanzó el límite de ${limit} citas.`);
        }

        // Buscar slot disponible
        const agQ = query(
          collection(db, "agenda"),
          where("eventId", "==", eventId),
          where("available", "==", true),
          orderBy("startTime")
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
              eventConfig.breakBlocks
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
            "No hay slots libres fuera de descansos y horarios pasados."
          );
        }

        // 3. Actualizar reunión y agenda
        await updateDoc(mtgRef, {
          status: "accepted",
          tableAssigned: chosen.tableNumber.toString(),
          timeSlot: `${chosen.startTime} - ${chosen.endTime}`,
        });

        await updateDoc(doc(db, "agenda", chosenDoc.id), {
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
        if (requester && receiver) {
          await sendMeetingAcceptedWhatsapp(
            requester.telefono || "",
            receiver,
            {
              timeSlot: `${chosen.startTime} - ${chosen.endTime}`,
              tableAssigned: chosen.tableNumber,
            }
          );
          await sendMeetingAcceptedWhatsapp(
            receiver.telefono || "",
            requester,
            {
              timeSlot: `${chosen.startTime} - ${chosen.endTime}`,
              tableAssigned: chosen.tableNumber,
            }
          );
        }
      } else {
        // Rechazar reunión
        await updateDoc(mtgRef, { status: newStatus });
        await addDoc(collection(db, "notifications"), {
          userId: data.requesterId,
          title: "Reunión rechazada",
          message: "Tu reunión fue rechazada.",
          timestamp: new Date(),
          read: false,
        });
      }
    } catch (e) {
      // console.error(e);
    }
  };

  // Seleccionar slots disponibles para aceptar/reagendar reuniones
  const prepareSlotSelection = async (meetingId: string, isEdit = false) => {
    setPrepareSlotSelectionLoading(true);

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

    // Slots ocupados por cualquiera de los dos usuarios
    const accSn = await getDocs(
      query(
        collection(db, "events", eventId!, "meetings"),
        where("status", "==", "accepted"),
        where("participants", "array-contains-any", [requesterId, receiverId])
      )
    );
    const occupiedRanges = accSn.docs
      .map((d) => d.data().timeSlot)
      .filter(Boolean)
      .map((ts) => {
        const [s, e] = ts.split(" - ");
        const [sh, sm] = s.split(":").map(Number);
        const [eh, em] = e.split(":").map(Number);
        return { start: sh * 60 + sm, end: eh * 60 + em };
      });

    // Agenda de slots disponibles
    const agSn = await getDocs(
      query(
        collection(db, "agenda"),
        where("eventId", "==", eventId),
        where("available", "==", true),
        orderBy("startTime")
      )
    );
    const now = new Date();
    const filtered = agSn.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<AgendaSlot, "id">) }))
      .filter((slot) => {
        const [h, m] = slot.startTime.split(":").map(Number);
        const slotDate = new Date(now);
        slotDate.setHours(h, m, 0, 0);
        if (slotDate <= now) return false;
        if (
          slotOverlapsBreakBlock(
            slot.startTime,
            eventConfig.meetingDuration,
            eventConfig.breakBlocks
          )
        )
          return false;
        const slotStart = h * 60 + m;
        const slotEnd = slotStart + eventConfig.meetingDuration;
        if (occupiedRanges.some((r) => slotStart < r.end && slotEnd > r.start))
          return false;
        return true;
      });

    setAvailableSlots(filtered);
    setPrepareSlotSelectionLoading(false);
    setSlotModalOpened(true);
  };

  // Confirmar la selección de slot para la reunión
  const confirmAcceptWithSlot = async (meetingId: string, slot: any) => {
    setConfirmLoading(true);
    const isEdit = meetingToEdit === meetingId;

    try {
      const mtgRef = doc(db, "events", eventId!, "meetings", meetingId);

      // 1. Si es edición, libera el slot anterior (en agenda) de esta reunión
      if (isEdit) {
        const oldAgendaQ = query(
          collection(db, "agenda"),
          where("meetingId", "==", meetingId)
        );
        const oldAgendaSnap = await getDocs(oldAgendaQ);
        for (const oldSlot of oldAgendaSnap.docs) {
          await updateDoc(doc(db, "agenda", oldSlot.id), {
            available: true,
            meetingId: null,
          });
        }
      }

      if (!meetingId || !slot?.id) {
        alert("No se seleccionó correctamente el horario. Intenta de nuevo.");
        setConfirmLoading(false);
        return;
      }

      // 2. Actualiza la reunión con el nuevo horario y mesa
      const updatePayload: any = {
        timeSlot: `${slot.startTime} - ${slot.endTime}`,
        tableAssigned: slot.tableNumber.toString(),
      };
      if (!isEdit) {
        updatePayload.status = "accepted";
      }
      await updateDoc(mtgRef, updatePayload);

      // 3. Marca el nuevo slot como ocupado
      await updateDoc(doc(db, "agenda", slot.id), {
        available: false,
        meetingId,
      });

      // 4. Obtiene datos para notificaciones
      const mtgSnap = await getDoc(mtgRef);
      const data = mtgSnap.data() as Partial<Meeting>;
      if (!data?.requesterId || !data?.receiverId)
        throw new Error("Datos de la reunión incompletos");
      const { requesterId, receiverId } = data;

      const [reqSnap, recvSnap] = await Promise.all([
        getDoc(doc(db, "users", requesterId)),
        getDoc(doc(db, "users", receiverId)),
      ]);
      const requester = reqSnap.exists() ? (reqSnap.data() as Assistant) : null;
      const receiver = recvSnap.exists()
        ? (recvSnap.data() as Assistant)
        : null;

      // 5. Notificaciones en la app
      const notificationsBatch = isEdit
        ? [
            {
              userId: requesterId,
              title: "Reunión modificada",
              message: `Tu reunión con ${receiver?.nombre || ""} fue movida a ${
                slot.startTime
              } (Mesa ${slot.tableNumber}).`,
            },
            {
              userId: receiverId,
              title: "Reunión modificada",
              message: `Has cambiado la reunión con ${
                requester?.nombre || ""
              } a ${slot.startTime} (Mesa ${slot.tableNumber}).`,
            },
          ]
        : [
            {
              userId: requesterId,
              title: "Reunión aceptada",
              message: `Tu reunión con ${
                receiver?.nombre || ""
              } fue aceptada para ${slot.startTime} en Mesa ${
                slot.tableNumber
              }.`,
            },
            {
              userId: receiverId,
              title: "Reunión confirmada",
              message: `Has aceptado la reunión con ${
                requester?.nombre || ""
              } para ${slot.startTime} en Mesa ${slot.tableNumber}.`,
            },
          ];

      for (const notif of notificationsBatch) {
        await addDoc(collection(db, "notifications"), {
          ...notif,
          timestamp: new Date(),
          read: false,
        });
      }

      // 6. SMS
      const smsMsg = isEdit
        ? `Tu reunión fue movida a ${slot.startTime} en Mesa ${slot.tableNumber}.`
        : `Tu reunión fue aceptada para ${slot.startTime} en Mesa ${slot.tableNumber}.`;

      if (requester?.telefono) {
        await sendSms(smsMsg, requester.telefono);
      }
      if (receiver?.telefono) {
        await sendSms(smsMsg, receiver.telefono);
      }

      // 7. WhatsApp
      if (requester?.telefono) {
        await sendMeetingAcceptedWhatsapp(requester.telefono, receiver!, {
          timeSlot: slot.startTime,
          tableAssigned: slot.tableNumber,
        });
      }
      if (receiver?.telefono) {
        await sendMeetingAcceptedWhatsapp(receiver.telefono, requester!, {
          timeSlot: slot.startTime,
          tableAssigned: slot.tableNumber,
        });
      }

      // 8. Cierra los modales y limpia estado
      setSlotModalOpened(false);
      setConfirmModalOpened(false);
      setMeetingToEdit(null);
      setMeetingToAccept(null);
    } catch (e) {
      // Manejo de errores (puedes mostrar notificación)
      console.error(e);
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
        })
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
    new Set(assistants.map((a) => a.interesPrincipal).filter(Boolean))
  ).map((i) => ({
    value: i,
    label: i,
  }));

  // ---------------------- RETORNO ----------------------

  return {
    uid,
    currentUser,
    assistants,
    filteredAssistants,
    acceptedMeetings,
    loadingMeetings,
    pendingRequests,
    cancelSentMeeting,
    sentRequests,
    acceptedRequests,
    rejectedRequests,
    participantsInfo,
    notifications,
    solicitarReunionHabilitado,
    eventConfig,

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
    confirmAcceptWithSlot,
    cancelMeeting,

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
  };
}

import { useEffect, useContext, useState, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  doc,
  getDoc,
  updateDoc,
  addDoc,
  collection,
  runTransaction,
} from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { auth, db } from "../firebase/firebaseConfig";
import { UserContext } from "../context/UserContext";
import { getTableLabel, getCompanyAdvisors, computeAvailableSlots } from "./dashboard/meetingSlotEngine";
import { isVendedor, canDiscoverAttendee } from "../utils/attendeeRole";
import {
  Loader,
  Container,
  Paper,
  Text,
  Button,
  Stack,
  Select,
  Group,
  Card,
  Badge,
  Divider,
  Center,
  Box,
} from "@mantine/core";

const API_WP_URL = "https://apiwhatsapp.geniality.com.co/api/send";
const CLIENT_ID = "genialitybussinesstest";

// "2026-10-15" -> "jueves, 15 de octubre" (mismo formato que SlotModal/ConfirmModal)
const formatDay = (dateISO) => {
  if (!dateISO) return "";
  const [y, m, d] = String(dateISO).split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
};

const localTodayISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

// Las reglas exigen request.auth != null para escribir. En navegadores in-app
// (WhatsApp/Instagram) la sesión de Firebase Auth puede perderse aunque el
// localStorage conserve una sesión manual (UserContext no reintenta el login
// anónimo en ese caso), así que nos aseguramos de tener una antes de operar.
async function ensureFirebaseAuth() {
  if (auth.currentUser) return true;
  try {
    await signInAnonymously(auth);
    return true;
  } catch (e) {
    console.error("No se pudo iniciar sesión anónima:", e);
    return false;
  }
}

const readUser = (uid) =>
  uid
    ? getDoc(doc(db, "users", uid)).then((s) => (s.exists() ? s.data() : null))
    : Promise.resolve(null);

// Mesa fija y agenda compartida de la empresa del receptor (igual que
// resolveFixedTableForReceiver / resolveReceiverGroupIds del dashboard)
async function resolveSlotContext(eventId, eventConfig, requesterId, receiverId, receiverData) {
  const receiverCompanyId = receiverData?.companyId || null;
  let receiverFixedTable = null;
  let receiverGroupIds = [receiverId];
  if (receiverCompanyId) {
    const companySnap = await getDoc(doc(db, "events", eventId, "companies", receiverCompanyId));
    const company = companySnap.exists() ? companySnap.data() : null;
    receiverFixedTable = company?.fixedTable ? String(company.fixedTable) : null;
    if (company?.sharedAgenda) {
      const teammates = (await getCompanyAdvisors(eventId, receiverCompanyId))
        .filter((a) => isVendedor(a.tipoAsistente))
        .map((a) => a.id);
      if (teammates.includes(receiverId)) receiverGroupIds = teammates;
    }
  }
  return { eventConfig, requesterId, receiverId, receiverFixedTable, receiverGroupIds };
}

// Horarios libres de un día, con la misma lógica del dashboard
// (computeAvailableSlots): reuniones aceptadas de ESE día, descansos del día
// (dailyConfig), slots bloqueados, horas pasadas, mesa fija y agenda compartida.
async function computeDaySlots(eventId, ctx, dateISO) {
  const { slots } = await computeAvailableSlots({
    eventId,
    eventConfig: ctx.eventConfig,
    policies: ctx.eventConfig.policies || {},
    requesterId: ctx.requesterId,
    receiverId: ctx.receiverId,
    selectedDate: dateISO,
    receiverFixedTable: ctx.receiverFixedTable,
    receiverGroupIds: ctx.receiverGroupIds,
  });
  // Los slots de standby (último recurso del dashboard) no están "available" y la
  // transacción de aceptación de esta página los rechazaría.
  return slots
    .filter((s) => !s.isStandbySlot)
    .sort(
      (a, b) =>
        String(a.startTime).localeCompare(String(b.startTime)) ||
        Number(a.tableNumber) - Number(b.tableNumber)
    );
}

// Días a ofrecer y primer día con horarios. Cada día descarga todos los slots libres
// de todas las mesas, así que se calcula solo el día inicial (hoy o el primero) y,
// únicamente si está lleno, el resto. `cache` guarda la promesa de cada día calculado.
async function loadInitialDays(eventId, ctx) {
  const eventConfig = ctx.eventConfig;
  const todayISO = localTodayISO();
  const allDays = [
    ...new Set(eventConfig.eventDates || (eventConfig.eventDate ? [eventConfig.eventDate] : [])),
  ]
    .filter(Boolean)
    .sort();
  const upcoming = allDays.filter((d) => d >= todayISO);
  const days = upcoming.length ? upcoming : allDays;
  const cache = new Map();
  const dayPromise = (d) => {
    if (!cache.has(d)) cache.set(d, computeDaySlots(eventId, ctx, d));
    return cache.get(d);
  };

  const startDay = days.includes(todayISO) ? todayISO : days[0];
  if (!startDay) return { ctx, days, firstDay: null, slots: [], cache };
  const startSlots = await dayPromise(startDay);
  if (startSlots.length) return { ctx, days, firstDay: startDay, slots: startSlots, cache };

  const rest = days.filter((d) => d > startDay);
  const perDay = await Promise.all(rest.map(dayPromise));
  const idx = perDay.findIndex((sl) => sl.length > 0);
  return idx >= 0
    ? { ctx, days, firstDay: rest[idx], slots: perDay[idx], cache }
    : { ctx, days, firstDay: startDay, slots: [], cache };
}

// Lecturas que arrancan apenas se abre el enlace, sin esperar a que UserContext
// resuelva la sesión (son colecciones de lectura pública): reunión, evento,
// solicitante, quien recibe el enlace y, al aceptar, los horarios del primer día.
// La validación y la carga de horarios consumen estas promesas en vez de releer.
function startPrefetch(eventId, meetingId, advisorId, action) {
  const meetingP = getDoc(doc(db, "events", eventId, "meetings", meetingId)).then((s) =>
    s.exists() ? s.data() : null
  );
  const eventP = getDoc(doc(db, "events", eventId)).then((s) => (s.exists() ? s.data() : null));
  const requesterP = meetingP.then((m) => readUser(m?.requesterId));
  // Destinatario del enlace: el receptor, o en solicitudes a empresa el asesor del link
  const actingP = meetingP.then((m) => {
    const uid = m?.receiverId || (m?.companyId ? advisorId : null) || null;
    return uid ? readUser(uid).then((data) => ({ uid, data })) : null;
  });

  let slotsP = Promise.resolve(null);
  if (action === "accept") {
    slotsP = Promise.all([meetingP, eventP, actingP])
      .then(async ([m, ev, acting]) => {
        if (!m || m.status !== "pending" || !ev || !acting?.data) return null;
        // Asesor del link que no es de la empresa: la validación lo rechazará
        if (!m.receiverId && acting.data.companyId !== m.companyId) return null;
        const ctx = await resolveSlotContext(
          eventId, ev.config || {}, m.requesterId, acting.uid, acting.data
        );
        return loadInitialDays(eventId, ctx);
      })
      .catch((e) => {
        console.warn("Precarga de horarios falló; se recalcula tras validar:", e);
        return null;
      });
  }

  // Si la validación termina antes de consumirlas, que no queden rechazos sin manejar
  [meetingP, eventP, requesterP, actingP].forEach((p) => p.catch(() => {}));
  return { meetingP, eventP, requesterP, actingP, slotsP };
}

export default function MeetingAutoResponse() {
  // advisorId (opcional): en solicitudes a una empresa el enlace de WhatsApp lleva el ID del
  // asesor al que se envió, para poder iniciar su sesión sin pedirle ingresar de nuevo.
  const { eventId, meetingId, action, advisorId } = useParams();
  const navigate = useNavigate();
  const { currentUser, userLoading, loginAsUser } = useContext(UserContext);
  // uid de quien actúa sobre la reunión, resuelto en la validación. loginAsUser actualiza el
  // estado de forma asíncrona, así que el closure del efecto que carga los slots seguiría
  // viendo la sesión anterior (anónima) si leyera currentUser.
  const actingUidRef = useRef(null);
  // Datos ya leídos en la validación (reunión, evento, solicitante y quien actúa), para
  // no repetir esas lecturas al cargar horarios ni al confirmar: en el navegador de
  // WhatsApp cada ida y vuelta a Firestore cuesta cientos de ms.
  const loadedRef = useRef({ meeting: null, eventData: null, requesterData: null, actingData: null });
  // Lecturas iniciales, lanzadas en el primer render (ver startPrefetch)
  const prefetchRef = useRef(null);
  if (!prefetchRef.current) {
    prefetchRef.current = startPrefetch(eventId, meetingId, advisorId, action);
  }
  // Promesa de horarios por día ya pedidos (cambiar de día no vuelve a consultar)
  const dayCacheRef = useRef(new Map());

  const [status, setStatus] = useState(
    action === "accept" ? "Cargando horarios..." : "Procesando..."
  );
  const [availableSlots, setAvailableSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(action === "accept");
  // Días del evento (multi-día) y día cuyos horarios se muestran
  const [eventDays, setEventDays] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [loadingDay, setLoadingDay] = useState(false);
  // Datos para recalcular los slots al cambiar de día sin volver a leer todo
  const slotCtxRef = useRef(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  //  Añadidos para selects y confirmación
  const [selectedRange, setSelectedRange] = useState(null);
  const [selectedSlotId, setSelectedSlotId] = useState(null);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const [requesterName, setRequesterName] = useState("");
  
  // Estados para validación
  const [isValidating, setIsValidating] = useState(true);
  const [validationError, setValidationError] = useState(null);
  
  // Estados para rechazo
  const [showRejectConfirmation, setShowRejectConfirmation] = useState(false);
  const [rejectLoading, setRejectLoading] = useState(false);

  // 1) Agrupo slots por rango
  const groupedSlots = useMemo(() => {
    const map = {};
    for (const slot of availableSlots) {
      const rangeKey = `${slot.startTime} – ${slot.endTime}`;
      if (!map[rangeKey]) {
        map[rangeKey] = {
          startTime: slot.startTime,
          endTime: slot.endTime,
          slots: [],
        };
      }
      map[rangeKey].slots.push(slot);
    }
    return Object.entries(map).map(([rangeKey, grp]) => ({
      id: rangeKey,
      ...grp,
    }));
  }, [availableSlots]);

  // 2) Preselección al cargar los slots
  useEffect(() => {
    if (groupedSlots.length > 0) {
      const first = groupedSlots[0];
      setSelectedRange(first.id);
      setSelectedSlotId(first.slots[0]?.id || null);
    } else {
      setSelectedRange(null);
      setSelectedSlotId(null);
    }
  }, [groupedSlots]);

  // --------------------------------------------------------
  // Función de validación de sesión y propiedad de reunión
  // --------------------------------------------------------
  async function validateUserAndMeeting() {
    try {
      setIsValidating(true);

      await ensureFirebaseAuth();

      // 1. Validar que el usuario tiene sesión activa
      if (!currentUser?.uid && !auth.currentUser?.uid) {
        setValidationError(
          "No tienes una sesión activa. Por favor inicia sesión para continuar."
        );
        setTimeout(() => navigate(`/event/${eventId}`), 3000);
        return false;
      }

      const userId = currentUser?.uid || auth.currentUser?.uid;

      // 2. Datos de la reunión y el evento (precargados al abrir la página)
      const prefetch = prefetchRef.current;
      const [meetingData, eventData] = await Promise.all([prefetch.meetingP, prefetch.eventP]);
      loadedRef.current.eventData = eventData;

      if (!meetingData) {
        setValidationError("La reunión no existe.");
        setTimeout(() => navigate(`/event/${eventId}`), 3000);
        return false;
      }

      loadedRef.current.meeting = meetingData;
      const { receiverId, companyId, status: meetingStatus } = meetingData;

      // 3. Validar que la reunión no ha sido procesada aún
      if (meetingStatus && meetingStatus !== "pending") {
        setValidationError(
          `Esta reunión ya fue ${
            meetingStatus === "accepted"
              ? "aceptada"
              : meetingStatus === "rejected"
              ? "rechazada"
              : "procesada"
          }.`
        );
        setTimeout(() => navigate(`/event/${eventId}`), 3000);
        return false;
      }

      // Solicitante (precargado en paralelo)
      const requesterPromise = prefetch.requesterP;

      // 4. El destinatario del enlace es siempre receiverId (a su WhatsApp
      // llegó la solicitud). Si la sesión activa no es ya la suya (p.ej.
      // quedó anónima al abrir el link), la reemplazamos por su sesión real
      // para que el redirect final al dashboard lo reconozca ya logueado.
      actingUidRef.current = receiverId || userId;
      if (receiverId && currentUser?.uid !== receiverId) {
        const receiverData = (await prefetch.actingP)?.data;
        if (receiverData) {
          loadedRef.current.actingData = receiverData;
          loginAsUser(receiverId, receiverData);
        }
      } else if (receiverId) {
        loadedRef.current.actingData = currentUser?.data || null;
      } else if (!receiverId && companyId) {
        // Solicitud dirigida a una empresa (sin reclamar): no hay un destinatario
        // fijo. Si el enlace trae el ID del asesor al que se envió, se inicia su sesión
        // (siempre que pertenezca a esa empresa y evento); si no, se valida que la
        // sesión activa sea la de un asesor de esa empresa.
        let claimerId = userId;
        let myData = null;
        if (advisorId && advisorId !== userId) {
          // actingP ya leyó al asesor del enlace (receiverId vacío + companyId)
          const acting = await prefetch.actingP;
          const advData = acting?.uid === advisorId ? acting.data : await readUser(advisorId);
          if (advData && advData.companyId === companyId && advData.eventId === eventId) {
            claimerId = advisorId;
            myData = advData;
            loginAsUser(advisorId, advData);
          }
        }
        if (!myData) myData = await readUser(claimerId);
        actingUidRef.current = claimerId;
        loadedRef.current.actingData = myData;
        const myCompanyNit = myData?.companyId;
        // Cualquier persona asociada a la empresa puede reclamarla, sin importar
        // su tipoAsistente (ver getCompanyAdvisors en meetingSlotEngine.ts).
        const isAdvisorOfCompany = !!myCompanyNit && myCompanyNit === companyId;
        if (!isAdvisorOfCompany) {
          setValidationError(
            "Esta solicitud es para un asesor de la empresa. Inicia sesión con tu cuenta de asesor en el dashboard y vuelve a intentarlo."
          );
          setTimeout(() => navigate(`/event/${eventId}`), 3000);
          return false;
        }

        // Rol: solo puede reclamarla un asesor con el que el solicitante pueda
        // reunirse (misma regla del directorio, policies.discoveryMode)
        if (action === "accept") {
          const reqData = await requesterPromise;
          const mode = eventData?.config?.policies?.discoveryMode;
          if (!canDiscoverAttendee(mode, myData?.tipoAsistente, reqData?.tipoAsistente || "")) {
            setValidationError(
              "Tu perfil no puede atender esta solicitud; debe aceptarla un compañero de tu empresa con el rol correspondiente."
            );
            setTimeout(() => navigate(`/dashboard/${eventId}`), 4000);
            return false;
          }
        }
      }

      // 5. Nombre del solicitante
      const requesterData = await requesterPromise;
      loadedRef.current.requesterData = requesterData;
      if (requesterData) setRequesterName(requesterData.nombre);

      setValidationError(null);
      setIsValidating(false);
      return true;
    } catch (e) {
      console.error("Error en validación:", e);
      setValidationError("Error al validar. Por favor intenta de nuevo.");
      setTimeout(() => navigate(`/event/${eventId}`), 3000);
      return false;
    }
  }

  useEffect(() => {
    // Esperar a que UserContext resuelva la sesión (anónima o persistida) antes
    // de validar — si se valida antes de tiempo, auth.currentUser aún puede
    // estar en null y se rechaza una sesión que en realidad sí es válida.
    if (userLoading) return;
    // Validar sesión y propiedad antes de procesar
    validateUserAndMeeting().then((isValid) => {
      if (isValid) {
        if (action === "accept") {
          loadSlots();
        } else {
          // Para rechazo, mostrar confirmación en lugar de procesar automáticamente
          setShowRejectConfirmation(true);
          setStatus("");
        }
      }
    });
    // eslint-disable-next-line
  }, [userLoading]);

  // --------------------------------------------------------
  // Horarios: se usan los precargados (startPrefetch) si corresponden a quien
  // actúa; si no (sesión de otro asesor, precarga fallida), se calculan aquí.
  // --------------------------------------------------------
  async function loadSlots() {
    try {
      const loaded = loadedRef.current;
      if (!loaded.meeting) throw new Error("Reunión no existe");
      const { requesterId, receiverId } = loaded.meeting;
      // Solicitud de empresa sin reclamar: quien está viendo esta página (ya validado
      // como asesor de la empresa) es quien efectivamente ocuparía el slot.
      const effectiveReceiverId =
        receiverId || actingUidRef.current || currentUser?.uid || auth.currentUser?.uid;

      let result = await prefetchRef.current.slotsP;
      if (!result || result.ctx.receiverId !== effectiveReceiverId || result.ctx.requesterId !== requesterId) {
        // Quien actúa ya se leyó en la validación (salvo sesión restaurada sin datos)
        let receiverData = loaded.actingData;
        if (!receiverData) {
          receiverData = await readUser(effectiveReceiverId);
          loaded.actingData = receiverData;
        }
        const ctx = await resolveSlotContext(
          eventId, loaded.eventData?.config || {}, requesterId, effectiveReceiverId, receiverData
        );
        result = await loadInitialDays(eventId, ctx);
      }

      slotCtxRef.current = result.ctx;
      dayCacheRef.current = result.cache;
      setEventDays(result.days);
      setSelectedDate(result.firstDay || null);
      setAvailableSlots(result.slots);
      setStatus("");

      // Los demás días se piden en segundo plano, ya con la página visible, para que
      // cambiar de día sea inmediato. Si alguno falla, changeDay lo vuelve a pedir.
      for (const d of result.days) {
        if (result.cache.has(d)) continue;
        const p = computeDaySlots(eventId, result.ctx, d);
        p.catch(() => result.cache.delete(d));
        result.cache.set(d, p);
      }
    } catch (e) {
      console.error(e);
      setStatus(`Error cargando horarios (${e?.code || e?.message || "desconocido"}).`);
      setTimeout(() => navigate(`/event/${eventId}`), 10000);
    } finally {
      setLoadingSlots(false);
    }
  }

  async function changeDay(dateISO) {
    if (!dateISO || dateISO === selectedDate || !slotCtxRef.current) return;
    setSelectedDate(dateISO);
    setLoadingDay(true);
    try {
      const cache = dayCacheRef.current;
      let p = cache.get(dateISO);
      if (!p) {
        p = computeDaySlots(eventId, slotCtxRef.current, dateISO);
        cache.set(dateISO, p);
      }
      setAvailableSlots(await p);
    } catch (e) {
      console.error(e);
      dayCacheRef.current.delete(dateISO);
      setAvailableSlots([]);
    } finally {
      setLoadingDay(false);
    }
  }

  async function processReject() {
    try {
      setRejectLoading(true);
      await ensureFirebaseAuth();
      const mtgRef = doc(db, "events", eventId, "meetings", meetingId);
      await updateDoc(mtgRef, {
        status: "rejected",
      });

      const mtgData = (await getDoc(mtgRef)).data();

      // Obtener datos del solicitante y del receptor (quien rechaza). Para una
      // solicitud de empresa sin reclamar, receiverId puede ser null: se atribuye
      // el rechazo a la sesión activa (el asesor que abrió el enlace).
      const myUid = actingUidRef.current || currentUser?.uid || auth.currentUser?.uid;
      const requesterSnap = await getDoc(doc(db, "users", mtgData.requesterId));
      const receiverSnap = await getDoc(doc(db, "users", mtgData.receiverId || myUid));
      const requester = requesterSnap.exists() ? requesterSnap.data() : {};
      const receiver = receiverSnap.exists() ? receiverSnap.data() : {};

      // Obtener nombre del evento y políticas
      const eventSnap = await getDoc(doc(db, "events", eventId));
      const evName = eventSnap.exists() ? eventSnap.data().eventName || "" : "";
      const evPolicies = eventSnap.exists() ? eventSnap.data().config?.policies || {} : {};

      if (evPolicies.dashboardNotificationsEnabled !== false) {
        await addDoc(collection(db, "notifications"), {
          userId: mtgData.requesterId,
          title: "Reunión rechazada",
          message: `${receiver?.nombre || "Un participante"} ha rechazado tu solicitud de reunión.`,
          timestamp: new Date(),
          read: false,
          type: "meeting_rejected",
        });
      }

      // Enviar WhatsApp al solicitante informando del rechazo
      if (evPolicies.whatsappNotificationsEnabled !== false && requester?.telefono) {
        const phone = (requester.telefono || "").toString().replace(/[^\d]/g, "");
        const eventLine = evName ? `📌 *Evento:* ${evName}\n` : "";
        const message =
          `😔 *Solicitud de reunión rechazada*\n\n` +
          eventLine +
          `*${receiver?.nombre || "Un participante"}* ha rechazado tu solicitud de reunión.\n\n` +
          `👤 *Nombre:* ${receiver?.nombre || ""}\n` +
          `🏢 *Empresa:* ${receiver?.empresa || ""}\n\n` +
          `Puedes enviar solicitudes a otros participantes desde el dashboard del evento.`;

        fetch(API_WP_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: CLIENT_ID,
            phone: `57${phone}`,
            message,
          }),
        }).catch(() => {});
      }

      setStatus("Reunión rechazada.");
    } catch (e) {
      console.error(e);
      setStatus("Error al rechazar.");
    } finally {
      setRejectLoading(false);
      setTimeout(() => navigate(`/event/${eventId}`), 2000);
    }
  }

  // --------------------------------------------------------
  // Genera el lockId con el mismo formato que useDashboardData
  // --------------------------------------------------------
  function buildLockId(evId, userId, dateISO, start, end) {
    const d = String(dateISO || "").replace(/-/g, "");
    return `${evId}_${userId}_${d}_${start}-${end}`;
  }

  // --------------------------------------------------------
  // confirmWithSlot se dispara tras confirmar
  // --------------------------------------------------------
  async function confirmWithSlot(slot) {
    setConfirmLoading(true);
    let succeeded = false;
    try {
      await ensureFirebaseAuth();
      const mtgRef = doc(db, "events", eventId, "meetings", meetingId);
      const slotRef = doc(db, "events", eventId, "agenda", slot.id);

      // Evento ya leído en la validación (solo se relee si faltara)
      let eventDocData = loadedRef.current.eventData;
      if (!eventDocData) {
        const evSnap = await getDoc(doc(db, "events", eventId));
        eventDocData = evSnap.exists() ? evSnap.data() : null;
      }
      // Eventos multi-día no tienen eventDate: la fecha real es la del slot.
      const eventDateISO =
        String(slot.date || "").trim() ||
        String(eventDocData?.eventDate || "").trim() ||
        new Date().toISOString().slice(0, 10);

      let requesterId, receiverId, isCompanyClaim, meetingCompanyId;
      const myUid = actingUidRef.current || currentUser?.uid || auth.currentUser?.uid;

      // TRANSACCIÓN: valida, crea locks, actualiza meeting y ocupa slot
      await runTransaction(db, async (tx) => {
        // 1. Validar que la reunión sigue pendiente
        const mtgSnap = await tx.get(mtgRef);
        if (!mtgSnap.exists()) throw new Error("La reunión no existe.");
        const mtg = mtgSnap.data();

        if (mtg.status !== "pending") {
          throw new Error(
            `Esta reunión ya fue ${
              mtg.status === "accepted"
                ? "aceptada"
                : mtg.status === "rejected"
                ? "rechazada"
                : "procesada"
            }.`
          );
        }

        requesterId = mtg.requesterId;
        meetingCompanyId = mtg.companyId || null;
        // Solicitud de empresa sin reclamar: quien acepta (ya validado como asesor
        // de la empresa) se convierte en el receptor, seteado atómicamente aquí.
        isCompanyClaim = !mtg.receiverId && !!mtg.companyId;
        receiverId = mtg.receiverId || (isCompanyClaim ? myUid : undefined);
        if (!receiverId) throw new Error("No se pudo determinar el asesor que acepta.");

        // 2. Validar que el slot sigue disponible
        const sSnap = await tx.get(slotRef);
        if (!sSnap.exists()) throw new Error("El horario seleccionado no existe.");
        if (sSnap.data().available !== true)
          throw new Error("Este horario ya fue tomado por otra persona. Por favor recarga la página y elige otro.");

        // 3. Crear referencias de locks
        const reqLockRef = doc(
          db,
          "locks",
          buildLockId(eventId, requesterId, eventDateISO, slot.startTime, slot.endTime)
        );
        const recLockRef = doc(
          db,
          "locks",
          buildLockId(eventId, receiverId, eventDateISO, slot.startTime, slot.endTime)
        );

        // 4. Verificar que ninguno tiene ya una reunión en ese horario
        const [reqLockSnap, recLockSnap] = await Promise.all([
          tx.get(reqLockRef),
          tx.get(recLockRef),
        ]);

        if (reqLockSnap.exists())
          throw new Error("El solicitante ya tiene una reunión en ese horario.");
        if (recLockSnap.exists())
          throw new Error("Ya tienes una reunión confirmada en ese horario. Elige otro.");

        // 5. Escribir todo de forma atómica
        tx.set(reqLockRef, {
          eventId,
          userId: requesterId,
          meetingId,
          date: eventDateISO,
          start: slot.startTime,
          end: slot.endTime,
          createdAt: new Date(),
        });
        tx.set(recLockRef, {
          eventId,
          userId: receiverId,
          meetingId,
          date: eventDateISO,
          start: slot.startTime,
          end: slot.endTime,
          createdAt: new Date(),
        });
        tx.update(mtgRef, {
          status: "accepted",
          timeSlot: `${slot.startTime} - ${slot.endTime}`,
          meetingDate: eventDateISO,
          tableAssigned: slot.tableNumber.toString(),
          slotId: slot.id,
          lockIds: [reqLockRef.id, recLockRef.id],
          updatedAt: new Date(),
          ...(isCompanyClaim ? { receiverId, participants: [requesterId, receiverId] } : {}),
        });
        tx.update(slotRef, { available: false, meetingId });
      });

      // La reunión ya quedó aceptada: se le confirma al usuario de inmediato y las
      // notificaciones salen en paralelo (antes se esperaba cada envío de WhatsApp,
      // uno tras otro, antes de mostrar la confirmación).
      succeeded = true;
      setStatus("¡Reunión confirmada! Avisando al solicitante...");

      const mtgData = { requesterId, receiverId, companyId: meetingCompanyId };

      // Datos de ambos participantes: los de la validación, si corresponden a ellos
      const loaded = loadedRef.current;
      const [requester, receiver] = await Promise.all([
        loaded.requesterData && loaded.meeting?.requesterId === requesterId
          ? loaded.requesterData
          : getDoc(doc(db, "users", requesterId)).then((sn) => (sn.exists() ? sn.data() : {})),
        loaded.actingData && actingUidRef.current === receiverId
          ? loaded.actingData
          : getDoc(doc(db, "users", receiverId)).then((sn) => (sn.exists() ? sn.data() : {})),
      ]);

      const evName = eventDocData?.eventName || "";
      const eventConfig = eventDocData?.config || {};
      const evPolicies = eventConfig.policies || {};
      const tableLabel = getTableLabel(slot.tableNumber, eventConfig.tableNames);
      const dayLabel = formatDay(eventDateISO);

      const tasks = [];

      // Notificación in-app
      if (evPolicies.dashboardNotificationsEnabled !== false) {
        tasks.push(addDoc(collection(db, "notifications"), {
          userId: mtgData.requesterId,
          title: "Reunión aceptada",
          message: `${receiver?.nombre || "Un participante"} ha aceptado tu reunión para ${dayLabel ? `el ${dayLabel} a las ` : ""}${slot.startTime} en ${tableLabel}.`,
          timestamp: new Date(),
          read: false,
          type: "meeting_accepted",
        }));
      }

      // Enviar WhatsApp a ambos participantes
      const whatsappApiVersion = evPolicies.whatsappApiVersion || "v1";
      const accepterName = receiver?.nombre || "";
      const meetingInfo = {
        timeSlot: `${slot.startTime} - ${slot.endTime}`,
        tableAssigned: tableLabel,
      };
      // Mismo formato que sendMeetingAcceptedWhatsapp del dashboard: "jueves, 15 de octubre - 08:00 - 08:20"
      const scheduleWithDay = dayLabel ? `${dayLabel} - ${meetingInfo.timeSlot}` : meetingInfo.timeSlot;

      if (evPolicies.whatsappNotificationsEnabled !== false) {
        if (whatsappApiVersion === "v2") {
          // Usar API v2 con el endpoint de confirmación
          const { sendMeetingConfirmation } = await import("../utils/whatsappService");

          if (requester?.telefono) {
            tasks.push(sendMeetingConfirmation({
              phone: requester.telefono,
              eventName: evName,
              acceptedBy: accepterName,
              meetingWith: receiver?.nombre || "Participante",
              company: receiver?.empresa || "Empresa",
              schedule: scheduleWithDay,
              table: meetingInfo.tableAssigned,
              tracking: { eventId, userId: mtgData.requesterId, meetingId },
            }));
          }

          if (receiver?.telefono) {
            tasks.push(sendMeetingConfirmation({
              phone: receiver.telefono,
              eventName: evName,
              acceptedBy: accepterName,
              meetingWith: requester?.nombre || "Participante",
              company: requester?.empresa || "Empresa",
              schedule: scheduleWithDay,
              table: meetingInfo.tableAssigned,
              tracking: { eventId, userId: mtgData.receiverId, meetingId },
            }));
          }
        } else {
          // Usar API v1 (método anterior)
          const buildAcceptedMsg = (otherParticipant) => {
            const eventLine = evName ? `📌 *Evento:* ${evName}\n` : "";
            const acceptedLine = accepterName
              ? `✅ *${accepterName}* ha aceptado la reunión.\n\n`
              : "";
            return (
              `🤝 *¡Reunión confirmada!*\n\n` +
              eventLine +
              acceptedLine +
              `👤 *Con:* ${otherParticipant?.nombre || ""}\n` +
              `🏢 *Empresa:* ${otherParticipant?.empresa || ""}\n` +
              (dayLabel ? `📅 *Día:* ${dayLabel}\n` : "") +
              `🕐 *Horario:* ${meetingInfo.timeSlot}\n` +
              `🪑 *Mesa:* ${meetingInfo.tableAssigned}\n\n` +
              `¡Te esperamos!`
            );
          };

          if (requester?.telefono) {
            const phone = (requester.telefono || "").toString().replace(/[^\d]/g, "");
            fetch(API_WP_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clientId: CLIENT_ID,
                phone: `57${phone}`,
                message: buildAcceptedMsg(receiver),
              }),
            }).catch(() => {});
          }
          if (receiver?.telefono) {
            const phone = (receiver.telefono || "").toString().replace(/[^\d]/g, "");
            fetch(API_WP_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clientId: CLIENT_ID,
                phone: `57${phone}`,
                message: buildAcceptedMsg(requester),
              }),
            }).catch(() => {});
          }
        }
      }

      // Notificar también a los demás asesores de la empresa (Etapa 1/2: fan-out).
      // Usa getCompanyAdvisors (meetingSlotEngine.ts) en vez de una query directa por
      // tipoAsistente: Firestore no puede filtrar ese campo sin distinguir mayúsculas,
      // así que se consulta por empresa y se filtra/normaliza del lado del cliente.
      if (mtgData.companyId) {
        tasks.push((async () => {
          const advisors = await getCompanyAdvisors(eventId, mtgData.companyId);
          const otherAdvisors = advisors.filter(
            (a) => a.id !== mtgData.requesterId && a.id !== mtgData.receiverId
          );
          const writes = [];
          for (const advisor of otherAdvisors) {
            if (evPolicies.dashboardNotificationsEnabled !== false) {
              writes.push(addDoc(collection(db, "notifications"), {
                userId: advisor.id,
                title: "Reunión aceptada",
                message: `${receiver?.nombre || "Un compañero"} aceptó una reunión de tu empresa.`,
                timestamp: new Date(),
                read: false,
                type: "meeting_accepted",
              }));
            }
            if (evPolicies.whatsappNotificationsEnabled !== false && advisor?.telefono) {
              const advisorPhone = (advisor.telefono || "").toString().replace(/[^\d]/g, "");
              fetch(API_WP_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  clientId: CLIENT_ID,
                  phone: `57${advisorPhone}`,
                  message: `Un compañero de tu empresa (${receiver?.nombre || ""}) aceptó una reunión (${scheduleWithDay}, ${tableLabel}).`,
                }),
              }).catch(() => {});
            }
          }
          await Promise.all(writes);
        })());
      }

      // Se espera a que salgan (sin bloquear la confirmación ya mostrada) para que el
      // redirect al dashboard no corte envíos en curso. Un fallo aquí no revierte nada.
      const results = await Promise.allSettled(tasks);
      results
        .filter((r) => r.status === "rejected")
        .forEach((r) => console.error("Notificación de aceptación falló:", r.reason));
      setStatus("Reunión confirmada.");
    } catch (e) {
      console.error(e);
      // La reunión ya quedó aceptada; lo que falló fue algo posterior (avisos)
      const msg = e?.message || "";
      if (succeeded) {
        setStatus("Reunión confirmada.");
      } else if (
        msg.includes("ya fue") ||
        msg.includes("ya tienes") ||
        msg.includes("ya fue tomado") ||
        msg.includes("solicitante ya tiene")
      ) {
        setStatus(msg);
      } else {
        setStatus(
          `Error al confirmar (${e?.code || msg || "desconocido"}). Por favor intenta de nuevo.`
        );
      }
    } finally {
      setConfirmLoading(false);
      // En éxito se va rápido al dashboard; si falló, damos tiempo de leer el motivo.
      setTimeout(
        () => {
          const dest =
            currentUser?.data || auth.currentUser
              ? `/dashboard/${eventId}`
              : `/event/${eventId}`;
          navigate(dest);
        },
        succeeded ? 1500 : 8000
      );
    }
  }

  // --------------------------------------------------------
  // Construyo opciones para los selects
  // --------------------------------------------------------
  const rangeOptions = groupedSlots.map((g) => ({
    value: g.id,
    label: `${g.startTime} – ${g.endTime}`,
  }));
  const tableOptions = selectedRange
    ? (groupedSlots.find((g) => g.id === selectedRange)?.slots || []).map(
        (s) => ({
          value: s.id,
          label: getTableLabel(s.tableNumber, slotCtxRef.current?.eventConfig?.tableNames),
        })
      )
    : [];

  // slot elegido completo
  const chosenSlot =
    groupedSlots
      .find((g) => g.id === selectedRange)
      ?.slots.find((s) => s.id === selectedSlotId) || null;

  // -------------------------------------------------------------------
  // Renderizado
  // -------------------------------------------------------------------
  return (
    <Container size="sm" py="xl">
      <Paper radius="lg" shadow="md" p={0} style={{ overflow: "hidden" }}>
        {validationError ? (
          <Box p="xl" style={{ backgroundColor: "#ffe0e0" }}>
            <Center mb="lg">
              <Text size="xl" weight={700} color="red">
                ⚠️ Error de validación
              </Text>
            </Center>
            <Text align="center" mb="md" size="sm">
              {validationError}
            </Text>
            <Text align="center" size="xs" color="dimmed">
              Serás redirigido en breve...
            </Text>
          </Box>
        ) : showRejectConfirmation && !isValidating ? (
          <Stack spacing={0}>
            <Box p="xl" style={{ backgroundColor: "#fff5f5", borderBottom: "1px solid #ffe0e0" }}>
              <Text size="lg" weight={700} align="center" mb="xs">
                ¿Deseas rechazar esta reunión?
              </Text>
              <Divider my="md" />
              <Card shadow="none" p="md" style={{ backgroundColor: "white", border: "1px solid #e9ecef" }}>
                <Group spacing="sm">
                  <Box style={{ flex: 1 }}>
                    <Text size="sm" color="dimmed" weight={500}>
                      Solicitud de:
                    </Text>
                    <Text size="md" weight={700} mt={4}>
                      {requesterName}
                    </Text>
                  </Box>
                  <Badge color="orange" variant="dot" size="lg">
                    Pendiente
                  </Badge>
                </Group>
              </Card>
            </Box>
            <Group p="lg" position="right" spacing="md">
              <Button
                variant="light"
                size="md"
                onClick={() => {
                  setShowRejectConfirmation(false);
                  navigate(`/event/${eventId}`);
                }}
                disabled={rejectLoading}
              >
                Cancelar
              </Button>
              <Button
                color="red"
                size="md"
                loading={rejectLoading}
                onClick={processReject}
              >
                Rechazar reunión
              </Button>
            </Group>
          </Stack>
        ) : isValidating || loadingSlots || status ? (
          <Box p="xl">
            <Center mb="lg">
              <Loader />
            </Center>
            <Text align="center" size="sm" color="dimmed">
              {status || "Validando acceso..."}
            </Text>
          </Box>
        ) : (availableSlots.length > 0 || eventDays.length > 1) && !showConfirmation ? (
          <Stack spacing={0}>
            <Box p="xl" style={{ backgroundColor: "#f8f9fa", borderBottom: "1px solid #e9ecef" }}>
              <Text size="lg" weight={700} align="center">
                Selecciona un horario disponible
              </Text>
              <Text size="sm" color="dimmed" align="center" mt={4}>
                Reunión con <b>{requesterName}</b>
              </Text>
            </Box>
            <Stack p="xl" spacing="lg">
              {/* Fuera del estado vacío: si el día no tiene horarios, se puede pasar a otro */}
              {eventDays.length > 1 && (
                <Select
                  label="Día"
                  data={eventDays.map((d) => ({ value: d, label: formatDay(d) }))}
                  value={selectedDate}
                  onChange={changeDay}
                  disabled={confirmLoading || loadingDay}
                  allowDeselect={false}
                />
              )}
              {loadingDay ? (
                <Center py="md">
                  <Loader size="sm" />
                </Center>
              ) : availableSlots.length === 0 ? (
                <Text align="center" color="dimmed" size="sm">
                  No hay horarios disponibles este día. Prueba con otro día.
                </Text>
              ) : (
              <>
              <Select
                label="Horario"
                placeholder="Selecciona un horario"
                data={rangeOptions}
                value={selectedRange}
                onChange={(v) => {
                  setSelectedRange(v);
                  const first = groupedSlots.find((g) => g.id === v)?.slots[0];
                  setSelectedSlotId(first?.id || null);
                }}
                disabled={confirmLoading}
                required
                searchable
                clearable={false}
              />
              <Select
                label="Mesa"
                placeholder="Selecciona una mesa"
                data={tableOptions}
                value={selectedSlotId}
                onChange={setSelectedSlotId}
                disabled={!selectedRange || confirmLoading}
                required
                searchable
                clearable={false}
              />
              <Button
                fullWidth
                size="lg"
                loading={confirmLoading}
                onClick={() => setShowConfirmation(true)}
                disabled={!chosenSlot}
                mt="md"
              >
                Confirmar datos
              </Button>
              </>
              )}
            </Stack>
          </Stack>
        ) : showConfirmation ? (
          <Stack spacing={0}>
            <Box p="xl" style={{ backgroundColor: "#e7f5ff", borderBottom: "1px solid #a5d8ff" }}>
              <Text size="lg" weight={700} align="center" mb="xs">
                ✓ Confirmación de reunión
              </Text>
            </Box>
            <Stack p="xl" spacing="lg">
              <Card shadow="none" p="md" style={{ backgroundColor: "#f0f9ff", border: "1px solid #bae6fd" }}>
                <Stack spacing="sm">
                  <Group position="apart">
                    <Text size="sm" color="dimmed" weight={500}>
                      Con:
                    </Text>
                    <Text weight={700}>{requesterName}</Text>
                  </Group>
                  <Divider />
                  {chosenSlot?.date && (
                    <>
                      <Group position="apart">
                        <Text size="sm" color="dimmed" weight={500}>
                          Día:
                        </Text>
                        <Text weight={700}>
                          {formatDay(chosenSlot.date)}
                        </Text>
                      </Group>
                      <Divider />
                    </>
                  )}
                  <Group position="apart">
                    <Text size="sm" color="dimmed" weight={500}>
                      Horario:
                    </Text>
                    <Badge size="lg">
                      {chosenSlot?.startTime} – {chosenSlot?.endTime}
                    </Badge>
                  </Group>
                  <Divider />
                  <Group position="apart">
                    <Text size="sm" color="dimmed" weight={500}>
                      Mesa:
                    </Text>
                    <Badge color="blue" size="lg">
                      {getTableLabel(chosenSlot?.tableNumber, slotCtxRef.current?.eventConfig?.tableNames)}
                    </Badge>
                  </Group>
                </Stack>
              </Card>
              <Text size="sm" color="dimmed" align="center" style={{ fontStyle: "italic" }}>
                Por favor verifica los datos antes de confirmar
              </Text>
            </Stack>
            <Group p="lg" position="right" spacing="md">
              <Button
                variant="light"
                size="md"
                onClick={() => setShowConfirmation(false)}
              >
                Volver
              </Button>
              <Button
                color="green"
                size="md"
                loading={confirmLoading}
                onClick={() => confirmWithSlot(chosenSlot)}
              >
                Confirmar reunión
              </Button>
            </Group>
          </Stack>
        ) : (
          <Box p="xl">
            <Center>
              <Text size="md" color="dimmed" weight={500}>
                No hay horarios disponibles en este momento
              </Text>
            </Center>
          </Box>
        )}
      </Paper>
    </Container>
  );
}

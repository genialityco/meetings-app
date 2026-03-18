/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect } from "react";
import {
  Container,
  Title,
  Button,
  Card,
  Text,
  Group,
  Loader,
  Center,
  Image,
  Alert,
  Stack,
  Badge,
  Tabs,
  SimpleGrid,
  Modal,
  Table,
  ScrollArea,
  SegmentedControl,
} from "@mantine/core";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { sendWhatsAppMessage, sendMeetingConfirmation } from "../../utils/whatsappService";
import EditEventConfigModal from "./EditEventConfigModal";
import ManualMeetingModal from "./ManualMeetingModal";
import MeetingsListModal from "./MeetingsListModal";
import AttendeesList from "./AttendeesList";
import { useParams, Link } from "react-router-dom";
import * as XLSX from "xlsx";
import ConfigureFieldsModal from "./ConfigureFieldsModal";
import EventPoliciesModal from "./EventPoliciesModal";
import ConfigureSurveyModal from "./ConfigureSurveyModal";

const EventAdmin = () => {
  const { eventId } = useParams();
  const [event, setEvent] = useState(null);
  const [globalMessage, setGlobalMessage] = useState("");
  const [editConfigModalOpened, setEditConfigModalOpened] = useState(false);
  const [manualMeetingModalOpened, setManualMeetingModalOpened] =
    useState(false);
  const [meetingsModalOpened, setMeetingsModalOpened] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [attendees, setAttendees] = useState([]);
  const [, setAttendeesLoading] = useState(false);
  const [configureFieldsModalOpened, setConfigureFieldsModalOpened] =
    useState(false);
  const [policiesModalOpened, setPoliciesModalOpened] = useState(false);
  const [configureSurveyModalOpened, setConfigureSurveyModalOpened] = useState(false);

  // Estado para reuniones huérfanas
  const [orphanedMeetingsModalOpened, setOrphanedMeetingsModalOpened] = useState(false);
  const [orphanedMeetings, setOrphanedMeetings] = useState([]);
  const [checkingOrphans, setCheckingOrphans] = useState(false);

  // Estado para importar reuniones desde JSON
  const [importMeetingsModalOpened, setImportMeetingsModalOpened] = useState(false);
  const [importMeetingsJson, setImportMeetingsJson] = useState("");
  const [importMeetingsPreview, setImportMeetingsPreview] = useState([]);
  const [importMeetingsError, setImportMeetingsError] = useState("");
  const [importingMeetings, setImportingMeetings] = useState(false);
  const [importMeetingsResult, setImportMeetingsResult] = useState(null);
  const [deletingOrphan, setDeletingOrphan] = useState(null);
  const [notifyingMeetings, setNotifyingMeetings] = useState(false);
  const [notifyModalOpened, setNotifyModalOpened] = useState(false);
  const [notifyTarget, setNotifyTarget] = useState("ambos"); // "compradores" | "vendedores" | "ambos"
  const [notifyLog, setNotifyLog] = useState([]); // { nombre, empresa, tipo, status: "ok"|"fail"|"skip", meetingId }
  const [notifyRunning, setNotifyRunning] = useState(false);
  const [notifyDone, setNotifyDone] = useState(false);

  const [meetingsCounts, setMeetingsCounts] = useState({
    aceptadas: 0,
    pendientes: 0,
    rechazadas: 0,
  });
  const [meetingsCountLoading, setMeetingsCountLoading] = useState(false);

  useEffect(() => {
    fetchEvent();
  }, [eventId]);

  const fetchEvent = async () => {
    try {
      const eventSnap = await getDoc(doc(db, "events", eventId));
      if (eventSnap.exists()) {
        setEvent({ id: eventSnap.id, ...eventSnap.data() });
      }
    } catch (error) {
      console.log(error);
      setGlobalMessage("Error al obtener el evento.");
    }
  };

  // Cargar asistentes del evento
  useEffect(() => {
    if (!eventId) return;
    fetchMeetingsCounts();

    const fetchAttendees = async () => {
      setAttendeesLoading(true);
      try {
        const q = query(
          collection(db, "users"),
          where("eventId", "==", eventId),
        );
        const snap = await getDocs(q);
        setAttendees(
          snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          })),
        );
      } catch (e) {
        console.log(e);
        setGlobalMessage("Error al obtener asistentes.");
      }
      setAttendeesLoading(false);
    };
    fetchAttendees();
  }, [eventId]);

  // Funciones auxiliares para agenda
  const timeToMinutes = (timeStr) => {
    const [hours, minutes] = timeStr.split(":").map(Number);
    return hours * 60 + minutes;
  };

  const minutesToTime = (minutes) => {
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hrs.toString().padStart(2, "0")}:${mins
      .toString()
      .padStart(2, "0")}`;
  };

  const isWithinBreakBlock = (slotStart, slotEnd, breakBlocks) => {
    if (!Array.isArray(breakBlocks)) return false;
    return breakBlocks.some((block) => {
      if (!block.start || !block.end) return false;
      const blockStart = timeToMinutes(block.start);
      const blockEnd = timeToMinutes(block.end);
      return (
        (slotStart >= blockStart && slotStart < blockEnd) ||
        (slotEnd > blockStart && slotEnd <= blockEnd) ||
        (slotStart <= blockStart && slotEnd >= blockEnd)
      );
    });
  };

  // Generar la agenda para un evento (se asigna eventId a cada slot)
  const generateAgendaForEvent = async () => {
    try {
      setActionLoading(true);
      const {
        meetingDuration,
        breakTime,
        numTables,
        dailyConfig,
        eventDates,
        eventDate,
        // Fallback para eventos antiguos
        startTime: globalStartTime,
        endTime: globalEndTime,
        breakBlocks: globalBreakBlocks = [],
      } = event.config;

      let createdCount = 0;

      // Determinar los días a procesar
      const daysToProcess = dailyConfig 
        ? Object.entries(dailyConfig)
        : eventDates?.length
          ? eventDates.map(date => [date, { startTime: globalStartTime, endTime: globalEndTime, breakBlocks: globalBreakBlocks }])
          : [[eventDate, { startTime: globalStartTime, endTime: globalEndTime, breakBlocks: globalBreakBlocks }]];

      // Generar slots para cada día
      for (const [date, dayConfig] of daysToProcess) {
        const { startTime, endTime, breakBlocks = [] } = dayConfig;

        const blockLength = meetingDuration + breakTime;

        // Dividir el día en segmentos separados por los breaks
        // Ej: 8:30-10:30, 11:00-13:00 (si hay break 10:30-11:00)
        const sortedBreaks = [...breakBlocks]
          .filter((b) => b.start && b.end)
          .map((b) => ({ start: timeToMinutes(b.start), end: timeToMinutes(b.end) }))
          .sort((a, b) => a.start - b.start);

        // Construir lista de segmentos [segStart, segEnd]
        const segments = [];
        let segStart = timeToMinutes(startTime);
        const dayEnd = timeToMinutes(endTime);
        for (const br of sortedBreaks) {
          if (br.start > segStart) segments.push([segStart, br.start]);
          segStart = br.end;
        }
        if (segStart < dayEnd) segments.push([segStart, dayEnd]);

        // Generar slots dentro de cada segmento
        for (const [segBegin, segEnd] of segments) {
          const totalSlots = Math.floor((segEnd - segBegin) / blockLength);
          for (let slot = 0; slot < totalSlots; slot++) {
            const slotStart = segBegin + slot * blockLength;
            const slotEnd = slotStart + meetingDuration;
            const slotStartTime = minutesToTime(slotStart);
            const slotEndTime = minutesToTime(slotEnd);

            for (let tableNumber = 1; tableNumber <= numTables; tableNumber++) {
              await addDoc(collection(db, "events", event.id, "agenda"), {
                date,
                tableNumber,
                startTime: slotStartTime,
                endTime: slotEndTime,
                available: true,
              });
              createdCount++;
            }
          }
        }
      }

      setGlobalMessage(
        `Agenda generada: ${createdCount} slots creados para el evento ${event.eventName}.`,
      );
    } catch (error) {
      console.log(error);
      setGlobalMessage("Error al generar la agenda.");
    } finally {
      setActionLoading(false);
    }
  };

  // Restablecer la agenda para un evento (marcar slots existentes como disponibles)
  const resetAgendaForEvent = async () => {
    try {
      setActionLoading(true);
      const agendaSnapshot = await getDocs(
        collection(db, "events", event.id, "agenda"),
      );
      agendaSnapshot.forEach(async (docItem) => {
        await updateDoc(doc(db, "events", event.id, "agenda", docItem.id), {
          available: true,
          meetingId: null,
        });
      });
      setGlobalMessage(
        `Agenda restablecida para el evento ${event.eventName}.`,
      );
    } catch (error) {
      console.log(error);

      setGlobalMessage("Error al restablecer la agenda.");
    } finally {
      setActionLoading(false);
    }
  };

  // Borrar completamente la agenda para un evento
  const deleteAgendaForEvent = async () => {
    try {
      setActionLoading(true);
      const agendaSnapshot = await getDocs(
        collection(db, "events", event.id, "agenda"),
      );
      let deletedCountAgenda = 0;
      for (const docItem of agendaSnapshot.docs) {
        await deleteDoc(doc(db, "events", event.id, "agenda", docItem.id));
        deletedCountAgenda++;
      }
      const meetingsRef = collection(db, "events", event.id, "meetings");
      const meetingsSnapshot = await getDocs(meetingsRef);
      let deletedCountMeetings = 0;
      for (const docItem of meetingsSnapshot.docs) {
        await deleteDoc(doc(db, "events", event.id, "meetings", docItem.id));
        deletedCountMeetings++;
      }
      setGlobalMessage(
        `Agenda borrada: ${deletedCountAgenda} slots y ${deletedCountMeetings} reuniones eliminados para el evento ${event.eventName}.`,
      );
    } catch (error) {
      console.log(error);

      setGlobalMessage("Error al borrar la agenda.");
    } finally {
      setActionLoading(false);
    }
  };

  // Ejemplo: alternar habilitación de registros
  const toggleRegistration = async () => {
    try {
      setActionLoading(true);
      const currentStatus = event.config?.registrationEnabled ?? true;
      await updateDoc(doc(db, "events", event.id), {
        "config.registrationEnabled": !currentStatus,
      });
      setGlobalMessage(
        `Registros ${
          !currentStatus ? "habilitados" : "inhabilitados"
        } correctamente.`,
      );
      fetchEvent();
    } catch (error) {
      console.log(error);

      setGlobalMessage("Error al actualizar el estado de registros.");
    } finally {
      setActionLoading(false);
    }
  };

  // Exportar reuniones a Excel usando xlsx
  const exportMeetingsToExcel = async () => {
    try {
      setActionLoading(true);

      const [meetingsSnap, agendaSnap, asistentesSnap, usersSnap] = await Promise.all([
        getDocs(collection(db, "events", event.id, "meetings")),
        getDocs(collection(db, "events", event.id, "agenda")),
        getDocs(collection(db, "events", event.id, "asistentes")),
        getDocs(query(collection(db, "users"), where("eventId", "==", event.id))),
      ]);

      // meetingId -> agendaSlot
      const agendaByMeetingId = {};
      agendaSnap.forEach((d) => {
        const data = d.data();
        if (data.meetingId) agendaByMeetingId[data.meetingId] = data;
      });

      // userId -> asistente (info base)
      const usersMap = {};
      asistentesSnap.forEach((d) => { usersMap[d.id] = { ...d.data() }; });

      // Enriquecer con tipoAsistente desde users
      usersSnap.forEach((d) => {
        const u = d.data();
        if (usersMap[d.id]) usersMap[d.id].tipoAsistente = u.tipoAsistente || "";
        else usersMap[d.id] = { ...u };
      });

      const wsData = [
        [
          "Hora",
          "Mesa",
          "Fecha reunión",
          "Participante 1 (Empresa)",
          "Participante 1 (Nombre)",
          "Participante 1 (Rol)",
          "Participante 1 (Necesidad)",
          "Participante 2 (Empresa)",
          "Participante 2 (Nombre)",
          "Participante 2 (Rol)",
          "Participante 2 (Necesidad)",
          "Estado",
          "Realizada",
          "Fecha creación",
        ],
        ...meetingsSnap.docs.map((d) => {
          const meeting = d.data();
          const agendaSlot = agendaByMeetingId[d.id];
          const p1 = meeting.participants?.[0] ? usersMap[meeting.participants[0]] : null;
          const p2 = meeting.participants?.[1] ? usersMap[meeting.participants[1]] : null;

          let createdAt = "";
          if (meeting.createdAt?.toDate) createdAt = meeting.createdAt.toDate().toLocaleString();
          else if (typeof meeting.createdAt === "string") createdAt = meeting.createdAt;

          return [
            agendaSlot ? `${agendaSlot.startTime} - ${agendaSlot.endTime}` : (meeting.timeSlot || ""),
            agendaSlot ? agendaSlot.tableNumber : (meeting.tableAssigned || ""),
            meeting.meetingDate || "",
            p1?.empresa || "",
            p1?.nombre || "",
            p1?.tipoAsistente || "",
            p1?.necesidad || "",
            p2?.empresa || "",
            p2?.nombre || "",
            p2?.tipoAsistente || "",
            p2?.necesidad || "",
            meeting.status || "",
            meeting.completed ? "Sí" : "No",
            createdAt,
          ];
        }),
      ];

      const ws = XLSX.utils.aoa_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Reuniones");
      XLSX.writeFile(wb, `reuniones_${event?.eventName || event.id}.xlsx`);
    } catch (e) {
      console.error(e);
      setGlobalMessage("Error al exportar reuniones.");
    } finally {
      setActionLoading(false);
    }
  };

  // Exportar asistentes a Excel usando xlsx
  const exportToExcel = () => {
    const wsData = [
      [
        "Nombre",
        "Cédula",
        "Empresa",
        "Descripción",
        "Cargo",
        "Correo",
        "Teléfono",
        "interesPrincipal",
      ],
      ...attendees.map((a) => [
        a.nombre || "",
        a.cedula || "",
        a.empresa || "",
        a.descripcion || "",
        a.cargo || "",
        a.contacto?.correo || "",
        a.contacto?.telefono || "",
        a.interesPrincipal || "",
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Asistentes");
    XLSX.writeFile(wb, `asistentes_${event?.eventName || eventId}.xlsx`);
  };

  // Exportar toda la información de asistentes con subcolecciones a JSON
  const exportAttendeesWithSubcollectionsToJSON = async () => {
    try {
      setActionLoading(true);
      setGlobalMessage("Exportando datos completos...");

      // Obtener todos los asistentes del evento
      const usersQuery = query(
        collection(db, "users"),
        where("eventId", "==", eventId)
      );
      const usersSnap = await getDocs(usersQuery);

      const asistentes = [];
      const matches = [];

      // Para cada asistente, obtener su información y affinityScores
      for (const userDoc of usersSnap.docs) {
        const rawUserData = userDoc.data();
        
        // Omitir el campo vector
        const { vector, ...userDataWithoutVector } = rawUserData;
        
        // Agregar datos del asistente (sin subcolecciones)
        asistentes.push({
          id: userDoc.id,
          ...userDataWithoutVector,
        });

        // Obtener affinityScores del usuario para construir matches
        try {
          const affinityScoresSnap = await getDocs(
            collection(db, "users", userDoc.id, "affinityScores")
          );
          
          if (!affinityScoresSnap.empty) {
            affinityScoresSnap.docs.forEach((doc) => {
              const affinityData = doc.data();
              
              // Crear entrada de match con los IDs de los usuarios y el score
              matches.push({
                userId1: userDoc.id,
                userId2: affinityData.targetUserId || doc.id,
                affinityScore: affinityData.score || 0,
                reasons: affinityData.reasons || [],
                aiGenerated: affinityData.aiGenerated || false,
                calculatedAt: affinityData.calculatedAt?.toDate?.() || affinityData.calculatedAt || null,
              });
            });
          }
        } catch (err) {
          console.log(`No affinityScores for user ${userDoc.id}`);
        }
      }

      // Eliminar matches duplicados (ya que son simétricos)
      // Mantener solo un match por par de usuarios
      const uniqueMatches = [];
      const seenPairs = new Set();
      
      matches.forEach((match) => {
        // Crear clave única ordenada para el par
        const pairKey = [match.userId1, match.userId2].sort().join('_');
        
        if (!seenPairs.has(pairKey)) {
          seenPairs.add(pairKey);
          uniqueMatches.push(match);
        }
      });

      // Crear estructura final
      const exportData = {
        asistentes,
        matches: uniqueMatches,
        metadata: {
          eventId,
          eventName: event?.eventName || "Evento",
          totalAsistentes: asistentes.length,
          totalMatches: uniqueMatches.length,
          exportDate: new Date().toISOString(),
        },
      };

      // Crear el JSON y descargarlo
      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `asistentes_matches_${event?.eventName || eventId}_${
        new Date().toISOString().split("T")[0]
      }.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setGlobalMessage(
        `Exportación completa: ${asistentes.length} asistentes, ${uniqueMatches.length} matches únicos.`
      );
    } catch (error) {
      console.error("Error exportando a JSON:", error);
      setGlobalMessage("Error al exportar datos completos.");
    } finally {
      setActionLoading(false);
    }
  };

  const fetchMeetingsCounts = async () => {
    if (!eventId) return;
    setMeetingsCountLoading(true);
    try {
      // meetings están como subcolección de events: /events/{eventId}/meetings
      const meetingsRef = collection(db, "events", eventId, "meetings");
      const meetingsSnap = await getDocs(meetingsRef);
      let aceptadas = 0,
        pendientes = 0,
        rechazadas = 0;

      meetingsSnap.forEach((doc) => {
        const status = (doc.data().status || "").toLowerCase();
        if (status === "accepted") aceptadas++;
        else if (status === "rejected") rechazadas++;
        else pendientes++;
      });

      setMeetingsCounts({ aceptadas, pendientes, rechazadas });
    } catch (e) {
      console.log(e);
      setMeetingsCounts({ aceptadas: 0, pendientes: 0, rechazadas: 0 });
    }
    setMeetingsCountLoading(false);
  };

  // Buscar reuniones con usuarios inexistentes
  const checkOrphanedMeetings = async () => {
    setCheckingOrphans(true);
    try {
      // Obtener todas las reuniones del evento
      const meetingsRef = collection(db, "events", eventId, "meetings");
      const meetingsSnap = await getDocs(meetingsRef);
      
      // Obtener todos los IDs de usuarios del evento
      const usersQuery = query(collection(db, "users"), where("eventId", "==", eventId));
      const usersSnap = await getDocs(usersQuery);
      const userIds = new Set(usersSnap.docs.map(doc => doc.id));
      
      // Buscar reuniones con usuarios inexistentes
      const orphaned = [];
      meetingsSnap.forEach((doc) => {
        const meeting = doc.data();
        const receiverExists = userIds.has(meeting.receiverId);
        const requesterExists = userIds.has(meeting.requesterId);
        
        if (!receiverExists || !requesterExists) {
          orphaned.push({
            id: doc.id,
            ...meeting,
            missingReceiver: !receiverExists,
            missingRequester: !requesterExists,
          });
        }
      });
      
      setOrphanedMeetings(orphaned);
      setOrphanedMeetingsModalOpened(true);
      
      if (orphaned.length === 0) {
        setGlobalMessage("No se encontraron reuniones con usuarios inexistentes.");
      } else {
        setGlobalMessage(`Se encontraron ${orphaned.length} reuniones con usuarios inexistentes.`);
      }
    } catch (error) {
      console.error("Error checking orphaned meetings:", error);
      setGlobalMessage("Error al buscar reuniones huérfanas.");
    } finally {
      setCheckingOrphans(false);
    }
  };

  // Eliminar una reunión huérfana
  const deleteOrphanedMeeting = async (meetingId) => {
    setDeletingOrphan(meetingId);
    try {
      await deleteDoc(doc(db, "events", eventId, "meetings", meetingId));
      setOrphanedMeetings(prev => prev.filter(m => m.id !== meetingId));
      setGlobalMessage("Reunión eliminada correctamente.");
      fetchMeetingsCounts(); // Actualizar contadores
    } catch (error) {
      console.error("Error deleting orphaned meeting:", error);
      setGlobalMessage("Error al eliminar la reunión.");
    } finally {
      setDeletingOrphan(null);
    }
  };

  // Eliminar todas las reuniones huérfanas
  const deleteAllOrphanedMeetings = async () => {
    if (!window.confirm(`¿Eliminar todas las ${orphanedMeetings.length} reuniones huérfanas?`)) return;
    
    setCheckingOrphans(true);
    try {
      for (const meeting of orphanedMeetings) {
        await deleteDoc(doc(db, "events", eventId, "meetings", meeting.id));
      }
      setGlobalMessage(`${orphanedMeetings.length} reuniones eliminadas correctamente.`);
      setOrphanedMeetings([]);
      setOrphanedMeetingsModalOpened(false);
      fetchMeetingsCounts(); // Actualizar contadores
    } catch (error) {
      console.error("Error deleting all orphaned meetings:", error);
      setGlobalMessage("Error al eliminar las reuniones.");
    } finally {
      setCheckingOrphans(false);
    }
  };

  // Manejar cambio de JSON para importar reuniones
  const handleImportMeetingsJsonChange = (value) => {
    setImportMeetingsJson(value);
    setImportMeetingsError("");
    setImportMeetingsPreview([]);
    setImportMeetingsResult(null);
    if (!value.trim()) return;
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) {
        setImportMeetingsError("El JSON debe ser un array de reuniones.");
        return;
      }
      setImportMeetingsPreview(parsed);
    } catch {
      setImportMeetingsError("JSON inválido. Verifica el formato.");
    }
  };

  // Helper: convierte "HH:MM" a minutos
  const hmToMinutes = (hm) => {
    const [h, m] = hm.split(":").map(Number);
    return h * 60 + m;
  };

  // Helper: genera el lockId con el mismo formato del sistema
  const buildLockId = (evId, userId, dateISO, start, end) => {
    const d = String(dateISO || "").replace(/-/g, "");
    return `${evId}_${userId}_${d}_${start}-${end}`;
  };

  // Confirmar importación de reuniones desde JSON
  // const handleConfirmImportMeetings = async () => {
  //   if (!importMeetingsPreview.length) return;
  //   setImportingMeetings(true);
  //   setImportMeetingsResult(null);
  //   let created = 0;
  //   let errors = 0;
  //   const skipped = [];
  //   try {
  //     // 1. Validar usuarios existentes
  //     const usersSnap = await getDocs(
  //       query(collection(db, "users"), where("eventId", "==", eventId))
  //     );
  //     const validUserIds = new Set(usersSnap.docs.map((d) => d.id));

  //     // 2. Cargar agenda disponible del evento
  //     const agendaSnap = await getDocs(collection(db, "events", eventId, "agenda"));
  //     // Mapa: "HH:MM" -> lista de slots disponibles ordenados por mesa
  //     const agendaByTime = {};
  //     agendaSnap.docs.forEach((d) => {
  //       const s = d.data();
  //       if (s.available !== false) {
  //         const key = s.startTime;
  //         if (!agendaByTime[key]) agendaByTime[key] = [];
  //         agendaByTime[key].push({ id: d.id, ...s });
  //       }
  //     });
  //     // Ordenar cada grupo por número de mesa
  //     Object.values(agendaByTime).forEach((slots) =>
  //       slots.sort((a, b) => Number(a.tableNumber) - Number(b.tableNumber))
  //     );

  //     // Rastrear slots ya usados en esta importación para no reutilizarlos
  //     const usedSlotIds = new Set();

  //     const meetingsRef = collection(db, "events", eventId, "meetings");

  //     for (const item of importMeetingsPreview) {
  //       // Validar usuarios
  //       const compradorExists = validUserIds.has(item.comprador_id);
  //       const vendedorExists = validUserIds.has(item.vendedor_id);
  //       if (!compradorExists || !vendedorExists) {
  //         skipped.push({
  //           bloque: item.bloque,
  //           comprador_id: item.comprador_id,
  //           vendedor_id: item.vendedor_id,
  //           missingComprador: !compradorExists,
  //           missingVendedor: !vendedorExists,
  //           reason: "Usuario no encontrado",
  //         });
  //         continue;
  //       }

  //       // Parsear el bloque: "08:30-08:45" o "08:30 - 08:45"
  //       const bloqueClean = item.bloque.replace(/\s/g, "");
  //       const [startTime, endTime] = bloqueClean.split("-");

  //       // Buscar slot disponible para este horario
  //       const slotsForTime = (agendaByTime[startTime] || []).filter(
  //         (s) => !usedSlotIds.has(s.id)
  //       );

  //       if (!slotsForTime.length) {
  //         skipped.push({
  //           bloque: item.bloque,
  //           comprador_id: item.comprador_id,
  //           vendedor_id: item.vendedor_id,
  //           reason: `Sin mesa disponible para ${startTime}`,
  //         });
  //         continue;
  //       }

  //       const slot = slotsForTime[0];
  //       usedSlotIds.add(slot.id);

  //       // Fecha del slot (multi-día) o fecha del evento
  //       const meetingDate = slot.date || event.config?.eventDate || event.config?.eventDates?.[0] || "";
  //       const dateISO = String(meetingDate).replace(/-/g, "");

  //       const reqLockId = buildLockId(eventId, item.comprador_id, meetingDate, startTime, endTime || slot.endTime);
  //       const recLockId = buildLockId(eventId, item.vendedor_id, meetingDate, startTime, endTime || slot.endTime);

  //       try {
  //         const now = new Date();
  //         const meetingDocRef = await addDoc(meetingsRef, {
  //           eventId,
  //           requesterId: item.comprador_id,
  //           receiverId: item.vendedor_id,
  //           participants: [item.comprador_id, item.vendedor_id],
  //           status: "accepted",
  //           timeSlot: `${startTime} - ${endTime || slot.endTime}`,
  //           tableAssigned: String(slot.tableNumber),
  //           meetingDate,
  //           startMinutes: hmToMinutes(startTime),
  //           endMinutes: hmToMinutes(endTime || slot.endTime),
  //           slotId: slot.id,
  //           lockIds: [reqLockId, recLockId],
  //           turno: item.turno || null,
  //           comprador_nombre: item.comprador_nombre || null,
  //           comprador_empresa: item.comprador_empresa || null,
  //           vendedor_nombre: item.vendedor_nombre || null,
  //           vendedor_empresa: item.vendedor_empresa || null,
  //           afinidad: item.afinidad ?? null,
  //           ambos_colsubsidio: item.ambos_colsubsidio ?? null,
  //           createdAt: now,
  //           updatedAt: now,
  //           importedFromJson: true,
  //           isNotificated: false,
  //         });

  //         // Crear locks
  //         await setDoc(doc(db, "locks", reqLockId), {
  //           eventId,
  //           userId: item.comprador_id,
  //           meetingId: meetingDocRef.id,
  //           date: meetingDate,
  //           start: startTime,
  //           end: endTime || slot.endTime,
  //           createdAt: now,
  //         });
  //         await setDoc(doc(db, "locks", recLockId), {
  //           eventId,
  //           userId: item.vendedor_id,
  //           meetingId: meetingDocRef.id,
  //           date: meetingDate,
  //           start: startTime,
  //           end: endTime || slot.endTime,
  //           createdAt: now,
  //         });

  //         // Marcar slot como ocupado
  //         await updateDoc(doc(db, "events", eventId, "agenda", slot.id), {
  //           available: false,
  //           meetingId: meetingDocRef.id,
  //         });

  //         created++;
  //       } catch (e) {
  //         console.error("Error creando reunión:", e);
  //         errors++;
  //       }
  //     }

  //     setImportMeetingsResult({ created, errors, skipped: skipped.length, skippedDetails: skipped });
  //     fetchMeetingsCounts();
  //     if (skipped.length === 0 && errors === 0) {
  //       setGlobalMessage(`${created} reuniones importadas correctamente.`);
  //       setImportMeetingsModalOpened(false);
  //       setImportMeetingsJson("");
  //       setImportMeetingsPreview([]);
  //     }
  //   } catch (error) {
  //     console.error("Error importing meetings:", error);
  //     setImportMeetingsError("Error al importar reuniones.");
  //   } finally {
  //     setImportingMeetings(false);
  //   }
  // };

  // Notificar por WhatsApp las reuniones accepted no notificadas
  const notifyPendingMeetings = async () => {
    setNotifyRunning(true);
    setNotifyDone(false);
    setNotifyLog([]);

    try {
      const whatsappVersion = event.config?.policies?.whatsappApiVersion || "v1";
      const eventName = event.eventName || "Evento";

      const meetingsSnap = await getDocs(collection(db, "events", eventId, "meetings"));
      const pending = meetingsSnap.docs.filter((d) => {
        const m = d.data();
        return m.status === "accepted" && !m.isNotificated;
      });

      if (pending.length === 0) {
        setNotifyLog([{ nombre: "—", empresa: "—", tipo: "—", status: "skip", reason: "No hay reuniones pendientes de notificación" }]);
        setNotifyDone(true);
        setNotifyRunning(false);
        return;
      }

      const usersSnap = await getDocs(query(collection(db, "users"), where("eventId", "==", eventId)));
      const usersMap = {};
      usersSnap.docs.forEach((d) => { usersMap[d.id] = { id: d.id, ...d.data() }; });

      const sendToUser = async (user, otherUser, m, tipo) => {
        const phone = (user?.contacto?.telefono || user?.telefono || "").replace(/[^\d]/g, "");
        if (!phone) return "skip";

        let dateStr = "";
        if (m.meetingDate) {
          const [y, mo, dy] = m.meetingDate.split("-").map(Number);
          dateStr = new Date(y, mo - 1, dy).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
        }

        try {
          if (whatsappVersion === "v2") {
            const schedule = dateStr ? `${dateStr} - ${m.timeSlot || ""}` : m.timeSlot || "";
            const ok = await sendMeetingConfirmation({
              phone,
              eventName,
              acceptedBy: otherUser?.nombre || "El participante",
              meetingWith: otherUser?.nombre || "Participante",
              company: otherUser?.empresa || "Empresa",
              schedule,
              table: m.tableAssigned || "N/A",
            });
            return ok ? "ok" : "fail";
          } else {
            const dateLine = dateStr ? `📅 *Día:* ${dateStr}\n` : "";
            const message =
              `🤝 *¡Reunión confirmada!*\n\n` +
              `📌 *Evento:* ${eventName}\n` +
              `👤 *Con:* ${otherUser?.nombre || ""}\n` +
              `🏢 *Empresa:* ${otherUser?.empresa || ""}\n` +
              dateLine +
              `🕐 *Horario:* ${m.timeSlot || ""}\n` +
              `🪑 *Mesa:* ${m.tableAssigned || ""}\n\n` +
              `¡Te esperamos!`;
            const ok = await sendWhatsAppMessage({ apiVersion: "v1", phone, message });
            return ok ? "ok" : "fail";
          }
        } catch { return "fail"; }
      };

      const log = [];

      for (const meetingDoc of pending) {
        const m = meetingDoc.data();
        const requester = usersMap[m.requesterId]; // comprador
        const receiver = usersMap[m.receiverId];   // vendedor

        let reqResult = "skip";
        let recResult = "skip";

        if (notifyTarget === "compradores" || notifyTarget === "ambos") {
          reqResult = await sendToUser(requester, receiver, m, "comprador");
          log.push({
            meetingId: meetingDoc.id,
            nombre: requester?.nombre || m.requesterId,
            empresa: requester?.empresa || "—",
            tipo: "Comprador",
            timeSlot: m.timeSlot,
            status: reqResult,
          });
          setNotifyLog([...log]);
        }

        if (notifyTarget === "vendedores" || notifyTarget === "ambos") {
          recResult = await sendToUser(receiver, requester, m, "vendedor");
          log.push({
            meetingId: meetingDoc.id,
            nombre: receiver?.nombre || m.receiverId,
            empresa: receiver?.empresa || "—",
            tipo: "Vendedor",
            timeSlot: m.timeSlot,
            status: recResult,
          });
          setNotifyLog([...log]);
        }

        // Marcar como notificado si los envíos relevantes fueron ok o skip (sin teléfono)
        const reqDone = notifyTarget === "vendedores" || reqResult === "ok" || reqResult === "skip";
        const recDone = notifyTarget === "compradores" || recResult === "ok" || recResult === "skip";
        if (reqDone && recDone) {
          await updateDoc(doc(db, "events", eventId, "meetings", meetingDoc.id), { isNotificated: true });
        }
      }

      setNotifyDone(true);
    } catch (error) {
      console.error("Error notifying meetings:", error);
    } finally {
      setNotifyRunning(false);
    }
  };

  if (!event) {
    return (
      <Center mt="lg">
        <Loader size="lg" />
      </Center>
    );
  }

  return (
    <Container fluid>
      {/* Header */}
      <Group justify="space-between" mt="md" mb="sm" wrap="wrap">
        <Stack gap={2}>
          <Group gap="xs" align="center">
            <Title order={2}>Administrar Evento</Title>
            <Badge variant="light" color="gray">
              ID: {event.id}
            </Badge>
            <Badge
              variant="filled"
              color={event.config?.registrationEnabled ? "teal" : "red"}
            >
              {event.config?.registrationEnabled
                ? "Registros ON"
                : "Registros OFF"}
            </Badge>
          </Group>

          <Text size="sm" c="dimmed">
            Gestiona agenda, reuniones, asistentes, configuración y
            exportaciones desde un solo lugar.
          </Text>
        </Stack>

        <Group gap="xs">
          <Button component={Link} to="/admin" variant="light">
            Volver al Panel
          </Button>
          <Button component={Link} to={`/event/${event.id}`} variant="default">
            Ir a la landing
          </Button>
          <Button component={Link} to={`/matrix/${event.id}`} variant="default">
            Ver Matriz
          </Button>
        </Group>
      </Group>

      {globalMessage && (
        <Alert
          mt="md"
          title="Aviso"
          color="green"
          withCloseButton
          onClose={() => setGlobalMessage("")}
        >
          {globalMessage}
        </Alert>
      )}

      {/* Evento + acciones principales */}
      <Card withBorder shadow="sm" radius="md" p="lg" mt="md">
        <Group align="flex-start" justify="space-between" wrap="wrap">
          <Group align="flex-start" wrap="nowrap">
            {event.eventImage ? (
              <Image
                src={event.eventImage}
                alt={event.eventName}
                w={220}
                h={130}
                radius="md"
                fit="cover"
              />
            ) : (
              <Card withBorder radius="md" w={220} h={130} p="md">
                <Text c="dimmed" size="sm">
                  Sin imagen
                </Text>
              </Card>
            )}

            <Stack gap={6}>
              <Title order={3}>{event.eventName}</Title>
              <Text size="sm" c="dimmed">
                Administra configuración, agenda, reuniones y asistentes.
              </Text>

              <Group gap="xs" mt={4}>
                <Badge variant="light">Asistentes</Badge>
                <Badge variant="light">Empresas</Badge>
                <Badge variant="light">Matches IA</Badge>
              </Group>
            </Stack>
          </Group>

          {/* Acciones principales (las más usadas) */}
          <Group gap="xs" justify="flex-end">
            <Button
              onClick={() => setEditConfigModalOpened(true)}
              loading={actionLoading}
              disabled={actionLoading}
            >
              Editar Configuración
            </Button>

            <Button
              onClick={() => setMeetingsModalOpened(true)}
              loading={actionLoading}
              disabled={actionLoading}
              variant="light"
            >
              Ver Reuniones
            </Button>

            <Button
              onClick={toggleRegistration}
              loading={actionLoading}
              disabled={actionLoading}
              color={event.config?.registrationEnabled ? "red" : "teal"}
              variant="light"
            >
              {event.config?.registrationEnabled
                ? "Inhabilitar Registros"
                : "Habilitar Registros"}
            </Button>
          </Group>
        </Group>
      </Card>

      {/* Resumen de Asistentes */}
      <Card withBorder shadow="sm" radius="md" p="lg" mt="md">
        <Group justify="space-between" mb="xs" wrap="wrap">
          <Title order={5}>Resumen de Asistentes</Title>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          <Card withBorder radius="md" p="md">
            <Text c="dimmed" size="sm">
              Total Asistentes
            </Text>
            <Title order={3}>{attendees.length}</Title>
          </Card>

          <Card withBorder radius="md" p="md">
            <Text c="dimmed" size="sm">
              Vendedores
            </Text>
            <Title order={3}>
              {attendees.filter((a) => a.tipoAsistente?.toLowerCase() === "vendedor").length}
            </Title>
          </Card>

          <Card withBorder radius="md" p="md">
            <Text c="dimmed" size="sm">
              Compradores
            </Text>
            <Title order={3}>
              {attendees.filter((a) => a.tipoAsistente?.toLowerCase() === "comprador").length}
            </Title>
          </Card>
        </SimpleGrid>
      </Card>

      {/* Resumen de Reuniones */}
      <Card withBorder shadow="sm" radius="md" p="lg" mt="md">
        <Group justify="space-between" mb="xs" wrap="wrap">
          <Title order={5}>Resumen de Reuniones</Title>
          <Button
            size="xs"
            variant="subtle"
            onClick={() => setMeetingsModalOpened(true)}
            loading={actionLoading}
            disabled={actionLoading}
          >
            Ver detalle
          </Button>
        </Group>

        {meetingsCountLoading ? (
          <Loader size="sm" />
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
            <Card withBorder radius="md" p="md">
              <Text c="dimmed" size="sm">
                Aceptadas
              </Text>
              <Title order={3}>{meetingsCounts.aceptadas}</Title>
            </Card>

            <Card withBorder radius="md" p="md">
              <Text c="dimmed" size="sm">
                Pendientes
              </Text>
              <Title order={3}>{meetingsCounts.pendientes}</Title>
            </Card>

            <Card withBorder radius="md" p="md">
              <Text c="dimmed" size="sm">
                Rechazadas
              </Text>
              <Title order={3}>{meetingsCounts.rechazadas}</Title>
            </Card>
          </SimpleGrid>
        )}
      </Card>

      {/* Centro de acciones */}
      <Card withBorder shadow="sm" radius="md" p="lg" mt="md">
        <Tabs defaultValue="operacion" keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="operacion">Operación</Tabs.Tab>
            <Tabs.Tab value="config">Configuración</Tabs.Tab>
            <Tabs.Tab value="importexport">Import / Export</Tabs.Tab>
            <Tabs.Tab value="peligro" color="red">
              Peligro
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="operacion" pt="md">
            <Group gap="xs" wrap="wrap">
              <Button
                onClick={() => setManualMeetingModalOpened(true)}
                loading={actionLoading}
                disabled={actionLoading}
                variant="default"
              >
                Agendar Reunión Manual
              </Button>

              <Button
                onClick={() => setConfigureFieldsModalOpened(true)}
                loading={actionLoading}
                disabled={actionLoading}
                variant="default"
              >
                Configurar campos
              </Button>

              <Button
                onClick={() => setConfigureSurveyModalOpened(true)}
                loading={actionLoading}
                disabled={actionLoading}
                variant="default"
              >
                Configurar encuesta
              </Button>

              <Button
                onClick={() => setPoliciesModalOpened(true)}
                loading={actionLoading}
                disabled={actionLoading}
                color="grape"
                variant="light"
              >
                Configurar políticas
              </Button>

              <Button
                onClick={async () => {
                  if (!window.confirm("¿Regenerar vectores para todos los usuarios del evento? Esto puede tardar varios minutos.")) return;
                  setActionLoading(true);
                  try {
                    const response = await fetch("https://regeneratevectorsforevent-6eaymlz5eq-uc.a.run.app", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ eventId: event.id }),
                    });
                    const data = await response.json();
                    if (response.ok) {
                      setGlobalMessage(`Vectores regenerados: ${data.vectorsRegenerated || 0} usuarios, ${data.affinityScoresUpdated || 0} afinidades, ${data.matchesCreated || 0} matches`);
                    } else {
                      setGlobalMessage(`Error: ${data.error || "No se pudieron regenerar los vectores"}`);
                    }
                  } catch (error) {
                    console.error("Error regenerating vectors:", error);
                    setGlobalMessage("Error al regenerar vectores del evento");
                  } finally {
                    setActionLoading(false);
                  }
                }}
                loading={actionLoading}
                disabled={actionLoading}
                color="blue"
                variant="light"
              >
                Regenerar Vectores Evento
              </Button>

              <Button
                onClick={checkOrphanedMeetings}
                loading={checkingOrphans}
                disabled={checkingOrphans || actionLoading}
                color="orange"
                variant="light"
              >
                Buscar Reuniones Huérfanas
              </Button>

              {/* <Button
                onClick={() => {
                  setImportMeetingsJson("");
                  setImportMeetingsPreview([]);
                  setImportMeetingsError("");
                  setImportMeetingsResult(null);
                  setImportMeetingsModalOpened(true);
                }}
                color="violet"
                variant="light"
              >
                Importar Reuniones JSON
              </Button> */}

              <Button
                onClick={() => {
                  setNotifyLog([]);
                  setNotifyDone(false);
                  setNotifyTarget("ambos");
                  setNotifyModalOpened(true);
                }}
                loading={notifyingMeetings}
                disabled={notifyingMeetings || actionLoading}
                color="green"
                variant="light"
              >
                Notificar Reuniones por WhatsApp
              </Button>
            </Group>
          </Tabs.Panel>

          <Tabs.Panel value="config" pt="md">
            <Stack gap="md">
              <div>
                <Text size="sm" fw={600} mb="xs">Configuración del evento</Text>
                <Group gap="xs" wrap="wrap">
                  <Button
                    onClick={() => setEditConfigModalOpened(true)}
                    loading={actionLoading}
                    disabled={actionLoading}
                  >
                    Editar Configuración
                  </Button>

                  <Button
                    onClick={() => setConfigureFieldsModalOpened(true)}
                    loading={actionLoading}
                    disabled={actionLoading}
                    variant="default"
                  >
                    Configurar campos
                  </Button>

                  <Button
                    onClick={() => setConfigureSurveyModalOpened(true)}
                    loading={actionLoading}
                    disabled={actionLoading}
                    variant="default"
                  >
                    Configurar encuesta
                  </Button>

                  <Button
                    onClick={() => setPoliciesModalOpened(true)}
                    loading={actionLoading}
                    disabled={actionLoading}
                    color="grape"
                    variant="default"
                  >
                    Configurar políticas
                  </Button>
                </Group>
              </div>

              <div>
                <Text size="sm" fw={600} mb="xs">Gestión de agenda</Text>
                <Group gap="xs" wrap="wrap">
                  <Button
                    onClick={generateAgendaForEvent}
                    loading={actionLoading}
                    disabled={actionLoading}
                  >
                    Generar Agenda
                  </Button>

                  <Button
                    component={Link}
                    to={`/admin/event/${event.id}/agenda`}
                    loading={actionLoading}
                    disabled={actionLoading}
                    variant="light"
                  >
                    Ver Agenda
                  </Button>
                </Group>
              </div>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="importexport" pt="md">
            <Group gap="xs" wrap="wrap">
              <Button
                component={Link}
                to={`/admin/event/${event.id}/import-meetings`}
                loading={actionLoading}
                disabled={actionLoading}
                color="violet"
                variant="light"
              >
                Importar reuniones desde Excel
              </Button>

              <Button
                color="teal"
                onClick={exportMeetingsToExcel}
                loading={actionLoading}
                disabled={actionLoading}
                variant="light"
              >
                Exportar reuniones a Excel
              </Button>

              <Button
                onClick={exportToExcel}
                loading={actionLoading}
                disabled={actionLoading}
                variant="default"
              >
                Exportar asistentes a Excel
              </Button>

              <Button
                onClick={exportAttendeesWithSubcollectionsToJSON}
                loading={actionLoading}
                disabled={actionLoading}
                variant="outline"
                color="blue"
              >
                Exportar asistentes completo (JSON)
              </Button>
            </Group>
          </Tabs.Panel>

          <Tabs.Panel value="peligro" pt="md">
            <Alert
              color="red"
              title="Acciones irreversibles o críticas"
              mb="md"
            >
              Estas acciones pueden eliminar o reiniciar información. Úsalas con
              cuidado.
            </Alert>

            <Group gap="xs" wrap="wrap">
              <Button
                color="orange"
                onClick={resetAgendaForEvent}
                loading={actionLoading}
                disabled={actionLoading}
                variant="light"
              >
                Restablecer Agenda
              </Button>

              <Button
                color="red"
                onClick={deleteAgendaForEvent}
                loading={actionLoading}
                disabled={actionLoading}
                variant="light"
              >
                Borrar Agenda
              </Button>
            </Group>
          </Tabs.Panel>
        </Tabs>
      </Card>

      {/* Tu lista de asistentes queda igual */}
      <AttendeesList
        event={event}
        setGlobalMessage={setGlobalMessage}
        exportToExcel={exportToExcel}
      />

      {/* Modales */}
      <EditEventConfigModal
        opened={editConfigModalOpened}
        onClose={() => setEditConfigModalOpened(false)}
        event={event}
        refreshEvents={fetchEvent}
        setGlobalMessage={setGlobalMessage}
      />
      <ManualMeetingModal
        opened={manualMeetingModalOpened}
        onClose={() => setManualMeetingModalOpened(false)}
        event={event}
        setGlobalMessage={setGlobalMessage}
      />
      <MeetingsListModal
        opened={meetingsModalOpened}
        onClose={() => setMeetingsModalOpened(false)}
        event={event}
        setGlobalMessage={setGlobalMessage}
      />
      <ConfigureFieldsModal
        opened={configureFieldsModalOpened}
        onClose={() => setConfigureFieldsModalOpened(false)}
        event={event}
        refreshEvents={fetchEvent}
        setGlobalMessage={setGlobalMessage}
      />
      <ConfigureSurveyModal
        opened={configureSurveyModalOpened}
        onClose={() => setConfigureSurveyModalOpened(false)}
        event={event}
        refreshEvents={fetchEvent}
        setGlobalMessage={setGlobalMessage}
      />
      <EventPoliciesModal
        opened={policiesModalOpened}
        onClose={() => setPoliciesModalOpened(false)}
        event={event}
        refreshEvents={fetchEvent}
        setGlobalMessage={setGlobalMessage}
      />

      {/* Modal de importar reuniones desde JSON */}
      {/* <Modal
        opened={importMeetingsModalOpened}
        onClose={() => setImportMeetingsModalOpened(false)}
        title="Importar Reuniones desde JSON"
        size="xl"
        centered
      >
        <Stack gap="md">
          <textarea
            rows={8}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 12, padding: 8, borderRadius: 4, border: "1px solid #ced4da" }}
            placeholder='[{"bloque":"08:30-08:45","turno":"mañana","comprador_id":"...","vendedor_id":"...",...}]'
            value={importMeetingsJson}
            onChange={(e) => handleImportMeetingsJsonChange(e.target.value)}
          />

          {importMeetingsError && (
            <Alert color="red" title="Error">{importMeetingsError}</Alert>
          )}

          {importMeetingsPreview.length > 0 && (
            <>
              <Text size="sm" fw={600}>
                Vista previa: {importMeetingsPreview.length} reuniones a importar
              </Text>
              <Table.ScrollContainer minWidth={500}>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Bloque</Table.Th>
                      <Table.Th>Turno</Table.Th>
                      <Table.Th>Comprador</Table.Th>
                      <Table.Th>Vendedor</Table.Th>
                      <Table.Th>Afinidad</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {importMeetingsPreview.map((item, i) => (
                      <Table.Tr key={i}>
                        <Table.Td>{item.bloque}</Table.Td>
                        <Table.Td>{item.turno}</Table.Td>
                        <Table.Td>
                          <Text size="xs">{item.comprador_nombre}</Text>
                          <Text size="xs" c="dimmed">{item.comprador_empresa}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">{item.vendedor_nombre}</Text>
                          <Text size="xs" c="dimmed">{item.vendedor_empresa}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge color={item.afinidad >= 89 ? "green" : "yellow"} size="sm">
                            {item.afinidad}%
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </>
          )}

          {importMeetingsResult && (
            <Stack gap="xs">
              <Alert
                color={importMeetingsResult.errors > 0 || importMeetingsResult.skipped > 0 ? "orange" : "green"}
                title="Resultado"
              >
                {importMeetingsResult.created} importadas
                {importMeetingsResult.skipped > 0 && `, ${importMeetingsResult.skipped} omitidas (usuarios no encontrados)`}
                {importMeetingsResult.errors > 0 && `, ${importMeetingsResult.errors} errores`}.
              </Alert>
              {importMeetingsResult.skippedDetails?.length > 0 && (
                <Stack gap={4}>
                  <Text size="xs" fw={600} c="orange">Reuniones omitidas por usuarios inexistentes:</Text>
                  {importMeetingsResult.skippedDetails.map((s, i) => (
                    <Text key={i} size="xs" style={{ fontFamily: "monospace" }}>
                      {s.bloque} — {s.missingComprador && `comprador: ${s.comprador_id}`}{s.missingComprador && s.missingVendedor && ", "}{s.missingVendedor && `vendedor: ${s.vendedor_id}`}
                    </Text>
                  ))}
                </Stack>
              )}
            </Stack>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={() => setImportMeetingsModalOpened(false)}>
              Cancelar
            </Button>
            <Button
              color="violet"
              onClick={handleConfirmImportMeetings}
              loading={importingMeetings}
              disabled={importMeetingsPreview.length === 0 || !!importMeetingsError}
            >
              Importar {importMeetingsPreview.length > 0 ? `(${importMeetingsPreview.length})` : ""}
            </Button>
          </Group>
        </Stack>
      </Modal> */}

      {/* Modal de reuniones huérfanas */}
      <Modal
        opened={orphanedMeetingsModalOpened}
        onClose={() => setOrphanedMeetingsModalOpened(false)}
        title="Reuniones con Usuarios Inexistentes"
        size="xl"
        centered
      >
        <Stack gap="md">
          {orphanedMeetings.length === 0 ? (
            <Text c="dimmed">No se encontraron reuniones con usuarios inexistentes.</Text>
          ) : (
            <>
              <Group justify="space-between">
                <Stack gap={4}>
                  <Text size="sm">
                    Se encontraron <strong>{orphanedMeetings.length}</strong> reuniones con usuarios que ya no existen.
                  </Text>
                  <Text size="sm" c="dimmed">
                    IDs únicos inexistentes: <strong>
                      {(() => {
                        const missingIds = new Set();
                        orphanedMeetings.forEach(m => {
                          if (m.missingRequester) missingIds.add(m.requesterId);
                          if (m.missingReceiver) missingIds.add(m.receiverId);
                        });
                        return missingIds.size;
                      })()}
                    </strong>
                  </Text>
                </Stack>
                <Button
                  color="red"
                  size="sm"
                  onClick={deleteAllOrphanedMeetings}
                  loading={checkingOrphans}
                >
                  Eliminar Todas
                </Button>
              </Group>

              <Table.ScrollContainer minWidth={500}>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>ID Reunión</Table.Th>
                      <Table.Th>Solicitante</Table.Th>
                      <Table.Th>Receptor</Table.Th>
                      <Table.Th>Estado</Table.Th>
                      <Table.Th>Problema</Table.Th>
                      <Table.Th>Acciones</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {orphanedMeetings.map((meeting) => (
                      <Table.Tr key={meeting.id}>
                        <Table.Td>
                          <Text size="xs" style={{ fontFamily: 'monospace' }}>
                            {meeting.id.substring(0, 8)}...
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" style={{ fontFamily: 'monospace' }}>
                            {meeting.requesterId}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" style={{ fontFamily: 'monospace' }}>
                            {meeting.receiverId}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge
                            color={
                              meeting.status === "accepted"
                                ? "green"
                                : meeting.status === "rejected"
                                  ? "red"
                                  : "yellow"
                            }
                            size="sm"
                          >
                            {meeting.status}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={4}>
                            {meeting.missingRequester && (
                              <Badge color="red" size="xs" variant="light">
                                Solicitante no existe
                              </Badge>
                            )}
                            {meeting.missingReceiver && (
                              <Badge color="red" size="xs" variant="light">
                                Receptor no existe
                              </Badge>
                            )}
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Button
                            size="xs"
                            color="red"
                            variant="light"
                            onClick={() => deleteOrphanedMeeting(meeting.id)}
                            loading={deletingOrphan === meeting.id}
                            disabled={deletingOrphan !== null}
                          >
                            Eliminar
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </>
          )}
        </Stack>
      </Modal>

      {/* Modal de notificaciones WhatsApp */}
      <Modal
        opened={notifyModalOpened}
        onClose={() => { if (!notifyRunning) setNotifyModalOpened(false); }}
        title="Notificar Reuniones por WhatsApp"
        size="xl"
        centered
      >
        <Stack gap="md">
          {!notifyRunning && !notifyDone && (
            <>
              <Text size="sm">Selecciona a quiénes enviar las notificaciones de reuniones aceptadas sin notificar:</Text>
              <SegmentedControl
                value={notifyTarget}
                onChange={setNotifyTarget}
                data={[
                  { label: "Compradores", value: "compradores" },
                  { label: "Vendedores", value: "vendedores" },
                  { label: "Ambos", value: "ambos" },
                ]}
              />
              <Group justify="flex-end">
                <Button variant="default" onClick={() => setNotifyModalOpened(false)}>Cancelar</Button>
                <Button color="green" onClick={notifyPendingMeetings}>Iniciar envío</Button>
              </Group>
            </>
          )}

          {(notifyRunning || notifyLog.length > 0) && (
            <>
              {notifyRunning && (
                <Group gap="xs">
                  <Loader size="xs" />
                  <Text size="sm" c="dimmed">Enviando notificaciones...</Text>
                </Group>
              )}

              <ScrollArea h={320} offsetScrollbars>
                <Table striped highlightOnHover fz="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Nombre</Table.Th>
                      <Table.Th>Empresa</Table.Th>
                      <Table.Th>Tipo</Table.Th>
                      <Table.Th>Horario</Table.Th>
                      <Table.Th>Estado</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {notifyLog.map((entry, i) => (
                      <Table.Tr key={i}>
                        <Table.Td>{entry.nombre}</Table.Td>
                        <Table.Td>{entry.empresa}</Table.Td>
                        <Table.Td>
                          <Badge size="xs" color={entry.tipo === "Comprador" ? "blue" : "teal"} variant="light">
                            {entry.tipo}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{entry.timeSlot || "—"}</Table.Td>
                        <Table.Td>
                          <Badge
                            size="xs"
                            color={entry.status === "ok" ? "green" : entry.status === "skip" ? "gray" : "red"}
                            variant="filled"
                          >
                            {entry.status === "ok" ? "✓ Enviado" : entry.status === "skip" ? "Sin teléfono" : "✗ Falló"}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>

              {notifyDone && (() => {
                const ok = notifyLog.filter(e => e.status === "ok").length;
                const fail = notifyLog.filter(e => e.status === "fail").length;
                const skip = notifyLog.filter(e => e.status === "skip").length;
                return (
                  <Alert color={fail > 0 ? "orange" : "green"} title="Resumen">
                    <Group gap="lg">
                      <Text size="sm">✓ Enviados: <strong>{ok}</strong></Text>
                      <Text size="sm">✗ Fallidos: <strong>{fail}</strong></Text>
                      <Text size="sm">— Sin teléfono: <strong>{skip}</strong></Text>
                      <Text size="sm">Total: <strong>{notifyLog.length}</strong></Text>
                    </Group>
                  </Alert>
                );
              })()}

              {notifyDone && (
                <Group justify="flex-end">
                  <Button onClick={() => setNotifyModalOpened(false)}>Cerrar</Button>
                </Group>
              )}
            </>
          )}
        </Stack>
      </Modal>

    </Container>
  );
};
export default EventAdmin;

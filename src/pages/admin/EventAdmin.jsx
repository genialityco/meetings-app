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
} from "@mantine/core";
import {
  doc,
  getDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import EditEventConfigModal from "./EditEventConfigModal";
import ManualMeetingModal from "./ManualMeetingModal";
import MeetingsListModal from "./MeetingsListModal";
import AttendeesList from "./AttendeesList";
import { useParams, Link } from "react-router-dom";
import * as XLSX from "xlsx";
import ConfigureFieldsModal from "./ConfigureFieldsModal";
import EventPoliciesModal from "./EventPoliciesModal";

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

  // Estado para reuniones huérfanas
  const [orphanedMeetingsModalOpened, setOrphanedMeetingsModalOpened] = useState(false);
  const [orphanedMeetings, setOrphanedMeetings] = useState([]);
  const [checkingOrphans, setCheckingOrphans] = useState(false);
  const [deletingOrphan, setDeletingOrphan] = useState(null);

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
        
        const startMinutes = timeToMinutes(startTime);
        const endMinutes = timeToMinutes(endTime);
        const blockLength = meetingDuration + breakTime;
        const totalSlots = Math.floor((endMinutes - startMinutes) / blockLength);

        for (let slot = 0; slot < totalSlots; slot++) {
          const slotStart = startMinutes + slot * blockLength;
          const slotEnd = slotStart + meetingDuration;

          if (isWithinBreakBlock(slotStart, slotEnd, breakBlocks)) {
            continue;
          }

          const slotStartTime = minutesToTime(slotStart);
          const slotEndTime = minutesToTime(slotEnd);

          for (let tableNumber = 1; tableNumber <= numTables; tableNumber++) {
            const slotData = {
              date, // ⭐ NUEVO: incluir fecha del slot
              tableNumber,
              startTime: slotStartTime,
              endTime: slotEndTime,
              available: true,
            };
            await addDoc(collection(db, "events", event.id, "agenda"), slotData);
            createdCount++;
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

      // Consulta todas las reuniones aceptadas del evento
      const meetingsRef = collection(db, "events", event.id, "meetings");
      const meetingsSnap = await getDocs(meetingsRef);

      // Consulta la agenda para obtener los datos de slot (hora, mesa, etc)
      const agendaSnap = await getDocs(
        collection(db, "events", event.id, "agenda"),
      );
      const agendaData = {};
      agendaSnap.forEach((doc) => {
        agendaData[doc.data().meetingId] = doc.data();
      });

      // Si tienes usuarios, para poner los nombres de participantes
      const usersSnap = await getDocs(
        query(collection(db, "users"), where("eventId", "==", event.id)),
      );
      const usersMap = {};
      usersSnap.forEach((d) => {
        usersMap[d.id] = d.data();
      });

      const wsData = [
        [
          "Hora",
          "Mesa",
          "Participante 1 (Empresa)",
          "Participante 1 (Nombre)",
          "Participante 1 (Necesidad)",
          "Participante 2 (Empresa)",
          "Participante 2 (Nombre)",
          "Participante 2 (Necesidad)",
          "Estado",
          "Descripción reunión",
          "Fecha creación",
        ],
        ...meetingsSnap.docs.map((doc) => {
          const meeting = doc.data();
          // Busca el slot de agenda para la hora y mesa
          const agendaSlot = Object.values(agendaData).find(
            (a) => a.meetingId === doc.id,
          );

          // Obtener datos de cada participante
          const participant1 = meeting.participants?.[0]
            ? usersMap[meeting.participants[0]]
            : null;
          const participant2 = meeting.participants?.[1]
            ? usersMap[meeting.participants[1]]
            : null;

          // Formatear la fecha de creación si existe
          let createdAtFormatted = "";
          if (meeting.createdAt) {
            // Si es un timestamp de Firestore
            if (meeting.createdAt.toDate) {
              createdAtFormatted = meeting.createdAt.toDate().toLocaleString();
            }
            // Si ya es una cadena de texto
            else if (typeof meeting.createdAt === "string") {
              createdAtFormatted = meeting.createdAt;
            }
          }

          return [
            agendaSlot
              ? `${agendaSlot.startTime} - ${agendaSlot.endTime}`
              : meeting.timeSlot,
            agendaSlot ? agendaSlot.tableNumber : meeting.tableAssigned,
            participant1?.empresa || "",
            participant1?.nombre || "",
            participant1?.necesidad || "",
            participant2?.empresa || "",
            participant2?.nombre || "",
            participant2?.necesidad || "",
            meeting.status,
            meeting.descripcion || "",
            createdAtFormatted,
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
      <EventPoliciesModal
        opened={policiesModalOpened}
        onClose={() => setPoliciesModalOpened(false)}
        event={event}
        refreshEvents={fetchEvent}
        setGlobalMessage={setGlobalMessage}
      />

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
                <Text size="sm">
                  Se encontraron <strong>{orphanedMeetings.length}</strong> reuniones con usuarios que ya no existen.
                </Text>
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
    </Container>
  );
};
export default EventAdmin;

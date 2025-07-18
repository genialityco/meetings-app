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
  const [attendeesLoading, setAttendeesLoading] = useState(false);
  const [configureFieldsModalOpened, setConfigureFieldsModalOpened] =
    useState(false);

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
          where("eventId", "==", eventId)
        );
        const snap = await getDocs(q);
        setAttendees(
          snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }))
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
        startTime,
        endTime,
        numTables,
        breakBlocks = [],
      } = event.config;

      const startMinutes = timeToMinutes(startTime);
      const endMinutes = timeToMinutes(endTime);
      const blockLength = meetingDuration + breakTime;
      const totalSlots = Math.floor((endMinutes - startMinutes) / blockLength);

      let createdCount = 0;

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
            eventId: event.id,
            tableNumber,
            startTime: slotStartTime,
            endTime: slotEndTime,
            available: true,
          };
          await addDoc(collection(db, "agenda"), slotData);
          createdCount++;
        }
      }

      setGlobalMessage(
        `Agenda generada: ${createdCount} slots creados para el evento ${event.eventName}.`
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
      const agendaQuery = query(
        collection(db, "agenda"),
        where("eventId", "==", event.id)
      );
      const agendaSnapshot = await getDocs(agendaQuery);
      agendaSnapshot.forEach(async (docItem) => {
        await updateDoc(doc(db, "agenda", docItem.id), {
          available: true,
          meetingId: null,
        });
      });
      setGlobalMessage(
        `Agenda restablecida para el evento ${event.eventName}.`
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
      const agendaQuery = query(
        collection(db, "agenda"),
        where("eventId", "==", event.id)
      );
      const agendaSnapshot = await getDocs(agendaQuery);
      let deletedCountAgenda = 0;
      for (const docItem of agendaSnapshot.docs) {
        await deleteDoc(doc(db, "agenda", docItem.id));
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
        `Agenda borrada: ${deletedCountAgenda} slots y ${deletedCountMeetings} reuniones eliminados para el evento ${event.eventName}.`
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
        } correctamente.`
      );
      fetchEvent();
    } catch (error) {
      console.log(error);

      setGlobalMessage("Error al actualizar el estado de registros.");
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

  // Eliminar asistente por id
  const handleDeleteAttendee = async (attendeeId) => {
    if (!window.confirm("¿Seguro que deseas eliminar este asistente?")) return;
    try {
      await deleteDoc(doc(db, "users", attendeeId));
      setAttendees((prev) => prev.filter((a) => a.id !== attendeeId));
      setGlobalMessage("Asistente eliminado correctamente.");
    } catch (e) {
      console.log(e);
      setGlobalMessage("Error al eliminar el asistente.");
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

  if (!event) {
    return (
      <Center mt="lg">
        <Loader size="lg" />
      </Center>
    );
  }

  return (
    <Container>
      <Title mt="md">Administrar Evento</Title>
      <Button component={Link} to="/admin" mt="md">
        Volver al Panel de Eventos
      </Button>
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
      <Card shadow="sm" p="lg" withBorder mt="md">
        <Card.Section>
          {event.eventImage && (
            <Image
              src={event.eventImage}
              alt={event.eventName}
              height={160}
              fit="cover"
            />
          )}
        </Card.Section>
        <Group position="apart" mt="md">
          <div>
            <Title order={4}>{event.eventName}</Title>
            <Text size="sm" color="dimmed">
              ID: {event.id}
            </Text>
          </div>
          <Group spacing="xs" align="flex-start">
            <Button
              onClick={() => setEditConfigModalOpened(true)}
              loading={actionLoading}
              disabled={actionLoading}
            >
              Editar Configuración
            </Button>
            <Button
              onClick={() => setManualMeetingModalOpened(true)}
              loading={actionLoading}
              disabled={actionLoading}
            >
              Agendar Reunión Manual
            </Button>
            <Button
              component={Link}
              to={`/event/${event.id}`}
              loading={actionLoading}
              disabled={actionLoading}
            >
              Ir a la landing
            </Button>
            <Button
              component={Link}
              to={`/matrix/${event.id}`}
              loading={actionLoading}
              disabled={actionLoading}
            >
              Ver Matriz
            </Button>
            <Button
              onClick={toggleRegistration}
              loading={actionLoading}
              disabled={actionLoading}
            >
              {event.config?.registrationEnabled
                ? "Inhabilitar Registros"
                : "Habilitar Registros"}
            </Button>
            <Button
              onClick={generateAgendaForEvent}
              loading={actionLoading}
              disabled={actionLoading}
            >
              Generar Agenda
            </Button>
            <Button
              color="orange"
              onClick={resetAgendaForEvent}
              loading={actionLoading}
              disabled={actionLoading}
            >
              Restablecer Agenda
            </Button>
            <Button
              color="red"
              onClick={deleteAgendaForEvent}
              loading={actionLoading}
              disabled={actionLoading}
            >
              Borrar Agenda
            </Button>
            <Button
              onClick={() => setMeetingsModalOpened(true)}
              loading={actionLoading}
              disabled={actionLoading}
            >
              Ver Reuniones
            </Button>
            <Button
              component={Link}
              to={`/admin/event/${event.id}/match`}
              loading={actionLoading}
              disabled={actionLoading}
            >
              Generar Matches IA
            </Button>
            <Button
              onClick={() => setConfigureFieldsModalOpened(true)}
              loading={actionLoading}
              disabled={actionLoading}
            >
              Configurar campos
            </Button>
          </Group>
        </Group>
      </Card>

      <Card shadow="sm" p="lg" withBorder mt="md">
        <Title order={5} mb="xs">
          Resumen de Reuniones
        </Title>
        {meetingsCountLoading ? (
          <Loader size="sm" />
        ) : (
          <Group spacing="md">
            <Text>
              <b>Aceptadas:</b> {meetingsCounts.aceptadas}
            </Text>
            <Text>
              <b>Pendientes:</b> {meetingsCounts.pendientes}
            </Text>
            <Text>
              <b>Rechazadas:</b> {meetingsCounts.rechazadas}
            </Text>
          </Group>
        )}
      </Card>

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
      <AttendeesList
        event={event}
        setGlobalMessage={setGlobalMessage}
        exportToExcel={exportToExcel}
      />
      <ConfigureFieldsModal
        opened={configureFieldsModalOpened}
        onClose={() => setConfigureFieldsModalOpened(false)}
        event={event}
        refreshEvents={fetchEvent}
        setGlobalMessage={setGlobalMessage}
      />
    </Container>
  );
};

export default EventAdmin;

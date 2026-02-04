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
            tableNumber,
            startTime: slotStartTime,
            endTime: slotEndTime,
            available: true,
          };
          await addDoc(collection(db, "events", event.id, "agenda"), slotData);
          createdCount++;
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

      {/* Resumen */}
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
            <Tabs.Tab value="agenda">Agenda</Tabs.Tab>
            <Tabs.Tab value="config">Configuración</Tabs.Tab>
            <Tabs.Tab value="ia">IA</Tabs.Tab>
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
            </Group>
          </Tabs.Panel>

          <Tabs.Panel value="agenda" pt="md">
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
          </Tabs.Panel>

          <Tabs.Panel value="config" pt="md">
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
          </Tabs.Panel>

          <Tabs.Panel value="ia" pt="md">
            <Group gap="xs" wrap="wrap">
              <Button
                component={Link}
                to={`/admin/event/${event.id}/match`}
                loading={actionLoading}
                disabled={actionLoading}
              >
                Generar Matches IA
              </Button>
            </Group>
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
    </Container>
  );
};
export default EventAdmin;

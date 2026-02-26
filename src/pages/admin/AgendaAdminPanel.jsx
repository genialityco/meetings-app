import { useEffect, useState, useMemo } from "react";
import { Table, Button, Badge, Container, Loader, Title, Alert, Group, Select, Stack, Text } from "@mantine/core";
import { collection, query, where, getDocs, updateDoc, doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { useParams } from "react-router-dom";

const statusColors = {
  available: "gray",
  occupied: "yellow",
  accepted: "green",
  break: "blue",
};

const statusLabels = {
  available: "Disponible",
  occupied: "Ocupado (sin reunión)",
  accepted: "Con reunión",
  break: "Descanso",
};


export default function AgendaAdminPage() {
  const { eventId } = useParams();
  const [agenda, setAgenda] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [globalMessage, setGlobalMessage] = useState("");
  const [eventDates, setEventDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);

  useEffect(() => {
    if (!eventId) return;
    setLoading(true);

    // Cargar configuración del evento para obtener las fechas
    getDoc(doc(db, "events", eventId)).then((eventDoc) => {
      if (eventDoc.exists()) {
        const eventData = eventDoc.data();
        const config = eventData.config || {};
        
        // Obtener fechas del evento
        const dates = config.eventDates || (config.eventDate ? [config.eventDate] : []);
        setEventDates(dates);
        
        // Seleccionar primera fecha por defecto
        if (dates.length > 0 && !selectedDate) {
          setSelectedDate(dates[0]);
        }
      }
    });

    Promise.all([
      getDocs(collection(db, "events", eventId, "agenda")),
      getDocs(collection(db, "events", eventId, "meetings")),
    ]).then(([agendaSnap, meetingsSnap]) => {
      setAgenda(agendaSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setMeetings(meetingsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
  }, [eventId]);

  // Filtrar agenda por fecha seleccionada
  const filteredAgenda = useMemo(() => {
    if (!selectedDate) return agenda;
    
    // Si los slots tienen campo 'date', filtrar por ese campo
    const hasDateField = agenda.some(slot => slot.date);
    if (hasDateField) {
      return agenda.filter(slot => slot.date === selectedDate);
    }
    
    // Si no tienen campo 'date', mostrar todos (compatibilidad con eventos antiguos)
    return agenda;
  }, [agenda, selectedDate]);

  // Formatear fecha para el selector
  const formatDate = (dateStr) => {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  // Opciones para el selector de fecha
  const dateOptions = useMemo(() => {
    return eventDates.map(date => ({
      value: date,
      label: formatDate(date),
    }));
  }, [eventDates]);

  // --- ACCIONES ---
  const refreshAgenda = async () => {
    const agendaSnap = await getDocs(collection(db, "events", eventId, "agenda"));
    setAgenda(agendaSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  const handleLiberar = async (slotId) => {
    await updateDoc(doc(db, "events", eventId, "agenda", slotId), {
      available: true,
      meetingId: null,
      isBreak: false,
    });
    setGlobalMessage("Slot liberado correctamente.");
    refreshAgenda();
  };

  const handleBloquear = async (slotId) => {
    await updateDoc(doc(db, "events", eventId, "agenda", slotId), {
      isBreak: true,
      available: false,
      meetingId: null,
    });
    setGlobalMessage("Slot bloqueado como descanso.");
    refreshAgenda();
  };

  const handleDesbloquear = async (slotId) => {
    await updateDoc(doc(db, "events", eventId, "agenda", slotId), {
      isBreak: false,
      available: true,
    });
    setGlobalMessage("Slot desbloqueado.");
    refreshAgenda();
  };

  const handleCancelarReunion = async (slot) => {
    if (!slot.meetingId) return;
    await updateDoc(doc(db, "events", eventId, "agenda", slot.id), {
      available: true,
      meetingId: null,
    });
    // Marcar reunión como cancelada si existe
    if (slot.meetingId) {
      await updateDoc(doc(db, "events", eventId, "meetings", slot.meetingId), {
        status: "cancelled",
      });
    }
    setGlobalMessage("Reunión cancelada y slot liberado.");
    refreshAgenda();
  };

  // --- UI ---
  if (loading) return <Loader />;
  
  const hasMultipleDays = eventDates.length > 1;
  const slotsCount = filteredAgenda.length;
  const availableCount = filteredAgenda.filter(s => s.available && !s.isBreak).length;
  const occupiedCount = filteredAgenda.filter(s => !s.available || s.meetingId).length;
  const breakCount = filteredAgenda.filter(s => s.isBreak).length;
  
  return (
    <Container size="xl">
      <Stack gap="md" mt="md">
        <Title>Admin Agenda — Control de Slots</Title>
        
        {globalMessage && (
          <Alert color="teal" withCloseButton onClose={() => setGlobalMessage("")}>
            {globalMessage}
          </Alert>
        )}
        
        {/* Selector de día (solo si hay múltiples días) */}
        {hasMultipleDays && (
          <Group align="flex-end">
            <Select
              label="Seleccionar día"
              placeholder="Elige un día"
              data={dateOptions}
              value={selectedDate}
              onChange={setSelectedDate}
              style={{ minWidth: 300 }}
            />
            <Badge size="lg" variant="light">
              {slotsCount} slots totales
            </Badge>
            <Badge size="lg" variant="light" color="gray">
              {availableCount} disponibles
            </Badge>
            <Badge size="lg" variant="light" color="yellow">
              {occupiedCount} ocupados
            </Badge>
            <Badge size="lg" variant="light" color="blue">
              {breakCount} descansos
            </Badge>
          </Group>
        )}
        
        {!hasMultipleDays && (
          <Group>
            <Badge size="lg" variant="light">
              {slotsCount} slots totales
            </Badge>
            <Badge size="lg" variant="light" color="gray">
              {availableCount} disponibles
            </Badge>
            <Badge size="lg" variant="light" color="yellow">
              {occupiedCount} ocupados
            </Badge>
            <Badge size="lg" variant="light" color="blue">
              {breakCount} descansos
            </Badge>
          </Group>
        )}
        
        {filteredAgenda.length === 0 ? (
          <Alert color="blue">
            <Text>No hay slots de agenda para {hasMultipleDays ? 'este día' : 'este evento'}.</Text>
            <Text size="sm" c="dimmed" mt="xs">
              {hasMultipleDays 
                ? 'Selecciona otro día o genera la agenda desde la configuración del evento.'
                : 'Genera la agenda desde la configuración del evento.'}
            </Text>
          </Alert>
        ) : (
          <Table striped highlightOnHover withBorder>
            <Table.Thead>
              <Table.Tr>
                {hasMultipleDays && <Table.Th>Fecha</Table.Th>}
                <Table.Th>Hora</Table.Th>
                <Table.Th>Mesa</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th>Acción</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredAgenda
                .sort((a, b) => {
                  // Ordenar por fecha y luego por hora
                  if (a.date && b.date && a.date !== b.date) {
                    return a.date.localeCompare(b.date);
                  }
                  return a.startTime > b.startTime ? 1 : -1;
                })
                .map((slot) => {
                  const status = slot.isBreak
                    ? "break"
                    : slot.meetingId
                    ? meetings.find((m) => m.id === slot.meetingId && m.status === "accepted")
                      ? "accepted"
                      : "occupied"
                    : !slot.available
                    ? "occupied"
                    : "available";
                  return (
                    <Table.Tr key={slot.id}>
                      {hasMultipleDays && (
                        <Table.Td>
                          <Text size="sm">{slot.date || 'N/A'}</Text>
                        </Table.Td>
                      )}
                      <Table.Td>
                        {slot.startTime} - {slot.endTime}
                      </Table.Td>
                      <Table.Td>{slot.tableNumber}</Table.Td>
                      <Table.Td>
                        <Badge color={statusColors[status]}>{statusLabels[status]}</Badge>
                      </Table.Td>
                      <Table.Td>
                        <Group gap="xs">
                          {status === "occupied" && (
                            <Button size="xs" color="orange" onClick={() => handleLiberar(slot.id)}>
                              Liberar
                            </Button>
                          )}
                          {status === "available" && (
                            <Button size="xs" color="blue" onClick={() => handleBloquear(slot.id)}>
                              Bloquear
                            </Button>
                          )}
                          {status === "break" && (
                            <Button size="xs" color="gray" onClick={() => handleDesbloquear(slot.id)}>
                              Desbloquear
                            </Button>
                          )}
                          {status === "accepted" && (
                            <Button size="xs" color="red" onClick={() => handleCancelarReunion(slot)}>
                              Cancelar reunión
                            </Button>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Container>
  );
}

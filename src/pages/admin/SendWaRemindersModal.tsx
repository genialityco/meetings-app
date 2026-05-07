import React, { useState, useEffect } from "react";
import {
  Modal,
  Button,
  Select,
  Checkbox,
  Group,
  Stack,
  Text,
  ScrollArea,
  LoadingOverlay,
  Badge,
} from "@mantine/core";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { sendWhatsAppMessage } from "../../utils/whatsappService";

interface SendWaRemindersModalProps {
  opened: boolean;
  onClose: () => void;
  event: any;
}

export default function SendWaRemindersModal({
  opened,
  onClose,
  event,
}: SendWaRemindersModalProps) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [users, setUsers] = useState<Record<string, any>>({});
  
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [selectedSlot, setSelectedSlot] = useState<string | null>("");
  
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);

  useEffect(() => {
    if (opened && event?.id) {
      fetchData();
    }
  }, [opened, event]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Get users
      const usersSnap = await getDocs(
        query(collection(db, "users"), where("eventId", "==", event.id))
      );
      const usersMap: Record<string, any> = {};
      usersSnap.docs.forEach((doc) => {
        usersMap[doc.id] = { id: doc.id, ...doc.data() };
      });
      setUsers(usersMap);

      // 2. Get meetings
      const meetingsSnap = await getDocs(
        collection(db, "events", event.id, "meetings")
      );
      const meetingsData = meetingsSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setMeetings(meetingsData);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  // Filter meetings based on status and timeSlot
  const filteredMeetings = meetings.filter((m) => {
    if (statusFilter && m.status !== statusFilter) return false;
    if (selectedSlot && m.timeSlot !== selectedSlot) return false;
    return true;
  });

  // Extract unique time slots for the current status
  const timeSlots = Array.from(
    new Set(
      meetings
        .filter((m) => m.status === statusFilter && m.timeSlot)
        .map((m) => m.timeSlot)
    )
  ).sort();

  // Get unique participants from filtered meetings
  // If "pending", maybe we just want to remind the receiver? Or both?
  // Let's include all participants for the filtered meetings
  const participantIds = Array.from(
    new Set(
      filteredMeetings.flatMap((m) => {
        if (statusFilter === "pending") {
          // Si es pendiente, generalmente queremos recordar al que debe aceptar (receiverId)
          // Pero incluiremos a ambos o solo al que recibe? Lo dejo opcional, incluyo ambos por si acaso,
          // o mejor solo al receiverId si queremos recordarles que acepten.
          // Como el prompt dice "reuniones pendientes" incluiré los receiverId para que las acepten.
          return [m.receiverId].filter(Boolean);
        }
        return m.participants || [];
      })
    )
  );

  const participantsList = participantIds
    .map((id) => users[id])
    .filter((u) => !!u) // only existing users
    .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));

  const handleSelectAll = () => {
    if (selectedParticipants.length === participantsList.filter(p => p.telefono).length) {
      setSelectedParticipants([]);
    } else {
      setSelectedParticipants(participantsList.filter(p => p.telefono).map((p) => p.id));
    }
  };

  const toggleParticipant = (id: string) => {
    setSelectedParticipants((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const handleSend = async () => {
    if (selectedParticipants.length === 0) return;
    
    setSending(true);
    let successCount = 0;
    
    try {
      const whatsappApiVersion = event?.config?.policies?.whatsappApiVersion || "v1";

      for (const userId of selectedParticipants) {
        const user = users[userId];
        if (!user || !user.telefono) continue;

        // Como un usuario puede tener multiples reuniones, le enviamos un enlace general al dashboard del evento
        // Y en V1 lo enviamos a /dashboard, en v2 la api completa la url base con el cancel/accept
        const baseUrl = window.location.origin;

        const success = await sendWhatsAppMessage({
          apiVersion: whatsappApiVersion,
          phone: user.telefono,
          message: "Tienes reuniones pendientes por revisar en el evento. Por favor ingresa para gestionarlas.", // Mensaje vacío / fallback
          metadata: {
            eventName: event.eventName || "Evento",
            requesterName: "La Organización",
            requesterCompany: event.eventName || "Evento",
            requesterPosition: "Administración",
            requesterEmail: "-",
            requesterPhone: "-",
            // La API v2 completa los botones con la URL, por eso se coloca toda la ruta
            acceptUrl: `${baseUrl}/dashboard/${event.id}`,
            cancelUrl: `${baseUrl}/dashboard/${event.id}`,
            contextNote: "Tienes reuniones pendientes por revisar en el evento.", // Para V2
          }
        });
        
        if (success) successCount++;
        
        // Pequeña pausa para no saturar la API
        await new Promise(r => setTimeout(r, 200));
      }
      
      alert(`Mensajes enviados exitosamente a ${successCount} asistentes.`);
      onClose();
    } catch (error) {
      console.error("Error sending messages:", error);
      alert("Hubo un error al enviar algunos mensajes.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Recordatorios WhatsApp (Reuniones)"
      size="lg"
    >
      <LoadingOverlay visible={loading} />
      
      <Stack>
        <Group grow>
          <Select
            label="Estado de reuniones"
            value={statusFilter}
            onChange={(val) => {
              setStatusFilter(val || "pending");
              setSelectedSlot("");
              setSelectedParticipants([]);
            }}
            data={[
              { value: "pending", label: "Pendientes (Solicitudes)" },
              { value: "accepted", label: "Aceptadas / Agendadas" },
            ]}
          />
          <Select
            label="Franja de horario"
            placeholder="Todas las franjas"
            value={selectedSlot}
            onChange={(val) => {
              setSelectedSlot(val || "");
              setSelectedParticipants([]);
            }}
            data={[
              { value: "", label: "Todas las franjas" },
              ...timeSlots.map(slot => ({ value: slot, label: slot }))
            ]}
            clearable
          />
        </Group>

        <Group justify="space-between" mt="md">
          <Text fw={500}>
            Asistentes a notificar: {participantsList.length}
          </Text>
          <Button variant="subtle" size="sm" onClick={handleSelectAll}>
            {selectedParticipants.length > 0 && selectedParticipants.length === participantsList.filter(p => p.telefono).length
              ? "Deseleccionar Todos"
              : "Seleccionar Todos"}
          </Button>
        </Group>

        <ScrollArea h={300} type="always" offsetScrollbars>
          <Stack gap="xs">
            {participantsList.length === 0 ? (
              <Text c="dimmed" fs="italic" ta="center" py="xl">
                No hay asistentes para los filtros seleccionados
              </Text>
            ) : (
              participantsList.map((user) => (
                <Checkbox
                  key={user.id}
                  checked={selectedParticipants.includes(user.id)}
                  onChange={() => toggleParticipant(user.id)}
                  label={
                    <Group gap="sm">
                      <Text size="sm">{user.nombre}</Text>
                      <Badge size="sm" variant="dot" color={user.telefono ? "green" : "red"}>
                        {user.telefono || "Sin teléfono"}
                      </Badge>
                      <Text size="xs" c="dimmed">{user.empresa || user.company_razonSocial}</Text>
                    </Group>
                  }
                  disabled={!user.telefono}
                />
              ))
            )}
          </Stack>
        </ScrollArea>

        <Button
          color="green"
          fullWidth
          onClick={handleSend}
          loading={sending}
          disabled={selectedParticipants.length === 0}
        >
          Enviar {selectedParticipants.length} Mensajes
        </Button>
      </Stack>
    </Modal>
  );
}

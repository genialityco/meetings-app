// Dashboard/Dashboard.tsx

import { Container, MantineProvider } from "@mantine/core";
import { useParams } from "react-router-dom";
import { useDashboardData } from "./useDashboardData";
import { buildEventTheme } from "../../theme.js";

import TabsPanel from "./TabsPanel";
import AvatarModal from "./AvatarModal";
import SlotModal from "./SlotModal";
import ConfirmModal from "./ConfirmModal";
import MeetingConfirmationGuard from "./MeetingConfirmationGuard";
import { useCallback, useContext, useMemo, useState, useEffect } from "react";
import { UserContext } from "../../context/UserContext";
import DashboardHeader from "../../components/DashboardHeader";
import type { Notification, NotificationType } from "./types";
import { DEFAULT_POLICIES } from "./types";
import { Modal, Text, Button, TextInput, Stack, Group, Loader, List, ThemeIcon } from "@mantine/core";
import { IconBuildings, IconCalendarEvent } from "@tabler/icons-react";

const NOTIF_NAV_MAP: Record<string, { view: string; tab?: string }> = {
  meeting_request: { view: "activity", tab: "solicitudes" },
  meeting_accepted: { view: "activity", tab: "reuniones" },
  meeting_rejected: { view: "activity", tab: "solicitudes" },
  meeting_cancelled: { view: "activity", tab: "reuniones" },
  meeting_modified: { view: "activity", tab: "reuniones" },
  high_affinity: { view: "matches" }, // Navega a vista de matches
};

function formatTime(timeString?: string) {
  if (!timeString) return "";
  const [hourStr, minuteStr] = timeString.split(":");
  let hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  const suffix = hour >= 12 ? "p. m." : "a. m.";
  hour = hour % 12 || 12;
  return `${hour}:${minute.toString().padStart(2, "0")} ${suffix}`;
}

function formatDate(dateString?: string) {
  if (!dateString) return "";
  const [year, month, day] = dateString.split("-").map(Number);
  const months = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
  ];
  return `${day} de ${months[month - 1]} de ${year}`;
}

export default function Dashboard() {
  const { eventId } = useParams();
  const dashboard = useDashboardData(eventId);
  const { currentUser, updateUser } = useContext(UserContext);

  const [welcomeModalOpened, setWelcomeModalOpened] = useState(false);
  const [welcomePhone, setWelcomePhone] = useState("");
  const [welcomeEmail, setWelcomeEmail] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [isSendingWelcome, setIsSendingWelcome] = useState(false);
  // Mensaje opcional capturado en el mismo modal de selección de horario
  // (solo aplica al flujo de "solicitar reunión", no al de aceptar/reagendar).
  const [requestMessage, setRequestMessage] = useState("");

  const companiesTabEnabled =
    dashboard.policies?.uiViewsEnabled?.companies ??
    DEFAULT_POLICIES.uiViewsEnabled.companies;

  useEffect(() => {
    // Si el usuario acaba de registrarse, no ha visto el popup, y la política está habilitada
    if (
      currentUser?.data &&
      currentUser.data.welcomePopupSeen === false &&
      dashboard.policies?.welcomeMessageEnabled === true
    ) {
      setWelcomePhone(currentUser.data.telefono || currentUser.data.contacto?.telefono || "");
      setWelcomeEmail(currentUser.data.correo || "");
      setWelcomeModalOpened(true);
    }
  }, [currentUser?.data, dashboard.policies?.welcomeMessageEnabled]);

  const handleCloseWelcomeModal = async () => {
    const cleanedPhone = welcomePhone.replace(/\D/g, "");
    if (!cleanedPhone || cleanedPhone.length < 10) {
      setPhoneError("Por favor ingresa un número de teléfono válido (mínimo 10 dígitos).");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(welcomeEmail.trim())) {
      setEmailError("Por favor ingresa un correo electrónico válido.");
      return;
    }

    setIsSendingWelcome(true);

    try {
      if (currentUser?.uid) {
        await updateUser(currentUser.uid, { 
          welcomePopupSeen: true,
          telefono: welcomePhone,
          correo: welcomeEmail
        });
      }
      
      setWelcomeModalOpened(false);
    } catch (err) {
      console.error("Error updating welcomePopupSeen or sending message:", err);
      // Cerrar de todos modos para no bloquear al usuario
      setWelcomeModalOpened(false);
    } finally {
      setIsSendingWelcome(false);
    }
  };

  const [viewRequest, setViewRequest] = useState<{
    view: string;
    tab?: string;
    _k: number;
    highlightEntityId?: string;
    highlightEntityType?: "assistant" | "product" | "company";
  } | null>(null);

  const handleNotificationClick = useCallback(
    (notif: Notification) => {
      console.log("[Dashboard] Notification clicked:", notif);
      dashboard.markNotificationRead(notif.id);
      const target = NOTIF_NAV_MAP[notif.type || ""] || {
        view: "activity",
        tab: "solicitudes",
      };
      
      console.log("[Dashboard] Target:", target);
      
      // Si es notificación de alta afinidad, pasar el entityId para resaltar
      if (notif.type === "high_affinity" && notif.entityType && notif.entityId) {
        const viewReq = { 
          ...target, 
          _k: Date.now(),
          highlightEntityId: notif.entityId,
          highlightEntityType: notif.entityType,
        };
        console.log("[Dashboard] Setting viewRequest with highlight:", viewReq);
        setViewRequest(viewReq);
      } else {
        console.log("[Dashboard] Setting viewRequest without highlight");
        setViewRequest({ ...target, _k: Date.now() });
      }
    },
    [dashboard.markNotificationRead],
  );

  const eventTheme = useMemo(
    () => buildEventTheme(dashboard.eventConfig?.primaryColor),
    [dashboard.eventConfig?.primaryColor],
  );

  return (
    <MantineProvider theme={eventTheme}>
    <Container fluid p={0}>
      {currentUser?.data && (
        <DashboardHeader
          eventImage={dashboard.eventImage}
          dashboardLogo={dashboard.dashboardLogo}
          eventName={dashboard.eventName}
          notifications={dashboard.notifications}
          onNotificationClick={handleNotificationClick}
          onMarkAllRead={dashboard.markAllNotificationsRead}
          formFields={dashboard.formFields}
          eventConfig={dashboard.eventConfig}
          policies={dashboard.policies}
        />
      )}
      <Container fluid pt="sm">
        <TabsPanel dashboard={dashboard} viewRequest={viewRequest} />
      </Container>
      <AvatarModal
        opened={dashboard.avatarModalOpened}
        image={dashboard.selectedImage}
        onClose={() => dashboard.setAvatarModalOpened(false)}
      />
      <SlotModal
        opened={dashboard.slotModalOpened}
        availableSlots={dashboard.availableSlots}
        confirmLoading={dashboard.confirmLoading}
        groupedSlots={dashboard.groupedSlots}
        selectedRange={dashboard.selectedRange}
        setSelectedRange={dashboard.setSelectedRange}
        tableOptions={dashboard.tableOptions}
        selectedSlotId={dashboard.selectedSlotId}
        setSelectedSlotId={dashboard.setSelectedSlotId}
        chosenSlot={dashboard.chosenSlot}
        onConfirmClick={async () => {
          // Si el solicitante está eligiendo horario, se confirma directo
          // (sin el paso extra de ConfirmModal): la reunión queda agendada
          // en el acto, sin necesidad de una segunda pantalla de revisión.
          if (dashboard.pendingMeetingRequest) {
            dashboard.setSlotModalOpened(false);
            const success = await dashboard.confirmSendMeetingRequestWithSlot(
              dashboard.chosenSlot,
              requestMessage,
            );
            setRequestMessage("");
            if (success) {
              setViewRequest({ view: "activity", tab: "agenda", _k: Date.now() });
            }
            return;
          }
          dashboard.setConfirmModalOpened(true);
        }}
        onClose={() => {
          dashboard.setSlotModalOpened(false);
          dashboard.setPendingMeetingRequest(null);
          dashboard.setMeetingToAccept(null);
          dashboard.setMeetingToEdit(null);
          dashboard.setSelectedRange(null);
          dashboard.setSelectedSlotId(null);
          dashboard.setSelectedDate(null);
          setRequestMessage("");
        }}
        eventDates={[...new Set(dashboard.eventConfig?.eventDates || (dashboard.eventConfig?.eventDate ? [dashboard.eventConfig.eventDate] : []))]}
        selectedDate={dashboard.selectedDate}
        onDateChange={dashboard.handleDateChange}
        description={
          dashboard.pendingMeetingRequest
            ? `Vas a solicitar una reunión con ${dashboard.currentRequesterName || "..."}.`
            : undefined
        }
        message={dashboard.pendingMeetingRequest ? requestMessage : undefined}
        onMessageChange={dashboard.pendingMeetingRequest ? setRequestMessage : undefined}
        confirmLabel={dashboard.pendingMeetingRequest ? "Enviar solicitud" : undefined}
      />
      <ConfirmModal
        opened={dashboard.confirmModalOpened}
        currentRequesterName={dashboard.currentRequesterName}
        chosenSlot={dashboard.chosenSlot}
        tableLabel={dashboard.chosenSlotTableLabel}
        onCancel={() => {
          dashboard.setConfirmModalOpened(false);
          dashboard.setPendingMeetingRequest(null);
        }}
        onAccept={async () => {
          dashboard.setConfirmModalOpened(false);
          dashboard.setSlotModalOpened(false);

          if (dashboard.pendingMeetingRequest) {
            if (!dashboard.chosenSlot) {
              alert("No se pudo determinar el horario.");
              return;
            }
            const success = await dashboard.confirmSendMeetingRequestWithSlot(
              dashboard.chosenSlot,
            );
            if (success) {
              setViewRequest({ view: "activity", tab: "agenda", _k: Date.now() });
            }
            return;
          }

          const idToUse =
            dashboard.meetingToEdit ?? dashboard.meetingToAccept?.id;

          if (!idToUse || !dashboard.chosenSlot) {
            alert("No se pudo determinar la reunión o el horario.");
            return;
          }

          const success = await dashboard.confirmAcceptWithSlot(
            idToUse,
            dashboard.chosenSlot,
          );

          if (success) {
            setViewRequest({ view: "activity", tab: "agenda", _k: Date.now() });
          }
        }}
      />

      {currentUser?.uid && eventId && (
        <MeetingConfirmationGuard
          uid={currentUser.uid}
          eventId={eventId}
          enabled={!!dashboard.eventConfig?.policies?.meetingConfirmationEnabled}
          eventConfig={dashboard.eventConfig}
        />
      )}

      <Modal
        opened={welcomeModalOpened}
        onClose={() => {}}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        title="¡Bienvenido al Evento!"
        centered
        radius="md"
        overlayProps={{ blur: 3 }}
      >
        <Stack gap="md">
          <Text size="sm">
            ¡Hola <b>{currentUser?.data?.nombre}</b>! Nos alegra tenerte aquí.
          </Text>
          <List spacing="xs" size="sm" center>
            {companiesTabEnabled && (
              <List.Item
                icon={
                  <ThemeIcon color="blue" size={22} radius="xl">
                    <IconBuildings size={14} />
                  </ThemeIcon>
                }
              >
                En el tab <b>Empresas</b> puedes buscar asistentes y empresas para solicitar reuniones.
              </List.Item>
            )}
            <List.Item
              icon={
                <ThemeIcon color="blue" size={22} radius="xl">
                  <IconCalendarEvent size={14} />
                </ThemeIcon>
              }
            >
              En el tab <b>Mis reuniones</b> verás tus reuniones agendadas y solicitudes.
            </List.Item>
          </List>
          <Text size="sm">
            Revisa tu WhatsApp y correo electrónico para verificar si te llegó el mensaje de bienvenida. Si no lo has recibido, por favor <b>corrige tu teléfono o tu correo</b> a continuación. Así garantizamos que recibirás todas tus notificaciones de reuniones.
          </Text>
          <TextInput
            label="Número de WhatsApp"
            placeholder="Ej: +573001234567"
            value={welcomePhone}
            onChange={(e) => {
              setWelcomePhone(e.currentTarget.value);
              setPhoneError("");
            }}
            error={phoneError}
          />
          <TextInput
            label="Correo electrónico"
            placeholder="tu@empresa.com"
            value={welcomeEmail}
            onChange={(e) => {
              setWelcomeEmail(e.currentTarget.value);
              setEmailError("");
            }}
            error={emailError}
          />
          <Button fullWidth onClick={handleCloseWelcomeModal} color={dashboard.eventConfig?.primaryColor || "blue"} loading={isSendingWelcome}>
            Confirmar y Entrar
          </Button>
        </Stack>
      </Modal>
    </Container>
    </MantineProvider>
  );
}

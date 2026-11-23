// Dashboard/Dashboard.tsx

import { Container, MantineProvider } from "@mantine/core";
import { useParams } from "react-router-dom";
import { useDashboardData } from "./useDashboardData";
import { buildEventTheme } from "../../theme.js";

import TabsPanel from "./TabsPanel";
import AvatarModal from "./AvatarModal";
import WelcomeSellerMessage from "./WelcomeSellerMessage";
import WelcomeBuyerMessage from "./WelcomeBuyerMessage";
import { isVendedor } from "../../utils/attendeeRole";
import SlotModal from "./SlotModal";
import ConfirmModal from "./ConfirmModal";
import MeetingConfirmationGuard from "./MeetingConfirmationGuard";
import CompanySurveyGuard from "./CompanySurveyGuard";
import { useCallback, useContext, useMemo, useState, useEffect } from "react";
import { UserContext } from "../../context/UserContext";
import DashboardHeader from "../../components/DashboardHeader";
import SupportButton from "../../components/SupportButton";
import type { Notification, NotificationType } from "./types";
import { DEFAULT_POLICIES } from "./types";
import { Modal, Text, Button, TextInput, Stack, Group, Loader } from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import { sendWelcomeMessages } from "../../utils/welcomeNotification";

const NOTIF_NAV_MAP: Record<string, { view: string; tab?: string }> = {
  meeting_request: { view: "activity", tab: "solicitudes" },
  meeting_accepted: { view: "activity", tab: "reuniones" },
  meeting_rejected: { view: "activity", tab: "solicitudes" },
  meeting_cancelled: { view: "activity", tab: "reuniones" },
  meeting_modified: { view: "activity", tab: "reuniones" },
  high_affinity: { view: "matches" }, // Navega a vista de matches
};

export default function Dashboard() {
  const { eventId } = useParams();
  const dashboard = useDashboardData(eventId);
  const { currentUser, updateUser, userLoading } = useContext(UserContext);

  useEffect(() => {
    // Cuando la sesión se cierra o se vence (el token de Firebase Auth se invalida y
    // UserContext recupera con una sesión anónima nueva sin ficha asociada, o la ficha
    // de asistente ya no existe), currentUser.data queda vacío. Antes eso dejaba a la
    // persona viendo un dashboard en blanco/roto en vez de mandarla a iniciar sesión de
    // nuevo -se espera a que termine de resolver el estado de auth (userLoading) para no
    // disparar esto en falso durante la carga inicial.
    if (!eventId || userLoading) return;
    if (!currentUser?.data) {
      window.location.assign(`/event/${eventId}`);
    }
  }, [eventId, userLoading, currentUser]);

  const [welcomeModalOpened, setWelcomeModalOpened] = useState(false);
  const [welcomePhone, setWelcomePhone] = useState("");
  const [welcomeEmail, setWelcomeEmail] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [isSendingWelcome, setIsSendingWelcome] = useState(false);
  // "ask": ¿te llegó el mensaje? (dos botones) · "fix": corregir datos y reenviar
  const [welcomeStep, setWelcomeStep] = useState<"ask" | "fix">("ask");
  // Mensaje opcional capturado en el mismo modal de selección de horario
  // (solo aplica al flujo de "solicitar reunión", no al de aceptar/reagendar).
  const [requestMessage, setRequestMessage] = useState("");

  const companiesTabEnabled =
    dashboard.policies?.uiViewsEnabled?.companies ??
    DEFAULT_POLICIES.uiViewsEnabled.companies;

  // El pop-up de bienvenida tiene mensaje propio para vendedores; solo tiene sentido
  // con roleMode "buyer_seller" (en modo abierto el rol no distingue nada).
  const isSellerWelcome =
    dashboard.policies?.roleMode === "buyer_seller" &&
    isVendedor(currentUser?.data?.tipoAsistente);

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

  // "Sí me llegó, continuar": solo marca el pop-up como visto
  const handleWelcomeReceived = async () => {
    setIsSendingWelcome(true);
    try {
      if (currentUser?.uid) {
        await updateUser(currentUser.uid, { welcomePopupSeen: true });
      }
    } catch (err) {
      console.error("Error actualizando welcomePopupSeen:", err);
    } finally {
      // Cerrar de todos modos para no bloquear al usuario
      setIsSendingWelcome(false);
      setWelcomeModalOpened(false);
    }
  };

  // "No me llegó": guarda el teléfono/correo corregidos y reenvía la bienvenida
  // (WhatsApp + correo, el mismo envío del registro)
  const handleWelcomeResend = async () => {
    const cleanedPhone = welcomePhone.replace(/\D/g, "");
    if (!cleanedPhone || cleanedPhone.length < 10) {
      setPhoneError("Por favor ingresa un número de teléfono válido (mínimo 10 dígitos).");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(welcomeEmail.trim())) {
      setEmailError("Por favor ingresa un correo electrónico válido.");
      return;
    }

    const telefono = welcomePhone.trim();
    // loginByEmail busca el correo en minúsculas
    const correo = welcomeEmail.trim().toLowerCase();

    setIsSendingWelcome(true);
    try {
      if (currentUser?.uid && eventId) {
        await updateUser(currentUser.uid, { welcomePopupSeen: true, telefono, correo });
        await sendWelcomeMessages({
          eventId,
          uid: currentUser.uid,
          event: {
            eventName: dashboard.eventName,
            eventImage: dashboard.eventImage,
            config: dashboard.eventConfig,
          },
          nombre: currentUser.data?.nombre,
          telefono,
          correo,
        });
        showNotification({
          color: "green",
          title: "Mensaje reenviado",
          message: "Te volvimos a enviar la bienvenida por WhatsApp y correo electrónico.",
        });
      }
    } catch (err) {
      console.error("Error reenviando la bienvenida:", err);
    } finally {
      setIsSendingWelcome(false);
      setWelcomeModalOpened(false);
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
      {currentUser?.data && (
        <SupportButton
          eventName={dashboard.eventName}
          userName={currentUser.data.nombre}
          userEmail={currentUser.data.correo}
        />
      )}
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
        slotsLoading={dashboard.prepareSlotSelectionLoading}
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

      {currentUser?.uid && eventId && (
        <CompanySurveyGuard
          eventId={eventId}
          uid={currentUser.uid}
          userData={currentUser.data}
          policies={dashboard.eventConfig?.policies}
        />
      )}

      <Modal
        opened={welcomeModalOpened}
        onClose={() => {}}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        title={isSellerWelcome ? "¡Tu registro está completo! 🎉" : "¡Bienvenido al evento! 🎉"}
        centered
        size="xl"
        radius="md"
        overlayProps={{ blur: 3 }}
      >
        {welcomeStep === "ask" ? (
          <Stack gap="md">
            {isSellerWelcome ? (
              <>
                <WelcomeSellerMessage />
                <Text size="sm">
                  Revisa tu WhatsApp y correo electrónico para verificar si te llegó el mensaje de bienvenida. Si no lo has recibido, pulsa <b>"No me llegó"</b> para corregir tu teléfono o tu correo y te lo volvemos a enviar. Así garantizamos que recibirás todas tus notificaciones de reuniones.
                </Text>
              </>
            ) : (
              // El texto de comprador ya incluye el aviso de verificar WhatsApp/correo.
              <WelcomeBuyerMessage
                nombre={currentUser?.data?.nombre}
                companiesTabEnabled={companiesTabEnabled}
              />
            )}
            <Text fw={700} ta="center">
              ¿Te llegó el mensaje de bienvenida?
            </Text>
            <Group grow wrap="wrap">
              <Button
                onClick={handleWelcomeReceived}
                color={dashboard.eventConfig?.primaryColor || "blue"}
                loading={isSendingWelcome}
              >
                Sí me llegó, continuar
              </Button>
              <Button
                variant="light"
                color={dashboard.eventConfig?.primaryColor || "blue"}
                disabled={isSendingWelcome}
                onClick={() => setWelcomeStep("fix")}
              >
                No me llegó, volver a enviar
              </Button>
            </Group>
          </Stack>
        ) : (
          <Stack gap="md">
            <Text size="sm">
              Verifica tu número de WhatsApp y tu correo electrónico. Corrige lo que esté mal y te
              volvemos a enviar el mensaje de bienvenida.
            </Text>
            <TextInput
              label="Número de WhatsApp"
              description="Incluye el indicativo del país"
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
            <Group grow wrap="wrap">
              <Button
                variant="default"
                disabled={isSendingWelcome}
                onClick={() => setWelcomeStep("ask")}
              >
                Volver
              </Button>
              <Button
                onClick={handleWelcomeResend}
                color={dashboard.eventConfig?.primaryColor || "blue"}
                loading={isSendingWelcome}
              >
                Guardar y volver a enviar
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Container>
    </MantineProvider>
  );
}

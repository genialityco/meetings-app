import { Container, MantineProvider, createTheme, Button } from "@mantine/core";
import { useParams, useNavigate } from "react-router-dom";
import { useContext, useMemo } from "react";
import { IconArrowLeft } from "@tabler/icons-react";
import { generateColors } from "@mantine/colors-generator";
import { useDashboardData } from "./useDashboardData";
import { UserContext } from "../../context/UserContext";
import DashboardHeader from "../../components/DashboardHeader";
import MyCompanyTab from "./MyCompanyTab";
import SlotModal from "./SlotModal";
import ConfirmModal from "./ConfirmModal";
import type { Notification } from "./types";

export default function MyCompanyPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const dashboard = useDashboardData(eventId);
  const { currentUser } = useContext(UserContext);

  const eventTheme = useMemo(() => {
    const hex = dashboard.eventConfig?.primaryColor;
    if (!hex) return createTheme({});
    return createTheme({
      colors: { eventPrimary: generateColors(hex) },
      primaryColor: "eventPrimary",
    });
  }, [dashboard.eventConfig?.primaryColor]);

  return (
    <MantineProvider theme={eventTheme}>
      <Container fluid p={0}>
        {currentUser?.data && (
          <DashboardHeader
            eventImage={dashboard.eventImage}
            dashboardLogo={dashboard.dashboardLogo}
            eventName={dashboard.eventName}
            notifications={dashboard.notifications}
            onNotificationClick={(notif: Notification) => {
              dashboard.markNotificationRead(notif.id);
            }}
            onMarkAllRead={dashboard.markAllNotificationsRead}
            formFields={dashboard.formFields}
            eventConfig={dashboard.eventConfig}
            policies={dashboard.policies}
          />
        )}
        <Container fluid pt="sm">
          <Button
            variant="subtle"
            leftSection={<IconArrowLeft size={16} />}
            onClick={() => navigate(`/dashboard/${eventId}`)}
            mb="sm"
          >
            Volver al dashboard
          </Button>
          <MyCompanyTab {...dashboard} />
        </Container>
      </Container>

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
          // Si el solicitante está eligiendo horario, se confirma directo,
          // sin el paso extra de ConfirmModal.
          if (dashboard.pendingMeetingRequest) {
            dashboard.setSlotModalOpened(false);
            await dashboard.confirmSendMeetingRequestWithSlot(dashboard.chosenSlot);
            return;
          }
          dashboard.setConfirmModalOpened(true);
        }}
        onClose={() => {
          dashboard.setSlotModalOpened(false);
          dashboard.setPendingMeetingRequest(null);
        }}
        eventDates={[...new Set(dashboard.eventConfig?.eventDates || (dashboard.eventConfig?.eventDate ? [dashboard.eventConfig.eventDate] : []))]}
        selectedDate={dashboard.selectedDate}
        onDateChange={dashboard.handleDateChange}
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

          const idToUse = dashboard.meetingToEdit ?? dashboard.meetingToAccept?.id;
          if (!idToUse || !dashboard.chosenSlot) return;
          await dashboard.confirmAcceptWithSlot(idToUse, dashboard.chosenSlot);
        }}
      />
    </MantineProvider>
  );
}

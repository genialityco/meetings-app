// Dashboard/Dashboard.tsx

import { Container, Title, Flex, MantineProvider, createTheme } from "@mantine/core";
import { useParams } from "react-router-dom";
import { useDashboardData } from "./useDashboardData";
import { generateColors } from "@mantine/colors-generator";

import NotificationsMenu from "./NotificationsMenu";
import PendingRequestsSection from "./PendingRequestsSection";
import TabsPanel from "./TabsPanel";
import AvatarModal from "./AvatarModal";
import SlotModal from "./SlotModal";
import ConfirmModal from "./ConfirmModal";
import { useContext, useMemo } from "react";
import { UserContext } from "../../context/UserContext";
import UserProfile from "../../components/UserProfile";

export default function Dashboard() {
  const { eventId } = useParams();
  const dashboard = useDashboardData(eventId);
    const { currentUser } = useContext(UserContext);

    console.log("Current User in Dashboard:", currentUser);

  const eventTheme = useMemo(() => {
    const hex = dashboard.eventConfig?.primaryColor;
    if (!hex) return createTheme({});
    return createTheme({
      colors: { eventPrimary: generateColors(hex) },
      primaryColor: "eventPrimary",
    });
  }, [dashboard.eventConfig?.primaryColor]);

  return (
    <MantineProvider theme={eventTheme} inherit>
    <Container fluid>
      {currentUser?.data && <UserProfile />}
      <Flex gap="md" pt="sm">
        <Title order={2}>Dashboard</Title>
        <NotificationsMenu notifications={dashboard.notifications} />
      </Flex>
      {/* <PendingRequestsSection
        pendingRequests={dashboard.pendingRequests}
        assistants={dashboard.assistants}
        onAccept={dashboard.prepareSlotSelection}
        onReject={dashboard.updateMeetingStatus}
        prepareSlotSelectionLoading={dashboard.prepareSlotSelectionLoading}
        sendWhatsAppMessage={dashboard.sendWhatsAppMessage}
      /> */}
      <TabsPanel dashboard={dashboard} />
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
        setConfirmModalOpened={dashboard.setConfirmModalOpened}
        onClose={() => dashboard.setSlotModalOpened(false)}
      />
      <ConfirmModal
        opened={dashboard.confirmModalOpened}
        currentRequesterName={dashboard.currentRequesterName}
        chosenSlot={dashboard.chosenSlot}
        onCancel={() => dashboard.setConfirmModalOpened(false)}
        onAccept={() => {
          dashboard.setConfirmModalOpened(false);
          dashboard.setSlotModalOpened(false);

          // 👇 Selecciona el id correcto dependiendo del modo
          const idToUse =
            dashboard.meetingToEdit ?? dashboard.meetingToAccept?.id;

          if (!idToUse || !dashboard.chosenSlot) {
            alert("No se pudo determinar la reunión o el horario.");
            return;
          }

          dashboard.confirmAcceptWithSlot(idToUse, dashboard.chosenSlot);
        }}
      />
    </Container>
    </MantineProvider>
  );
}

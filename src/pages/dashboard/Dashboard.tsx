// Dashboard/Dashboard.tsx

import { Container, MantineProvider, createTheme } from "@mantine/core";
import { useParams } from "react-router-dom";
import { useDashboardData } from "./useDashboardData";
import { generateColors } from "@mantine/colors-generator";

import TabsPanel from "./TabsPanel";
import AvatarModal from "./AvatarModal";
import SlotModal from "./SlotModal";
import ConfirmModal from "./ConfirmModal";
import { useCallback, useContext, useMemo, useState } from "react";
import { UserContext } from "../../context/UserContext";
import DashboardHeader from "../../components/DashboardHeader";
import type { Notification, NotificationType } from "./types";

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
    const { currentUser } = useContext(UserContext);

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
          onNotificationClick={handleNotificationClick}
          onMarkAllRead={dashboard.markAllNotificationsRead}
          formFields={dashboard.formFields}
          eventConfig={dashboard.eventConfig}
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
        setConfirmModalOpened={dashboard.setConfirmModalOpened}
        onClose={() => dashboard.setSlotModalOpened(false)}
        eventDates={dashboard.eventConfig?.eventDates || (dashboard.eventConfig?.eventDate ? [dashboard.eventConfig.eventDate] : [])}
        selectedDate={dashboard.selectedDate}
        onDateChange={dashboard.handleDateChange}
      />
      <ConfirmModal
        opened={dashboard.confirmModalOpened}
        currentRequesterName={dashboard.currentRequesterName}
        chosenSlot={dashboard.chosenSlot}
        onCancel={() => dashboard.setConfirmModalOpened(false)}
        onAccept={() => {
          dashboard.setConfirmModalOpened(false);
          dashboard.setSlotModalOpened(false);

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

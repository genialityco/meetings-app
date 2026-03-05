import { Container, MantineProvider, createTheme, Button } from "@mantine/core";
import { useParams, useNavigate } from "react-router-dom";
import { useContext, useMemo } from "react";
import { IconArrowLeft } from "@tabler/icons-react";
import { generateColors } from "@mantine/colors-generator";
import { useDashboardData } from "./useDashboardData";
import { UserContext } from "../../context/UserContext";
import DashboardHeader from "../../components/DashboardHeader";
import MyProductsTab from "./MyProductsTab";
import type { Notification } from "./types";

const NOTIF_NAV_MAP: Record<string, { view: string; tab?: string }> = {
  meeting_request: { view: "activity", tab: "solicitudes" },
  meeting_accepted: { view: "activity", tab: "reuniones" },
  meeting_rejected: { view: "activity", tab: "solicitudes" },
  meeting_cancelled: { view: "activity", tab: "reuniones" },
  meeting_modified: { view: "activity", tab: "reuniones" },
};

export default function MyProductsPage() {
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
          <MyProductsTab {...dashboard} />
        </Container>
      </Container>
    </MantineProvider>
  );
}

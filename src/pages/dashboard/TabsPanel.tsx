import { Tabs, SegmentedControl, Stack, Badge, Group } from "@mantine/core";
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import {
  IconCalendarEvent,
  IconInbox,
} from "@tabler/icons-react";
import AttendeesView from "./AttendeesView";
import CompaniesView from "./CompaniesView";
import ProductsView from "./ProductsView";
import ChatbotTab from "./ChatbotTab";
import MeetingsTab from "./MeetingsTab";
import RequestsTab from "./RequestsTab";
import { DEFAULT_POLICIES } from "./types";
import { useMediaQuery } from "@mantine/hooks";

interface ViewRequest {
  view: string;
  tab?: string;
  _k: number;
}

export default function TabsPanel({
  dashboard,
  viewRequest,
}: {
  dashboard: any;
  viewRequest?: ViewRequest | null;
}) {
  const { eventId } = useParams();
  const policies = dashboard.policies || DEFAULT_POLICIES;
  const uiViews = policies.uiViewsEnabled || DEFAULT_POLICIES.uiViewsEnabled;
  const cardFieldsConfig = policies.cardFieldsConfig || DEFAULT_POLICIES.cardFieldsConfig;
  const enableChatbot = import.meta.env.VITE_ENABLE_CHATBOT === "true"

  const isMobile = useMediaQuery("(max-width: 48em)"); // ~768px

  // Construir opciones de vista dinámicamente según configuración del evento
  const viewOptions: { value: string; label: string }[] = [];
  if (uiViews.chatbot) viewOptions.push({ value: "chatbot", label: "Chatbot" });
  if (uiViews.attendees) viewOptions.push({ value: "attendees", label: "Asistentes" });
  if (uiViews.companies) viewOptions.push({ value: "companies", label: "Empresas" });
  if (uiViews.products) viewOptions.push({ value: "products", label: "Productos" });
  viewOptions.push({ value: "activity", label: "Mis reuniones" });

  const [topView, setTopView] = useState(viewOptions[0]?.value || "companies");

  // Si la vista activa ya no existe en las opciones (ej: chatbot deshabilitado), ir a la primera disponible
  const validValues = viewOptions.map((o) => o.value);
  useEffect(() => {
    if (!validValues.includes(topView)) {
      setTopView(validValues[0] || "companies");
    }
  }, [validValues.join(",")]);

  const [activityDefaultTab, setActivityDefaultTab] = useState("reuniones");

  // Navegación externa (ej: click en notificación)
  useEffect(() => {
    if (!viewRequest) return;
    const { view, tab } = viewRequest;
    if (validValues.includes(view)) {
      setTopView(view);
    }
    if (tab) {
      setActivityDefaultTab(tab);
    }
  }, [viewRequest?._k]);

  const requestsCount =
    (dashboard.pendingRequests?.length || 0) +
    (dashboard.acceptedRequests?.length || 0) +
    (dashboard.rejectedRequests?.length || 0) +
    (dashboard.sentRequests?.length || 0) +
    (dashboard.sentRejectedRequests?.length || 0);

  return (
    <Stack mt="md">
    {isMobile ? (
      <Tabs value={topView} onChange={(v) => v && setTopView(v)} variant="pills">
        <Tabs.List style={{ flexWrap: "nowrap", overflowX: "auto", gap: 4 }}>
          {viewOptions.map((o) => (
            <Tabs.Tab
              key={o.value}
              value={o.value}
              style={(theme) => ({
                fontWeight: topView === o.value ? 700 : 500,
                transition: "background 0.15s",
              })}
            >
              {o.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
    ) : (
      <SegmentedControl
        value={topView}
        onChange={setTopView}
        data={viewOptions}
        fullWidth
      />
    )}

      {topView === "attendees" && (
        <AttendeesView
          filteredAssistants={dashboard.filteredAssistants}
          searchTerm={dashboard.searchTerm}
          setSearchTerm={dashboard.setSearchTerm}
          showOnlyToday={dashboard.showOnlyToday}
          setShowOnlyToday={dashboard.setShowOnlyToday}
          interestOptions={dashboard.interestOptions}
          interestFilter={dashboard.interestFilter}
          setInterestFilter={dashboard.setInterestFilter}
          eventConfig={dashboard.eventConfig}
          solicitarReunionHabilitado={dashboard.solicitarReunionHabilitado}
          sendMeetingRequest={dashboard.sendMeetingRequest}
          setAvatarModalOpened={dashboard.setAvatarModalOpened}
          setSelectedImage={dashboard.setSelectedImage}
          currentUser={dashboard.currentUser}
          formFields={dashboard.formFields}
          cardFields={cardFieldsConfig!.attendeeCard}
        />
      )}

      {topView === "companies" && (
        <CompaniesView
          filteredAssistants={dashboard.filteredAssistants}
          companies={dashboard.companies}
          policies={policies}
          solicitarReunionHabilitado={dashboard.solicitarReunionHabilitado}
          sendMeetingRequest={dashboard.sendMeetingRequest}
          setAvatarModalOpened={dashboard.setAvatarModalOpened}
          setSelectedImage={dashboard.setSelectedImage}
          currentUser={dashboard.currentUser}
          formFields={dashboard.formFields}
          cardFields={cardFieldsConfig!.companyCard}
        />
      )}

      {topView === "chatbot" && (
        <ChatbotTab
          sendMeetingRequest={dashboard.sendMeetingRequest}
          solicitarReunionHabilitado={dashboard.solicitarReunionHabilitado}
          currentUser={dashboard.currentUser}
          eventId={eventId}
        />
      )}

      {topView === "products" && (
        <ProductsView
          products={dashboard.products}
          companies={dashboard.companies}
          filteredAssistants={dashboard.filteredAssistants}
          solicitarReunionHabilitado={dashboard.solicitarReunionHabilitado}
          sendMeetingRequest={dashboard.sendMeetingRequest}
          currentUser={dashboard.currentUser}
        />
      )}

      {topView === "activity" && (
        <Tabs value={activityDefaultTab} onChange={(v) => setActivityDefaultTab(v || "reuniones")} variant="pills" radius="md">
          <Tabs.List grow>
            <Tabs.Tab
              value="reuniones"
              leftSection={<IconCalendarEvent size={16} />}
              style={{ fontWeight: activityDefaultTab === "reuniones" ? 700 : 500, transition: "background 0.15s" }}
            >
              <Group gap={4} wrap="nowrap">
                Reuniones
                {(dashboard.acceptedMeetings?.length || 0) > 0 && (
                  <Badge size="sm" variant="light" circle>
                    {dashboard.acceptedMeetings?.length || 0}
                  </Badge>
                )}
              </Group>
            </Tabs.Tab>
            <Tabs.Tab
              value="solicitudes"
              leftSection={<IconInbox size={16} />}
              style={{ fontWeight: activityDefaultTab === "solicitudes" ? 700 : 500, transition: "background 0.15s" }}
            >
              <Group gap={4} wrap="nowrap">
                Solicitudes
                {requestsCount > 0 && (
                  <Badge size="sm" variant="filled" color="red" circle>
                    {requestsCount}
                  </Badge>
                )}
              </Group>
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="reuniones" pt="md">
            <MeetingsTab {...dashboard} />
          </Tabs.Panel>
          <Tabs.Panel value="solicitudes" pt="md">
            <RequestsTab {...dashboard} />
          </Tabs.Panel>
        </Tabs>
      )}
    </Stack>
  );
}

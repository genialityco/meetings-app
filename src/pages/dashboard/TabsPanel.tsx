import { Tabs, SegmentedControl, Stack, Badge, Group } from "@mantine/core";
import { useState } from "react";
import AttendeesView from "./AttendeesView";
import CompaniesView from "./CompaniesView";
import ProductsView from "./ProductsView";
import ChatbotTab from "./ChatbotTab";
import MeetingsTab from "./MeetingsTab";
import RequestsTab from "./RequestsTab";
import MyProductsTab from "./MyProductsTab";
import { DEFAULT_POLICIES } from "./types";

export default function TabsPanel({ dashboard }: { dashboard: any }) {
  const policies = dashboard.policies || DEFAULT_POLICIES;
  const uiViews = policies.uiViewsEnabled || DEFAULT_POLICIES.uiViewsEnabled;

  // Construir opciones de vista dinámicamente según configuración del evento
  const viewOptions: { value: string; label: string }[] = [];
  if (uiViews.attendees) viewOptions.push({ value: "attendees", label: "Directorio" });
  if (uiViews.companies) viewOptions.push({ value: "companies", label: "Empresas" });
  if (uiViews.products) viewOptions.push({ value: "products", label: "Productos" });
  // Añadir Chatbot siempre visible; puedes condicionar con uiViews.chatbot si prefieres
  viewOptions.push({ value: "chatbot", label: "Chatbot" });
  viewOptions.push({ value: "activity", label: "Mi actividad" });

  const [topView, setTopView] = useState(viewOptions[0]?.value || "attendees");

  const requestsCount =
    (dashboard.pendingRequests?.length || 0) +
    (dashboard.acceptedRequests?.length || 0) +
    (dashboard.rejectedRequests?.length || 0) +
    (dashboard.sentRequests?.length || 0);

  return (
    <Stack mt="md">
      <SegmentedControl
        value={topView}
        onChange={setTopView}
        data={viewOptions}
        fullWidth
      />

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
        />
      )}

      {topView === "chatbot" && (
        <ChatbotTab
          filteredAssistants={dashboard.filteredAssistants}
          products={dashboard.products}
          sendMeetingRequest={dashboard.sendMeetingRequest}
          solicitarReunionHabilitado={dashboard.solicitarReunionHabilitado}
          setAvatarModalOpened={dashboard.setAvatarModalOpened}
          setSelectedImage={dashboard.setSelectedImage}
          currentUser={dashboard.currentUser}
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
        <Tabs defaultValue="reuniones">
          <Tabs.List>
            <Tabs.Tab value="reuniones">
              Reuniones ({dashboard.acceptedMeetings?.length || 0})
            </Tabs.Tab>
            <Tabs.Tab value="solicitudes">
              <Group gap={4}>
                Solicitudes
                {requestsCount > 0 && (
                  <Badge size="sm" variant="filled" color="red" circle>
                    {requestsCount}
                  </Badge>
                )}
              </Group>
            </Tabs.Tab>
            <Tabs.Tab value="mis-productos">Mis productos</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="reuniones" pt="md">
            <MeetingsTab {...dashboard} />
          </Tabs.Panel>
          <Tabs.Panel value="solicitudes" pt="md">
            <RequestsTab {...dashboard} />
          </Tabs.Panel>
          <Tabs.Panel value="mis-productos" pt="md">
            <MyProductsTab {...dashboard} />
          </Tabs.Panel>
        </Tabs>
      )}
    </Stack>
  );
}

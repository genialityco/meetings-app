import { Tabs, SegmentedControl, Stack, Badge, Group } from "@mantine/core";
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import {
  IconCalendarEvent,
  IconInbox,
  IconCalendar,
} from "@tabler/icons-react";
import AttendeesView from "./AttendeesView";
import CompaniesView from "./CompaniesView";
import ProductsView from "./ProductsView";
import ChatbotTab from "./ChatbotTab";
import MeetingsTab from "./MeetingsTab";
import RequestsTab from "./RequestsTab";
import CalendarTab from "./CalendarTab";
import MatchesTab from "./MatchesTab";
import { DEFAULT_POLICIES } from "./types";
import { useMediaQuery } from "@mantine/hooks";
import { trackTabChange } from "../../utils/analytics";

interface ViewRequest {
  view: string;
  tab?: string;
  _k: number;
  highlightEntityId?: string;
  highlightEntityType?: "assistant" | "product" | "company";
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

  const isMobile = useMediaQuery("(max-width: 48em)"); // ~768px

  // Estado para mantener el highlightEntityId persistente
  const [persistentHighlight, setPersistentHighlight] = useState<{
    entityId?: string;
    entityType?: "assistant" | "product" | "company";
  }>({});

  // Construir opciones de vista dinámicamente según configuración del evento
  const viewOptions: { value: string; label: string }[] = [];
  if (uiViews.chatbot) viewOptions.push({ value: "chatbot", label: "Chatbot" });
  if (uiViews.matches) viewOptions.push({ value: "matches", label: "Matches" });
  if (uiViews.attendees) viewOptions.push({ value: "attendees", label: "Asistentes" });
  if (uiViews.companies) viewOptions.push({ value: "companies", label: "Empresas" });
  if (uiViews.products) viewOptions.push({ value: "products", label: "Productos" });
  viewOptions.push({ value: "activity", label: "Mis reuniones" });

  const [topView, setTopView] = useState(viewOptions[0]?.value || "companies");

  // Función para cambiar vista principal con tracking
  const handleTopViewChange = (newView: string) => {
    trackTabChange(newView, topView);
    setTopView(newView);
  };

  // Si la vista activa ya no existe en las opciones (ej: chatbot deshabilitado), ir a la primera disponible
  const validValues = viewOptions.map((o) => o.value);
  useEffect(() => {
    if (!validValues.includes(topView)) {
      setTopView(validValues[0] || "companies");
    }
  }, [validValues.join(",")]);

  const [activityDefaultTab, setActivityDefaultTab] = useState("agenda");

  // Función para cambiar tab de actividad con tracking
  const handleActivityTabChange = (newTab: string) => {
    trackTabChange(`activity_${newTab}`, `activity_${activityDefaultTab}`);
    setActivityDefaultTab(newTab);
  };

  // Navegación externa (ej: click en notificación)
  useEffect(() => {
    if (!viewRequest) return;
    const { view, tab, highlightEntityId, highlightEntityType } = viewRequest;
    
    console.log("[TabsPanel] viewRequest changed:", viewRequest);
    
    if (validValues.includes(view)) {
      setTopView(view);
    }
    if (tab) {
      setActivityDefaultTab(tab);
    }
    
    // Guardar highlight info para persistir durante el render
    if (highlightEntityId && highlightEntityType) {
      console.log("[TabsPanel] Setting persistent highlight:", highlightEntityId, highlightEntityType);
      setPersistentHighlight({
        entityId: highlightEntityId,
        entityType: highlightEntityType,
      });
      
      // Limpiar después de 10 segundos (más tiempo que el highlight visual)
      setTimeout(() => {
        console.log("[TabsPanel] Clearing persistent highlight");
        setPersistentHighlight({});
      }, 10000);
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
      <Tabs value={topView} onChange={(v) => v && handleTopViewChange(v)} variant="pills">
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
        onChange={handleTopViewChange}
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
          affinityScores={dashboard.affinityScores}
          highlightEntityId={topView === "attendees" && persistentHighlight.entityType === "assistant" ? persistentHighlight.entityId : undefined}
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
          affinityScores={dashboard.affinityScores}
          highlightEntityId={topView === "companies" && persistentHighlight.entityType === "company" ? persistentHighlight.entityId : undefined}
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

      {topView === "matches" && (
        <MatchesTab
          currentUser={dashboard.currentUser}
          sendMeetingRequest={dashboard.sendMeetingRequest}
          solicitarReunionHabilitado={dashboard.solicitarReunionHabilitado}
          eventId={eventId}
          highlightEntityId={(() => {
            const shouldHighlight = topView === "matches" && persistentHighlight.entityType === "assistant";
            const idToPass = shouldHighlight ? persistentHighlight.entityId : undefined;
            console.log("[TabsPanel] Matches highlight:", {
              topView,
              persistentHighlight,
              shouldHighlight,
              idToPass,
            });
            return idToPass;
          })()}
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
          affinityScores={dashboard.affinityScores}
          highlightEntityId={topView === "products" && persistentHighlight.entityType === "product" ? persistentHighlight.entityId : undefined}
        />
      )}

      {topView === "activity" && (
        <Tabs value={activityDefaultTab} onChange={(v) => v && handleActivityTabChange(v)} variant="pills" radius="md">
          <Tabs.List grow>
            <Tabs.Tab
              value="agenda"
              leftSection={<IconCalendar size={16} />}
            >
              Agenda
            </Tabs.Tab>
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

          <Tabs.Panel value="agenda" pt="md">
            <CalendarTab
              acceptedMeetings={dashboard.acceptedMeetings}
              cancelledMeetings={dashboard.cancelledMeetings}
              pendingRequests={dashboard.pendingRequests}
              sentRequests={dashboard.sentRequests}
              participantsInfo={dashboard.participantsInfo}
              uid={dashboard.uid}
              eventConfig={dashboard.eventConfig}
              eventId={eventId || ""}
            />
          </Tabs.Panel>
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

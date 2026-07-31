import { Tabs, SegmentedControl, Stack, Badge, Group, Popover, Button, Text } from "@mantine/core";
import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import {
  IconCalendarEvent,
  IconInbox,
  IconCalendar,
  IconMessageChatbot,
  IconSparkles,
  IconUsers,
  IconBuildings,
  IconBuildingStore,
  IconPackage,
  IconClipboardList,
  IconInfoCircle,
} from "@tabler/icons-react";
import AttendeesView from "./AttendeesView";
import CompaniesView from "./CompaniesView";
import ProductsView from "./ProductsView";
import ChatbotTab from "./ChatbotTab";
import MeetingsTab from "./MeetingsTab";
import RequestsTab from "./RequestsTab";
import CalendarTab from "./CalendarTab";
import MatchesTab from "./MatchesTab";
import EventSurveyTab from "./EventSurveyTab";
import MyCompanyTab from "./MyCompanyTab";
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

// Icono de cada vista principal — mismo lenguaje visual en móvil (pills) y
// escritorio (SegmentedControl) para que cada tab se reconozca de un vistazo.
const VIEW_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  mystand: IconBuildingStore,
  chatbot: IconMessageChatbot,
  matches: IconSparkles,
  attendees: IconUsers,
  companies: IconBuildings,
  products: IconPackage,
  activity: IconCalendarEvent,
  survey: IconClipboardList,
};

// Ayuda contextual por tab: solo los tabs listados aquí muestran el botón de instrucciones.
const TAB_INSTRUCTIONS: Record<string, string> = {
  companies: "Busca empresas o sus representantes y solicita una reunión directamente desde su tarjeta.",
  activity: "Aquí verás tus reuniones agendadas, tus solicitudes y tu agenda del evento.",
};

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
  const eventSurveyEnabled = !!dashboard.eventConfig?.eventSurvey?.enabled;
  if (eventSurveyEnabled) viewOptions.push({ value: "survey", label: "Encuesta" });

  // Reordenar según la configuración del admin (viewsOrder). Las vistas
  // habilitadas que no estén en el orden configurado se muestran al final.
  const viewsOrder: string[] = policies.viewsOrder || DEFAULT_POLICIES.viewsOrder || [];
  viewOptions.sort((a, b) => {
    const ia = viewsOrder.indexOf(a.value);
    const ib = viewsOrder.indexOf(b.value);
    return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib);
  });

  // "Mi stand": vista principal del representante de stand cuando el evento
  // maneja visitas a stands (standVisitsEnabled). Solo los vendedores tienen
  // stand — los compradores también registran empresa, así que tener empresa
  // no basta. Se antepone al resto para que sea su pantalla de aterrizaje.
  const roleLower = (dashboard.currentUser?.data?.tipoAsistente || "").toLowerCase().trim();
  const hasCompany = !!(dashboard.currentUser?.data?.companyId || dashboard.currentUser?.data?.company_nit);
  const showMyStand = policies.standVisitsEnabled === true && hasCompany && roleLower === "vendedor";
  if (showMyStand) viewOptions.unshift({ value: "mystand", label: "Mi stand" });

  // Con "el solicitante elige horario" no existen solicitudes pendientes
  // (toda reunión se confirma al instante), así que la sub-tab Solicitudes
  // quedaría siempre vacía y confunde: se oculta.
  const hideSolicitudes = policies.schedulingMode === "requester_picks";

  const [topView, setTopView] = useState(viewOptions[0]?.value || "companies");

  // Aterrizar en "Mi stand" una sola vez cuando la vista aparece (las políticas
  // cargan async, así que en el primer render aún no existe).
  const autoLandedMyStand = useRef(false);
  useEffect(() => {
    if (showMyStand && !autoLandedMyStand.current) {
      autoLandedMyStand.current = true;
      setTopView("mystand");
    }
  }, [showMyStand]);

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
      setActivityDefaultTab(tab === "solicitudes" && hideSolicitudes ? "reuniones" : tab);
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
        <Tabs.List style={{ flexWrap: "nowrap", overflowX: "auto", gap: 4, paddingBottom: 4 }}>
          {viewOptions.map((o) => {
            const Icon = VIEW_ICONS[o.value];
            return (
              <Tabs.Tab
                key={o.value}
                value={o.value}
                leftSection={Icon ? <Icon size={16} /> : undefined}
                style={{
                  fontWeight: topView === o.value ? 700 : 500,
                  transition: "background 0.15s",
                  flexShrink: 0,
                }}
              >
                {o.label}
              </Tabs.Tab>
            );
          })}
        </Tabs.List>
      </Tabs>
    ) : (
      <SegmentedControl
        value={topView}
        onChange={handleTopViewChange}
        data={viewOptions.map((o) => {
          const Icon = VIEW_ICONS[o.value];
          return {
            value: o.value,
            label: (
              <Group gap={6} wrap="nowrap" justify="center">
                {Icon && <Icon size={16} />}
                <span>{o.label}</span>
              </Group>
            ),
          };
        })}
        radius="xl"
        fullWidth
      />
    )}

    {TAB_INSTRUCTIONS[topView] && (
      <Group justify="flex-start">
        <Popover width={300} position="bottom-start" withArrow shadow="md">
          <Popover.Target>
            <Button
              variant="light"
              color="blue"
              size="xs"
              radius="xl"
              leftSection={<IconInfoCircle size={16} />}
            >
              ¿Cómo funciona esta sección?
            </Button>
          </Popover.Target>
          <Popover.Dropdown>
            <Text size="sm">{TAB_INSTRUCTIONS[topView]}</Text>
          </Popover.Dropdown>
        </Popover>
      </Group>
    )}

      {topView === "attendees" && (
        <AttendeesView
          filteredAssistants={dashboard.filteredAssistants}
          showOnlyToday={dashboard.showOnlyToday}
          setShowOnlyToday={dashboard.setShowOnlyToday}
          filterByRole={dashboard.filterByRole}
          setFilterByRole={dashboard.setFilterByRole}
          interestOptions={dashboard.interestOptions}
          interestFilter={dashboard.interestFilter}
          setInterestFilter={dashboard.setInterestFilter}
          eventConfig={dashboard.eventConfig}
          solicitarReunionHabilitado={dashboard.solicitarReunionHabilitado}
          sendMeetingRequest={dashboard.sendMeetingRequest}
          requestMeetingWithSlotPicker={dashboard.requestMeetingWithSlotPicker}
          setAvatarModalOpened={dashboard.setAvatarModalOpened}
          setSelectedImage={dashboard.setSelectedImage}
          currentUser={dashboard.currentUser}
          formFields={dashboard.formFields}
          cardFields={cardFieldsConfig!.attendeeCard}
          affinityScores={dashboard.affinityScores}
          highlightEntityId={topView === "attendees" && persistentHighlight.entityType === "assistant" ? persistentHighlight.entityId : undefined}
        />
      )}

      {topView === "mystand" && <MyCompanyTab {...dashboard} />}

      {topView === "companies" && (
        <CompaniesView
          filteredAssistants={dashboard.filteredAssistants}
          companies={dashboard.companies}
          policies={policies}
          acceptedMeetings={dashboard.acceptedMeetings}
          participantsInfo={dashboard.participantsInfo}
          myStandVisits={dashboard.myStandVisits}
          eventConfig={dashboard.eventConfig}
          solicitarReunionHabilitado={dashboard.solicitarReunionHabilitado}
          sendMeetingRequest={dashboard.sendMeetingRequest}
          requestMeetingWithSlotPicker={dashboard.requestMeetingWithSlotPicker}
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
          requestMeetingWithSlotPicker={dashboard.requestMeetingWithSlotPicker}
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
          requestMeetingWithSlotPicker={dashboard.requestMeetingWithSlotPicker}
          currentUser={dashboard.currentUser}
          affinityScores={dashboard.affinityScores}
          highlightEntityId={topView === "products" && persistentHighlight.entityType === "product" ? persistentHighlight.entityId : undefined}
        />
      )}

      {topView === "survey" && (
        <EventSurveyTab
          eventId={eventId || ""}
          uid={dashboard.uid}
          currentUser={dashboard.currentUser}
          eventConfig={dashboard.eventConfig}
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
            {!hideSolicitudes && (
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
            )}
          </Tabs.List>

          <Tabs.Panel value="agenda" pt="md">
            <CalendarTab
              acceptedMeetings={dashboard.acceptedMeetings}
              cancelledMeetings={dashboard.cancelledMeetings}
              standbyMeetings={dashboard.standbyMeetings || []}
              pendingRequests={dashboard.pendingRequests}
              sentRequests={dashboard.sentRequests}
              participantsInfo={dashboard.participantsInfo}
              uid={dashboard.uid}
              eventConfig={dashboard.eventConfig}
              eventId={eventId || ""}
              currentUser={dashboard.currentUser}
              policies={policies}
              downloadVCard={dashboard.downloadVCard}
              sendWhatsAppMessage={dashboard.sendWhatsAppMessage}
              cancelMeeting={dashboard.cancelMeeting}
            />
          </Tabs.Panel>
          <Tabs.Panel value="reuniones" pt="md">
            <MeetingsTab 
              {...dashboard} 
              onNavigateToCompany={(companyNit) => {
                // Change main view to "companies"
                setTopView("companies");
                // Set the persistent highlight to trigger scroll and highlight in CompaniesView
                setPersistentHighlight({
                  entityType: "company",
                  entityId: companyNit,
                  timestamp: Date.now()
                });
              }}
            />
          </Tabs.Panel>
          {!hideSolicitudes && (
            <Tabs.Panel value="solicitudes" pt="md">
              <RequestsTab {...dashboard} />
            </Tabs.Panel>
          )}
        </Tabs>
      )}
    </Stack>
  );
}

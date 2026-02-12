import { Tabs, SegmentedControl, Stack, Badge, Group, Paper } from "@mantine/core";
import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import {
  IconCalendarEvent,
  IconInbox,
  IconPackage,
  IconBuilding,
} from "@tabler/icons-react";
import AttendeesView from "./AttendeesView";
import CompaniesView from "./CompaniesView";
import ProductsView from "./ProductsView";
import ChatbotTab from "./ChatbotTab";
import MeetingsTab from "./MeetingsTab";
import RequestsTab from "./RequestsTab";
import MyProductsTab from "./MyProductsTab";
import MyCompanyTab from "./MyCompanyTab";
import { DEFAULT_POLICIES } from "./types";

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

  // Política configurable: redirigir vendedor a productos en primer ingreso
  const sellerRedirect = policies.sellerRedirectToProducts === true;
  const userRole = dashboard.currentUser?.data?.tipoAsistente as string | undefined;
  const uid = dashboard.uid as string | undefined;
  const roleLower = userRole?.toLowerCase();
  const isVendedor = sellerRedirect && roleLower === "vendedor";
  const isComprador = sellerRedirect && roleLower === "comprador";

  // DEBUG: verificar valores de la redirección
  console.log("[TabsPanel DEBUG]", {
    eventId,
    uid,
    sellerRedirectPolicy: policies.sellerRedirectToProducts,
    sellerRedirect,
    userRole,
    tipoAsistenteRaw: dashboard.currentUser?.data?.tipoAsistente,
    currentUserData: dashboard.currentUser?.data,
    isVendedor,
    isComprador,
    policiesLoaded: dashboard.policies !== undefined,
  });

  // Construir opciones de vista dinámicamente según configuración del evento
  const viewOptions: { value: string; label: string }[] = [];
  if (uiViews.chatbot) viewOptions.push({ value: "chatbot", label: "Chatbot" });
  if (uiViews.attendees) viewOptions.push({ value: "attendees", label: "Asistentes" });
  if (uiViews.companies) viewOptions.push({ value: "companies", label: "Empresas" });
  if (uiViews.products) viewOptions.push({ value: "products", label: "Productos" });
  viewOptions.push({ value: "activity", label: "Mi actividad" });

  const [topView, setTopView] = useState(viewOptions[0]?.value || "companies");

  // Si la vista activa ya no existe en las opciones (ej: chatbot deshabilitado), ir a la primera disponible
  const validValues = viewOptions.map((o) => o.value);
  useEffect(() => {
    if (!validValues.includes(topView)) {
      setTopView(validValues[0] || "companies");
    }
  }, [validValues.join(",")]);

  // Redirigir al vendedor a "Mi actividad > Mis productos" solo la primera vez
  const redirectKey = eventId && uid ? `seller_redirect_${eventId}_${uid}` : null;
  const redirectDone = useRef(false);
  const [activityDefaultTab, setActivityDefaultTab] = useState("reuniones");

  useEffect(() => {
    if (redirectDone.current) return;
    if (!isVendedor || !redirectKey) return;
    if (localStorage.getItem(redirectKey)) return;

    // Datos cargados y es vendedor con política activa: redirigir
    console.log("Redirigiendo vendedor a Mis productos por política sellerRedirectToProducts");
    localStorage.setItem(redirectKey, "1");
    redirectDone.current = true;
    setTopView("activity");
    setActivityDefaultTab("mis-productos");
  }, [isVendedor, redirectKey]);

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
        <Tabs value={activityDefaultTab} onChange={(v) => setActivityDefaultTab(v || "reuniones")} radius="md">
          <Tabs.List grow>
            <Tabs.Tab
              value="reuniones"
              leftSection={<IconCalendarEvent size={16} />}
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
            {!isComprador && (
              <Tabs.Tab
                value="mis-productos"
                leftSection={<IconPackage size={16} />}
              >
                Mis productos
              </Tabs.Tab>
            )}
            <Tabs.Tab
              value="mi-empresa"
              leftSection={<IconBuilding size={16} />}
            >
              Mi empresa
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="reuniones" pt="md">
            <MeetingsTab {...dashboard} />
          </Tabs.Panel>
          <Tabs.Panel value="solicitudes" pt="md">
            <RequestsTab {...dashboard} />
          </Tabs.Panel>
          {!isComprador && (
            <Tabs.Panel value="mis-productos" pt="md">
              <MyProductsTab {...dashboard} />
            </Tabs.Panel>
          )}
          <Tabs.Panel value="mi-empresa" pt="md">
            <MyCompanyTab {...dashboard} />
          </Tabs.Panel>
        </Tabs>
      )}
    </Stack>
  );
}

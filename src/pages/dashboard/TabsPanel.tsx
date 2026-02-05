import { Tabs, SegmentedControl, Stack, Badge, Group } from "@mantine/core";
import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import AttendeesView from "./AttendeesView";
import CompaniesView from "./CompaniesView";
import ProductsView from "./ProductsView";
import ChatbotTab from "./ChatbotTab";
import MeetingsTab from "./MeetingsTab";
import RequestsTab from "./RequestsTab";
import MyProductsTab from "./MyProductsTab";
import MyCompanyTab from "./MyCompanyTab";
import { DEFAULT_POLICIES } from "./types";

export default function TabsPanel({ dashboard }: { dashboard: any }) {
  const { eventId } = useParams();
  const policies = dashboard.policies || DEFAULT_POLICIES;
  const uiViews = policies.uiViewsEnabled || DEFAULT_POLICIES.uiViewsEnabled;
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
  if (uiViews.companies) viewOptions.push({ value: "companies", label: "Disponibles" });
  if (uiViews.products) viewOptions.push({ value: "products", label: "Productos" });
  viewOptions.push({ value: "activity", label: "Mi actividad" });

  const [topView, setTopView] = useState(viewOptions[0]?.value || "attendees");

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
        <Tabs defaultValue={activityDefaultTab}>
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
            {/* En modo buyer_seller, solo vendedores ven "Mis productos" */}
            {!isComprador && (
              <Tabs.Tab value="mis-productos">Mis productos</Tabs.Tab>
            )}
            <Tabs.Tab value="mi-empresa">Mi empresa</Tabs.Tab>
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

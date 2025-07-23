import { useContext } from "react";
import { Tabs, Text } from "@mantine/core";
import AssistantsTab from "./AssistantsTab";
import MeetingsTab from "./MeetingsTab";
import RequestsTab from "./RequestsTab";
import { UserContext } from "../../context/UserContext";

export default function TabsPanel({ dashboard }) {
  return (
    <Tabs defaultValue="reuniones">
      <Tabs.List>
        <Tabs.Tab value="reuniones">
          Reuniones ({dashboard.acceptedMeetings.length})
        </Tabs.Tab>
        <Tabs.Tab value="asistentes">
          {
            <Tabs.Tab value="asistentes">
              {dashboard.currentUser?.data?.tipoAsistente
                ? dashboard.currentUser?.data?.tipoAsistente == "vendedor"
                  ? "Compradores"
                  : "Vendedores"
                : "Asistentes"}{" "}
              ({dashboard.filteredAssistants.length})
            </Tabs.Tab>
          }
        </Tabs.Tab>
        <Tabs.Tab value="solicitudes">
          Solicitudes (
          {dashboard.pendingRequests.length +
            dashboard.acceptedRequests.length +
            dashboard.rejectedRequests.length +
            dashboard.sentRequests.length}
          )
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="reuniones" pt="md">
        <MeetingsTab {...dashboard} />
      </Tabs.Panel>
      <Tabs.Panel value="asistentes" pt="md">
        <AssistantsTab {...dashboard} />
      </Tabs.Panel>
      <Tabs.Panel value="solicitudes" pt="md">
        <RequestsTab {...dashboard} />
      </Tabs.Panel>
    </Tabs>
  );
}

import { Tabs, Text } from "@mantine/core";
import AssistantsTab from "./AssistantsTab";
import MeetingsTab from "./MeetingsTab";
import RequestsTab from "./RequestsTab";

export default function TabsPanel({ dashboard }) {
  return (
    <Tabs defaultValue="asistentes">
      <Tabs.List>
        <Tabs.Tab value="asistentes">Asistentes ({dashboard.assistants.length})</Tabs.Tab>
        <Tabs.Tab value="reuniones">Reuniones ({dashboard.acceptedMeetings.length})</Tabs.Tab>
        <Tabs.Tab value="solicitudes">
          Solicitudes ({dashboard.pendingRequests.length + dashboard.acceptedRequests.length + dashboard.rejectedRequests.length})
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="asistentes" pt="md">
        <AssistantsTab {...dashboard} />
      </Tabs.Panel>
      <Tabs.Panel value="reuniones" pt="md">
        <MeetingsTab {...dashboard} />
      </Tabs.Panel>
      <Tabs.Panel value="solicitudes" pt="md">
        <RequestsTab {...dashboard} />
      </Tabs.Panel>
    </Tabs>
  );
}

import { Tabs } from "@mantine/core";
import { useMemo } from "react";
import AssistantsTab from "./AssistantsTab";
import MeetingsTab from "./MeetingsTab";
import RequestsTab from "./RequestsTab";

export default function TabsPanel({ dashboard }) {
  const tipoUsuario = dashboard.currentUser?.data?.tipoAsistente;
  
  // Determinar qué tipo de asistentes mostrar
  const tipoAMostrar = tipoUsuario === "vendedor" ? "comprador" : tipoUsuario === "comprador" ? "vendedor" : null;
  
  // Filtrar y agrupar asistentes
  const assistantsFiltrados = useMemo(() => {
    // dashboard.filteredAssistants ya es una lista plana
    const todosLosAsistentes = dashboard.filteredAssistants || [];
    
    // Filtrar por tipo si es necesario
    const assistentesFiltrados = tipoAMostrar
      ? todosLosAsistentes.filter(asistente => asistente.tipoAsistente === tipoAMostrar)
      : todosLosAsistentes;
    
    // Agrupar por empresa usando la misma lógica
    const empresaCounts: Record<string, number> = {};

    // 1️⃣ Contar cuántos hay por empresa
    assistentesFiltrados.forEach((a) => {
      const empresa = a.empresa?.trim() || "Sin empresa";
      empresaCounts[empresa] = (empresaCounts[empresa] || 0) + 1;
    });

    // 2️⃣ Crear grupos según la cantidad
    const agrupado: Record<string, any[]> = {};

    assistentesFiltrados.forEach((a) => {
      const empresa = a.empresa?.trim() || "Sin empresa";
      const grupo = empresaCounts[empresa] > 1 ? empresa : "Otras empresas";

      if (!agrupado[grupo]) agrupado[grupo] = [];
      agrupado[grupo].push(a);
    });

    // 🔹 Convertimos el objeto agrupado a un array para iterarlo fácilmente
    const agrupadoArray = Object.entries(agrupado).map(([empresa, asistentes]) => ({
      empresa,
      asistentes,
    }));

    return agrupadoArray;
  }, [dashboard.filteredAssistants, tipoAMostrar]);
  
  // Contar total de asistentes filtrados
  const totalAssistants = assistantsFiltrados.reduce(
    (total, group) => total + group.asistentes.length,
    0
  );

  return (
    <Tabs defaultValue="asistentes">
      <Tabs.List>
        <Tabs.Tab value="asistentes">
          {tipoUsuario
            ? tipoUsuario === "vendedor"
              ? "Compradores"
              : "Vendedores"
            : "Asistentes"}{" "}
          ({totalAssistants})
        </Tabs.Tab>

        <Tabs.Tab value="reuniones">
          Reuniones ({dashboard.acceptedMeetings.length})
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
        <AssistantsTab {...dashboard} filteredAssistants={assistantsFiltrados} />
      </Tabs.Panel>

      <Tabs.Panel value="solicitudes" pt="md">
        <RequestsTab {...dashboard} />
      </Tabs.Panel>
    </Tabs>
  );
}
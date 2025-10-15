// Dashboard/RequestsTab.tsx
"use client";

import { Tabs, Stack, Card, Text, Button, Group, Select } from "@mantine/core";
import { Assistant, Meeting } from "./types";
import { useState } from "react";

interface RequestsTabProps {
  pendingRequests: Meeting[];
  acceptedRequests: Meeting[];
  rejectedRequests: Meeting[];
  takenRequests: Meeting[];
  sentRequests: Meeting[];
  assistants: Assistant[];
  availableAsistents: Assistant[];
  updateMeetingStatus: (meetingId: string, status: string) => void;
  sendWhatsAppMessage: (participant: Assistant) => void;
  cancelSentMeeting: (meetingId: string) => void;
  changeAssistant: (participant: Assistant, slot: string, table: string) => void;
}

export default function RequestsTab({
  pendingRequests,
  acceptedRequests,
  rejectedRequests,
  sentRequests,
  takenRequests,
  assistants,
  updateMeetingStatus,
  sendWhatsAppMessage,
  cancelSentMeeting,
  changeAssistant,
  changeMeetingAssistantId,
  prepareSlotSelection,
  availableAsistents
}: RequestsTabProps) {
  // Helper para buscar usuario por id
  const findUser = (id) => assistants.find((u) => u.id === id);
  const [selectedAssistantId, setSelectedAssistantId] = useState<string | null>(null);
  const [selectedForChangeId, setSelectedForChangeId] = useState<string | null>(null);
console.log("acceptedRequests", acceptedRequests);
  return (
    <Tabs defaultValue="pendientes">
      <Tabs.List>
        <Tabs.Tab value="pendientes">
          Pendientes ({pendingRequests.length})
        </Tabs.Tab>
        <Tabs.Tab value="aceptadas">
          Aceptadas ({acceptedRequests.length})
        </Tabs.Tab>
        <Tabs.Tab value="rechazadas">
          Rechazadas ({rejectedRequests.length})
        </Tabs.Tab>
        <Tabs.Tab value="enviadas">Enviadas ({sentRequests.length})</Tabs.Tab>
        <Tabs.Tab value="taken">Otras ({takenRequests.length})</Tabs.Tab>
      </Tabs.List>

      {/* Pendientes */}
      <Tabs.Panel value="pendientes" pt="md">
        <Stack>
          {pendingRequests.length > 0 ? (
            pendingRequests.map((request) => {
              const requester = findUser(request.requesterId);
              return (
                <Card key={request.id} shadow="sm" p="lg">
                  {requester ? (
                    <>
                      <Text>
                        <strong>📛 Nombre:</strong> {requester.nombre}
                      </Text>
                      <Text size="sm">
                        🏢 <strong>Empresa:</strong> {requester.empresa}
                      </Text>
                      <Text size="sm">
                        🏷 <strong>Cargo:</strong> {requester.cargo}
                      </Text>
                      <Text size="sm">
                        📧 <strong>Correo:</strong>{" "}
                        {requester.correo || "No disponible"}
                      </Text>
                      <Text size="sm">
                        📞 <strong>Teléfono:</strong>{" "}
                        {requester.telefono || "No disponible"}
                      </Text>
                      <Text size="sm">
                        📝 <strong>Descripción:</strong>{" "}
                        {requester.descripcion || "No especificada"}
                      </Text>
                      <Text size="sm">
                        🎯 <strong>Interés Principal:</strong>{" "}
                        {requester.interesPrincipal || "No especificado"}
                      </Text>
                      <Text size="sm">
                        🔍 <strong>Necesidad:</strong>{" "}
                        {requester.necesidad || "No especificada"}
                      </Text>
                    </>
                  ) : (
                    <Text>Cargando información del solicitante...</Text>
                  )}
                  <Group mt="sm">
                    <Button
                      color="green"
                      onClick={() => prepareSlotSelection(request.id)}
                    >
                      Aceptar
                    </Button>
                    <Button
                      color="red"
                      onClick={() =>
                        updateMeetingStatus(request.id, "rejected")
                      }
                    >
                      Rechazar
                    </Button>
                    <Button
                      variant="outline"
                      color="green"
                      onClick={() =>
                        sendWhatsAppMessage(requester as Assistant)
                      }
                    >
                      Enviar WhatsApp
                    </Button>
                  </Group>
                </Card>
              );
            })
          ) : (
            <Text>No tienes solicitudes de reunión pendientes.</Text>
          )}
        </Stack>
      </Tabs.Panel>

      {/* Aceptadas */}
      <Tabs.Panel value="aceptadas" pt="md">
        <Stack>
          {acceptedRequests.length > 0 ? (
            acceptedRequests.map((request) => {
              const requester = findUser(request.requesterId);
              return (
                <Card key={request.id} shadow="sm" p="lg">
                  {requester ? (
                    <>
                      <Text>
                        <strong>📛 Nombre:</strong> {requester.nombre}
                      </Text>
                      <Text size="sm">
                        🏢 <strong>Empresa:</strong> {requester.empresa}
                      </Text>
                      <Text size="sm">
                        🏷 <strong>Cargo:</strong> {requester.cargo}
                      </Text>
                      <Text size="sm">
                        📧 <strong>Correo:</strong>{" "}
                        {requester.correo || "No disponible"}
                      </Text>
                      <Text size="sm">
                        📞 <strong>Teléfono:</strong>{" "}
                        {requester.telefono || "No disponible"}
                      </Text>
                      <Text size="sm">
                        📝 <strong>Descripción:</strong>{" "}
                        {requester.descripcion || "No especificada"}
                      </Text>
                      <Text size="sm">
                        🎯 <strong>Interés Principal:</strong>{" "}
                        {requester.interesPrincipal || "No especificado"}
                      </Text>
                      <Text size="sm">
                        🔍 <strong>Necesidad:</strong>{" "}
                        {requester.necesidad || "No especificada"}
                      </Text>
                      <Text size="sm">
                        <strong>Horario:</strong>{" "}
                        {request.timeSlot || "Por asignar"}
                      </Text>
                      <Text size="sm">
                        <strong>Mesa:</strong>{" "}
                        {request.tableAssigned || "Por asignar"}
                      </Text>
                      <Group mt="sm">
                        <Button
                          variant="outline"
                          color="green"
                          onClick={() =>{
                            changeAssistant(requester as Assistant, request.timeSlot as string, request.tableAssigned as string);
                            setSelectedAssistantId(request.id)
                          }
                          }
                        >
                          cambiar asistente
                        </Button>
                         {availableAsistents && availableAsistents.length > 0 &&  selectedAssistantId == request.id && (
    <Select
      placeholder="Selecciona asistente"
      data={availableAsistents
        .filter(a => a.nombre) // solo los que tengan nombre
        .map(a => ({
          value: a.id,
          label: a.nombre,
        }))}
        onChange={(value) => setSelectedForChangeId(value)}
      size="sm"
      style={{ width: 220 }}
    />
  )}
   { selectedForChangeId &&  selectedAssistantId == request.id &&(
  <Button
                          variant="outline"
                          color="blue"
                          onClick={() =>{
                           changeMeetingAssistantId(selectedForChangeId, request.id)
                           setSelectedAssistantId(null);
                          }
                          }
                        >
                          cambiar asistente
                        </Button>
            )}
                      </Group>
                    </>
                  ) : (
                    <Text>Cargando información del solicitante...</Text>
                  )}
                </Card>
              );
            })
          ) : (
            <Text>No tienes solicitudes aceptadas.</Text>
          )}
        </Stack>
      </Tabs.Panel>

      {/* Rechazadas */}
      <Tabs.Panel value="rechazadas" pt="md">
        <Stack>
          {rejectedRequests.length > 0 ? (
            rejectedRequests.map((request) => {
              const requester = findUser(request.requesterId);
              return (
                <Card key={request.id} shadow="sm" p="lg">
                  {requester ? (
                    <>
                      <Text>
                        <strong>📛 Nombre:</strong> {requester.nombre}
                      </Text>
                      <Text size="sm">
                        🏢 <strong>Empresa:</strong> {requester.empresa}
                      </Text>
                      <Text size="sm">
                        🏷 <strong>Cargo:</strong> {requester.cargo}
                      </Text>
                      <Text size="sm">
                        📧 <strong>Correo:</strong>{" "}
                        {requester.correo || "No disponible"}
                      </Text>
                      <Text size="sm">
                        📞 <strong>Teléfono:</strong>{" "}
                        {requester.telefono || "No disponible"}
                      </Text>
                      <Text size="sm">
                        📝 <strong>Descripción:</strong>{" "}
                        {requester.descripcion || "No especificada"}
                      </Text>
                      <Text size="sm">
                        🎯 <strong>Interés Principal:</strong>{" "}
                        {requester.interesPrincipal || "No especificado"}
                      </Text>
                      <Text size="sm">
                        🔍 <strong>Necesidad:</strong>{" "}
                        {requester.necesidad || "No especificada"}
                      </Text>
                      <Text size="sm" color="red">
                        <strong>Esta solicitud fue rechazada.</strong>
                      </Text>
                    </>
                  ) : (
                    <Text>Cargando información del solicitante...</Text>
                  )}
                </Card>
              );
            })
          ) : (
            <Text>No tienes solicitudes rechazadas.</Text>
          )}
        </Stack>
      </Tabs.Panel>

      {/* Enviadas */}
      <Tabs.Panel value="enviadas" pt="md">
        <Stack>
          {sentRequests.length > 0 ? (
            sentRequests.map((request) => {
              const receiver = findUser(request.receiverId);
              return (
                <Card key={request.id} shadow="sm" p="lg">
                  {receiver ? (
                    <>
                      <Text>
                        <strong>📛 Nombre:</strong> {receiver.nombre}
                      </Text>
                      <Text size="sm">
                        🏢 <strong>Empresa:</strong> {receiver.empresa}
                      </Text>
                      <Text size="sm">
                        🏷 <strong>Cargo:</strong> {receiver.cargo}
                      </Text>
                      <Text size="sm">
                        📧 <strong>Correo:</strong>{" "}
                        {receiver.correo || "No disponible"}
                      </Text>
                      <Text size="sm">
                        📞 <strong>Teléfono:</strong>{" "}
                        {receiver.telefono || "No disponible"}
                      </Text>
                      <Text size="sm" color="blue">
                        <strong>Estado:</strong> Pendiente
                      </Text>
                      {request.status === "pending" && (
                        <Group mt="sm">
                          <Button
                            color="red"
                            variant="outline"
                            onClick={() =>
                              cancelSentMeeting(request.id, "cancel")
                            }
                          >
                            Cancelar solicitud
                          </Button>
                          {/* Si quieres mostrar eliminar también:
                    <Button
                      color="red"
                      variant="light"
                      onClick={() => cancelSentMeeting(request.id, "delete")}
                    >
                      Eliminar solicitud
                    </Button>
                    */}
                        </Group>
                      )}
                    </>
                  ) : (
                    <Text>Cargando información del receptor...</Text>
                  )}
                </Card>
              );
            })
          ) : (
            <Text>No tienes solicitudes enviadas pendientes.</Text>
          )}
        </Stack>
      </Tabs.Panel>
      <Tabs.Panel value="taken" pt="md">
        <Stack>
          {takenRequests.length > 0 ? (
            takenRequests.map((request) => {
              const requester = findUser(request.requesterId);
              return (
                <Card key={request.id} shadow="sm" p="lg">
                  {requester ? (
                    <>
                      <Text>
                        <strong>📛 Nombre:</strong> {requester.nombre}
                      </Text>
                      <Text size="sm">
                        🏢 <strong>Empresa:</strong> {requester.empresa}
                      </Text>
                      <Text size="sm">
                        🏷 <strong>Cargo:</strong> {requester.cargo}
                      </Text>
                      <Text size="sm">
                        📧 <strong>Correo:</strong>{" "}
                        {requester.correo || "No disponible"}
                      </Text>
                      <Text size="sm">
                        📞 <strong>Teléfono:</strong>{" "}
                        {requester.telefono || "No disponible"}
                      </Text>
                      <Text size="sm">
                        📝 <strong>Descripción:</strong>{" "}
                        {requester.descripcion || "No especificada"}
                      </Text>
                      <Text size="sm">
                        🎯 <strong>Interés Principal:</strong>{" "}
                        {requester.interesPrincipal || "No especificado"}
                      </Text>
                      <Text size="sm">
                        🔍 <strong>Necesidad:</strong>{" "}
                        {requester.necesidad || "No especificada"}
                      </Text>
                      <Text size="sm" color="blue">
                        <strong>Esta solicitud fue tomada por otro asistente de tu empresa.</strong>
                      </Text>
                    </>
                  ) : (
                    <Text>Cargando información del solicitante...</Text>
                  )}
                </Card>
              );
            })
          ) : (
            <Text>No tienes solicitudes</Text>
          )}
        </Stack>
      </Tabs.Panel>
    </Tabs>
  );
}

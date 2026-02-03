import React, { useState } from "react";
import {
  Textarea,
  Button,
  Stack,
  Card,
  Group,
  Avatar,
  Title,
  Text,
  Divider,
  ScrollArea,
  Loader,
  Center,
  Accordion,
  Badge,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";

export default function ChatbotTab({
  filteredAssistants = [],
  products = [],
  sendMeetingRequest,
  solicitarReunionHabilitado,
  setAvatarModalOpened,
  setSelectedImage,
  currentUser,
  eventId,
}) {
  const [input, setInput] = useState("");
  // Mensaje de saludo inicial
  const initialGreeting = { from: "ai", text: "¡Hola! Soy tu asistente virtual. Puedes preguntarme por empresas, asistentes o productos del evento." };
  const [messages, setMessages] = useState([initialGreeting]);
  const [results, setResults] = useState({ assistants: [], products: [], companies: [] });
  const [loading, setLoading] = useState(false);

  const proxyUrl = import.meta.env.VITE_AI_PROXY_URL || "/api/ai/proxy";

  const send = async () => {
    if (!input.trim()) return;
    const msg = input.trim();
    setMessages((m) => [...m, { from: "user", text: msg }]);
    setInput("");
    setLoading(true);

    try {
        console
      const resp = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUser?.uid, eventId: currentUser.data.eventId, message: msg, descripcion: currentUser.data.descripcion,
      necesidad: currentUser.data.necesidad
      ,interesPrincipal: currentUser.data.interesPrincipal
      , tipoAsistente: currentUser.data.tipoAsistente}),
      });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(t || "AI request failed");
      }
      const j = await resp.json();
      // Log full AI response for debugging
      console.log("AI response:", j);
      if (j.aiRaw) console.log("AI raw:", j.aiRaw);

      const aiText = j.message || `Encontré ${j.results.assistants.length} asistentes, ${j.results.products.length} productos y ${j.results.companies.length} empresas.`;
      setMessages((m) => [...m, { from: "ai", text: aiText }]);
      setResults(j.results || { assistants: [], products: [], companies: [] });
    } catch (e) {
      console.error(e);
      showNotification({ title: "Error", message: "No se pudo procesar la consulta AI", color: "red" });
    } finally {
      setLoading(false);
    }
  };

  const handleRequestMeeting = async (assistant) => {
    try {
      await sendMeetingRequest(assistant.id, assistant.telefono);
      showNotification({ title: "Solicitud enviada", message: `Solicitud enviada a ${assistant.nombre}`, color: "teal" });
    } catch (e) {
      showNotification({ title: "Error", message: "No se pudo enviar la solicitud.", color: "red" });
    }
  };

  return (
    <Stack spacing="md">
      <Card p="md" shadow="sm" radius="md" style={{ height: 420, display: 'flex', flexDirection: 'column' }}>
        <Title order={5} mb="sm">Chat</Title>
        <Divider mb="sm" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <ScrollArea style={{ flex: 1, minHeight: 0, marginBottom: 8 }} offsetScrollbars>
            <Stack>
              {messages.map((m, i) => (
                <div key={i} style={{
                  display: 'flex',
                  justifyContent: m.from === 'user' ? 'flex-end' : 'flex-start',
                  width: '100%'
                }}>
                  <Card
                    radius="md"
                    shadow="xs"
                    bg={m.from === "user" ? "blue.2" : "gray.0"}
                    px="md"
                    py={4}
                    style={{
                      maxWidth: 350,
                      backgroundColor: m.from === 'user' ? '#e3f0ff' : undefined,
                      color: m.from === 'user' ? '#1864ab' : undefined,
                      marginLeft: m.from === 'user' ? 'auto' : 0,
                      marginRight: m.from === 'user' ? 0 : 'auto',
                    }}
                  >
                    <Text size="sm" c={m.from === "user" ? "blue.8" : "gray.8"}>{m.text}</Text>
                  </Card>
                </div>
              ))}
              {loading && (
                <Center py="sm">
                  <Loader size="sm" color="green" />
                </Center>
              )}
            </Stack>
          </ScrollArea>
          <Group align="flex-end" noWrap mt={4} style={{ borderTop: '1px solid #eee', paddingTop: 8 }}>
            <Textarea
              placeholder="Escribe tu mensaje..."
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              minRows={1}
              autosize
              style={{ flex: 1 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <Button onClick={send} loading={loading} color="blue" radius="md" style={{ minWidth: 80 }}>
              Enviar
            </Button>
          </Group>
        </div>
      </Card>

      <Card p="md" shadow="sm" radius="md">
        <Title order={6}>Resultados</Title>
        <Divider my="sm" />
        {loading && (
          <Center py="sm">
            <Loader size="md" color="green" />
          </Center>
        )}

        {/* Mensaje resumen de resultados */}
        {results.assistants.length + results.products.length + results.companies.length > 0 && (
          <Text mb="sm" fw={500}>
            Se encontró: {
              [
                results.assistants.length > 0 ? `${results.assistants.length} asistente${results.assistants.length > 1 ? 's' : ''}` : null,
                results.products.length > 0 ? `${results.products.length} producto${results.products.length > 1 ? 's' : ''}` : null,
                results.companies.length > 0 ? `${results.companies.length} empresa${results.companies.length > 1 ? 's' : ''}` : null
              ].filter(Boolean).join(' y ')
            }
          </Text>
        )}

        {results.assistants.length > 0 && (
          <>
            <Title order={6}>Asistentes</Title>
            <Stack>
              {results.assistants.map((a) => (
                <Card key={a.id} withBorder shadow="xs" radius="md" p="sm">
                  <Group position="apart" align="flex-start">
                    <Group align="flex-start" spacing="xs">
                      <Avatar src={a.photoURL} alt={a.nombre} radius="xl" size="md" />
                      <div>
                        <Text fw={600}>{a.nombre}</Text>
                        <Text size="xs" c="dimmed">{a.empresa}{a.cargo ? ` — ${a.cargo}` : ''}</Text>
                        {a.tipoAsistente && <Text size="xs" c="dimmed">Tipo: {a.tipoAsistente}</Text>}
                        {a.correo && <Text size="xs" c="dimmed">Email: <a href={`mailto:${a.correo}`}>{a.correo}</a></Text>}
                        {a.telefono && <Text size="xs" c="dimmed">Tel: <a href={`tel:${a.telefono}`}>{a.telefono}</a></Text>}
                        {a.necesidad && <Text size="xs" c="dimmed">Necesidad: {a.necesidad}</Text>}
                        {a.interesPrincipal && <Text size="xs" c="dimmed">Interés: {a.interesPrincipal}</Text>}
                      </div>
                    </Group>
                    <Button
                      size="xs"
                      onClick={() => handleRequestMeeting(a)}
                      disabled={!solicitarReunionHabilitado}
                      variant="light"
                      color="green"
                      radius="md"
                    >
                      {solicitarReunionHabilitado ? "Solicitar reunión" : "Solicitudes deshabilitadas"}
                    </Button>
                  </Group>
                </Card>
              ))}
            </Stack>
          </>
        )}

        {results.products.length > 0 && (
          <>
            <Title order={6} mt="sm">Productos</Title>
            <Stack>
              {results.products.map((p) => (
                <Card key={p.id} withBorder shadow="xs" radius="md" p="sm">
                  <Group position="apart" align="flex-start">
                    <Group align="flex-start" spacing="xs" noWrap>
                      {p.imageUrl && (
                        <img src={p.imageUrl} alt={p.title || p.name} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8 }} />
                      )}
                      <div>
                        <Text fw={600}>{p.title || p.name}</Text>
                        {p.category && <Text size="xs" c="dimmed">Categoría: {p.category}</Text>}
                        {p.description && <Text size="xs" c="dimmed">{p.description}</Text>}
                        {p.ownerCompany && <Text size="xs" c="dimmed">Empresa: {p.ownerCompany}</Text>}
                        {p.ownerName && <Text size="xs" c="dimmed">Responsable: {p.ownerName}</Text>}
                        {p.ownerPhone && <Text size="xs" c="dimmed">Tel: <a href={`tel:${p.ownerPhone}`}>{p.ownerPhone}</a></Text>}
                      </div>
                    </Group>
                    <Button size="xs" onClick={async () => {
                      try {
                        await sendMeetingRequest(p.ownerUserId, p.ownerPhone || "");
                        showNotification({ title: "Solicitud enviada", message: `Solicitud enviada al responsable`, color: "teal" });
                      } catch (e) {
                        showNotification({ title: "Error", message: "No se pudo enviar la solicitud.", color: "red" });
                      }
                    }} disabled={!solicitarReunionHabilitado || !p.ownerUserId} variant="light" color="green" radius="md">Solicitar reunión</Button>
                  </Group>
                </Card>
              ))}
            </Stack>
          </>
        )}

        {results.companies.length > 0 && (
          <>
            <Title order={6} mt="sm">Empresas</Title>
            <Stack>
              {results.companies.map((c, idx) => (
                <Card key={idx} withBorder shadow="xs" radius="md" p="sm">
                  <Group position="apart" align="flex-start">
                    <Group align="flex-start" spacing="xs" noWrap>
                      {c.logoUrl && (
                        <img src={c.logoUrl} alt={c.empresa || c.razonSocial || c.company_razonSocial} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8 }} />
                      )}
                      <div>
                        <Text fw={600}>{c.empresa || c.razonSocial || c.company_razonSocial}</Text>
                        {c.nitNorm && <Text size="xs" c="dimmed">NIT: {c.nitNorm}</Text>}
                        {c.descripcion && <Text size="xs" c="dimmed">{c.descripcion}</Text>}
                        {c.custom_por_favor_indique_el_tama_2641 && <Text size="xs" c="dimmed">Tamaño: {c.custom_por_favor_indique_el_tama_2641}</Text>}
                        {c.custom_nmero_de_empleados_6775 && <Text size="xs" c="dimmed">Empleados: {c.custom_nmero_de_empleados_6775}</Text>}
                      </div>
                    </Group>
                  </Group>
                  {Array.isArray(c.assistants) && c.assistants.length > 0 && (
                    <Accordion variant="contained" mt="sm">
                      {c.assistants.map((a, aidx) => (
                        <Accordion.Item value={`asistente-${a.id || aidx}`} key={a.id || aidx}>
                          <Accordion.Control>
                            <Group>
                              <Avatar size={32} src={a.fotoUrl || undefined} radius="xl" />
                              <Text fw={500}>{a.nombre}</Text>
                              {a.cargo && <Badge color="blue" size="xs">{a.cargo}</Badge>}
                            </Group>
                          </Accordion.Control>
                          <Accordion.Panel>
                            <Stack gap={2}>
                              {a.email && <Text size="sm"><b>Email:</b> {a.email}</Text>}
                              {a.telefono && <Text size="sm"><b>Teléfono:</b> {a.telefono}</Text>}
                              {a.cargo && <Text size="sm"><b>Cargo:</b> {a.cargo}</Text>}
                              {a.descripcion && <Text size="sm"><b>Descripción:</b> {a.descripcion}</Text>}
                              {a.necesidad && <Text size="sm"><b>Necesidad:</b> {a.necesidad}</Text>}
                              {a.interesPrincipal && <Text size="sm"><b>Interés principal:</b> {a.interesPrincipal}</Text>}
                              {a.tipoAsistente && <Text size="sm"><b>Tipo:</b> {a.tipoAsistente}</Text>}
                              {a.empresa && <Text size="sm"><b>Empresa:</b> {a.empresa}</Text>}
                              <Button size="xs" mt={4} color="green" radius="md" disabled={!solicitarReunionHabilitado} onClick={() => handleRequestMeeting(a)}>
                                Solicitar reunión
                              </Button>
                            </Stack>
                          </Accordion.Panel>
                        </Accordion.Item>
                      ))}
                    </Accordion>
                  )}
                </Card>
              ))}
            </Stack>
          </>
        )}

        {results.assistants.length === 0 && results.products.length === 0 && results.companies.length === 0 && (
          <Text c="dimmed">No hay resultados aún. Envía una consulta para que la IA busque.</Text>
        )}
      </Card>
    </Stack>
  );
}

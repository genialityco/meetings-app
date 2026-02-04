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
  Grid,
  Accordion,
  Badge,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";

export default function ChatbotTab({
  products = [],
  sendMeetingRequest,
  solicitarReunionHabilitado,
  setAvatarModalOpened,
  setSelectedImage,
  currentUser,
  eventId,
}: any) {
  const [input, setInput] = useState("");
  // Mensaje de saludo inicial
  const initialGreeting = { from: "ai", text: "¡Hola! Soy tu asistente virtual. Puedes preguntarme por empresas, asistentes o productos del evento." };
  const [messages, setMessages] = useState([initialGreeting]);
  const [results, setResults] = useState({ assistants: [], products: [], companies: [] });
  const [loading, setLoading] = useState(false);

  const proxyUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_AI_PROXY_URL) ? import.meta.env.VITE_AI_PROXY_URL : "/api/ai/proxy";

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
      , tipoAsistente: currentUser.data.tipoAsistente, companyNit: currentUser.data.company_nit}),
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

  const handleRequestMeeting = async (assistant: any) => {
    try {
      await sendMeetingRequest(assistant.id, assistant.telefono);
      if (typeof showNotification === 'function') {
        showNotification({ title: "Solicitud enviada", message: `Solicitud enviada a ${assistant.nombre}`, color: "teal" });
      }
    } catch (e) {
      if (typeof showNotification === 'function') {
        showNotification({ title: "Error", message: "No se pudo enviar la solicitud.", color: "red" });
      }
    }
  };

  return (
    <Stack>
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
          <Group align="flex-end" mt={4} style={{ borderTop: '1px solid #eee', paddingTop: 8 }}>
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
            <Button onClick={send} loading={loading} radius="md" style={{ minWidth: 80, background: 'rgb(68, 199, 142)', color: '#fff' }}>
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
              {(results.assistants as any[]).map((a: any, idx: number) => (
                <Card key={a.id || idx} shadow="sm" p="lg" withBorder radius="md" style={{ display: 'flex', flexDirection: 'column', minHeight: 220 }}>
                  <Group justify="center" mb="md">
                    <Avatar src={a.fotoUrl || a.photoURL} alt={a.nombre} radius="xl" size={56} style={{ cursor: 'pointer' }}>
                      {!a.fotoUrl && !a.photoURL && a.nombre && a.nombre[0]}
                    </Avatar>
                  </Group>
                  <Title order={5} mb={4} style={{ textAlign: 'center' }}>{a.nombre}</Title>
                  <Stack gap={2} style={{ flex: 1, minHeight: 0, marginBottom: 8 }}>
                    {a.cargo && <Text size="sm">🏷 <b>Cargo:</b> {a.cargo}</Text>}
                    {a.empresa && <Text size="sm">🏢 <b>Empresa:</b> {a.empresa}</Text>}
                    {a.email && <Text size="sm">📧 <b>Email:</b> {a.email}</Text>}
                    {a.telefono && <Text size="sm">📞 <b>Tel:</b> {a.telefono}</Text>}
                    {a.descripcion && <Text size="sm">📝 <b>Descripción:</b> {a.descripcion}</Text>}
                    {a.necesidad && <Text size="sm">🎯 <b>Necesidad:</b> {a.necesidad}</Text>}
                    {a.interesPrincipal && <Text size="sm">🔍 <b>Interés:</b> {a.interesPrincipal}</Text>}
                  </Stack>
                  <Button size="xs" fullWidth mt={8} radius="md" disabled={!solicitarReunionHabilitado} onClick={() => handleRequestMeeting(a)} style={{ background: 'rgb(68, 199, 142)', color: '#fff' }}>
                    Solicitar reunión
                  </Button>
                </Card>
              ))}
            </Stack>
          </>
        )}

        {results.products.length > 0 && (
          <>
            <Title order={6} mt="sm">Productos</Title>
            <Grid gutter={16}>
              {(results.products as any[]).map((p: any, idx: number) => (
                <Grid.Col key={p.id || idx} span={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                  <Card shadow="sm" p="lg" withBorder radius="md" style={{ display: 'flex', flexDirection: 'column', minHeight: 220 }}>
                    <Group justify="center" mb="md">
                      {p.imageUrl ? (
                        <Avatar src={p.imageUrl} alt={p.title || p.name} size={56} radius="md" />
                      ) : (
                        <Avatar size={56} radius="md" color="blue">{(p.title || p.name || 'P')[0]}</Avatar>
                      )}
                    </Group>
                    <Title order={5} mb={4} style={{ textAlign: 'center' }}>{p.title || p.name}</Title>
                    <Stack gap={2} style={{ flex: 1, minHeight: 0, marginBottom: 8 }}>
                      {p.category && <Text size="sm">🏷 <b>Categoría:</b> {p.category}</Text>}
                      {p.description && <Text size="sm">📝 <b>Descripción:</b> {p.description}</Text>}
                      {p.ownerCompany && <Text size="sm">🏢 <b>Empresa:</b> {p.ownerCompany}</Text>}
                      {p.ownerName && <Text size="sm">👤 <b>Responsable:</b> {p.ownerName}</Text>}
                      {p.ownerPhone && <Text size="sm">📞 <b>Tel:</b> <a href={`tel:${p.ownerPhone}`}>{p.ownerPhone}</a></Text>}
                    </Stack>
                    <Button size="xs" fullWidth mt={8} radius="md" onClick={async () => {
                      try {
                        await sendMeetingRequest(p.ownerUserId, p.ownerPhone || "");
                        showNotification({ title: "Solicitud enviada", message: `Solicitud enviada al responsable`, color: "teal" });
                      } catch (e) {
                        showNotification({ title: "Error", message: "No se pudo enviar la solicitud.", color: "red" });
                      }
                    }} disabled={!solicitarReunionHabilitado || !p.ownerUserId} style={{ background: 'rgb(68, 199, 142)', color: '#fff' }}>Solicitar reunión</Button>
                  </Card>
                </Grid.Col>
              ))}
            </Grid>
          </>
        )}

        {results.companies.length > 0 && (
          <>
            <Title order={6} mt="sm">Empresas</Title>
            <Grid gutter={16}>
              {(results.companies as any[]).map((c: any, idx: number) => (
                <Grid.Col key={idx} span={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                  <Card shadow="sm" p="lg" withBorder radius="md" style={{ display: 'flex', flexDirection: 'column', minHeight: 220 }}>
                    <Group justify="space-between" mb="md">
                      <Group gap="sm">
                        {c.logoUrl ? (
                          <Avatar src={c.logoUrl} alt={c.empresa || c.razonSocial || c.company_razonSocial} size={48} radius="md" />
                        ) : (
                          <Avatar size={48} radius="md" color="blue">{(c.empresa || c.razonSocial || c.company_razonSocial || 'E')[0]}</Avatar>
                        )}
                        <div style={{ flex: 1 }}>
                          <Title order={6} mb={4} style={{ textAlign: 'left' }}>{c.empresa || c.razonSocial || c.company_razonSocial}</Title>
                          {c.custom_nmero_de_empleados_6775 && <Text size="xs" c="dimmed">Empleados: {c.custom_nmero_de_empleados_6775}</Text>}
                        </div>
                      </Group>
                    </Group>
                    {Array.isArray(c.assistants) && c.assistants.length > 0 && (
                      <Accordion variant="contained" mt="sm">
                        {(c.assistants as any[]).map((a: any, aidx: number) => (
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
                                <Button size="xs" mt={8} fullWidth radius="md" disabled={!solicitarReunionHabilitado} onClick={() => handleRequestMeeting(a)} style={{ background: 'rgb(68, 199, 142)', color: '#fff' }}>
                                  Solicitar reunión
                                </Button>
                              </Stack>
                            </Accordion.Panel>
                          </Accordion.Item>
                        ))}
                      </Accordion>
                    )}
                  </Card>
                </Grid.Col>
              ))}
            </Grid>
          </>
        )}

        {results.assistants.length === 0 && results.products.length === 0 && results.companies.length === 0 && (
          <Text c="dimmed">No hay resultados aún. Envía una consulta para que la IA busque.</Text>
        )}
      </Card>
    </Stack>
  );
}

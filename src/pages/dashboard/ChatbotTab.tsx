import { useState, useRef, useEffect } from "react";
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
  Grid,
  Accordion,
  Badge,
  Box,
  Collapse,
  ActionIcon,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import {
  IconSend,
  IconUsers,
  IconPackage,
  IconBuilding,
  IconCalendarEvent,
  IconChevronDown,
  IconChevronUp,
} from "@tabler/icons-react";

interface ChatMessage {
  from: "user" | "ai";
  text: string;
  results?: {
    assistants: any[];
    products: any[];
    companies: any[];
    meetings: any[];
  };
}

export default function ChatbotTab({
  sendMeetingRequest,
  solicitarReunionHabilitado,
  currentUser,
  eventId,
}: {
  sendMeetingRequest: (userId: string, phone: string) => Promise<void>;
  solicitarReunionHabilitado: boolean;
  currentUser: any;
  eventId?: string;
}) {
  const [input, setInput] = useState("");
  const initialGreeting: ChatMessage = {
    from: "ai",
    text: "Soy tu asistente virtual. Puedes preguntarme por empresas, asistentes o productos del evento.",
  };
  const [messages, setMessages] = useState<ChatMessage[]>([initialGreeting]);
  const [loading, setLoading] = useState(false);
  const [expandedResults, setExpandedResults] = useState<Record<number, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const proxyUrl =
    typeof import.meta !== "undefined" && import.meta.env?.VITE_AI_PROXY_URL
      ? import.meta.env.VITE_AI_PROXY_URL
      : "/api/ai/proxy";

  // Auto-scroll al final cuando cambian los mensajes o loading
  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTo({
        top: viewportRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages, loading]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setMessages((m) => [...m, { from: "user", text: msg }]);
    setInput("");
    setLoading(true);

    try {
      console.log("[Chatbot] URL:", proxyUrl, "| eventId:", eventId || currentUser?.data?.eventId);
      const resp = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: currentUser?.uid,
          eventId: eventId || currentUser?.data?.eventId,
          message: msg,
          descripcion: currentUser?.data?.descripcion,
          necesidad: currentUser?.data?.necesidad,
          interesPrincipal: currentUser?.data?.interesPrincipal,
          tipoAsistente: currentUser?.data?.tipoAsistente,
          companyNit: currentUser?.data?.company_nit,
        }),
      });

      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(t || "AI request failed");
      }

      const j = await resp.json();
      console.log("[Chatbot] Response:", JSON.stringify({
        intent: j.intent,
        message: j.message?.substring(0, 100),
        assistants: j.results?.assistants?.length ?? 0,
        products: j.results?.products?.length ?? 0,
        companies: j.results?.companies?.length ?? 0,
        meetings: j.results?.meetings?.length ?? 0,
      }));
      const aiResults = j.results || { assistants: [], products: [], companies: [], meetings: [] };
      const hasResults =
        aiResults.assistants.length +
          aiResults.products.length +
          aiResults.companies.length +
          (aiResults.meetings?.length || 0) >
        0;

      const aiText =
        j.message ||
        (hasResults
          ? `Encontre ${aiResults.assistants.length} asistentes, ${aiResults.products.length} productos y ${aiResults.companies.length} empresas.`
          : "No encontre resultados para tu consulta.");

      const aiMessage: ChatMessage = {
        from: "ai",
        text: aiText,
        results: hasResults ? aiResults : undefined,
      };
      setMessages((m) => [...m, aiMessage]);
      // Auto-expandir resultados del último mensaje
      setExpandedResults((prev) => ({ ...prev, [messages.length + 1]: true }));
    } catch (e: any) {
      console.error("ChatbotTab send error:", e);
      setMessages((m) => [
        ...m,
        { from: "ai", text: "No se pudo procesar la consulta. Intenta de nuevo." },
      ]);
      showNotification({ title: "Error", message: "No se pudo conectar con el asistente", color: "red" });
    } finally {
      setLoading(false);
    }
  };

  const handleRequestMeeting = async (person: any) => {
    try {
      await sendMeetingRequest(person.id, person.telefono || "");
      showNotification({
        title: "Solicitud enviada",
        message: `Solicitud enviada a ${person.nombre}`,
        color: "teal",
      });
    } catch {
      showNotification({ title: "Error", message: "No se pudo enviar la solicitud.", color: "red" });
    }
  };

  const toggleResults = (msgIndex: number) => {
    setExpandedResults((prev) => ({ ...prev, [msgIndex]: !prev[msgIndex] }));
  };

  const resultCount = (r: ChatMessage["results"]) => {
    if (!r) return 0;
    return r.assistants.length + r.products.length + r.companies.length + (r.meetings?.length || 0);
  };

  // ── Render helpers ───────────────────────────────

  const renderAssistantCard = (a: any) => (
    <Card key={a.id} shadow="xs" p="sm" withBorder radius="md">
      <Group gap="sm" mb={6}>
        <Avatar src={a.fotoUrl || a.photoURL} radius="xl" size={40}>
          {(a.nombre || "?")[0]}
        </Avatar>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600} size="sm" lineClamp={1}>{a.nombre}</Text>
          {a.cargo && <Text size="xs" c="dimmed" lineClamp={1}>{a.cargo}</Text>}
        </div>
      </Group>
      {a.empresa && <Text size="xs"><b>Empresa:</b> {a.empresa}</Text>}
      {a.descripcion && <Text size="xs" c="dimmed" lineClamp={2}>{a.descripcion}</Text>}
      <Button
        size="compact-xs"
        fullWidth
        mt={8}
        radius="md"
        variant="filled"
        disabled={!solicitarReunionHabilitado}
        onClick={() => handleRequestMeeting(a)}
      >
        Solicitar reunion
      </Button>
    </Card>
  );

  const renderProductCard = (p: any) => (
    <Card key={p.id} shadow="xs" p="sm" withBorder radius="md">
      <Group gap="sm" mb={6}>
        <Avatar src={p.imageUrl} radius="md" size={40} color="blue">
          {(p.title || "P")[0]}
        </Avatar>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600} size="sm" lineClamp={1}>{p.title || p.name}</Text>
          {p.category && <Badge size="xs" variant="light">{p.category}</Badge>}
        </div>
      </Group>
      {p.description && <Text size="xs" c="dimmed" lineClamp={2}>{p.description}</Text>}
      {p.ownerCompany && <Text size="xs"><b>Empresa:</b> {p.ownerCompany}</Text>}
      <Button
        size="compact-xs"
        fullWidth
        mt={8}
        radius="md"
        variant="filled"
        disabled={!solicitarReunionHabilitado || !p.ownerUserId}
        onClick={async () => {
          try {
            await sendMeetingRequest(p.ownerUserId, p.ownerPhone || "");
            showNotification({ title: "Solicitud enviada", message: "Solicitud enviada al responsable", color: "teal" });
          } catch {
            showNotification({ title: "Error", message: "No se pudo enviar la solicitud.", color: "red" });
          }
        }}
      >
        Solicitar reunion
      </Button>
    </Card>
  );

  const renderCompanyCard = (c: any, idx: number) => (
    <Card key={c.id || idx} shadow="xs" p="sm" withBorder radius="md">
      <Group gap="sm" mb={6}>
        <Avatar src={c.logoUrl} radius="md" size={40} color="blue">
          {(c.razonSocial || c.empresa || "E")[0]}
        </Avatar>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600} size="sm" lineClamp={1}>
            {c.razonSocial || c.empresa || c.company_razonSocial}
          </Text>
          {c.descripcion && <Text size="xs" c="dimmed" lineClamp={1}>{c.descripcion}</Text>}
        </div>
      </Group>
      {Array.isArray(c.assistants) && c.assistants.length > 0 && (
        <Accordion variant="separated" size="xs" mt={4}>
          <Accordion.Item value="reps">
            <Accordion.Control>
              <Text size="xs">{c.assistants.length} representante{c.assistants.length > 1 ? "s" : ""}</Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap={4}>
                {c.assistants.map((a: any, aidx: number) => (
                  <Group key={a.id || aidx} gap="xs" justify="space-between">
                    <Group gap="xs">
                      <Avatar size={24} src={a.fotoUrl} radius="xl" />
                      <Text size="xs">{a.nombre}</Text>
                    </Group>
                    <Button
                      size="compact-xs"
                      variant="light"
                      radius="md"
                      disabled={!solicitarReunionHabilitado}
                      onClick={() => handleRequestMeeting(a)}
                    >
                      Reunion
                    </Button>
                  </Group>
                ))}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
    </Card>
  );

  const renderMeetingCard = (m: any) => {
    const statusColors: Record<string, string> = {
      pending: "yellow",
      accepted: "green",
      rejected: "red",
    };
    const statusLabels: Record<string, string> = {
      pending: "Pendiente",
      accepted: "Aceptada",
      rejected: "Rechazada",
    };
    return (
      <Card key={m.id} shadow="xs" p="sm" withBorder radius="md">
        <Group gap="sm" justify="space-between" mb={4}>
          <Group gap="xs">
            <Avatar size={32} radius="xl" src={m.counterpart?.photoURL}>
              {(m.counterpart?.nombre || "?")[0]}
            </Avatar>
            <div>
              <Text fw={600} size="sm">{m.counterpart?.nombre || "Sin nombre"}</Text>
              <Text size="xs" c="dimmed">{m.counterpart?.empresa || ""}</Text>
            </div>
          </Group>
          <Badge size="sm" color={statusColors[m.status] || "gray"}>
            {statusLabels[m.status] || m.status}
          </Badge>
        </Group>
        {m.status === "accepted" && m.timeSlot && (
          <Text size="xs"><b>Horario:</b> {m.timeSlot}</Text>
        )}
        {m.status === "accepted" && m.tableAssigned && (
          <Text size="xs"><b>Mesa:</b> {m.tableAssigned}</Text>
        )}
        <Text size="xs" c="dimmed">
          {m.isRequester ? "Tu enviaste la solicitud" : "Te enviaron la solicitud"}
        </Text>
      </Card>
    );
  };

  const renderResultsInline = (results: ChatMessage["results"], msgIndex: number) => {
    if (!results) return null;
    const total = resultCount(results);
    if (total === 0) return null;

    const isExpanded = expandedResults[msgIndex] ?? false;

    return (
      <Box mt={8}>
        <Button
          variant="subtle"
          size="compact-xs"
          onClick={() => toggleResults(msgIndex)}
          rightSection={isExpanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          fullWidth
          justify="space-between"
        >
          {total} resultado{total > 1 ? "s" : ""} encontrado{total > 1 ? "s" : ""}
        </Button>

        <Collapse in={isExpanded}>
          <Stack gap="sm" mt={8}>
            {results.assistants.length > 0 && (
              <>
                <Group gap={4}>
                  <IconUsers size={14} />
                  <Text size="xs" fw={600}>Asistentes ({results.assistants.length})</Text>
                </Group>
                <Grid gutter={8}>
                  {results.assistants.map((a: any) => (
                    <Grid.Col key={a.id} span={{ xs: 12, sm: 6 }}>{renderAssistantCard(a)}</Grid.Col>
                  ))}
                </Grid>
              </>
            )}

            {results.products.length > 0 && (
              <>
                <Group gap={4}>
                  <IconPackage size={14} />
                  <Text size="xs" fw={600}>Productos ({results.products.length})</Text>
                </Group>
                <Grid gutter={8}>
                  {results.products.map((p: any) => (
                    <Grid.Col key={p.id} span={{ xs: 12, sm: 6 }}>{renderProductCard(p)}</Grid.Col>
                  ))}
                </Grid>
              </>
            )}

            {results.companies.length > 0 && (
              <>
                <Group gap={4}>
                  <IconBuilding size={14} />
                  <Text size="xs" fw={600}>Empresas ({results.companies.length})</Text>
                </Group>
                <Grid gutter={8}>
                  {results.companies.map((c: any, idx: number) => (
                    <Grid.Col key={c.id || idx} span={{ xs: 12, sm: 6 }}>{renderCompanyCard(c, idx)}</Grid.Col>
                  ))}
                </Grid>
              </>
            )}

            {results.meetings && results.meetings.length > 0 && (
              <>
                <Group gap={4}>
                  <IconCalendarEvent size={14} />
                  <Text size="xs" fw={600}>Reuniones ({results.meetings.length})</Text>
                </Group>
                <Grid gutter={8}>
                  {results.meetings.map((m: any) => (
                    <Grid.Col key={m.id} span={{ xs: 12, sm: 6 }}>{renderMeetingCard(m)}</Grid.Col>
                  ))}
                </Grid>
              </>
            )}
          </Stack>
        </Collapse>
      </Box>
    );
  };

  // ── Main render ──────────────────────────────────

  return (
    <Card
      p="md"
      shadow="sm"
      radius="md"
      style={{
        height: "calc(100vh - 200px)",
        minHeight: 400,
        maxHeight: 800,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Title order={5} mb="xs">Asistente IA</Title>
      <Divider mb="xs" />

      <ScrollArea
        style={{ flex: 1, minHeight: 0 }}
        offsetScrollbars
        viewportRef={viewportRef}
      >
        <Stack gap="sm" ref={scrollRef} pb="xs">
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: m.from === "user" ? "flex-end" : "flex-start",
                width: "100%",
              }}
            >
              <Box
                style={{
                  maxWidth: "80%",
                  minWidth: m.results ? "70%" : undefined,
                }}
              >
                <Card
                  radius="md"
                  shadow="xs"
                  px="md"
                  py={6}
                  bg={m.from === "user" ? "var(--mantine-primary-color-light)" : "gray.0"}
                >
                  <Text
                    size="sm"
                    c={m.from === "user" ? "var(--mantine-primary-color-filled)" : "dark"}
                    style={{ whiteSpace: "pre-wrap" }}
                  >
                    {m.text}
                  </Text>
                </Card>
                {m.from === "ai" && m.results && renderResultsInline(m.results, i)}
              </Box>
            </div>
          ))}

          {loading && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <Card radius="md" shadow="xs" px="md" py={8} bg="gray.0" w={70}>
                <Group gap={4} justify="center">
                  <Box
                    style={{
                      width: 6, height: 6, borderRadius: "50%",
                      backgroundColor: "var(--mantine-color-gray-5)",
                      animation: "chatDot 1.4s infinite ease-in-out both",
                      animationDelay: "0s",
                    }}
                  />
                  <Box
                    style={{
                      width: 6, height: 6, borderRadius: "50%",
                      backgroundColor: "var(--mantine-color-gray-5)",
                      animation: "chatDot 1.4s infinite ease-in-out both",
                      animationDelay: "0.2s",
                    }}
                  />
                  <Box
                    style={{
                      width: 6, height: 6, borderRadius: "50%",
                      backgroundColor: "var(--mantine-color-gray-5)",
                      animation: "chatDot 1.4s infinite ease-in-out both",
                      animationDelay: "0.4s",
                    }}
                  />
                </Group>
              </Card>
            </div>
          )}
        </Stack>
      </ScrollArea>

      <Group align="flex-end" mt={8} pt={8} style={{ borderTop: "1px solid var(--mantine-color-gray-3)" }}>
        <Textarea
          placeholder="Escribe tu mensaje..."
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          minRows={1}
          maxRows={4}
          autosize
          style={{ flex: 1 }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <ActionIcon
          size="lg"
          radius="md"
          variant="filled"
          onClick={send}
          loading={loading}
        >
          <IconSend size={18} />
        </ActionIcon>
      </Group>

      <style>{`
        @keyframes chatDot {
          0%, 80%, 100% { transform: scale(0.4); opacity: 0.3; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </Card>
  );
}

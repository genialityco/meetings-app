import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import * as XLSX from "xlsx";
import {
  Alert,
  Badge,
  Button,
  Center,
  Container,
  Group,
  Loader,
  Pagination,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconArrowLeft, IconDownload, IconInfoCircle, IconRefresh, IconSearch } from "@tabler/icons-react";
import { db } from "../../firebase/firebaseConfig";
import WaMetaAnalyticsTab from "./WaMetaAnalyticsTab";
import {
  WA_MESSAGE_TYPE_LABELS,
  type WaMessageLog,
  type WaMessageStatus,
  type WaMessageType,
} from "../../utils/waTracking";

// ─── Helpers ────────────────────────────────────────────────────────────────

const STATUS_META: Record<WaMessageStatus, { label: string; color: string; hint: string }> = {
  error: { label: "Error de envío", color: "red", hint: "El backend o Meta rechazó el envío; nunca salió" },
  sent: { label: "Enviado", color: "gray", hint: "Meta lo aceptó; aún sin confirmación de entrega" },
  delivered: { label: "Recibido", color: "blue", hint: "Entregado en el teléfono del destinatario" },
  read: { label: "Leído", color: "teal", hint: "El destinatario lo abrió (si tiene confirmaciones de lectura activas)" },
  failed: { label: "No entregado", color: "orange", hint: "Meta reportó que no se pudo entregar" },
};

const isOut = (s: WaMessageStatus) => s !== "error";
const isReceived = (s: WaMessageStatus) => s === "delivered" || s === "read";
const isFailed = (s: WaMessageStatus) => s === "error" || s === "failed";

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

const toDate = (v: any): Date | null => {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const fmtDate = (v: any) =>
  toDate(v)?.toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) || "—";

type MeetingOutcome = "accepted" | "rejected" | "pending" | "cancelled" | "other";

function meetingOutcome(m: any): MeetingOutcome {
  if (!m) return "other";
  if (m.completed || m.status === "accepted" || m.status === "standby") return "accepted";
  if (m.status === "rejected") return "rejected";
  if (m.status === "pending") return "pending";
  if (m.status === "cancelled") return "cancelled";
  return "other";
}

interface UserInfo {
  nombre: string;
  empresa: string;
  telefono: string;
  companyId: string;
}

interface RankingRow {
  userId: string;
  nombre: string;
  empresa: string;
  telefono: string;
  notificaciones: number;
  recibidas: number;
  leidas: number;
  recordatorios: number;
  solicitudes: number;
  aceptadas: number;
  atendidasPorOtro: number;
  rechazadas: number;
  pendientes: number;
  canceladas: number;
  sinAceptar: number;
}

const PAGE_SIZE = 50;

function StatTile({ label, value, sub, hint }: { label: string; value: string | number; sub?: string; hint?: string }) {
  const body = (
    <Paper withBorder p="md" radius="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text fz={28} fw={700} lh={1.2}>
        {value}
      </Text>
      {sub && (
        <Text size="sm" c="dimmed">
          {sub}
        </Text>
      )}
    </Paper>
  );
  return hint ? (
    <Tooltip label={hint} multiline w={260} withArrow>
      {body}
    </Tooltip>
  ) : (
    body
  );
}

function StatusBadge({ status }: { status: WaMessageStatus }) {
  const meta = STATUS_META[status] || STATUS_META.sent;
  return (
    <Tooltip label={meta.hint} withArrow>
      <Badge color={meta.color} variant="light">
        {meta.label}
      </Badge>
    </Tooltip>
  );
}

// ─── Página ─────────────────────────────────────────────────────────────────

export default function WaTrackingPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<any>(null);
  const [messages, setMessages] = useState<WaMessageLog[]>([]);
  const [users, setUsers] = useState<Map<string, UserInfo>>(new Map());
  const [meetings, setMeetings] = useState<Map<string, any>>(new Map());
  // events/{eventId}/pendingReminders/{uid}.sendCount (existe desde antes del tracking)
  const [reminderCounts, setReminderCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rankingMode, setRankingMode] = useState<"all" | "noAccept">("noAccept");
  const [rankingSearch, setRankingSearch] = useState("");

  const loadData = async () => {
    if (!eventId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [eventSnap, msgSnap, usersSnap, meetingsSnap, remindersSnap] = await Promise.all([
        getDoc(doc(db, "events", eventId)),
        getDocs(collection(db, "events", eventId, "waMessages")),
        getDocs(query(collection(db, "users"), where("eventId", "==", eventId))),
        getDocs(collection(db, "events", eventId, "meetings")),
        getDocs(collection(db, "events", eventId, "pendingReminders")),
      ]);
      if (eventSnap.exists()) setEvent({ id: eventSnap.id, ...eventSnap.data() });

      setMessages(
        msgSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }) as WaMessageLog)
          .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0)),
      );

      const uMap = new Map<string, UserInfo>();
      usersSnap.docs.forEach((d) => {
        const u = d.data() as any;
        uMap.set(d.id, {
          nombre: (u.nombre || "").trim() || "Sin nombre",
          empresa: u.empresa || u.company_razonSocial || "",
          telefono: u.telefono || "",
          companyId: u.companyId || "",
        });
      });
      setUsers(uMap);

      const rMap = new Map<string, number>();
      remindersSnap.docs.forEach((d) => rMap.set(d.id, Number(d.data().sendCount) || 0));
      setReminderCounts(rMap);

      const mMap = new Map<string, any>();
      meetingsSnap.docs.forEach((d) => mMap.set(d.id, { id: d.id, ...d.data() }));
      setMeetings(mMap);
    } catch (err: any) {
      console.error("[WaTrackingPage] Error cargando datos:", err);
      setLoadError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // ── Resumen por tipo ──
  const byType = useMemo(() => {
    const rows = new Map<WaMessageType, { total: number; out: number; received: number; read: number; failed: number }>();
    for (const m of messages) {
      const r = rows.get(m.type) || { total: 0, out: 0, received: 0, read: 0, failed: 0 };
      r.total++;
      if (isOut(m.status)) r.out++;
      if (isReceived(m.status)) r.received++;
      if (m.status === "read") r.read++;
      if (isFailed(m.status)) r.failed++;
      rows.set(m.type, r);
    }
    return [...rows.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [messages]);

  const totals = useMemo(
    () =>
      byType.reduce(
        (acc, [, r]) => ({
          total: acc.total + r.total,
          out: acc.out + r.out,
          received: acc.received + r.received,
          read: acc.read + r.read,
          failed: acc.failed + r.failed,
        }),
        { total: 0, out: 0, received: 0, read: 0, failed: 0 },
      ),
    [byType],
  );

  // ── Solicitudes de reunión: conversión ──
  const requestStats = useMemo(() => {
    const requestMsgs = messages.filter((m) => m.type === "meeting_request");
    const notified = new Set<string>();
    const received = new Set<string>();
    for (const m of requestMsgs) {
      if (!m.meetingId) continue;
      if (isOut(m.status)) notified.add(m.meetingId);
      if (isReceived(m.status)) received.add(m.meetingId);
    }
    const outcomes = (ids: Set<string>) => {
      const c: Record<MeetingOutcome, number> = { accepted: 0, rejected: 0, pending: 0, cancelled: 0, other: 0 };
      ids.forEach((id) => c[meetingOutcome(meetings.get(id))]++);
      return c;
    };
    return {
      messagesOut: requestMsgs.filter((m) => isOut(m.status)).length,
      messagesReceived: requestMsgs.filter((m) => isReceived(m.status)).length,
      messagesRead: requestMsgs.filter((m) => m.status === "read").length,
      notifiedCount: notified.size,
      receivedCount: received.size,
      notifiedOutcomes: outcomes(notified),
      receivedOutcomes: outcomes(received),
    };
  }, [messages, meetings]);

  // ── Ranking de destinatarios de solicitudes ──
  // Se arma con el historial de reuniones del evento (sirve para eventos
  // anteriores al tracking) y se completa con los WhatsApp registrados y los
  // recordatorios de pendientes. Destinatarios de una solicitud:
  //  - directa: receiverId
  //  - a empresa sin reclamar (receiverId null): los asistentes de esa empresa
  //  - cualquiera a la que se le haya enviado un WhatsApp de solicitud o recordatorio
  const ranking = useMemo<RankingRow[]>(() => {
    const rows = new Map<string, RankingRow & { meetingSet: Set<string> }>();
    const rowFor = (userId: string, phone = "") => {
      let r = rows.get(userId);
      if (!r) {
        const u = users.get(userId);
        r = {
          userId,
          nombre: u?.nombre || "(asistente eliminado)",
          empresa: u?.empresa || "",
          telefono: u?.telefono || phone,
          notificaciones: 0,
          recibidas: 0,
          leidas: 0,
          recordatorios: reminderCounts.get(userId) || 0,
          solicitudes: 0,
          aceptadas: 0,
          atendidasPorOtro: 0,
          rechazadas: 0,
          pendientes: 0,
          canceladas: 0,
          sinAceptar: 0,
          meetingSet: new Set(),
        };
        rows.set(userId, r);
      }
      return r;
    };

    const byCompany = new Map<string, string[]>();
    users.forEach((u, id) => {
      if (!u.companyId) return;
      if (!byCompany.has(u.companyId)) byCompany.set(u.companyId, []);
      byCompany.get(u.companyId)!.push(id);
    });

    meetings.forEach((m, id) => {
      if (m.isExternal || !m.requesterId) return;
      if (m.receiverId) {
        if (m.receiverId !== m.requesterId) rowFor(m.receiverId).meetingSet.add(id);
      } else if (m.companyId) {
        (byCompany.get(m.companyId) || [])
          .filter((uid) => uid !== m.requesterId)
          .forEach((uid) => rowFor(uid).meetingSet.add(id));
      }
    });

    const trackedReminders = new Map<string, number>();
    for (const m of messages) {
      if (!m.userId || !isOut(m.status)) continue;
      if (m.type === "meeting_request") {
        const r = rowFor(m.userId, m.to);
        r.notificaciones++;
        if (isReceived(m.status)) r.recibidas++;
        if (m.status === "read") r.leidas++;
        if (m.meetingId) r.meetingSet.add(m.meetingId);
      } else if (m.type === "pending_reminder") {
        const r = rowFor(m.userId, m.to);
        trackedReminders.set(m.userId, (trackedReminders.get(m.userId) || 0) + 1);
        (m.meetingIds || []).forEach((mid) => r.meetingSet.add(mid));
      }
    }

    return [...rows.values()]
      .map(({ meetingSet, ...r }) => {
        r.recordatorios = Math.max(r.recordatorios, trackedReminders.get(r.userId) || 0);
        meetingSet.forEach((id) => {
          const mtg = meetings.get(id);
          if (!mtg) return;
          r.solicitudes++;
          switch (meetingOutcome(mtg)) {
            case "accepted":
              // Solicitudes a empresa: la acepta (reclama) un solo asesor
              if (!mtg.receiverId || mtg.receiverId === r.userId) r.aceptadas++;
              else r.atendidasPorOtro++;
              break;
            case "rejected":
              r.rechazadas++;
              break;
            case "pending":
              r.pendientes++;
              break;
            case "cancelled":
              r.canceladas++;
              break;
          }
        });
        r.sinAceptar = r.rechazadas + r.pendientes;
        return r;
      })
      .filter((r) => r.solicitudes > 0 || r.notificaciones > 0)
      .sort(
        (a, b) =>
          b.sinAceptar - a.sinAceptar ||
          b.pendientes - a.pendientes ||
          a.aceptadas - b.aceptadas ||
          b.notificaciones + b.recordatorios - (a.notificaciones + a.recordatorios),
      );
  }, [messages, meetings, users, reminderCounts]);

  const visibleRanking = useMemo(() => {
    const q = rankingSearch.trim().toLowerCase();
    return ranking.filter(
      (r) =>
        (rankingMode === "all" || (r.aceptadas === 0 && r.sinAceptar > 0)) &&
        (!q || r.nombre.toLowerCase().includes(q) || r.empresa.toLowerCase().includes(q) || r.telefono.includes(q)),
    );
  }, [ranking, rankingMode, rankingSearch]);

  // ── Historial ──
  const filteredLog = useMemo(() => {
    const q = search.trim().toLowerCase();
    return messages.filter((m) => {
      if (typeFilter !== "all" && m.type !== typeFilter) return false;
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      if (!q) return true;
      const u = m.userId ? users.get(m.userId) : undefined;
      return (
        m.to.includes(q) ||
        (u?.nombre || "").toLowerCase().includes(q) ||
        (u?.empresa || "").toLowerCase().includes(q)
      );
    });
  }, [messages, typeFilter, statusFilter, search, users]);

  useEffect(() => setPage(1), [typeFilter, statusFilter, search]);

  const exportRanking = () => {
    const rows = visibleRanking.map((r, i) => ({
      "#": i + 1,
      Nombre: r.nombre,
      Empresa: r.empresa,
      Teléfono: r.telefono,
      "Solicitudes recibidas": r.solicitudes,
      Aceptadas: r.aceptadas,
      "Atendidas por compañero": r.atendidasPorOtro,
      Rechazadas: r.rechazadas,
      Pendientes: r.pendientes,
      Canceladas: r.canceladas,
      "Sin aceptar (rechazadas + pendientes)": r.sinAceptar,
      "Tasa de aceptación": pct(r.aceptadas, r.solicitudes),
      "WhatsApp de solicitud enviados": r.notificaciones,
      "WhatsApp recibidos": r.recibidas,
      "WhatsApp leídos": r.leidas,
      "Recordatorios de pendientes": r.recordatorios,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Solicitudes sin aceptar");
    XLSX.writeFile(wb, `whatsapp_solicitudes_${eventId}.xlsx`);
  };

  if (loading) {
    return (
      <Center h="60vh">
        <Loader />
      </Center>
    );
  }

  const apiVersion = event?.config?.policies?.whatsappApiVersion || "v1";
  const typeOptions = [
    { value: "all", label: "Todos los tipos" },
    ...(Object.keys(WA_MESSAGE_TYPE_LABELS) as WaMessageType[]).map((t) => ({ value: t, label: WA_MESSAGE_TYPE_LABELS[t] })),
  ];
  const statusOptions = [
    { value: "all", label: "Todos los estados" },
    ...(Object.keys(STATUS_META) as WaMessageStatus[]).map((s) => ({ value: s, label: STATUS_META[s].label })),
  ];
  const ro = requestStats.receivedOutcomes;
  const no = requestStats.notifiedOutcomes;

  return (
    <Container size="xl" py="lg">
      <Stack gap="lg">
        <Group justify="space-between" wrap="wrap">
          <Group gap="sm">
            <Button component={Link} to={`/admin/event/${eventId}`} variant="subtle" leftSection={<IconArrowLeft size={16} />}>
              Volver
            </Button>
            <div>
              <Title order={2}>Tracking WhatsApp</Title>
              <Text c="dimmed" size="sm">
                {event?.eventName || eventId} · API oficial
              </Text>
            </div>
          </Group>
          <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={loadData}>
            Actualizar
          </Button>
        </Group>

        {loadError && (
          <Alert color="red" title="No se pudieron cargar los datos">
            {loadError}
          </Alert>
        )}

        {apiVersion !== "v2" && (
          <Alert color="yellow" icon={<IconInfoCircle size={18} />}>
            Este evento está configurado con la API v1 de WhatsApp. Solo se registran los mensajes enviados por la API
            oficial (v2); cámbiala en Políticas del evento para empezar a medir.
          </Alert>
        )}

        {messages.length === 0 && !loadError && (
          <Alert color="blue" icon={<IconInfoCircle size={18} />}>
            Aún no hay mensajes registrados. El tracking cuenta los envíos hechos desde su activación; los anteriores no
            quedaron registrados.
          </Alert>
        )}

        <Tabs defaultValue="resumen" keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="resumen">Resumen</Tabs.Tab>
            <Tabs.Tab value="solicitudes">Solicitudes de reunión</Tabs.Tab>
            <Tabs.Tab value="historial">Historial ({messages.length})</Tabs.Tab>
            <Tabs.Tab value="meta">Analítica Meta por día</Tabs.Tab>
          </Tabs.List>

          {/* ── Resumen ── */}
          <Tabs.Panel value="resumen" pt="md">
            <Stack gap="lg">
              <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }}>
                <StatTile label="Registrados" value={totals.total} hint="Intentos de envío registrados" />
                <StatTile
                  label="Enviados"
                  value={totals.out}
                  sub={pct(totals.out, totals.total)}
                  hint="Aceptados por Meta para entrega"
                />
                <StatTile
                  label="Recibidos"
                  value={totals.received}
                  sub={`${pct(totals.received, totals.out)} de enviados`}
                  hint="Entregados en el teléfono (incluye leídos)"
                />
                <StatTile
                  label="Leídos"
                  value={totals.read}
                  sub={`${pct(totals.read, totals.out)} de enviados`}
                  hint="Solo cuenta a quienes tienen activas las confirmaciones de lectura"
                />
                <StatTile
                  label="Fallidos"
                  value={totals.failed}
                  sub={pct(totals.failed, totals.total)}
                  hint="Error al enviar + no entregados por Meta"
                />
              </SimpleGrid>

              <Paper withBorder radius="md">
                <ScrollArea>
                  <Table striped highlightOnHover miw={720}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Tipo de mensaje</Table.Th>
                        <Table.Th ta="right">Registrados</Table.Th>
                        <Table.Th ta="right">Enviados</Table.Th>
                        <Table.Th ta="right">Recibidos</Table.Th>
                        <Table.Th ta="right">Leídos</Table.Th>
                        <Table.Th ta="right">Fallidos</Table.Th>
                        <Table.Th ta="right">% recibidos</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {byType.map(([type, r]) => (
                        <Table.Tr key={type}>
                          <Table.Td>{WA_MESSAGE_TYPE_LABELS[type] || type}</Table.Td>
                          <Table.Td ta="right">{r.total}</Table.Td>
                          <Table.Td ta="right">{r.out}</Table.Td>
                          <Table.Td ta="right">{r.received}</Table.Td>
                          <Table.Td ta="right">{r.read}</Table.Td>
                          <Table.Td ta="right">{r.failed}</Table.Td>
                          <Table.Td ta="right">{pct(r.received, r.out)}</Table.Td>
                        </Table.Tr>
                      ))}
                      {byType.length === 0 && (
                        <Table.Tr>
                          <Table.Td colSpan={7}>
                            <Text c="dimmed" ta="center" py="md">
                              Sin mensajes registrados
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      )}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </Paper>
            </Stack>
          </Tabs.Panel>

          {/* ── Solicitudes ── */}
          <Tabs.Panel value="solicitudes" pt="md">
            <Stack gap="lg">
              <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }}>
                <StatTile
                  label="Notificaciones enviadas"
                  value={requestStats.messagesOut}
                  sub={`${requestStats.notifiedCount} solicitudes`}
                  hint="WhatsApp de solicitud de reunión aceptados por Meta (una solicitud a empresa notifica a varios asesores)"
                />
                <StatTile
                  label="Notificaciones recibidas"
                  value={requestStats.messagesReceived}
                  sub={`${requestStats.receivedCount} solicitudes`}
                  hint="Solicitudes cuya notificación llegó al teléfono de al menos un destinatario"
                />
                <StatTile
                  label="Aceptadas"
                  value={ro.accepted}
                  sub={`${pct(ro.accepted, requestStats.receivedCount)} de las recibidas`}
                  hint="De las solicitudes con notificación recibida, cuántas terminaron en reunión"
                />
                <StatTile
                  label="Rechazadas"
                  value={ro.rejected}
                  sub={`${pct(ro.rejected, requestStats.receivedCount)} de las recibidas`}
                />
                <StatTile
                  label="Sin respuesta"
                  value={ro.pending}
                  sub={`${pct(ro.pending, requestStats.receivedCount)} de las recibidas`}
                  hint="Siguen pendientes de aceptar o rechazar"
                />
              </SimpleGrid>

              <Paper withBorder radius="md">
                <ScrollArea>
                  <Table miw={600}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Solicitudes</Table.Th>
                        <Table.Th ta="right">Total</Table.Th>
                        <Table.Th ta="right">Aceptadas</Table.Th>
                        <Table.Th ta="right">Rechazadas</Table.Th>
                        <Table.Th ta="right">Pendientes</Table.Th>
                        <Table.Th ta="right">Canceladas</Table.Th>
                        <Table.Th ta="right">Tasa de aceptación</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      <Table.Tr>
                        <Table.Td>Con notificación enviada</Table.Td>
                        <Table.Td ta="right">{requestStats.notifiedCount}</Table.Td>
                        <Table.Td ta="right">{no.accepted}</Table.Td>
                        <Table.Td ta="right">{no.rejected}</Table.Td>
                        <Table.Td ta="right">{no.pending}</Table.Td>
                        <Table.Td ta="right">{no.cancelled}</Table.Td>
                        <Table.Td ta="right">{pct(no.accepted, requestStats.notifiedCount)}</Table.Td>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Td fw={600}>Con notificación recibida</Table.Td>
                        <Table.Td ta="right">{requestStats.receivedCount}</Table.Td>
                        <Table.Td ta="right">{ro.accepted}</Table.Td>
                        <Table.Td ta="right">{ro.rejected}</Table.Td>
                        <Table.Td ta="right">{ro.pending}</Table.Td>
                        <Table.Td ta="right">{ro.cancelled}</Table.Td>
                        <Table.Td ta="right" fw={600}>
                          {pct(ro.accepted, requestStats.receivedCount)}
                        </Table.Td>
                      </Table.Tr>
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </Paper>

              <Stack gap="xs">
                <Group justify="space-between" wrap="wrap">
                  <div>
                    <Title order={4}>Quiénes reciben solicitudes y no aceptan</Title>
                    <Text size="sm" c="dimmed">
                      Todo el historial de solicitudes del evento, ordenado por solicitudes sin aceptar (rechazadas +
                      pendientes). Las columnas de WhatsApp solo cuentan los envíos registrados desde que existe el
                      tracking; las aceptadas pueden incluir reuniones asignadas directamente por el administrador.
                    </Text>
                  </div>
                  <Group gap="sm">
                    <SegmentedControl
                      value={rankingMode}
                      onChange={(v) => setRankingMode(v as "all" | "noAccept")}
                      data={[
                        { value: "noAccept", label: "No han aceptado ninguna" },
                        { value: "all", label: "Todos" },
                      ]}
                    />
                    <Button
                      variant="default"
                      leftSection={<IconDownload size={16} />}
                      onClick={exportRanking}
                      disabled={visibleRanking.length === 0}
                    >
                      Excel
                    </Button>
                  </Group>
                </Group>
                <TextInput
                  placeholder="Buscar por nombre, empresa o teléfono"
                  leftSection={<IconSearch size={16} />}
                  value={rankingSearch}
                  onChange={(e) => setRankingSearch(e.currentTarget.value)}
                  maw={400}
                />
                <Paper withBorder radius="md">
                  <ScrollArea h={520}>
                    <Table striped highlightOnHover stickyHeader miw={1000}>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>#</Table.Th>
                          <Table.Th>Destinatario</Table.Th>
                          <Table.Th ta="right">Solicitudes</Table.Th>
                          <Table.Th ta="right">Aceptadas</Table.Th>
                          <Table.Th ta="right">
                            <Tooltip label="Solicitudes a su empresa que aceptó un compañero" withArrow>
                              <span>Por compañero</span>
                            </Tooltip>
                          </Table.Th>
                          <Table.Th ta="right">Rechazadas</Table.Th>
                          <Table.Th ta="right">Pendientes</Table.Th>
                          <Table.Th ta="right">Aceptación</Table.Th>
                          <Table.Th ta="right">
                            <Tooltip label="WhatsApp de solicitud enviados / recibidos (solo desde el tracking)" withArrow>
                              <span>WA env. / rec.</span>
                            </Tooltip>
                          </Table.Th>
                          <Table.Th ta="right">Recordatorios</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {visibleRanking.map((r, i) => (
                          <Table.Tr key={r.userId}>
                            <Table.Td>
                              <Text size="sm" c="dimmed">
                                {i + 1}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              <Text size="sm" fw={500}>
                                {r.nombre}
                              </Text>
                              <Text size="xs" c="dimmed">
                                {[r.empresa, r.telefono].filter(Boolean).join(" · ")}
                              </Text>
                            </Table.Td>
                            <Table.Td ta="right">{r.solicitudes}</Table.Td>
                            <Table.Td ta="right">{r.aceptadas}</Table.Td>
                            <Table.Td ta="right">{r.atendidasPorOtro}</Table.Td>
                            <Table.Td ta="right">{r.rechazadas}</Table.Td>
                            <Table.Td ta="right" fw={r.pendientes > 0 ? 600 : undefined}>
                              {r.pendientes}
                            </Table.Td>
                            <Table.Td ta="right">{pct(r.aceptadas, r.solicitudes)}</Table.Td>
                            <Table.Td ta="right">
                              {r.notificaciones} / {r.recibidas}
                            </Table.Td>
                            <Table.Td ta="right">{r.recordatorios}</Table.Td>
                          </Table.Tr>
                        ))}
                        {visibleRanking.length === 0 && (
                          <Table.Tr>
                            <Table.Td colSpan={10}>
                              <Text c="dimmed" ta="center" py="md">
                                Nadie en esta vista
                              </Text>
                            </Table.Td>
                          </Table.Tr>
                        )}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                </Paper>
              </Stack>
            </Stack>
          </Tabs.Panel>

          {/* ── Historial ── */}
          <Tabs.Panel value="historial" pt="md">
            <Stack gap="sm">
              <Group gap="sm" wrap="wrap">
                <Select data={typeOptions} value={typeFilter} onChange={(v) => setTypeFilter(v || "all")} allowDeselect={false} w={240} />
                <Select data={statusOptions} value={statusFilter} onChange={(v) => setStatusFilter(v || "all")} allowDeselect={false} w={200} />
                <TextInput
                  placeholder="Nombre, empresa o teléfono"
                  leftSection={<IconSearch size={16} />}
                  value={search}
                  onChange={(e) => setSearch(e.currentTarget.value)}
                  w={280}
                />
                <Text size="sm" c="dimmed">
                  {filteredLog.length} mensajes
                </Text>
              </Group>
              <Paper withBorder radius="md">
                <ScrollArea>
                  <Table striped highlightOnHover miw={900}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Fecha</Table.Th>
                        <Table.Th>Tipo</Table.Th>
                        <Table.Th>Destinatario</Table.Th>
                        <Table.Th>Estado</Table.Th>
                        <Table.Th>Detalle</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {filteredLog.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((m) => {
                        const u = m.userId ? users.get(m.userId) : undefined;
                        const lastAt = m.statusAt?.[m.status as "sent"] ?? null;
                        return (
                          <Table.Tr key={m.id}>
                            <Table.Td>
                              <Text size="sm">{fmtDate(m.createdAt)}</Text>
                            </Table.Td>
                            <Table.Td>
                              <Text size="sm">{WA_MESSAGE_TYPE_LABELS[m.type] || m.type}</Text>
                            </Table.Td>
                            <Table.Td>
                              <Text size="sm">{u?.nombre || "—"}</Text>
                              <Text size="xs" c="dimmed">
                                {[u?.empresa, m.to].filter(Boolean).join(" · ")}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              <StatusBadge status={m.status} />
                              {lastAt && m.status !== "sent" && (
                                <Text size="xs" c="dimmed">
                                  {fmtDate(lastAt)}
                                </Text>
                              )}
                            </Table.Td>
                            <Table.Td>
                              {m.error ? (
                                <Text size="xs" c="red" lineClamp={2}>
                                  {m.errorCode ? `[${m.errorCode}] ` : ""}
                                  {m.error}
                                </Text>
                              ) : m.meetingId ? (
                                <Text size="xs" c="dimmed">
                                  Reunión: {meetings.get(m.meetingId)?.status || "eliminada"}
                                </Text>
                              ) : null}
                              {m.fallbackEmail && (
                                <Text size="xs" c="dimmed">
                                  Con correo de respaldo
                                </Text>
                              )}
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </Paper>
              {filteredLog.length > PAGE_SIZE && (
                <Group justify="center">
                  <Pagination total={Math.ceil(filteredLog.length / PAGE_SIZE)} value={page} onChange={setPage} />
                </Group>
              )}
            </Stack>
          </Tabs.Panel>

          {/* ── Analítica de Meta (histórica, por plantilla y día) ── */}
          <Tabs.Panel value="meta" pt="md">
            {eventId && <WaMetaAnalyticsTab eventId={eventId} event={event} />}
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Container>
  );
}

import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Divider,
  Group,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconDownload, IconInfoCircle, IconSearch } from "@tabler/icons-react";
import * as XLSX from "xlsx";
import { auth } from "../../firebase/firebaseConfig";
import { WA_MESSAGE_TYPE_LABELS, type WaMessageType } from "../../utils/waTracking";

const FUNCTIONS_BASE = `https://us-central1-${import.meta.env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net`;

/** Plantillas fijas de wa-multi-session-backend (/api/send-*) → tipo de mensaje */
const FIXED_TEMPLATE_TYPES: Record<string, WaMessageType> = {
  solicitud_reunion: "meeting_request",
  confirmacion_reunion: "meeting_confirmation",
  reunion_cancelada: "meeting_cancelled",
  rechazo_solicitud: "meeting_rejected",
  bienvenida_magnetic: "welcome",
};

// Bogotá es UTC-5 todo el año (sin horario de verano)
const BOGOTA_OFFSET_S = 5 * 3600;

interface Totals {
  sent: number;
  delivered: number;
  read?: number;
}

interface MessagePoint {
  start: number;
  end: number;
  sent: number;
  delivered: number;
}

interface MetaTemplate {
  id: string;
  name: string;
  language: string;
}

interface TemplatePoint {
  template_id: string;
  start: number;
  end: number;
  sent?: number;
  delivered?: number;
  read?: number;
}

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

/** YYYY-MM-DD de la fecha de calendario elegida en el selector */
const toDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const parseDay = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Fecha/hora en Bogotá de un unix (s), como Date cuyos getters UTC dan la hora local */
const bogota = (unix: number) => new Date((unix - BOGOTA_OFFSET_S) * 1000);

const fmtDay = (d: Date) =>
  d.toLocaleDateString("es-CO", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short", year: "numeric" });

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00 – ${String(h).padStart(2, "0")}:59`;

/** Rango por defecto: creación del evento → último día del evento (o hoy) */
function defaultRange(event: any): [Date | null, Date | null] {
  const created = event?.createdAt?.toDate?.() ?? (event?.createdAt ? new Date(event.createdAt) : null);
  const days = [
    ...(Array.isArray(event?.eventDates) ? event.eventDates : []),
    ...(Array.isArray(event?.config?.eventDates) ? event.config.eventDates : []),
    ...Object.keys(event?.dailyConfig || event?.config?.dailyConfig || {}),
    event?.config?.eventDate,
  ]
    .filter(Boolean)
    .map((d: any) => String(d).slice(0, 10))
    .filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  const today = new Date();
  const last = days.length ? parseDay(days[days.length - 1]) : today;
  const end = last > today ? today : last;
  const first = days.length ? parseDay(days[0]) : end;
  const start = created && !isNaN(created.getTime()) && created < first ? created : first;
  return [start, end];
}

async function callAnalytics<T>(fn: string, eventId: string, range: [Date, Date]): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error("Debes iniciar sesión como administrador");
  const token = await user.getIdToken();
  const res = await fetch(`${FUNCTIONS_BASE}/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ eventId, start: toDay(range[0]), end: toDay(range[1]) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error([data.error || `Error ${res.status}`, data.details].filter(Boolean).join(": "));
    err.subcode = data.subcode;
    throw err;
  }
  return data as T;
}

function Tile({ label, value, sub, hint }: { label: string; value: number; sub?: string; hint?: string }) {
  const body = (
    <Paper withBorder p="md" radius="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text fz={28} fw={700}>
        {value.toLocaleString("es-CO")}
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

function TotalsTable({ rows, firstHeader, showRead }: { rows: [string, Totals][]; firstHeader: string; showRead?: boolean }) {
  const total = rows.reduce(
    (acc, [, r]) => ({ sent: acc.sent + r.sent, delivered: acc.delivered + r.delivered, read: (acc.read || 0) + (r.read || 0) }),
    { sent: 0, delivered: 0, read: 0 } as Totals,
  );
  return (
    <Paper withBorder radius="md">
      <ScrollArea h={rows.length > 12 ? 480 : undefined}>
        <Table striped highlightOnHover stickyHeader miw={520}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{firstHeader}</Table.Th>
              <Table.Th ta="right">Enviados</Table.Th>
              <Table.Th ta="right">Entregados</Table.Th>
              {showRead && <Table.Th ta="right">Leídos</Table.Th>}
              <Table.Th ta="right">% entregados</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map(([label, r]) => (
              <Table.Tr key={label}>
                <Table.Td>{label}</Table.Td>
                <Table.Td ta="right">{r.sent}</Table.Td>
                <Table.Td ta="right">{r.delivered}</Table.Td>
                {showRead && <Table.Td ta="right">{r.read || 0}</Table.Td>}
                <Table.Td ta="right">{pct(r.delivered, r.sent)}</Table.Td>
              </Table.Tr>
            ))}
            {rows.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={showRead ? 5 : 4}>
                  <Text c="dimmed" ta="center" py="md">
                    Sin envíos en el rango
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              <Table.Tr>
                <Table.Td fw={700}>Total</Table.Td>
                <Table.Td ta="right" fw={700}>
                  {total.sent}
                </Table.Td>
                <Table.Td ta="right" fw={700}>
                  {total.delivered}
                </Table.Td>
                {showRead && (
                  <Table.Td ta="right" fw={700}>
                    {total.read}
                  </Table.Td>
                )}
                <Table.Td ta="right" fw={700}>
                  {pct(total.delivered, total.sent)}
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Paper>
  );
}

// ─── Mensajes del número por día / hora ─────────────────────────────────────

function MessageAnalytics({ eventId, range }: { eventId: string; range: [Date | null, Date | null] }) {
  const [data, setData] = useState<{ points: MessagePoint[]; phoneLast4: string; start: number; clamped: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"day" | "hour" | "hourOfDay">("day");

  const load = async () => {
    if (!range[0] || !range[1]) return;
    setLoading(true);
    setError(null);
    try {
      setData(await callAnalytics("getWaMessageAnalytics", eventId, range as [Date, Date]));
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const grouped = useMemo(() => {
    const byDay = new Map<string, Totals>();
    const byHour = new Map<string, Totals>();
    const byHourOfDay = new Map<number, Totals>();
    const add = <K,>(map: Map<K, Totals>, key: K, p: MessagePoint) => {
      const r = map.get(key) || { sent: 0, delivered: 0 };
      r.sent += p.sent;
      r.delivered += p.delivered;
      map.set(key, r);
    };
    for (const p of data?.points || []) {
      if (!p.sent && !p.delivered) continue;
      const d = bogota(p.start);
      const day = d.toISOString().slice(0, 10);
      add(byDay, day, p);
      add(byHour, `${day}T${String(d.getUTCHours()).padStart(2, "0")}`, p);
      add(byHourOfDay, d.getUTCHours(), p);
    }
    const sortKeys = <K,>(m: Map<K, Totals>) => [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return {
      day: sortKeys(byDay).map(([k, r]) => [fmtDay(new Date(`${k}T00:00:00Z`)), r] as [string, Totals]),
      hour: sortKeys(byHour).map(
        ([k, r]) => [`${fmtDay(new Date(`${k.slice(0, 10)}T00:00:00Z`))} · ${hourLabel(Number(k.slice(11)))}`, r] as [string, Totals],
      ),
      hourOfDay: sortKeys(byHourOfDay).map(([h, r]) => [hourLabel(h), r] as [string, Totals]),
      raw: { byDay: sortKeys(byDay), byHour: sortKeys(byHour) },
    };
  }, [data]);

  const total = (data?.points || []).reduce((acc, p) => ({ sent: acc.sent + p.sent, delivered: acc.delivered + p.delivered }), {
    sent: 0,
    delivered: 0,
  });

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(grouped.raw.byDay.map(([k, r]) => ({ Día: k, Enviados: r.sent, Entregados: r.delivered, "% entregados": pct(r.delivered, r.sent) }))),
      "Por día",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        grouped.raw.byHour.map(([k, r]) => ({ Día: k.slice(0, 10), Hora: `${k.slice(11)}:00`, Enviados: r.sent, Entregados: r.delivered })),
      ),
      "Por hora",
    );
    XLSX.writeFile(wb, `whatsapp_mensajes_${eventId}_${range[0] ? toDay(range[0]) : ""}_${range[1] ? toDay(range[1]) : ""}.xlsx`);
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Title order={4}>Mensajes del número por día y hora</Title>
          <Text size="sm" c="dimmed">
            Enviados y entregados de todo lo que salió del número de la plataforma (todas las plantillas juntas), en hora
            de Colombia. Meta guarda los últimos 365 días.
          </Text>
        </div>
        <Group gap="sm">
          <Button leftSection={<IconSearch size={16} />} onClick={load} loading={loading} disabled={!range[0] || !range[1]}>
            Consultar Meta
          </Button>
          {data && (
            <Button variant="default" leftSection={<IconDownload size={16} />} onClick={exportExcel} disabled={total.sent === 0}>
              Excel
            </Button>
          )}
        </Group>
      </Group>

      {error && (
        <Alert color="red" title="Meta no devolvió la analítica">
          {error}
        </Alert>
      )}

      {data && (
        <>
          {data.clamped && (
            <Alert color="yellow" icon={<IconInfoCircle size={18} />}>
              Meta solo guarda los últimos 365 días: el rango se recortó desde el{" "}
              {fmtDay(bogota(data.start))}.
            </Alert>
          )}
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Tile label="Enviados" value={total.sent} sub={`Número terminado en ${data.phoneLast4}`} />
            <Tile label="Entregados" value={total.delivered} sub={`${pct(total.delivered, total.sent)} de enviados`} />
            <Tile
              label="No entregados"
              value={Math.max(total.sent - total.delivered, 0)}
              sub={pct(Math.max(total.sent - total.delivered, 0), total.sent)}
              hint="Enviados que Meta no confirmó como entregados (número sin WhatsApp, teléfono apagado, bloqueos…)"
            />
          </SimpleGrid>
          <SegmentedControl
            value={view}
            onChange={(v) => setView(v as typeof view)}
            data={[
              { value: "day", label: "Por día" },
              { value: "hour", label: "Por día y hora" },
              { value: "hourOfDay", label: "Por hora del día" },
            ]}
            w="fit-content"
          />
          {view === "day" && <TotalsTable rows={grouped.day} firstHeader="Día" />}
          {view === "hour" && <TotalsTable rows={grouped.hour} firstHeader="Día y hora" />}
          {view === "hourOfDay" && <TotalsTable rows={grouped.hourOfDay} firstHeader="Hora (suma del rango)" />}
        </>
      )}
    </Stack>
  );
}

// ─── Por plantilla (Template Analytics) ──────────────────────────────────────

function TemplateAnalytics({ eventId, event, range }: { eventId: string; event: any; range: [Date | null, Date | null] }) {
  const [data, setData] = useState<{ templates: MetaTemplate[]; points: TemplatePoint[]; start: number; clamped: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; notEnabled: boolean } | null>(null);
  const [templateFilter, setTemplateFilter] = useState("all");
  const [onlyMeetingTemplates, setOnlyMeetingTemplates] = useState(true);

  const policies = event?.config?.policies || {};
  const typeOf = (name: string): WaMessageType | null => {
    if (FIXED_TEMPLATE_TYPES[name]) return FIXED_TEMPLATE_TYPES[name];
    if (policies.advisorNoticeTemplate?.name === name) return "advisor_notice";
    if (policies.pendingRemindersTemplate?.name === name) return "pending_reminder";
    return null;
  };

  const load = async () => {
    if (!range[0] || !range[1]) return;
    setLoading(true);
    setError(null);
    try {
      setData(await callAnalytics("getWaTemplateAnalytics", eventId, range as [Date, Date]));
      setTemplateFilter("all");
    } catch (err: any) {
      setError({ message: err?.message || String(err), notEnabled: err?.subcode === 4182004 });
    } finally {
      setLoading(false);
    }
  };

  const templatesById = useMemo(() => new Map((data?.templates || []).map((t) => [t.id, t])), [data]);
  const templateLabel = (id: string) => {
    const t = templatesById.get(id);
    if (!t) return id;
    const type = typeOf(t.name);
    return type ? `${WA_MESSAGE_TYPE_LABELS[type]} (${t.name})` : t.name;
  };

  const points = (data?.points || []).filter((p) => {
    const t = templatesById.get(p.template_id);
    return !onlyMeetingTemplates || (t && typeOf(t.name));
  });

  const sum = (list: TemplatePoint[], key: (p: TemplatePoint) => string | number) => {
    const map = new Map<string | number, Totals>();
    for (const p of list) {
      const r = map.get(key(p)) || { sent: 0, delivered: 0, read: 0 };
      r.sent += p.sent || 0;
      r.delivered += p.delivered || 0;
      r.read = (r.read || 0) + (p.read || 0);
      map.set(key(p), r);
    }
    return map;
  };
  const byTemplate = [...sum(points, (p) => p.template_id).entries()]
    .filter(([, r]) => r.sent > 0)
    .sort((a, b) => b[1].sent - a[1].sent) as [string, Totals][];
  const byDay = [...sum(templateFilter === "all" ? points : points.filter((p) => p.template_id === templateFilter), (p) => p.start).entries()]
    .filter(([, r]) => r.sent || r.delivered || r.read)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([start, r]) => [fmtDay(new Date(Number(start) * 1000)), r] as [string, Totals]);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Title order={4}>Por plantilla</Title>
          <Text size="sm" c="dimmed">
            Enviados, entregados y leídos por plantilla y día (días UTC). Meta solo la entrega de los últimos 90 días y
            requiere las estadísticas de plantillas activadas en la cuenta.
          </Text>
        </div>
        <Group gap="sm">
          <Switch
            label="Solo plantillas de reuniones"
            checked={onlyMeetingTemplates}
            onChange={(e) => setOnlyMeetingTemplates(e.currentTarget.checked)}
          />
          <Button variant="default" leftSection={<IconSearch size={16} />} onClick={load} loading={loading} disabled={!range[0] || !range[1]}>
            Consultar por plantilla
          </Button>
        </Group>
      </Group>

      {error && (
        <Alert color={error.notEnabled ? "yellow" : "red"} title={error.notEnabled ? "Estadísticas de plantillas no activadas" : "Meta no devolvió la analítica"}>
          {error.message}
          {error.notEnabled &&
            " Se activan una vez en la cuenta de WhatsApp Business y Meta solo registra desde ese momento: no recupera datos anteriores. Mientras tanto usa la sección de mensajes por día y hora."}
        </Alert>
      )}

      {data && (
        <>
          {data.clamped && (
            <Alert color="yellow" icon={<IconInfoCircle size={18} />}>
              Meta solo entrega los últimos 90 días: el rango se recortó desde el {fmtDay(new Date(data.start * 1000))}.
            </Alert>
          )}
          <TotalsTable rows={byTemplate.map(([id, r]) => [templateLabel(id), r])} firstHeader="Plantilla" showRead />
          <Group justify="space-between" wrap="wrap">
            <Text fw={600}>Por día</Text>
            <Select
              value={templateFilter}
              onChange={(v) => setTemplateFilter(v || "all")}
              allowDeselect={false}
              w={340}
              data={[{ value: "all", label: "Todas las plantillas" }, ...byTemplate.map(([id]) => ({ value: id, label: templateLabel(id) }))]}
            />
          </Group>
          <TotalsTable rows={byDay} firstHeader="Día (UTC)" showRead />
        </>
      )}
    </Stack>
  );
}

// ─── Pestaña ────────────────────────────────────────────────────────────────

export default function WaMetaAnalyticsTab({ eventId, event }: { eventId: string; event: any }) {
  const [range, setRange] = useState<[Date | null, Date | null]>(() => defaultRange(event));

  return (
    <Stack gap="lg">
      <Alert color="blue" icon={<IconInfoCircle size={18} />}>
        Datos de Meta para el rango elegido. Son de todo el número de WhatsApp, no solo de este evento: si en esas fechas
        otro evento o sistema envió mensajes por el mismo número, también se cuentan. Por defecto el rango va desde la
        creación del evento hasta su último día.
      </Alert>

      <DatePickerInput
        type="range"
        label="Rango"
        value={range}
        onChange={setRange}
        valueFormat="DD/MM/YYYY"
        maxDate={new Date()}
        w={280}
      />

      <MessageAnalytics eventId={eventId} range={range} />
      <Divider />
      <TemplateAnalytics eventId={eventId} event={event} range={range} />
    </Stack>
  );
}

import { useMemo, type ReactNode } from "react";
import {
  Badge,
  Box,
  Group,
  Paper,
  Progress,
  Select,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconCalendarCheck,
  IconChartPie,
  IconClockPlay,
  IconHourglassHigh,
  IconUserCheck,
  IconTable,
  IconClipboardCheck,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import { isCheckedInOnDay, DEFAULT_CHECKIN_DAY } from "../../utils/eventDays";

interface Props {
  event: any; // documento del evento (config, eventName, dashboardLogo…)
  meetings: any[]; // reuniones accepted + pending
  agenda: any[];
  attendees: any[];
  surveys: Record<string, any[]>; // meetingId -> respuestas
  selectedDate: string | null;
  eventDates: string[];
  onDateChange: (date: string) => void;
  meetingsPerDay?: Record<string, number>; // citas aceptadas por fecha, para el selector de día
  now: Date;
  formatDate: (date: string) => string;
  children?: ReactNode; // controles extra bajo las métricas (buscador)
}

const toMin = (hhmm?: string) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
};

const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

function StatCard({
  icon,
  color,
  label,
  value,
  sub,
  progress,
  tooltip,
}: {
  icon: ReactNode;
  color: string;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  progress?: ReactNode;
  tooltip?: string;
}) {
  const card = (
    <Paper withBorder radius="md" p="sm" h="100%" style={{ background: "var(--mantine-color-body)" }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
        <Text size="xs" c="dimmed" fw={600} tt="uppercase" lh={1.3}>
          {label}
        </Text>
        <ThemeIcon variant="light" color={color} size={30} radius="md">
          {icon}
        </ThemeIcon>
      </Group>
      <Text fw={700} fz={26} lh={1.1} mt={4}>
        {value}
      </Text>
      {sub && (
        <Text size="xs" c="dimmed" mt={2}>
          {sub}
        </Text>
      )}
      {progress && <Box mt="xs">{progress}</Box>}
    </Paper>
  );
  return tooltip ? (
    <Tooltip label={tooltip} multiline w={260} withArrow openDelay={300}>
      {card}
    </Tooltip>
  ) : (
    card
  );
}

export default function MatrixStatsHeader({
  event,
  meetings,
  agenda,
  attendees,
  surveys,
  selectedDate,
  eventDates,
  onDateChange,
  meetingsPerDay = {},
  now,
  formatDate,
  children,
}: Props) {
  const cfg = event?.config || {};
  const logo = event?.dashboardLogo || event?.eventImage;
  const numTables = Number(cfg.numTables) || 0;

  const stats = useMemo(() => {
    const accepted = meetings.filter((m) => m.status === "accepted");
    const pending = meetings.filter((m) => m.status === "pending");
    // Igual que el contador por día de la matriz: sin meetingDate cuenta para el día activo
    const dayMeetings = accepted.filter((m) => (m.meetingDate || selectedDate) === selectedDate);
    const external = dayMeetings.filter((m) => m.isExternal).length;

    // Cupos de agenda del día (sin descansos)
    const daySlots = agenda.filter((s) => (!s.date || s.date === selectedDate) && !s.isBreak);
    const occupiedSlots = daySlots.filter((s) => s.meetingId || s.available === false).length;

    // Estado temporal de las reuniones del día respecto a la hora actual
    const today = dayjs(now).format("YYYY-MM-DD");
    const nowMin = now.getHours() * 60 + now.getMinutes();
    let done = 0;
    let live = 0;
    let upcoming = 0;
    dayMeetings.forEach((m) => {
      const [start, end] = String(m.timeSlot || "").split(" - ").map((t) => t.trim());
      const s = toMin(start);
      const e = toMin(end) ?? s;
      if (m.completed || !selectedDate || selectedDate < today) return void done++;
      if (selectedDate > today || s === null) return void upcoming++;
      if (e !== null && e <= nowMin) done++;
      else if (s <= nowMin) live++;
      else upcoming++;
    });

    // Check-in del día activo
    const dayKey = eventDates.length ? selectedDate : DEFAULT_CHECKIN_DAY;
    const checkedIn = attendees.filter((a) => isCheckedInOnDay(a, dayKey)).length;

    // Mesas con al menos una reunión en el día
    const activeTables = new Set(dayMeetings.map((m) => m.tableAssigned).filter(Boolean)).size;

    const withSurvey = dayMeetings.filter((m) => surveys[m.id]?.length).length;

    return {
      totalAccepted: accepted.length,
      pending: pending.length,
      day: dayMeetings.length,
      external,
      slotsTotal: daySlots.length,
      slotsOccupied: occupiedSlots,
      done,
      live,
      upcoming,
      isToday: selectedDate === today,
      checkedIn,
      attendees: attendees.length,
      activeTables,
      withSurvey,
    };
  }, [meetings, agenda, attendees, surveys, selectedDate, eventDates, now]);

  const occupancy = pct(stats.slotsOccupied, stats.slotsTotal);
  const occupancyColor = occupancy >= 85 ? "red" : occupancy >= 60 ? "orange" : "teal";

  const dayOptions = eventDates.map((d) => ({
    value: d,
    label: `${formatDate(d)} · ${meetingsPerDay[d] || 0} citas`,
  }));

  return (
    <Paper
      radius="lg"
      p={{ base: "md", sm: "lg" }}
      mt="md"
      mb="md"
      withBorder
      style={{
        background:
          "linear-gradient(135deg, var(--mantine-color-blue-0) 0%, var(--mantine-color-body) 55%, var(--mantine-color-teal-0) 100%)",
      }}
    >
      {/* Título + selector de día */}
      <Group justify="space-between" align="center" gap="md" mb="md">
        <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
          {logo && (
            <Box
              component="img"
              src={logo}
              alt=""
              h={48}
              maw={120}
              style={{ objectFit: "contain", borderRadius: 8 }}
            />
          )}
          <div style={{ minWidth: 0 }}>
            <Group gap={8}>
              <Text size="xs" fw={700} tt="uppercase" c="blue.7" style={{ letterSpacing: 0.8 }}>
                Operación de mesas
              </Text>
              <Badge
                size="xs"
                variant="dot"
                color="green"
                title="Los datos se actualizan en tiempo real"
              >
                En vivo · {dayjs(now).format("HH:mm")}
              </Badge>
            </Group>
            <Title order={2} lh={1.2} style={{ wordBreak: "break-word" }}>
              {event?.eventName || "Evento"}
            </Title>
          </div>
        </Group>

        {eventDates.length > 1 &&
          (eventDates.length <= 4 ? (
            <SegmentedControl
              value={selectedDate || ""}
              onChange={onDateChange}
              data={dayOptions}
              radius="md"
            />
          ) : (
            <Select
              value={selectedDate}
              onChange={(v) => v && onDateChange(v)}
              data={dayOptions}
              allowDeselect={false}
              w={220}
            />
          ))}
        {eventDates.length === 1 && selectedDate && (
          <Badge size="lg" variant="light" color="blue" radius="md">
            {formatDate(selectedDate)}
          </Badge>
        )}
      </Group>

      {/* Métricas */}
      <SimpleGrid cols={{ base: 2, sm: 3, md: 4, xl: 7 }} spacing="sm">
        <StatCard
          icon={<IconCalendarCheck size={18} />}
          color="teal"
          label="Citas del día"
          value={stats.day}
          sub={
            <>
              {stats.totalAccepted} en todo el evento
              {stats.external > 0 && ` · ${stats.external} externas`}
            </>
          }
        />
        <StatCard
          icon={<IconChartPie size={18} />}
          color={occupancyColor}
          label="Ocupación agenda"
          value={`${occupancy}%`}
          sub={`${stats.slotsOccupied} de ${stats.slotsTotal} cupos`}
          tooltip="Cupos (mesa × franja) del día que ya tienen una reunión asignada. No incluye descansos."
          progress={<Progress value={occupancy} color={occupancyColor} size="sm" radius="xl" />}
        />
        <StatCard
          icon={<IconClockPlay size={18} />}
          color="grape"
          label={stats.isToday ? "En curso ahora" : "Estado del día"}
          value={stats.isToday ? stats.live : stats.upcoming > 0 ? `${stats.upcoming} por iniciar` : `${stats.done} finalizadas`}
          sub={`${stats.done} finalizadas · ${stats.upcoming} por iniciar`}
          tooltip="Según la franja horaria de cada cita y la hora actual (o marcadas como completadas)."
          progress={
            stats.day > 0 ? (
              <Progress.Root size="sm" radius="xl">
                <Progress.Section value={pct(stats.done, stats.day)} color="gray.5" />
                <Progress.Section value={pct(stats.live, stats.day)} color="grape" />
                <Progress.Section value={pct(stats.upcoming, stats.day)} color="grape.2" />
              </Progress.Root>
            ) : undefined
          }
        />
        <StatCard
          icon={<IconHourglassHigh size={18} />}
          color="yellow"
          label="Pendientes"
          value={stats.pending}
          sub="solicitudes sin responder"
          tooltip="Solicitudes de reunión de todo el evento que aún no han sido aceptadas ni rechazadas."
        />
        <StatCard
          icon={<IconUserCheck size={18} />}
          color="blue"
          label="Check-in"
          value={stats.checkedIn}
          sub={`de ${stats.attendees} registrados (${pct(stats.checkedIn, stats.attendees)}%)`}
          progress={<Progress value={pct(stats.checkedIn, stats.attendees)} size="sm" radius="xl" />}
        />
        <StatCard
          icon={<IconTable size={18} />}
          color="indigo"
          label="Mesas activas"
          value={numTables ? `${stats.activeTables}/${numTables}` : stats.activeTables}
          sub="con al menos una cita"
        />
        <StatCard
          icon={<IconClipboardCheck size={18} />}
          color="pink"
          label="Encuestas"
          value={stats.withSurvey}
          sub={`de ${stats.day} citas del día (${pct(stats.withSurvey, stats.day)}%)`}
        />
      </SimpleGrid>

      {children && <Stack mt="md">{children}</Stack>}
    </Paper>
  );
}

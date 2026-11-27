/**
 * Control del destacado en vivo (/admin/event/:eventId/spotlight). Pensada para usarse desde el
 * celular junto al escenario: se arma antes la lista de quienes van a pasar y en el evento se
 * activa con un toque ("Activar" / "Siguiente" / "Terminar"). Incluye métricas por destacado.
 * Modelo de datos y reglas: src/utils/spotlight.ts.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Container,
  Group,
  Loader,
  Modal,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowUp,
  IconBuilding,
  IconDownload,
  IconPlayerPlay,
  IconPlayerSkipForward,
  IconPlayerStop,
  IconPlus,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import * as XLSX from "xlsx";
import { auth, db } from "../../firebase/firebaseConfig";
import {
  type Spotlight,
  type SpotlightInterest,
  type SpotlightType,
  DEFAULT_SPOTLIGHT_HEADLINE,
  engagementCol,
  interestsCol,
  isSpotlightLive,
  spotlightDoc,
  spotlightEndedMs,
  spotlightEndsMs,
  spotlightsCol,
  spotlightStartedMs,
} from "../../utils/spotlight";

interface Target {
  type: SpotlightType;
  id: string;
  displayName: string;
  subtitle: string;
  imageUrl: string | null;
  description: string;
}

interface Metrics {
  seen: number;
  opened: number;
  requestClicked: number;
  interested: number;
  requests: number;
  accepted: number;
}

const DURATION_OPTIONS = [
  { value: "0", label: "Sin límite (lo apago yo)" },
  { value: "5", label: "5 minutos" },
  { value: "10", label: "10 minutos" },
  { value: "15", label: "15 minutos" },
  { value: "20", label: "20 minutos" },
  { value: "30", label: "30 minutos" },
  { value: "45", label: "45 minutos" },
  { value: "60", label: "1 hora" },
];

const fmtTime = (ms: number | null) =>
  ms ? new Date(ms).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDateTime = (ms: number | null) =>
  ms ? new Date(ms).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }) : "—";
const fmtRemaining = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function SpotlightAdminPage() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const [eventName, setEventName] = useState("");
  const [attendees, setAttendees] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [spotlights, setSpotlights] = useState<Spotlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const closingRef = useRef(new Set<string>());

  // Formulario
  const [type, setType] = useState<SpotlightType>("attendee");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [headline, setHeadline] = useState(DEFAULT_SPOTLIGHT_HEADLINE);
  const [note, setNote] = useState("");
  const [duration, setDuration] = useState("0");
  const [allowMultiple, setAllowMultiple] = useState(false);

  // Métricas
  const [metrics, setMetrics] = useState<Record<string, Metrics>>({});
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [interestsModal, setInterestsModal] = useState<{ spotlight: Spotlight; list: SpotlightInterest[] } | null>(null);

  useEffect(() => {
    if (!eventId) return;
    (async () => {
      try {
        const [eventSnap, usersSnap, companiesSnap] = await Promise.all([
          getDoc(doc(db, "events", eventId)),
          getDocs(query(collection(db, "users"), where("eventId", "==", eventId))),
          getDocs(collection(db, "events", eventId, "companies")),
        ]);
        setEventName(eventSnap.data()?.eventName || "");
        setAttendees(usersSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        setCompanies(companiesSnap.docs.map((d) => ({ nitNorm: d.id, ...(d.data() as any) })));
      } finally {
        setLoading(false);
      }
    })();
    return onSnapshot(spotlightsCol(eventId), (snap) =>
      setSpotlights(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Spotlight)),
    );
  }, [eventId]);

  // Reloj para la cuenta regresiva y el apagado automático
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const live = useMemo(
    () => spotlights.filter((s) => isSpotlightLive(s, now)).sort((a, b) => spotlightStartedMs(a) - spotlightStartedMs(b)),
    [spotlights, now],
  );
  const queued = useMemo(
    () => spotlights.filter((s) => s.status === "queued").sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [spotlights],
  );
  const history = useMemo(
    () =>
      spotlights
        .filter((s) => s.startedAt && !isSpotlightLive(s, now))
        .sort((a, b) => spotlightStartedMs(b) - spotlightStartedMs(a)),
    [spotlights, now],
  );

  // Los que vencieron quedan como "done" (los asistentes ya los ocultan por su cuenta)
  useEffect(() => {
    const expired = spotlights.filter(
      (s) => s.status === "live" && !isSpotlightLive(s, now) && !closingRef.current.has(s.id),
    );
    expired.forEach((s) => {
      closingRef.current.add(s.id);
      updateDoc(spotlightDoc(eventId, s.id), { status: "done", endedAt: s.endsAt || Timestamp.now() }).catch(() =>
        closingRef.current.delete(s.id),
      );
    });
  }, [spotlights, now, eventId]);

  // ------------------------------------------------------------------ opciones

  const attendeeOptions = useMemo(
    () =>
      attendees
        .map((a) => ({
          value: a.id,
          label: [a.nombre || "Sin nombre", a.company_razonSocial || a.empresa].filter(Boolean).join(" — "),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "es")),
    [attendees],
  );
  const companyOptions = useMemo(
    () =>
      companies
        .map((c) => ({ value: c.nitNorm, label: c.razonSocial || c.nitNorm }))
        .sort((a, b) => a.label.localeCompare(b.label, "es")),
    [companies],
  );

  const buildTarget = (t: SpotlightType, id: string): Target | null => {
    if (t === "attendee") {
      const a = attendees.find((x) => x.id === id);
      if (!a) return null;
      return {
        type: t,
        id,
        displayName: a.nombre || "Asistente",
        subtitle: [a.cargo, a.company_razonSocial || a.empresa].filter(Boolean).join(" · "),
        imageUrl: a.photoURL || null,
        description: a.descripcion || "",
      };
    }
    const c = companies.find((x) => x.nitNorm === id);
    if (!c) return null;
    const reps = attendees.filter((a) => a.companyId === id).length;
    return {
      type: t,
      id,
      displayName: c.razonSocial || id,
      subtitle: reps ? `${reps} ${reps === 1 ? "representante" : "representantes"}` : "",
      imageUrl: c.logoUrl || null,
      description: c.descripcion || "",
    };
  };

  // ------------------------------------------------------------------ acciones

  const liveFields = (minutes: number) => ({
    status: "live",
    startedAt: serverTimestamp(),
    endsAt: minutes > 0 ? Timestamp.fromMillis(Date.now() + minutes * 60_000) : null,
    endedAt: null,
    durationMinutes: minutes > 0 ? minutes : null,
  });

  /** Termina los que están en vivo (salvo que se permitan varios a la vez) */
  const endOthers = (batch: ReturnType<typeof writeBatch>, exceptId?: string) => {
    if (allowMultiple) return;
    live
      .filter((s) => s.id !== exceptId)
      .forEach((s) => batch.update(spotlightDoc(eventId, s.id), { status: "done", endedAt: serverTimestamp() }));
  };

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) showNotification({ message: ok, color: "teal" });
    } catch (err) {
      console.error(err);
      showNotification({ title: "Error", message: "No se pudo completar la acción.", color: "red" });
    } finally {
      setBusy(false);
    }
  };

  const createFromForm = (activate: boolean) =>
    run(async () => {
      if (!targetId) return;
      const target = buildTarget(type, targetId);
      if (!target) return;
      const minutes = Number(duration) || 0;
      const base = {
        type: target.type,
        targetId: target.id,
        displayName: target.displayName,
        subtitle: target.subtitle,
        imageUrl: target.imageUrl,
        description: target.description,
        headline: headline.trim() || DEFAULT_SPOTLIGHT_HEADLINE,
        note: note.trim(),
        order: (queued.at(-1)?.order ?? 0) + 1,
        durationMinutes: minutes > 0 ? minutes : null,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.uid || null,
      };
      if (activate) {
        const batch = writeBatch(db);
        endOthers(batch);
        batch.set(doc(spotlightsCol(eventId)), { ...base, ...liveFields(minutes) });
        await batch.commit();
      } else {
        await addDoc(spotlightsCol(eventId), { ...base, status: "queued" });
      }
      setTargetId(null);
      setNote("");
    }, activate ? "¡Destacado en vivo!" : "Agregado a la lista");

  const activate = (s: Spotlight) =>
    run(async () => {
      const batch = writeBatch(db);
      endOthers(batch, s.id);
      batch.update(spotlightDoc(eventId, s.id), liveFields(s.durationMinutes || 0));
      await batch.commit();
    }, `${s.displayName} está en vivo`);

  const activateNext = () => queued[0] && activate(queued[0]);

  const end = (s: Spotlight) =>
    run(() => updateDoc(spotlightDoc(eventId, s.id), { status: "done", endedAt: serverTimestamp() }), "Destacado terminado");

  const extend = (s: Spotlight, minutes: number) =>
    run(() => {
      const base = spotlightEndsMs(s) ?? Date.now();
      return updateDoc(spotlightDoc(eventId, s.id), {
        endsAt: Timestamp.fromMillis(Math.max(base, Date.now()) + minutes * 60_000),
      });
    });

  const removeLimit = (s: Spotlight) => run(() => updateDoc(spotlightDoc(eventId, s.id), { endsAt: null }));

  /** Vuelve a destacar a alguien que ya pasó: doc nuevo, para no mezclar métricas */
  const featureAgain = (s: Spotlight) =>
    run(async () => {
      const batch = writeBatch(db);
      endOthers(batch);
      const { id: _id, startedAt: _s, endsAt: _e, endedAt: _d, ...rest } = s;
      batch.set(doc(spotlightsCol(eventId)), {
        ...rest,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.uid || null,
        ...liveFields(s.durationMinutes || 0),
      });
      await batch.commit();
    }, `${s.displayName} está en vivo`);

  const move = (index: number, dir: -1 | 1) =>
    run(async () => {
      const a = queued[index];
      const b = queued[index + dir];
      if (!a || !b) return;
      const batch = writeBatch(db);
      batch.update(spotlightDoc(eventId, a.id), { order: b.order });
      batch.update(spotlightDoc(eventId, b.id), { order: a.order === b.order ? a.order + dir : a.order });
      await batch.commit();
    });

  const remove = (s: Spotlight) => run(() => deleteDoc(spotlightDoc(eventId, s.id)));

  // ------------------------------------------------------------------ métricas

  const historyIds = history.map((s) => s.id).join(",");
  const loadMetrics = async () => {
    if (!history.length) return;
    setMetricsLoading(true);
    try {
      const entries = await Promise.all(
        history.map(async (s): Promise<[string, Metrics]> => {
          const eng = engagementCol(eventId, s.id);
          const [seen, opened, requestClicked, interested, meetingsSnap] = await Promise.all([
            getCountFromServer(query(eng, where("seenAt", "!=", null))),
            getCountFromServer(query(eng, where("openedAt", "!=", null))),
            getCountFromServer(query(eng, where("requestClickedAt", "!=", null))),
            getCountFromServer(interestsCol(eventId, s.id)),
            getDocs(query(collection(db, "events", eventId, "meetings"), where("spotlightId", "==", s.id))),
          ]);
          const meetings = meetingsSnap.docs.map((d) => d.data());
          return [
            s.id,
            {
              seen: seen.data().count,
              opened: opened.data().count,
              requestClicked: requestClicked.data().count,
              interested: interested.data().count,
              requests: meetings.length,
              accepted: meetings.filter((m) => m.status === "accepted").length,
            },
          ];
        }),
      );
      setMetrics(Object.fromEntries(entries));
    } catch (err) {
      console.error("Error cargando métricas del destacado:", err);
      showNotification({ title: "Error", message: "No se pudieron cargar las métricas.", color: "red" });
    } finally {
      setMetricsLoading(false);
    }
  };

  useEffect(() => {
    loadMetrics();
    // Solo cuando cambia la lista de terminados
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyIds]);

  const openInterests = async (s: Spotlight) => {
    const snap = await getDocs(interestsCol(eventId, s.id));
    setInterestsModal({
      spotlight: s,
      list: snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as SpotlightInterest),
    });
  };

  const exportInterests = () => {
    if (!interestsModal) return;
    const rows = interestsModal.list.map((i) => ({
      Nombre: i.nombre,
      Empresa: i.empresa || "",
      Cargo: i.cargo || "",
      Teléfono: i.telefono || "",
      Correo: i.correo || "",
      Tipo: i.tipoAsistente || "",
      Fecha: fmtDateTime(i.createdAt?.toMillis?.() ?? null),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Interesados");
    XLSX.writeFile(wb, `interesados_${interestsModal.spotlight.displayName.replace(/[^\w]+/g, "_")}.xlsx`);
  };

  const exportMetrics = () => {
    const rows = history.map((s) => {
      const m = metrics[s.id];
      return {
        Destacado: s.displayName,
        Tipo: s.type === "company" ? "Empresa" : "Asistente",
        Inicio: fmtDateTime(spotlightStartedMs(s) || null),
        Fin: fmtDateTime(spotlightEndedMs(s)),
        "Lo vieron": m?.seen ?? "",
        "Abrieron detalle": m?.opened ?? "",
        "Tocaron Solicitar": m?.requestClicked ?? "",
        "Me interesa": m?.interested ?? "",
        Solicitudes: m?.requests ?? "",
        "Reuniones aceptadas": m?.accepted ?? "",
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Destacados");
    XLSX.writeFile(wb, `destacados_${eventId}.xlsx`);
  };

  // ------------------------------------------------------------------ render

  if (loading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  const avatarOf = (s: Spotlight, size = 44) => (
    <Avatar src={s.imageUrl || undefined} size={size} radius={s.type === "company" ? "md" : "xl"}>
      {s.type === "company" ? <IconBuilding size={size / 2} /> : s.displayName?.[0]?.toUpperCase()}
    </Avatar>
  );

  return (
    <Container size="md" py="md" px="sm">
      <Stack gap="md">
        <Group justify="space-between" wrap="nowrap">
          <Box style={{ minWidth: 0 }}>
            <Title order={3}>Destacado en vivo</Title>
            <Text size="sm" c="dimmed" lineClamp={1}>
              {eventName}
            </Text>
          </Box>
          <Button component={Link} to={`/admin/event/${eventId}`} variant="default" leftSection={<IconArrowLeft size={16} />}>
            Evento
          </Button>
        </Group>

        {/* En vivo */}
        <Paper withBorder radius="lg" p="md" style={live.length ? { borderColor: "var(--mantine-color-red-5)", borderWidth: 2 } : undefined}>
          <Group justify="space-between" mb="sm">
            <Group gap={8}>
              <Badge color={live.length ? "red" : "gray"} variant={live.length ? "filled" : "light"}>
                {live.length ? "En vivo" : "Nadie en vivo"}
              </Badge>
              {live.length > 1 && <Text size="sm">{live.length} destacados</Text>}
            </Group>
            <Switch
              label="Varios a la vez"
              checked={allowMultiple}
              onChange={(e) => setAllowMultiple(e.currentTarget.checked)}
            />
          </Group>

          <Stack gap="sm">
            {live.map((s) => {
              const ends = spotlightEndsMs(s);
              return (
                <Card key={s.id} withBorder radius="md" p="sm">
                  <Group wrap="nowrap" gap="sm">
                    {avatarOf(s, 52)}
                    <Box style={{ minWidth: 0, flex: 1 }}>
                      <Text fw={700} lineClamp={1}>
                        {s.displayName}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        Desde {fmtTime(spotlightStartedMs(s) || null)} ·{" "}
                        {ends ? `se apaga en ${fmtRemaining(ends - now)}` : "sin límite"}
                      </Text>
                    </Box>
                  </Group>
                  <Group gap="xs" mt="sm" grow>
                    <Button variant="light" onClick={() => extend(s, 5)} disabled={busy}>
                      +5 min
                    </Button>
                    {ends && (
                      <Button variant="default" onClick={() => removeLimit(s)} disabled={busy}>
                        Sin límite
                      </Button>
                    )}
                    <Button color="red" leftSection={<IconPlayerStop size={16} />} onClick={() => end(s)} loading={busy}>
                      Terminar
                    </Button>
                  </Group>
                </Card>
              );
            })}

            {queued.length > 0 && (
              <Button
                size="lg"
                color="red"
                variant={live.length ? "light" : "filled"}
                leftSection={<IconPlayerSkipForward size={20} />}
                onClick={activateNext}
                loading={busy}
              >
                {live.length && !allowMultiple ? "Siguiente" : "Activar"}: {queued[0].displayName}
              </Button>
            )}
            {!live.length && !queued.length && (
              <Text size="sm" c="dimmed">
                Agrega abajo a quien se va a presentar y actívalo cuando suba al escenario.
              </Text>
            )}
          </Stack>
        </Paper>

        {/* Agregar */}
        <Paper withBorder radius="lg" p="md">
          <Title order={5} mb="sm">
            Agregar persona o empresa
          </Title>
          <Stack gap="sm">
            <SegmentedControl
              value={type}
              onChange={(v) => {
                setType(v as SpotlightType);
                setTargetId(null);
              }}
              data={[
                { value: "attendee", label: "Asistente" },
                { value: "company", label: "Empresa" },
              ]}
              fullWidth
            />
            <Select
              placeholder={type === "attendee" ? "Busca por nombre o empresa" : "Busca la empresa"}
              data={type === "attendee" ? attendeeOptions : companyOptions}
              value={targetId}
              onChange={setTargetId}
              searchable
              clearable
              limit={50}
              nothingFoundMessage="Sin resultados"
            />
            <TextInput
              label="Texto superior"
              value={headline}
              onChange={(e) => setHeadline(e.currentTarget.value)}
              placeholder={DEFAULT_SPOTLIGHT_HEADLINE}
            />
            <Textarea
              label="Nota (opcional)"
              description="Ej. tema de la charla o dónde encontrarlo"
              value={note}
              onChange={(e) => setNote(e.currentTarget.value)}
              autosize
              minRows={2}
              maxLength={200}
            />
            <Select
              label="Apagar automáticamente"
              data={DURATION_OPTIONS}
              value={duration}
              onChange={(v) => setDuration(v || "0")}
              allowDeselect={false}
            />
            <Group grow>
              <Button variant="default" leftSection={<IconPlus size={16} />} disabled={!targetId} loading={busy} onClick={() => createFromForm(false)}>
                A la lista
              </Button>
              <Button color="red" leftSection={<IconPlayerPlay size={16} />} disabled={!targetId} loading={busy} onClick={() => createFromForm(true)}>
                Activar ahora
              </Button>
            </Group>
          </Stack>
        </Paper>

        {/* Lista */}
        {queued.length > 0 && (
          <Paper withBorder radius="lg" p="md">
            <Title order={5} mb="sm">
              Próximos ({queued.length})
            </Title>
            <Stack gap="xs">
              {queued.map((s, i) => (
                <Group key={s.id} wrap="nowrap" gap="sm">
                  <Text fw={700} c="dimmed" w={20} ta="center">
                    {i + 1}
                  </Text>
                  {avatarOf(s, 36)}
                  <Box style={{ minWidth: 0, flex: 1 }}>
                    <Text size="sm" fw={600} lineClamp={1}>
                      {s.displayName}
                    </Text>
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {s.durationMinutes ? `${s.durationMinutes} min` : "Sin límite"}
                      {s.note ? ` · ${s.note}` : ""}
                    </Text>
                  </Box>
                  <ActionIcon variant="subtle" disabled={i === 0 || busy} onClick={() => move(i, -1)} aria-label="Subir">
                    <IconArrowUp size={16} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    disabled={i === queued.length - 1 || busy}
                    onClick={() => move(i, 1)}
                    aria-label="Bajar"
                  >
                    <IconArrowDown size={16} />
                  </ActionIcon>
                  <ActionIcon variant="light" color="red" onClick={() => activate(s)} disabled={busy} aria-label="Activar">
                    <IconPlayerPlay size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="gray" onClick={() => remove(s)} disabled={busy} aria-label="Quitar">
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>
          </Paper>
        )}

        {/* Historial y métricas */}
        {history.length > 0 && (
          <Paper withBorder radius="lg" p="md">
            <Group justify="space-between" mb="sm">
              <Title order={5}>Ya se presentaron · métricas</Title>
              <Group gap="xs">
                <Tooltip label="Actualizar métricas">
                  <ActionIcon variant="default" onClick={loadMetrics} loading={metricsLoading} aria-label="Actualizar">
                    <IconRefresh size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Exportar a Excel">
                  <ActionIcon variant="default" onClick={exportMetrics} aria-label="Exportar">
                    <IconDownload size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>

            {(() => {
              const total = Object.values(metrics).reduce(
                (acc, m) => ({
                  requests: acc.requests + m.requests,
                  accepted: acc.accepted + m.accepted,
                  interested: acc.interested + m.interested,
                }),
                { requests: 0, accepted: 0, interested: 0 },
              );
              return (
                <SimpleGrid cols={3} mb="md">
                  <MetricTile label="Solicitudes generadas" value={total.requests} />
                  <MetricTile label="Reuniones aceptadas" value={total.accepted} />
                  <MetricTile label="Me interesa" value={total.interested} />
                </SimpleGrid>
              );
            })()}

            <Table.ScrollContainer minWidth={640}>
              <Table striped highlightOnHover verticalSpacing="xs" fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Destacado</Table.Th>
                    <Table.Th>Horario</Table.Th>
                    <Table.Th ta="right">Lo vieron</Table.Th>
                    <Table.Th ta="right">Abrieron</Table.Th>
                    <Table.Th ta="right">Tocaron Solicitar</Table.Th>
                    <Table.Th ta="right">Me interesa</Table.Th>
                    <Table.Th ta="right">Solicitudes</Table.Th>
                    <Table.Th ta="right">Aceptadas</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {history.map((s) => {
                    const m = metrics[s.id];
                    const cell = (v?: number) => (m ? v : metricsLoading ? "…" : "—");
                    return (
                      <Table.Tr key={s.id}>
                        <Table.Td>
                          <Group gap="xs" wrap="nowrap">
                            {avatarOf(s, 28)}
                            <Text size="sm" fw={600} lineClamp={1}>
                              {s.displayName}
                            </Text>
                          </Group>
                        </Table.Td>
                        <Table.Td style={{ whiteSpace: "nowrap" }}>
                          {fmtDateTime(spotlightStartedMs(s) || null)} – {fmtTime(spotlightEndedMs(s))}
                        </Table.Td>
                        <Table.Td ta="right">{cell(m?.seen)}</Table.Td>
                        <Table.Td ta="right">{cell(m?.opened)}</Table.Td>
                        <Table.Td ta="right">{cell(m?.requestClicked)}</Table.Td>
                        <Table.Td ta="right">
                          {m?.interested ? (
                            <Button size="compact-xs" variant="light" color="pink" onClick={() => openInterests(s)}>
                              {m.interested}
                            </Button>
                          ) : (
                            cell(m?.interested)
                          )}
                        </Table.Td>
                        <Table.Td ta="right">{cell(m?.requests)}</Table.Td>
                        <Table.Td ta="right">{cell(m?.accepted)}</Table.Td>
                        <Table.Td>
                          <Tooltip label="Destacar de nuevo">
                            <ActionIcon variant="subtle" color="red" onClick={() => featureAgain(s)} disabled={busy} aria-label="Destacar de nuevo">
                              <IconPlayerPlay size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            <Text size="xs" c="dimmed" mt="xs">
              "Lo vieron" cuenta a quienes tenían el dashboard abierto mientras estuvo en vivo. Las solicitudes incluyen
              las enviadas después desde "Se presentaron hoy".
            </Text>
          </Paper>
        )}
      </Stack>

      <Modal
        opened={!!interestsModal}
        onClose={() => setInterestsModal(null)}
        title={`Interesados en ${interestsModal?.spotlight.displayName || ""}`}
        size="lg"
      >
        {interestsModal && (
          <Stack gap="sm">
            <Group justify="flex-end">
              <Button size="xs" variant="light" leftSection={<IconDownload size={14} />} onClick={exportInterests}>
                Exportar Excel
              </Button>
            </Group>
            <Table.ScrollContainer minWidth={520}>
              <Table striped fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Nombre</Table.Th>
                    <Table.Th>Empresa</Table.Th>
                    <Table.Th>Teléfono</Table.Th>
                    <Table.Th>Correo</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {interestsModal.list.map((i) => (
                    <Table.Tr key={i.id}>
                      <Table.Td>{i.nombre}</Table.Td>
                      <Table.Td>{i.empresa}</Table.Td>
                      <Table.Td>{i.telefono}</Table.Td>
                      <Table.Td>{i.correo}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>
        )}
      </Modal>
    </Container>
  );
}

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <Card withBorder radius="md" p="sm">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Title order={3}>{value}</Title>
    </Card>
  );
}

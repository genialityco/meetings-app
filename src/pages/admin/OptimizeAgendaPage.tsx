import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Container,
  Title,
  Text,
  Button,
  Group,
  Stack,
  Paper,
  NumberInput,
  TextInput,
  Badge,
  Table,
  ScrollArea,
  Alert,
  Loader,
  Center,
  Divider,
  Stepper,
  ActionIcon,
  Grid,
  ThemeIcon,
  Progress,
  Tooltip,
  Select,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import {
  IconArrowLeft,
  IconRocket,
  IconCheck,
  IconAlertCircle,
  IconUpload,
  IconDatabase,
  IconCalendar,
  IconUsers,
  IconTrash,
  IconPlus,
  IconInfoCircle,
  IconPlayerPlay,
} from "@tabler/icons-react";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  addDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";

// ─── Tipos ──────────────────────────────────────────────────────────────────

interface Asistente {
  id: string;
  tipoAsistente: string;
  nombre?: string;
  empresa?: string;
  companyId?: string;
  descripcion?: string;
  correo?: string;
  [key: string]: unknown;
}

interface MatchPair {
  userId1: string;
  userId2: string;
  affinityScore: number;
}

interface OptimizerConfig {
  horaInicio: string;
  horaFin: string;
  duracionCitaMin: number;
  descansoEntreCitasMin: number;
  silasDisponibles: number;
  descansos: string[][];
  umbralAfinidad: number;
  umbralRelleno: number;
  bonoColsubsidio: number;
  minReunionesColsubsidio: number;
  minReunionesNoColsubsidio: number;
  excluirEmpresasCompradoras: string[];
  fusionarCompanyIds: string[][];
  campoColsubsidio: string | null;
  maxTimeSolverSeconds: number;
}

interface Reunion {
  bloque: string;
  comprador_id: string;
  comprador_nombre: string;
  comprador_empresa: string;
  vendedor_id: string;
  vendedor_nombre: string;
  vendedor_empresa: string;
  afinidad: number;
  vendedor_colsubsidio?: boolean | null;
}

interface OptimizeResponse {
  status: "optimal" | "feasible" | "infeasible" | "unknown";
  reuniones: Reunion[];
  stats: {
    total: number;
    bloques: number;
    compradores: number;
    vendedores: number;
    pares_validos: number;
    pares_principales: number;
  };
}

interface AgendaSlot {
  id: string;
  startTime: string;
  endTime: string;
  tableNumber: number | string;
  available: boolean;
  date?: string;
  meetingId?: string | null;
}

const DEFAULT_CONFIG: OptimizerConfig = {
  horaInicio: "08:30",
  horaFin: "13:00",
  duracionCitaMin: 20,
  descansoEntreCitasMin: 0,
  silasDisponibles: 23,
  descansos: [["10:30", "11:00"]],
  umbralAfinidad: 50,
  umbralRelleno: 1,
  bonoColsubsidio: 0.2,
  minReunionesColsubsidio: 6,
  minReunionesNoColsubsidio: 4,
  excluirEmpresasCompradoras: [],
  fusionarCompanyIds: [],
  campoColsubsidio: null,
  maxTimeSolverSeconds: 120,
};

const API_URL = import.meta.env.VITE_OPTIMIZER_API_URL || "http://localhost:8080";

// ─── Componente ─────────────────────────────────────────────────────────────

export default function OptimizeAgendaPage() {
  const { eventId } = useParams<{ eventId: string }>();

  // Paso del stepper
  const [activeStep, setActiveStep] = useState(0);

  // Datos de Firestore
  const [attendees, setAttendees] = useState<Asistente[]>([]);
  const [agendaSlots, setAgendaSlots] = useState<AgendaSlot[]>([]);
  const [matches, setMatches] = useState<MatchPair[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [availableDates, setAvailableDates] = useState<string[]>([]);

  // Config
  const [config, setConfig] = useState<OptimizerConfig>(DEFAULT_CONFIG);

  // Resultados
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResponse | null>(null);

  // Estados de carga
  const [loadingAttendees, setLoadingAttendees] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [loadingOptimize, setLoadingOptimize] = useState(false);
  const [loadingCreate, setLoadingCreate] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Carga inicial: asistentes, agenda y config del evento ─────────────────
  useEffect(() => {
    if (!eventId) return;
    setLoadingAttendees(true);

    Promise.all([
      getDocs(query(collection(db, "users"), where("eventId", "==", eventId))),
      getDocs(collection(db, "events", eventId, "agenda")),
      getDoc(doc(db, "events", eventId)),
    ])
      .then(([attendeesSnap, agendaSnap, eventSnap]) => {
        setAttendees(attendeesSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Asistente));

        const slots = agendaSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as AgendaSlot);
        setAgendaSlots(slots);

        // Extraer fechas disponibles
        const dates = [...new Set(slots.map((s) => s.date).filter(Boolean))] as string[];
        dates.sort();
        setAvailableDates(dates);
        if (dates.length > 0) setSelectedDate(dates[0]);

        // Aplicar defaults desde event.config
        if (eventSnap.exists()) {
          const eventCfg = eventSnap.data().config || {};
          setConfig((prev) => ({
            ...prev,
            silasDisponibles: eventCfg.tables ?? prev.silasDisponibles,
          }));
        }
      })
      .finally(() => setLoadingAttendees(false));
  }, [eventId]);

  // ── Cargar matches desde affinityScores de Firestore ────────────────────
  const handleLoadMatchesFromFirestore = async () => {
    if (!attendees.length) return;
    setLoadingMatches(true);
    try {
      const pares: Map<string, number> = new Map();

      await Promise.all(
        attendees.map(async (a) => {
          const scoresSnap = await getDocs(
            collection(db, "users", a.id, "affinityScores")
          );
          scoresSnap.docs.forEach((d) => {
            const data = d.data();
            const targetId: string = data.targetUserId;
            const score: number = data.score ?? 0;
            if (!targetId || score <= 0) return;
            // Clave canónica para deduplicar (orden lexicográfico)
            const key = [a.id, targetId].sort().join("___");
            if (!pares.has(key) || pares.get(key)! < score) {
              pares.set(key, score);
            }
          });
        })
      );

      const result: MatchPair[] = [];
      pares.forEach((score, key) => {
        const [u1, u2] = key.split("___");
        result.push({ userId1: u1, userId2: u2, affinityScore: score });
      });

      setMatches(result);
      showNotification({ message: `${result.length} compatibilidades cargadas desde Firestore`, color: "green" });
    } catch (e) {
      showNotification({ message: "Error cargando compatibilidades", color: "red" });
    } finally {
      setLoadingMatches(false);
    }
  };

  // ── Cargar matches desde archivo JSON ─────────────────────────────────────
  const handleLoadMatchesFromFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        const list: MatchPair[] = (json.matches || json).map((m: MatchPair) => ({
          userId1: m.userId1,
          userId2: m.userId2,
          affinityScore: m.affinityScore,
        }));
        setMatches(list);
        showNotification({ message: `${list.length} compatibilidades cargadas desde archivo`, color: "green" });
      } catch {
        showNotification({ message: "Archivo JSON inválido", color: "red" });
      }
    };
    reader.readAsText(file);
  };

  // ── Optimizar ──────────────────────────────────────────────────────────────
  const handleOptimize = async () => {
    if (!matches.length) {
      showNotification({ message: "Primero carga las compatibilidades", color: "orange" });
      return;
    }
    setLoadingOptimize(true);
    setOptimizeResult(null);
    try {
      const body = {
        asistentes: attendees.map((a) => ({
          id: a.id,
          tipoAsistente: a.tipoAsistente || "",
          nombre: a.nombre || "",
          empresa: a.empresa || "",
          companyId: a.companyId || null,
          descripcion: a.descripcion || null,
          correo: a.correo || null,
        })),
        matches,
        config,
      };

      const res = await fetch(`${API_URL}/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }

      const result: OptimizeResponse = await res.json();
      setOptimizeResult(result);
      setActiveStep(3);
    } catch (e: unknown) {
      showNotification({
        message: `Error al optimizar: ${e instanceof Error ? e.message : String(e)}`,
        color: "red",
      });
    } finally {
      setLoadingOptimize(false);
    }
  };

  // ── Crear reuniones en Firestore ──────────────────────────────────────────
  const handleCreateMeetings = async () => {
    if (!optimizeResult?.reuniones.length) return;
    setLoadingCreate(true);
    setCreatedCount(0);

    // Filtrar slots por fecha seleccionada y disponibles
    const slotsDisponibles = agendaSlots.filter(
      (s) =>
        s.available &&
        !s.meetingId &&
        (availableDates.length === 0 || !s.date || s.date === selectedDate)
    );

    // Agrupar por startTime para asignación rápida
    const slotsByStartTime: Map<string, AgendaSlot[]> = new Map();
    slotsDisponibles.forEach((s) => {
      const t = s.startTime;
      if (!slotsByStartTime.has(t)) slotsByStartTime.set(t, []);
      slotsByStartTime.get(t)!.push(s);
    });

    // Rastrear slots ya usados en esta operación
    const usedSlotIds = new Set<string>();
    let created = 0;
    let skipped = 0;

    for (const reunion of optimizeResult.reuniones) {
      // startTime = primera parte del bloque "HH:MM-HH:MM"
      const startTime = reunion.bloque.split("-")[0];
      const candidatos = slotsByStartTime.get(startTime) || [];
      const slot = candidatos.find((s) => !usedSlotIds.has(s.id));

      if (!slot) {
        console.warn(`Sin slot disponible para bloque ${reunion.bloque} (comprador: ${reunion.comprador_nombre})`);
        skipped++;
        continue;
      }

      try {
        const meetingRef = await addDoc(
          collection(db, "events", eventId!, "meetings"),
          {
            eventId,
            requesterId: reunion.comprador_id,
            receiverId: reunion.vendedor_id,
            status: "accepted",
            slotId: slot.id,
            startTime: slot.startTime,
            endTime: slot.endTime,
            tableNumber: slot.tableNumber,
            affinityScore: reunion.afinidad,
            agendadoAutomatico: true,
            isNotificated: false,
            createdAt: new Date(),
          }
        );

        await updateDoc(doc(db, "events", eventId!, "agenda", slot.id), {
          available: false,
          meetingId: meetingRef.id,
        });

        usedSlotIds.add(slot.id);
        created++;
        setCreatedCount(created);
      } catch (e) {
        console.error("Error creando reunión:", e);
        skipped++;
      }
    }

    showNotification({
      message: `${created} reuniones creadas. ${skipped > 0 ? `${skipped} no pudieron asignarse (sin slot disponible).` : ""}`,
      color: created > 0 ? "green" : "orange",
    });

    // Recargar agenda para reflejar cambios
    const agendaSnap = await getDocs(collection(db, "events", eventId!, "agenda"));
    setAgendaSlots(agendaSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as AgendaSlot));

    setLoadingCreate(false);
  };

  // ── Helpers de UI ─────────────────────────────────────────────────────────
  const compradores = attendees.filter(
    (a) => a.tipoAsistente?.toLowerCase() === "comprador"
  );
  const vendedores = attendees.filter(
    (a) => a.tipoAsistente?.toLowerCase() === "vendedor"
  );

  const slotsDisponiblesFiltrados = agendaSlots.filter(
    (s) =>
      s.available &&
      (!s.date || !selectedDate || s.date === selectedDate)
  );

  const updateConfig = (key: keyof OptimizerConfig, value: unknown) =>
    setConfig((prev) => ({ ...prev, [key]: value }));

  const updateDescanso = (idx: number, part: 0 | 1, value: string) => {
    const updated = config.descansos.map((d, i) =>
      i === idx ? (part === 0 ? [value, d[1]] : [d[0], value]) : d
    );
    updateConfig("descansos", updated);
  };

  const addDescanso = () =>
    updateConfig("descansos", [...config.descansos, ["10:00", "10:30"]]);

  const removeDescanso = (idx: number) =>
    updateConfig(
      "descansos",
      config.descansos.filter((_, i) => i !== idx)
    );

  const statusColor = {
    optimal: "green",
    feasible: "yellow",
    infeasible: "red",
    unknown: "gray",
  } as const;

  const statusLabel = {
    optimal: "Óptima",
    feasible: "Factible (no garantizada óptima)",
    infeasible: "Sin solución factible",
    unknown: "Desconocido",
  } as const;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Container size="xl" py="xl">
      {/* Encabezado */}
      <Group mb="xl">
        <ActionIcon
          component={Link}
          to={`/admin/event/${eventId}`}
          variant="subtle"
          size="lg"
        >
          <IconArrowLeft />
        </ActionIcon>
        <div>
          <Title order={2}>Optimización de Agenda CP-SAT</Title>
          <Text c="dimmed" size="sm">
            Generación automática de agenda óptima con solver de restricciones
          </Text>
        </div>
      </Group>

      <Stepper active={activeStep} onStepClick={setActiveStep} mb="xl">
        <Stepper.Step label="Datos" description="Asistentes y compatibilidades" />
        <Stepper.Step label="Configuración" description="Parámetros del evento" />
        <Stepper.Step label="Optimizar" description="Ejecutar solver" />
        <Stepper.Step label="Confirmar" description="Crear reuniones" />
      </Stepper>

      {/* ── PASO 0: DATOS ─────────────────────────────────────────────────── */}
      {activeStep === 0 && (
        <Stack>
          <Paper withBorder p="md">
            <Title order={4} mb="sm">Asistentes del evento</Title>
            {loadingAttendees ? (
              <Center py="md"><Loader size="sm" /></Center>
            ) : (
              <Group>
                <Badge size="lg" leftSection={<IconUsers size={14} />} color="blue">
                  {compradores.length} compradores
                </Badge>
                <Badge size="lg" leftSection={<IconUsers size={14} />} color="violet">
                  {vendedores.length} vendedores
                </Badge>
                <Badge size="lg" leftSection={<IconCalendar size={14} />} color="teal">
                  {slotsDisponiblesFiltrados.length} slots disponibles
                </Badge>
              </Group>
            )}
          </Paper>

          <Paper withBorder p="md">
            <Title order={4} mb="xs">Compatibilidades (matches)</Title>
            <Text size="sm" c="dimmed" mb="md">
              Carga los scores de afinidad entre compradores y vendedores. Puedes
              obtenerlos directamente de Firestore o subir el JSON exportado desde
              la página de Matches.
            </Text>
            <Group>
              <Button
                leftSection={<IconDatabase size={16} />}
                onClick={handleLoadMatchesFromFirestore}
                loading={loadingMatches}
                disabled={!attendees.length}
              >
                Cargar desde Firestore
              </Button>
              <Button
                leftSection={<IconUpload size={16} />}
                variant="light"
                onClick={() => fileInputRef.current?.click()}
              >
                Subir JSON
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files?.[0]) handleLoadMatchesFromFile(e.target.files[0]);
                  e.target.value = "";
                }}
              />
            </Group>

            {matches.length > 0 && (
              <Alert
                mt="md"
                color="green"
                icon={<IconCheck size={16} />}
              >
                {matches.length} pares de compatibilidades cargados
              </Alert>
            )}
          </Paper>

          {availableDates.length > 1 && (
            <Paper withBorder p="md">
              <Title order={4} mb="sm">Fecha de la rueda</Title>
              <Select
                label="Fecha"
                data={availableDates.map((d) => ({ value: d, label: d }))}
                value={selectedDate}
                onChange={(v) => setSelectedDate(v || "")}
                w={220}
              />
            </Paper>
          )}

          <Group justify="flex-end">
            <Button
              rightSection={<IconArrowLeft style={{ transform: "rotate(180deg)" }} size={16} />}
              onClick={() => setActiveStep(1)}
              disabled={!matches.length || !attendees.length}
            >
              Siguiente
            </Button>
          </Group>
        </Stack>
      )}

      {/* ── PASO 1: CONFIGURACIÓN ─────────────────────────────────────────── */}
      {activeStep === 1 && (
        <Stack>
          <Paper withBorder p="md">
            <Title order={4} mb="md">Horarios</Title>
            <Grid>
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <TextInput
                  label="Hora inicio"
                  placeholder="08:30"
                  value={config.horaInicio}
                  onChange={(e) => updateConfig("horaInicio", e.target.value)}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <TextInput
                  label="Hora fin"
                  placeholder="13:00"
                  value={config.horaFin}
                  onChange={(e) => updateConfig("horaFin", e.target.value)}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <NumberInput
                  label="Duración por cita (min)"
                  value={config.duracionCitaMin}
                  onChange={(v) => updateConfig("duracionCitaMin", Number(v))}
                  min={5}
                  max={120}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <NumberInput
                  label="Descanso entre citas (min)"
                  value={config.descansoEntreCitasMin}
                  onChange={(v) => updateConfig("descansoEntreCitasMin", Number(v))}
                  min={0}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <NumberInput
                  label="Sillas simultáneas (mesas)"
                  value={config.silasDisponibles}
                  onChange={(v) => updateConfig("silasDisponibles", Number(v))}
                  min={1}
                />
              </Grid.Col>
            </Grid>
          </Paper>

          <Paper withBorder p="md">
            <Group justify="space-between" mb="sm">
              <Title order={4}>Bloques de descanso</Title>
              <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={addDescanso}>
                Agregar
              </Button>
            </Group>
            {config.descansos.length === 0 && (
              <Text size="sm" c="dimmed">Sin bloques de descanso</Text>
            )}
            <Stack gap="xs">
              {config.descansos.map((d, idx) => (
                <Group key={idx}>
                  <TextInput
                    placeholder="10:30"
                    value={d[0]}
                    onChange={(e) => updateDescanso(idx, 0, e.target.value)}
                    w={90}
                  />
                  <Text>–</Text>
                  <TextInput
                    placeholder="11:00"
                    value={d[1]}
                    onChange={(e) => updateDescanso(idx, 1, e.target.value)}
                    w={90}
                  />
                  <ActionIcon color="red" variant="light" onClick={() => removeDescanso(idx)}>
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>
          </Paper>

          <Paper withBorder p="md">
            <Title order={4} mb="md">Restricciones de reuniones</Title>
            <Grid>
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <NumberInput
                  label="Umbral de afinidad principal"
                  description="Pares con score ≥ este valor son prioritarios"
                  value={config.umbralAfinidad}
                  onChange={(v) => updateConfig("umbralAfinidad", Number(v))}
                  min={1}
                  max={100}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <NumberInput
                  label="Umbral mínimo (relleno)"
                  description="Pares con score menor se ignoran"
                  value={config.umbralRelleno}
                  onChange={(v) => updateConfig("umbralRelleno", Number(v))}
                  min={1}
                  max={100}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <NumberInput
                  label="Mín. reuniones vendedor (general)"
                  value={config.minReunionesNoColsubsidio}
                  onChange={(v) => updateConfig("minReunionesNoColsubsidio", Number(v))}
                  min={0}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <NumberInput
                  label="Mín. reuniones vendedor Colsubsidio"
                  value={config.minReunionesColsubsidio}
                  onChange={(v) => updateConfig("minReunionesColsubsidio", Number(v))}
                  min={0}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <NumberInput
                  label="Tiempo máx. solver (seg)"
                  value={config.maxTimeSolverSeconds}
                  onChange={(v) => updateConfig("maxTimeSolverSeconds", Number(v))}
                  min={10}
                  max={600}
                />
              </Grid.Col>
            </Grid>
          </Paper>

          <Group justify="space-between">
            <Button variant="subtle" onClick={() => setActiveStep(0)}>
              Atrás
            </Button>
            <Button onClick={() => setActiveStep(2)}>
              Siguiente
            </Button>
          </Group>
        </Stack>
      )}

      {/* ── PASO 2: OPTIMIZAR ─────────────────────────────────────────────── */}
      {activeStep === 2 && (
        <Stack>
          <Paper withBorder p="md">
            <Title order={4} mb="md">Resumen antes de optimizar</Title>
            <Grid>
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <Stack gap={2}>
                  <Text size="xs" c="dimmed">Compradores</Text>
                  <Text fw={700} size="xl">{compradores.length}</Text>
                </Stack>
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <Stack gap={2}>
                  <Text size="xs" c="dimmed">Vendedores</Text>
                  <Text fw={700} size="xl">{vendedores.length}</Text>
                </Stack>
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <Stack gap={2}>
                  <Text size="xs" c="dimmed">Pares de afinidad</Text>
                  <Text fw={700} size="xl">{matches.length}</Text>
                </Stack>
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <Stack gap={2}>
                  <Text size="xs" c="dimmed">Slots disponibles</Text>
                  <Text fw={700} size="xl">{slotsDisponiblesFiltrados.length}</Text>
                </Stack>
              </Grid.Col>
            </Grid>

            <Divider my="md" />

            <Group>
              <Text size="sm">Horario:</Text>
              <Badge>{config.horaInicio} – {config.horaFin}</Badge>
              <Text size="sm">Citas de</Text>
              <Badge>{config.duracionCitaMin} min</Badge>
              <Text size="sm">Sillas:</Text>
              <Badge>{config.silasDisponibles}</Badge>
            </Group>

            <Alert icon={<IconInfoCircle size={16} />} color="blue" mt="md">
              El solver puede tardar hasta {config.maxTimeSolverSeconds} segundos según el tamaño del evento.
              La solución "factible" es válida aunque no garantice ser la óptima global.
            </Alert>
          </Paper>

          <Group justify="space-between">
            <Button variant="subtle" onClick={() => setActiveStep(1)}>
              Atrás
            </Button>
            <Button
              size="lg"
              leftSection={<IconRocket size={18} />}
              onClick={handleOptimize}
              loading={loadingOptimize}
            >
              Generar agenda óptima
            </Button>
          </Group>

          {loadingOptimize && (
            <Paper withBorder p="md">
              <Center>
                <Stack align="center" gap="xs">
                  <Loader size="md" />
                  <Text size="sm" c="dimmed">
                    Ejecutando solver CP-SAT… esto puede tomar hasta {config.maxTimeSolverSeconds}s
                  </Text>
                </Stack>
              </Center>
            </Paper>
          )}
        </Stack>
      )}

      {/* ── PASO 3: CONFIRMAR ─────────────────────────────────────────────── */}
      {activeStep === 3 && optimizeResult && (
        <Stack>
          <Paper withBorder p="md">
            <Group justify="space-between" mb="md">
              <Title order={4}>Resultado de la optimización</Title>
              <Badge
                size="lg"
                color={statusColor[optimizeResult.status] ?? "gray"}
              >
                {statusLabel[optimizeResult.status] ?? optimizeResult.status}
              </Badge>
            </Group>

            {optimizeResult.status === "infeasible" ? (
              <Alert color="red" icon={<IconAlertCircle size={16} />}>
                No se encontró solución factible. Revisa los parámetros de configuración,
                especialmente los umbrales de afinidad y mínimos de reuniones.
              </Alert>
            ) : (
              <>
                <Grid mb="md">
                  {[
                    { label: "Reuniones generadas", val: optimizeResult.stats.total },
                    { label: "Bloques de tiempo", val: optimizeResult.stats.bloques },
                    { label: "Compradores", val: optimizeResult.stats.compradores },
                    { label: "Vendedores", val: optimizeResult.stats.vendedores },
                    { label: "Pares válidos", val: optimizeResult.stats.pares_validos },
                    { label: "Pares principales (≥umbral)", val: optimizeResult.stats.pares_principales },
                  ].map(({ label, val }) => (
                    <Grid.Col key={label} span={{ base: 6, sm: 2 }}>
                      <Stack gap={2}>
                        <Text size="xs" c="dimmed">{label}</Text>
                        <Text fw={700} size="lg">{val}</Text>
                      </Stack>
                    </Grid.Col>
                  ))}
                </Grid>

                <ScrollArea h={400}>
                  <Table striped highlightOnHover withTableBorder withColumnBorders>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Bloque</Table.Th>
                        <Table.Th>Comprador</Table.Th>
                        <Table.Th>Empresa comprador</Table.Th>
                        <Table.Th>Vendedor</Table.Th>
                        <Table.Th>Empresa vendedor</Table.Th>
                        <Table.Th>Afinidad</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {optimizeResult.reuniones.map((r, idx) => (
                        <Table.Tr key={idx}>
                          <Table.Td>
                            <Badge variant="light" size="sm">{r.bloque}</Badge>
                          </Table.Td>
                          <Table.Td>{r.comprador_nombre}</Table.Td>
                          <Table.Td>{r.comprador_empresa}</Table.Td>
                          <Table.Td>{r.vendedor_nombre}</Table.Td>
                          <Table.Td>{r.vendedor_empresa}</Table.Td>
                          <Table.Td>
                            <Badge
                              color={r.afinidad >= 70 ? "green" : r.afinidad >= 40 ? "yellow" : "gray"}
                              size="sm"
                            >
                              {r.afinidad}
                            </Badge>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>

                <Divider my="md" />

                {availableDates.length > 1 && (
                  <Select
                    label="Crear reuniones en la fecha"
                    data={availableDates.map((d) => ({ value: d, label: d }))}
                    value={selectedDate}
                    onChange={(v) => setSelectedDate(v || "")}
                    w={220}
                    mb="md"
                  />
                )}

                {loadingCreate && (
                  <Stack gap="xs" mb="md">
                    <Text size="sm">
                      Creando reuniones: {createdCount} / {optimizeResult.reuniones.length}
                    </Text>
                    <Progress
                      value={(createdCount / optimizeResult.reuniones.length) * 100}
                      animated
                    />
                  </Stack>
                )}

                <Group justify="space-between">
                  <Button variant="subtle" onClick={() => setActiveStep(2)}>
                    Volver a optimizar
                  </Button>
                  <Tooltip label={`Crea ${optimizeResult.stats.total} reuniones en Firestore y bloquea los slots correspondientes`}>
                    <Button
                      size="lg"
                      color="green"
                      leftSection={<IconCheck size={18} />}
                      onClick={handleCreateMeetings}
                      loading={loadingCreate}
                    >
                      Confirmar y crear reuniones
                    </Button>
                  </Tooltip>
                </Group>
              </>
            )}
          </Paper>
        </Stack>
      )}

      {/* Paso 3 pero sin resultado aún */}
      {activeStep === 3 && !optimizeResult && (
        <Alert color="orange" icon={<IconAlertCircle size={16} />}>
          Aún no has ejecutado la optimización. Ve al paso anterior.
        </Alert>
      )}
    </Container>
  );
}

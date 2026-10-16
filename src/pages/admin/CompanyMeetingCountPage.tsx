// Conteo manual de reuniones por empresa (/admin/event/:eventId/conteo-reuniones).
// El equipo del evento pregunta a cada empresa cuántas reuniones hizo cada día y lo anota
// aquí, aparte de lo que cuenta el sistema. Se guarda por día en
// events/{eventId}/companies/{nit}.reunionesReportadasPorDia.{YYYY-MM-DD} (+ reunionesReportadasAt).
// Compatibilidad: el conteo único anterior (reunionesReportadas) se muestra como el día 1
// y se elimina al guardar ese día.
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Container,
  Group,
  Loader,
  NumberInput,
  Paper,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import { IconArrowLeft, IconCheck, IconSearch } from "@tabler/icons-react";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { normalizeTipoAsistente } from "../../utils/attendeeRole";
import { getEventDayKeys } from "../../utils/eventDays";

interface CompanyRow {
  nit: string;
  empresa: string;
  porDia: Record<string, number | null>;
  total: number;
  conConteo: boolean;
  legacy: boolean; // aún tiene el conteo único anterior (se muestra en el día 1)
}

const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const dayLabel = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  return new Date(y, m - 1, day).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
};

// Campo editable de un día: guarda al salir del campo o con Enter, solo si cambió.
function CountInput({
  eventId,
  nit,
  day,
  value,
  clearLegacy,
}: {
  eventId: string;
  nit: string;
  day: string;
  value: number | null;
  clearLegacy: boolean;
}) {
  const [draft, setDraft] = useState<number | string>(value ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  const save = async () => {
    const next = draft === "" || draft === null ? null : Math.max(0, Math.floor(Number(draft)));
    if (next === (value ?? null) || (next !== null && Number.isNaN(next))) return;
    setState("saving");
    try {
      await updateDoc(doc(db, "events", eventId, "companies", nit), {
        [`reunionesReportadasPorDia.${day}`]: next === null ? deleteField() : next,
        reunionesReportadasAt: serverTimestamp(),
        // El conteo único anterior queda reemplazado por el valor del día 1
        ...(clearLegacy ? { reunionesReportadas: deleteField() } : {}),
      });
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch (e) {
      console.error("Error guardando el conteo de reuniones:", e);
      setState("idle");
      setDraft(value ?? "");
      showNotification({ color: "red", title: "No se pudo guardar", message: "Intenta de nuevo." });
    }
  };

  return (
    <Group gap={6} wrap="nowrap" justify="center">
      <NumberInput
        w={80}
        min={0}
        allowDecimal={false}
        allowNegative={false}
        placeholder="—"
        value={draft}
        onChange={setDraft}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        }}
        hideControls
      />
      {state === "saving" ? (
        <Loader size={14} />
      ) : state === "saved" ? (
        <IconCheck size={16} color="var(--mantine-color-green-6)" />
      ) : (
        <span style={{ width: 16 }} />
      )}
    </Group>
  );
}

export default function CompanyMeetingCountPage() {
  const { eventId } = useParams();
  const [eventName, setEventName] = useState("");
  const [days, setDays] = useState<string[]>([]);
  const [rawCompanies, setRawCompanies] = useState<{ nit: string; data: any }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  // Roles presentes en cada empresa (según sus personas): una empresa con expositores
  // y asistentes aparece en ambos filtros; una sin personas solo en "Todos".
  const [rolesByCompany, setRolesByCompany] = useState<Record<string, Set<string>>>({});

  useEffect(() => {
    if (!eventId) return;
    getDoc(doc(db, "events", eventId)).then((s) => {
      const data = s.data();
      setEventName(data?.eventName || "");
      const keys = getEventDayKeys(data?.config);
      setDays(keys.length ? keys : ["unico"]);
    });
    // Tiempo real: varias personas pueden estar anotando a la vez
    return onSnapshot(collection(db, "events", eventId, "companies"), (snap) => {
      setRawCompanies(snap.docs.map((d) => ({ nit: d.id, data: d.data() })));
      setLoading(false);
    });
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    return onSnapshot(query(collection(db, "users"), where("eventId", "==", eventId)), (snap) => {
      const map: Record<string, Set<string>> = {};
      snap.docs.forEach((d) => {
        const u = d.data();
        const role = normalizeTipoAsistente(u.tipoAsistente);
        if (u.companyId && role) (map[u.companyId] ||= new Set()).add(role);
      });
      setRolesByCompany(map);
    });
  }, [eventId]);

  const companies = useMemo<CompanyRow[]>(() => {
    const firstDay = days[0];
    return rawCompanies
      .map(({ nit, data }) => {
        const stored = (data.reunionesReportadasPorDia || {}) as Record<string, unknown>;
        const legacyValue = typeof data.reunionesReportadas === "number" ? data.reunionesReportadas : null;
        const porDia: Record<string, number | null> = {};
        days.forEach((d) => {
          const v = stored[d];
          porDia[d] = typeof v === "number" ? v : d === firstDay && legacyValue !== null ? legacyValue : null;
        });
        const values = Object.values(porDia).filter((v): v is number => v !== null);
        return {
          nit,
          empresa: String(data.razonSocial || data.company_razonSocial || nit).trim(),
          porDia,
          total: values.reduce((s, v) => s + v, 0),
          conConteo: values.length > 0,
          legacy: legacyValue !== null,
        };
      })
      .sort((a, b) => a.empresa.localeCompare(b.empresa, "es"));
  }, [rawCompanies, days]);

  const visible = useMemo(() => {
    const q = norm(search).trim();
    return companies.filter((c) => {
      if (filter === "pending" && c.conConteo) return false;
      if (filter === "done" && !c.conConteo) return false;
      if (roleFilter !== "all" && !rolesByCompany[c.nit]?.has(roleFilter)) return false;
      return !q || norm(c.empresa).includes(q) || norm(c.nit).includes(q);
    });
  }, [companies, search, filter, roleFilter, rolesByCompany]);

  // Totales del rol elegido (no dependen del buscador ni del filtro de conteo)
  const roleScoped =
    roleFilter === "all" ? companies : companies.filter((c) => rolesByCompany[c.nit]?.has(roleFilter));
  const conConteo = roleScoped.filter((c) => c.conConteo).length;
  const totalPorDia = days.map((d) => roleScoped.reduce((s, c) => s + (c.porDia[d] ?? 0), 0));
  const total = totalPorDia.reduce((s, v) => s + v, 0);

  return (
    <Container size="lg" py="lg">
      <Stack gap="md">
        <Group gap="sm">
          <Button
            component={Link}
            to={`/admin/event/${eventId}`}
            variant="subtle"
            leftSection={<IconArrowLeft size={16} />}
          >
            Volver
          </Button>
          <div>
            <Title order={2}>Conteo de reuniones por empresa</Title>
            <Text c="dimmed" size="sm">
              {eventName || eventId}
            </Text>
          </div>
        </Group>

        <Paper withBorder radius="md" p="md">
          <Group justify="space-between" mb="md" wrap="wrap" gap="sm">
            <Group gap="sm" wrap="wrap">
              <TextInput
                placeholder="Buscar empresa o NIT"
                leftSection={<IconSearch size={16} />}
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
                radius="md"
                w={260}
              />
              <SegmentedControl
                size="xs"
                radius="xl"
                value={roleFilter}
                onChange={setRoleFilter}
                data={[
                  { value: "all", label: "Todos" },
                  { value: "vendedor", label: "Expositores" },
                  { value: "comprador", label: "Asistentes" },
                ]}
              />
              <SegmentedControl
                size="xs"
                radius="xl"
                value={filter}
                onChange={setFilter}
                data={[
                  { value: "all", label: "Todas" },
                  { value: "pending", label: "Sin conteo" },
                  { value: "done", label: "Con conteo" },
                ]}
              />
            </Group>
            <Group gap="xs">
              {days.length > 1 &&
                days.map((d, i) => (
                  <Badge key={d} variant="light" color="grape" size="lg">
                    {dayLabel(d)}: {totalPorDia[i]}
                  </Badge>
                ))}
              <Badge variant="light" color="violet" size="lg">
                Total: {total} reuniones
              </Badge>
              <Badge variant="light" size="lg">
                {conConteo} / {roleScoped.length} empresas
              </Badge>
            </Group>
          </Group>

          {loading || days.length === 0 ? (
            <Group justify="center" p="xl">
              <Loader />
            </Group>
          ) : (
            <div style={{ maxHeight: "calc(100vh - 260px)", overflow: "auto" }}>
              <Table striped highlightOnHover stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Empresa</Table.Th>
                    {days.map((d, i) => (
                      <Table.Th key={d} ta="center" w={140}>
                        {d === "unico" ? "Reuniones" : `Día ${i + 1} · ${dayLabel(d)}`}
                      </Table.Th>
                    ))}
                    {days.length > 1 && (
                      <Table.Th ta="center" w={90}>
                        Total
                      </Table.Th>
                    )}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {visible.map((c) => (
                    <Table.Tr key={c.nit}>
                      <Table.Td>
                        <Text size="sm" fw={500}>
                          {c.empresa}
                        </Text>
                        <Text size="xs" c="dimmed">
                          NIT {c.nit}
                        </Text>
                      </Table.Td>
                      {days.map((d, i) => (
                        <Table.Td key={d}>
                          <CountInput
                            eventId={eventId!}
                            nit={c.nit}
                            day={d}
                            value={c.porDia[d]}
                            clearLegacy={i === 0 && c.legacy}
                          />
                        </Table.Td>
                      ))}
                      {days.length > 1 && (
                        <Table.Td ta="center">
                          <Text fw={700} c={c.conConteo ? undefined : "dimmed"}>
                            {c.conConteo ? c.total : "—"}
                          </Text>
                        </Table.Td>
                      )}
                    </Table.Tr>
                  ))}
                  {visible.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={days.length + 2}>
                        <Text c="dimmed" ta="center" py="md">
                          No hay empresas con ese filtro.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </div>
          )}
          <Text size="xs" c="dimmed" mt="xs">
            Se guarda al salir del campo o con Enter. Es independiente de las reuniones que cuenta el sistema.
          </Text>
        </Paper>
      </Stack>
    </Container>
  );
}

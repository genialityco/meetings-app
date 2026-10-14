// Pestaña "Por Empresas" de la matriz: seguimiento rápido de cuántas reuniones tiene
// agendadas y realizadas cada empresa, más un conteo manual ("Reportadas") que el
// equipo del evento pregunta a cada empresa, aparte de lo que cuenta el sistema.
// Desechable: todo vive en este archivo y en la Tabs.Tab/Tabs.Panel de MatrixPage.jsx;
// el conteo manual se guarda en events/{eventId}/companies/{nit}.reunionesReportadas.
import { useEffect, useMemo, useState } from "react";
import { Badge, Group, Loader, NumberInput, Paper, SegmentedControl, Table, Text, TextInput } from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import { IconCheck, IconSearch } from "@tabler/icons-react";
import { collection, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";

interface Props {
  eventId: string;
  meetings: any[]; // reuniones del evento (MatrixPage ya las trae: accepted + pending)
  asistentes: any[]; // usuarios del evento
  eventDates: string[];
  formatDate: (d: string) => string;
}

interface Row {
  key: string;
  empresa: string;
  personas: number;
  agendadas: number;
  realizadas: number;
}

const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Campo editable del conteo manual: guarda al salir del campo o con Enter, solo si cambió.
function ReportedInput({ eventId, nit, value }: { eventId: string; nit: string; value: number | null }) {
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
        reunionesReportadas: next,
        reunionesReportadasAt: serverTimestamp(),
      });
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch (e) {
      console.error("Error guardando reuniones reportadas:", e);
      setState("idle");
      setDraft(value ?? "");
      showNotification({ color: "red", title: "No se pudo guardar", message: "Intenta de nuevo." });
    }
  };

  return (
    <Group gap={4} wrap="nowrap" justify="center">
      <NumberInput
        size="xs"
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
        <Loader size={12} />
      ) : state === "saved" ? (
        <IconCheck size={14} color="var(--mantine-color-green-6)" />
      ) : (
        <span style={{ width: 14 }} />
      )}
    </Group>
  );
}

export default function MatrixCompanyTotals({ eventId, meetings, asistentes, eventDates, formatDate }: Props) {
  const [day, setDay] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [reported, setReported] = useState<Record<string, number | null>>({});
  // Razón social de cada doc de empresa: también se listan las empresas sin usuarios
  const [companyNames, setCompanyNames] = useState<Record<string, string>>({});

  // Conteo manual en tiempo real (lo puede estar llenando más de una persona a la vez)
  useEffect(() => {
    if (!eventId) return;
    return onSnapshot(collection(db, "events", eventId, "companies"), (snap) => {
      const map: Record<string, number | null> = {};
      const names: Record<string, string> = {};
      snap.docs.forEach((d) => {
        const data = d.data();
        const v = data.reunionesReportadas;
        map[d.id] = typeof v === "number" ? v : null;
        names[d.id] = String(data.razonSocial || data.company_razonSocial || d.id).trim();
      });
      setReported(map);
      setCompanyNames(names);
    });
  }, [eventId]);

  const rows = useMemo(() => {
    const userCompany = new Map<string, string>();
    const byCompany = new Map<string, Row>();
    asistentes.forEach((u) => {
      const key = u.companyId || `sin-empresa-${u.id}`;
      userCompany.set(u.id, key);
      if (!byCompany.has(key)) {
        byCompany.set(key, {
          key,
          empresa: (u.company_razonSocial || u.empresa || "Sin empresa").trim(),
          personas: 0,
          agendadas: 0,
          realizadas: 0,
        });
      }
      byCompany.get(key)!.personas++;
    });
    Object.entries(companyNames).forEach(([nit, empresa]) => {
      if (!byCompany.has(nit)) byCompany.set(nit, { key: nit, empresa, personas: 0, agendadas: 0, realizadas: 0 });
    });

    meetings.forEach((m) => {
      if (m.status !== "accepted") return;
      if (day !== "all" && m.meetingDate !== day) return;
      // Una reunión cuenta una vez por empresa participante
      const companies = new Set(
        (m.participants || [m.requesterId, m.receiverId]).map((p: string) => userCompany.get(p)).filter(Boolean),
      );
      companies.forEach((k) => {
        const row = byCompany.get(k as string);
        if (!row) return;
        row.agendadas++;
        if (m.completed) row.realizadas++;
      });
    });

    return [...byCompany.values()].sort(
      (a, b) => b.realizadas - a.realizadas || b.agendadas - a.agendadas || a.empresa.localeCompare(b.empresa, "es"),
    );
  }, [meetings, asistentes, day, companyNames]);

  const visible = useMemo(() => {
    const q = norm(search).trim();
    return q ? rows.filter((r) => norm(r.empresa).includes(q) || norm(r.key).includes(q)) : rows;
  }, [rows, search]);

  const totals = useMemo(
    () => ({
      empresas: visible.length,
      conRealizadas: visible.filter((r) => r.realizadas > 0).length,
      sinReuniones: visible.filter((r) => r.agendadas === 0).length,
      reportadas: visible.reduce((s, r) => s + (reported[r.key] ?? 0), 0),
      conReporte: visible.filter((r) => reported[r.key] != null).length,
    }),
    [visible, reported],
  );

  const dayOptions = [
    { value: "all", label: "Todos los días" },
    ...eventDates.map((d) => ({ value: d, label: formatDate(d) })),
  ];

  return (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" mb="md" wrap="wrap" gap="sm">
        <Group gap="sm" wrap="wrap">
          <TextInput
            placeholder="Buscar empresa o NIT"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            radius="md"
            w={280}
          />
          {eventDates.length > 1 && (
            <SegmentedControl size="xs" radius="xl" data={dayOptions} value={day} onChange={setDay} />
          )}
        </Group>
        <Group gap="xs">
          <Badge variant="light">{totals.empresas} empresas</Badge>
          <Badge variant="light" color="green">{totals.conRealizadas} con reuniones realizadas</Badge>
          <Badge variant="light" color="gray">{totals.sinReuniones} sin reuniones</Badge>
          <Badge variant="light" color="violet">
            Reportadas: {totals.reportadas} ({totals.conReporte} empresas)
          </Badge>
        </Group>
      </Group>

      {/* Scroll nativo en ambos ejes: Table.ScrollContainer con altura máxima recortaba filas sin barra vertical */}
      <div style={{ maxHeight: "calc(100vh - 320px)", overflow: "auto" }}>
        <Table striped highlightOnHover stickyHeader miw={620}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Empresa</Table.Th>
              <Table.Th ta="center">Personas</Table.Th>
              <Table.Th ta="center">Agendadas</Table.Th>
              <Table.Th ta="center">Realizadas (sistema)</Table.Th>
              <Table.Th ta="center">Reportadas por la empresa</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visible.map((r) => {
              const hasCompany = !r.key.startsWith("sin-empresa-");
              return (
                <Table.Tr key={r.key}>
                  <Table.Td>
                    <Text size="sm" fw={500}>{r.empresa}</Text>
                    {hasCompany && <Text size="xs" c="dimmed">NIT {r.key}</Text>}
                  </Table.Td>
                  <Table.Td ta="center">{r.personas}</Table.Td>
                  <Table.Td ta="center">{r.agendadas}</Table.Td>
                  <Table.Td ta="center">
                    <Text size="sm" fw={700} c={r.realizadas > 0 ? "green" : "dimmed"}>{r.realizadas}</Text>
                  </Table.Td>
                  <Table.Td ta="center">
                    {hasCompany ? (
                      <ReportedInput eventId={eventId} nit={r.key} value={reported[r.key] ?? null} />
                    ) : (
                      <Text size="xs" c="dimmed">Sin empresa</Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </div>
      <Text size="xs" c="dimmed" mt="xs">
        Agendadas = reuniones aceptadas (incluye libres). Realizadas (sistema) = reuniones aceptadas marcadas como
        realizadas; cada reunión suma a las dos empresas participantes, por eso no coincide con el total del panel del
        evento. Reportadas = número que informa la empresa, total del evento (no depende del día elegido); se guarda al
        salir del campo o con Enter.
      </Text>
    </Paper>
  );
}

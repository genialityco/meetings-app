// Conteo manual de reuniones por empresa (/admin/event/:eventId/conteo-reuniones).
// El equipo del evento pregunta a cada empresa cuántas reuniones hizo y lo anota aquí,
// aparte de lo que cuenta el sistema. Se guarda en
// events/{eventId}/companies/{nit}.reunionesReportadas (+ reunionesReportadasAt).
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
import { collection, doc, getDoc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";

interface CompanyRow {
  nit: string;
  empresa: string;
  reportadas: number | null;
}

const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Campo editable: guarda al salir del campo o con Enter, solo si cambió.
function CountInput({ eventId, nit, value }: { eventId: string; nit: string; value: number | null }) {
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
      console.error("Error guardando el conteo de reuniones:", e);
      setState("idle");
      setDraft(value ?? "");
      showNotification({ color: "red", title: "No se pudo guardar", message: "Intenta de nuevo." });
    }
  };

  return (
    <Group gap={6} wrap="nowrap" justify="center">
      <NumberInput
        w={100}
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
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    if (!eventId) return;
    getDoc(doc(db, "events", eventId)).then((s) => setEventName(s.data()?.eventName || ""));
    // Tiempo real: varias personas pueden estar anotando a la vez
    return onSnapshot(collection(db, "events", eventId, "companies"), (snap) => {
      setCompanies(
        snap.docs
          .map((d) => {
            const data = d.data();
            return {
              nit: d.id,
              empresa: String(data.razonSocial || data.company_razonSocial || d.id).trim(),
              reportadas: typeof data.reunionesReportadas === "number" ? data.reunionesReportadas : null,
            };
          })
          .sort((a, b) => a.empresa.localeCompare(b.empresa, "es")),
      );
      setLoading(false);
    });
  }, [eventId]);

  const visible = useMemo(() => {
    const q = norm(search).trim();
    return companies.filter((c) => {
      if (filter === "pending" && c.reportadas != null) return false;
      if (filter === "done" && c.reportadas == null) return false;
      return !q || norm(c.empresa).includes(q) || norm(c.nit).includes(q);
    });
  }, [companies, search, filter]);

  const conConteo = companies.filter((c) => c.reportadas != null).length;
  const total = companies.reduce((s, c) => s + (c.reportadas ?? 0), 0);

  return (
    <Container size="md" py="lg">
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
              <Badge variant="light" color="violet" size="lg">
                Total: {total} reuniones
              </Badge>
              <Badge variant="light" size="lg">
                {conConteo} / {companies.length} empresas
              </Badge>
            </Group>
          </Group>

          {loading ? (
            <Group justify="center" p="xl">
              <Loader />
            </Group>
          ) : (
            <div style={{ maxHeight: "calc(100vh - 260px)", overflow: "auto" }}>
              <Table striped highlightOnHover stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Empresa</Table.Th>
                    <Table.Th ta="center" w={160}>
                      Reuniones
                    </Table.Th>
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
                      <Table.Td>
                        <CountInput eventId={eventId!} nit={c.nit} value={c.reportadas} />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  {visible.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={2}>
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

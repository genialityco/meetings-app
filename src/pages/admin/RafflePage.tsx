import { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  doc,
  getDoc,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import {
  Container,
  Title,
  Text,
  Group,
  Button,
  Loader,
  Center,
  Table,
  Paper,
  Stack,
  TextInput,
  Badge,
  ScrollArea,
} from "@mantine/core";
import { IconTicket, IconTrophy } from "@tabler/icons-react";

interface RaffleEntrant {
  id: string;
  nombre: string;
  empresa?: string;
  raffleTickets: number;
}

interface RaffleWinner {
  id: string;
  userId: string;
  nombre: string;
  empresa?: string;
  ticketsAtDraw: number;
  prizeLabel?: string;
  drawnAt: any;
}

/** Elige un ganador al azar, ponderado por número de tickets (a más puntos, más chances). */
function drawWeightedWinner(entrants: RaffleEntrant[]): RaffleEntrant | null {
  const totalTickets = entrants.reduce((sum, e) => sum + e.raffleTickets, 0);
  if (totalTickets <= 0) return null;

  let target = Math.random() * totalTickets;
  for (const entrant of entrants) {
    target -= entrant.raffleTickets;
    if (target <= 0) return entrant;
  }
  return entrants[entrants.length - 1];
}

export default function RafflePage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<any>(null);
  const [entrants, setEntrants] = useState<RaffleEntrant[]>([]);
  const [winners, setWinners] = useState<RaffleWinner[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const [prizeLabel, setPrizeLabel] = useState("");

  const loadData = async () => {
    if (!eventId) return;
    setLoading(true);
    try {
      const [eventSnap, usersSnap, winnersSnap] = await Promise.all([
        getDoc(doc(db, "events", eventId)),
        getDocs(query(collection(db, "users"), where("eventId", "==", eventId))),
        getDocs(collection(db, "events", eventId, "raffleWinners")),
      ]);

      if (eventSnap.exists()) setEvent({ id: eventSnap.id, ...eventSnap.data() });

      const list: RaffleEntrant[] = usersSnap.docs
        .map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            nombre: data.nombre || "Sin nombre",
            empresa: data.empresa || data.company_razonSocial || "",
            raffleTickets: data.raffleTickets || 0,
          };
        })
        .filter((u) => u.raffleTickets > 0)
        .sort((a, b) => b.raffleTickets - a.raffleTickets);
      setEntrants(list);

      const winnersList: RaffleWinner[] = winnersSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .sort((a, b) => (b.drawnAt?.toMillis?.() || 0) - (a.drawnAt?.toMillis?.() || 0));
      setWinners(winnersList);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const winnerIds = useMemo(() => new Set(winners.map((w) => w.userId)), [winners]);
  const eligibleEntrants = useMemo(
    () => entrants.filter((e) => !winnerIds.has(e.id)),
    [entrants, winnerIds],
  );

  const handleDraw = async () => {
    if (!eventId || eligibleEntrants.length === 0) return;
    setDrawing(true);
    try {
      const winner = drawWeightedWinner(eligibleEntrants);
      if (!winner) return;

      await addDoc(collection(db, "events", eventId, "raffleWinners"), {
        userId: winner.id,
        nombre: winner.nombre,
        empresa: winner.empresa || "",
        ticketsAtDraw: winner.raffleTickets,
        prizeLabel: prizeLabel.trim() || null,
        drawnAt: new Date(),
      });
      setPrizeLabel("");
      await loadData();
    } finally {
      setDrawing(false);
    }
  };

  if (loading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  if (!event) {
    return (
      <Center py="xl">
        <Text c="dimmed">Evento no encontrado.</Text>
      </Center>
    );
  }

  const totalTickets = entrants.reduce((sum, e) => sum + e.raffleTickets, 0);

  return (
    <Container size="md" py="md">
      <Group justify="space-between" mb="md">
        <div>
          <Title order={3}>Sorteo — {event.eventName || eventId}</Title>
          <Text size="sm" c="dimmed">
            {entrants.length} participante{entrants.length === 1 ? "" : "s"} · {totalTickets} punto{totalTickets === 1 ? "" : "s"} en juego
          </Text>
        </div>
        <Button variant="default" component={Link} to={`/admin/event/${eventId}`} size="sm">
          ← Volver al evento
        </Button>
      </Group>

      <Paper withBorder radius="md" p="md" mb="lg">
        <Stack gap="sm">
          <Text fw={600}>Elegir ganador</Text>
          <Text size="sm" c="dimmed">
            La selección es al azar y ponderada por puntos: a más puntos, más chances de ganar. Los ganadores anteriores no vuelven a participar.
          </Text>
          <Group align="flex-end">
            <TextInput
              label="Premio (opcional)"
              placeholder="Ej: Tablet, Bono, etc."
              value={prizeLabel}
              onChange={(e) => setPrizeLabel(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button
              leftSection={<IconTrophy size={16} />}
              onClick={handleDraw}
              loading={drawing}
              disabled={eligibleEntrants.length === 0}
            >
              Elegir ganador al azar
            </Button>
          </Group>
          {eligibleEntrants.length === 0 && (
            <Text size="sm" c="dimmed">
              No hay participantes elegibles restantes (con puntos y sin haber ganado ya).
            </Text>
          )}
        </Stack>
      </Paper>

      {winners.length > 0 && (
        <Paper withBorder radius="md" p="md" mb="lg">
          <Text fw={600} mb="sm">
            Ganadores
          </Text>
          <Stack gap="xs">
            {winners.map((w) => (
              <Group key={w.id} justify="space-between">
                <Group gap="xs">
                  <IconTrophy size={16} color="gold" />
                  <Text size="sm" fw={500}>
                    {w.nombre}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {w.empresa}
                  </Text>
                </Group>
                <Group gap="xs">
                  {w.prizeLabel && <Badge variant="light">{w.prizeLabel}</Badge>}
                  <Badge variant="light" color="grape" leftSection={<IconTicket size={12} />}>
                    {w.ticketsAtDraw}
                  </Badge>
                </Group>
              </Group>
            ))}
          </Stack>
        </Paper>
      )}

      <Paper withBorder radius="md" p="md">
        <Text fw={600} mb="sm">
          Ranking de puntos
        </Text>
        <ScrollArea>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nombre</Table.Th>
                <Table.Th>Empresa</Table.Th>
                <Table.Th>Puntos</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entrants.map((e) => (
                <Table.Tr key={e.id}>
                  <Table.Td>{e.nombre}</Table.Td>
                  <Table.Td>{e.empresa}</Table.Td>
                  <Table.Td>
                    <Badge variant="light" color="grape">
                      {e.raffleTickets}
                    </Badge>
                    {winnerIds.has(e.id) && (
                      <Badge ml="xs" variant="light" color="yellow">
                        Ganador
                      </Badge>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
              {entrants.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={3}>
                    <Text c="dimmed" ta="center" py="md">
                      Todavía no hay puntos registrados.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>
    </Container>
  );
}

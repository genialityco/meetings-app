import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Card,
  Title,
  Text,
  Button,
  Loader,
  Alert,
  Group,
  Container,
  Badge,
  ScrollArea,
} from "@mantine/core";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  doc,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";

const MATCH_API_LOCAL = "http://localhost:3001/api/match-openai";

const EventMatchPage = () => {
  const { eventId } = useParams();
  const [attendees, setAttendees] = useState([]);
  const [agenda, setAgenda] = useState([]);
  const [matchesMatrix, setMatchesMatrix] = useState([]);
  const [loading, setLoading] = useState(false);
  const [globalMessage, setGlobalMessage] = useState("");
  const [error, setError] = useState("");
  const [eventConfig, setEventConfig] = useState(null);

  // 1. Cargar asistentes, agenda y config
  useEffect(() => {
    const fetchData = async () => {
      try {
        const q1 = query(
          collection(db, "users"),
          where("eventId", "==", eventId)
        );
        const snap1 = await getDocs(q1);
        setAttendees(snap1.docs.map((d) => ({ id: d.id, ...d.data() })));

        const q2 = query(
          collection(db, "agenda"),
          where("eventId", "==", eventId)
        );
        const snap2 = await getDocs(q2);
        setAgenda(snap2.docs.map((d) => ({ id: d.id, ...d.data() })));

        // Config del evento (máximo de reuniones)
        const eventSnap = await getDocs(
          query(collection(db, "events"), where("id", "==", eventId))
        );
        if (!eventSnap.empty) {
          setEventConfig(eventSnap.docs[0].data().config);
        }
      } catch (e) {
        setError("Error cargando asistentes, agenda o configuración");
      }
    };
    fetchData();
  }, [eventId]);

  // Filtrar compradores y vendedores
  const compradores = attendees.filter((a) => a.tipoAsistente === "comprador");
  const vendedores = attendees.filter((a) => a.tipoAsistente === "vendedor");

  // 2. Hacer match con IA para TODOS los compradores
  const handleMatchAll = async () => {
    setError("");
    setLoading(true);
    setMatchesMatrix([]);
    try {
      const res = await fetch(MATCH_API_LOCAL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compradores, vendedores }),
      });
      const data = await res.json();
      setMatchesMatrix(data.results || []);
      if (data.error) setError(data.error);
    } catch (e) {
      setError("Error al consultar el servicio de IA");
    }
    setLoading(false);
  };

  // --------- AGENDAMIENTO MASIVO INTELIGENTE Y POR MESA ------------
  const handleAgendarMasivo = async () => {
    if (!matchesMatrix || matchesMatrix.length === 0) {
      setGlobalMessage("No hay matches para agendar.");
      return;
    }
    setLoading(true);
    setGlobalMessage("");

    const maxMeetings = eventConfig?.maxMeetingsPerUser ?? 24;
    const minMeetingsVendedor = 3;
    let scheduled = [];
    let pendientes = [];

    // Mapa de reuniones por vendedor
    const reunionesPorVendedor = {};
    vendedores.forEach((v) => (reunionesPorVendedor[v.id] = 0));

    // Mapa para slots por mesa
    const mesas = {};
    agenda.forEach((slot) => {
      if (slot.available) {
        if (!mesas[slot.tableNumber]) mesas[slot.tableNumber] = [];
        mesas[slot.tableNumber].push(slot);
      }
    });

    // Set para control global de comprador-vendedor únicos
    const reunionesAgendadas = new Set();

    // Para cada comprador...
    for (let cmp of compradores) {
      // Elige la mesa con más slots libres
      let mejorMesa = null;
      let maxSlots = 0;
      Object.entries(mesas).forEach(([mesa, slots]) => {
        if (slots.length > maxSlots) {
          maxSlots = slots.length;
          mejorMesa = mesa;
        }
      });
      if (!mejorMesa) {
        pendientes.push({
          compradorId: cmp.id,
          motivo: "No hay mesa/slots disponibles",
        });
        continue;
      }
      // Extrae y bloquea los slots de esa mesa para este comprador
      const slotsMesa = mesas[mejorMesa].splice(0, maxMeetings);

      const matchObj = matchesMatrix.find((m) => m.compradorId === cmp.id);
      let matches = (matchObj?.matches || []).slice();
      // Para control de vendedores asignados a este comprador
      const usadosVendedor = {};

      // Asignar cada slot de la mesa (uno por uno)
      for (let i = 0; i < slotsMesa.length; i++) {
        // Filtra vendedores que no estén repetidos para este comprador NI globalmente
        let match = matches.find(
          (m) =>
            !usadosVendedor[m.vendedorId] &&
            reunionesPorVendedor[m.vendedorId] < maxMeetings &&
            !reunionesAgendadas.has(`${cmp.id}_${m.vendedorId}`)
        );
        // Si no hay, toma el vendedor con menos reuniones pero no repetido
        if (!match) {
          let vLibre = vendedores
            .filter(
              (v) =>
                !usadosVendedor[v.id] &&
                !reunionesAgendadas.has(`${cmp.id}_${v.id}`)
            )
            .sort(
              (a, b) =>
                (reunionesPorVendedor[a.id] || 0) -
                (reunionesPorVendedor[b.id] || 0)
            )[0];
          if (vLibre) {
            match = {
              vendedor: vLibre.nombre,
              vendedorId: vLibre.id,
              score: 0,
              motivo: "Asignado para llenar la agenda, score bajo",
            };
          }
        }
        // Si aún no hay, ya no quedan vendedores únicos para este comprador
        if (!match) {
          pendientes.push({
            compradorId: cmp.id,
            motivo: "No hay vendedor disponible único para este comprador",
          });
          continue;
        }

        // Evita agendar si ya existe una reunión de este comprador con este vendedor
        if (reunionesAgendadas.has(`${cmp.id}_${match.vendedorId}`)) {
          pendientes.push({
            compradorId: cmp.id,
            vendedorId: match.vendedorId,
            motivo: "Vendedor repetido en comprador",
          });
          continue;
        }

        try {
          await addDoc(collection(db, "events", eventId, "meetings"), {
            eventId,
            requesterId: cmp.id,
            receiverId: match.vendedorId,
            status: "accepted",
            createdAt: new Date(),
            timeSlot: `${slotsMesa[i].startTime} - ${slotsMesa[i].endTime}`,
            tableAssigned: slotsMesa[i].tableNumber.toString(),
            participants: [cmp.id, match.vendedorId],
            motivoMatch: match.motivo,
            razonMatch: match.razonMatch,
            scoreMatch: match.score,
            agendadoAutomatico: true,
          });
          await updateDoc(doc(db, "agenda", slotsMesa[i].id), {
            available: false,
            meetingId: "asignado-ia",
          });
          reunionesPorVendedor[match.vendedorId]++;
          usadosVendedor[match.vendedorId] = true;
          reunionesAgendadas.add(`${cmp.id}_${match.vendedorId}`);
          scheduled.push({
            compradorId: cmp.id,
            vendedorId: match.vendedorId,
            slotId: slotsMesa[i].id,
          });
        } catch (e) {
          pendientes.push({
            compradorId: cmp.id,
            vendedorId: match.vendedorId,
            motivo: "Error agendando",
          });
        }
      }
    }

    // Segundo paso: asegura mínimo de 3 reuniones por vendedor (si se puede)
    for (let vendedor of vendedores) {
      while (reunionesPorVendedor[vendedor.id] < minMeetingsVendedor) {
        // Busca slot disponible
        let slotLibre = null;
        for (let mesa in mesas) {
          slotLibre = mesas[mesa]?.shift();
          if (slotLibre) break;
        }
        if (!slotLibre) break;
        // Busca un comprador con cupo que aún no tenga ese vendedor
        let comprador = compradores.find(
          (c) =>
            !reunionesAgendadas.has(`${c.id}_${vendedor.id}`) &&
            !scheduled.some(
              (s) => s.compradorId === c.id && s.vendedorId === vendedor.id
            )
        );
        if (!comprador) break;
        try {
          await addDoc(collection(db, "events", eventId, "meetings"), {
            eventId,
            requesterId: comprador.id,
            receiverId: vendedor.id,
            status: "accepted",
            createdAt: new Date(),
            timeSlot: `${slotLibre.startTime} - ${slotLibre.endTime}`,
            tableAssigned: slotLibre.tableNumber.toString(),
            participants: [comprador.id, vendedor.id],
            motivoMatch: "Para cumplir mínimo de reuniones por vendedor.",
            scoreMatch: 0,
            agendadoAutomatico: true,
          });
          await updateDoc(doc(db, "agenda", slotLibre.id), {
            available: false,
            meetingId: "asignado-ia",
          });
          reunionesPorVendedor[vendedor.id]++;
          reunionesAgendadas.add(`${comprador.id}_${vendedor.id}`);
          scheduled.push({
            compradorId: comprador.id,
            vendedorId: vendedor.id,
            slotId: slotLibre.id,
          });
        } catch (e) {
          pendientes.push({
            vendedorId: vendedor.id,
            motivo: "Error agendando forzado",
          });
        }
      }
    }

    setGlobalMessage(
      `Se agendaron ${scheduled.length} reuniones. Pendientes: ${pendientes.length}`
    );
    setLoading(false);
  };

  return (
    <Container>
      <Group mb="md">
        <Button component={Link} to={`/admin/event/${eventId}`}>
          Volver
        </Button>
        <Title order={2}>Agendar Reuniones Inteligentes (IA)</Title>
      </Group>
      <Text mb="sm">
        Presiona el botón para calcular y agendar automáticamente todos los
        matches, llenando la agenda de cada comprador en la misma mesa y
        distribuyendo vendedores.
      </Text>
      <Button onClick={handleMatchAll} loading={loading} mb="md" color="blue">
        Generar Matches con IA (Todos los compradores)
      </Button>
      <Button
        onClick={handleAgendarMasivo}
        loading={loading}
        mb="md"
        color="teal"
        disabled={
          matchesMatrix.length === 0 || !agenda.some((a) => a.available)
        }
      >
        Agendar todos los matches automáticamente
      </Button>
      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}
      {globalMessage && (
        <Alert
          color="green"
          mb="md"
          withCloseButton
          onClose={() => setGlobalMessage("")}
        >
          {globalMessage}
        </Alert>
      )}
      {loading && <Loader />}

      {/* Preview de matches por comprador */}
      {matchesMatrix.map((m, idx) => {
        const cmp = compradores.find((c) => c.id === m.compradorId);
        return (
          <Card key={idx} shadow="xs" my="sm" p="md" withBorder>
            <Text>
              <b>Comprador:</b> {cmp?.nombre || m.compradorId}
            </Text>
            <Text c="dimmed" size="sm" mb="sm">
              Matches sugeridos ({m.matches.length}):
            </Text>
            <ScrollArea h={320} type="auto" scrollbars="y">
              {m.matches
                .sort((a, b) => (b.score || 0) - (a.score || 0))
                .map((match, ix) => {
                  const vendedor = vendedores.find(
                    (v) =>
                      v.id === match.vendedorId ||
                      v.nombre?.trim().toLowerCase() ===
                        match.vendedor?.trim().toLowerCase()
                  );
                  return (
                    <Card key={ix} shadow="xs" my="xs" p="sm" withBorder>
                      <Group position="apart">
                        <Text>
                          <b>Vendedor:</b>{" "}
                          {vendedor?.nombre || match.vendedor || "-"}{" "}
                          <span style={{ color: "#888" }}>
                            ({vendedor?.empresa || ""})
                          </span>
                        </Text>
                        {typeof match.score === "number" && (
                          <Badge
                            color={
                              match.score > 0.8
                                ? "green"
                                : match.score > 0.5
                                ? "yellow"
                                : "red"
                            }
                          >
                            Compatibilidad: {(match.score * 100).toFixed(0)}%
                          </Badge>
                        )}
                      </Group>
                      <Text color="dimmed" size="sm" mt="xs" mb="xs">
                        {match.motivo}
                      </Text>
                      <Text color="dark" size="sm">
                        {match.razonMatch ? (
                          <>{match.razonMatch}</>
                        ) : (
                          <>
                            <b>El comprador busca:</b> {cmp?.necesidad || "-"}
                            <br />
                            <b>El vendedor ofrece:</b>{" "}
                            {vendedor?.descripcion || "-"}
                          </>
                        )}
                      </Text>
                    </Card>
                  );
                })}
            </ScrollArea>
          </Card>
        );
      })}
    </Container>
  );
};

export default EventMatchPage;

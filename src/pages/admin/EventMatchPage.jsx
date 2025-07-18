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
  Modal,
  Select,
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

const MATCH_API_LOCAL = "http://localhost:3001/api/match-ollama";

function extractJsonFromResponse(text) {
  if (!text) return [];
  let clean = text.trim();
  // Quita delimitadores ```json ... ```
  if (clean.startsWith("```")) {
    clean = clean.replace(/```json|```/gi, "");
  }
  // Quita saltos de línea iniciales/finales
  clean = clean.trim();

  // Busca el primer "[" y el último "]" para tomar solo el JSON
  const start = clean.indexOf("[");
  const end = clean.lastIndexOf("]");
  if (start !== -1 && end !== -1) {
    clean = clean.substring(start, end + 1);
  }

  try {
    return JSON.parse(clean);
  } catch (e) {
    // Fallback: intenta parsear con eval (no recomendado para producción pública)
    try {
      // eslint-disable-next-line no-eval
      return eval("(" + clean + ")");
    } catch {
      return [];
    }
  }
}

const EventMatchPage = () => {
  const { eventId } = useParams();
  const [attendees, setAttendees] = useState([]);
  const [agenda, setAgenda] = useState([]);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [globalMessage, setGlobalMessage] = useState("");
  const [error, setError] = useState("");

  // Modal para crear reunión
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);

  // 1. Cargar asistentes y agenda
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Asistentes
        const q1 = query(
          collection(db, "users"),
          where("eventId", "==", eventId)
        );
        const snap1 = await getDocs(q1);
        setAttendees(snap1.docs.map((d) => ({ id: d.id, ...d.data() })));
        // Agenda
        const q2 = query(
          collection(db, "agenda"),
          where("eventId", "==", eventId)
        );
        const snap2 = await getDocs(q2);
        setAgenda(snap2.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        setError("Error cargando asistentes o agenda");
      }
    };
    fetchData();
  }, [eventId]);

  // 2. Hacer match con IA (al dar click)
  const handleMatch = async () => {
    setError("");
    setLoading(true);
    setMatches([]);
    try {
      const res = await fetch(MATCH_API_LOCAL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asistentes: attendees }),
      });
      const data = await res.json();

      // Aquí parsea la respuesta de la IA
      let rawMatches = data.matches;
      if (typeof rawMatches === "string") {
        rawMatches = extractJsonFromResponse(rawMatches);
      }
      setMatches(rawMatches || []);
      if (data.error) setError(data.error);
    } catch (e) {
      setError("Error al consultar el servicio de IA");
    }
    setLoading(false);
  };

  // 3. Crear reunión a partir de un match y slot seleccionado
  const handleCreateMeeting = async () => {
    if (!selectedMatch || !selectedSlot) return;
    setLoading(true);
    try {
      // Buscar los IDs de los usuarios por nombre (ajusta si hay homónimos)
      const user1 = attendees.find(
        (a) =>
          a.nombre?.trim().toLowerCase() ===
          selectedMatch.asistentes[0]?.trim().toLowerCase()
      )?.id;
      const user2 = attendees.find(
        (a) =>
          a.nombre?.trim().toLowerCase() ===
          selectedMatch.asistentes[1]?.trim().toLowerCase()
      )?.id;
      const slotObj = agenda.find((a) => a.id === selectedSlot);

      if (!user1 || !user2 || !slotObj) {
        setGlobalMessage("No se encontró un usuario o slot válido.");
        setLoading(false);
        return;
      }

      // 1. Crear la reunión en meetings
      const meetingRef = await addDoc(
        collection(db, "events", eventId, "meetings"),
        {
          eventId,
          requesterId: user1,
          receiverId: user2,
          status: "accepted",
          createdAt: new Date(),
          timeSlot: `${slotObj.startTime} - ${slotObj.endTime}`,
          tableAssigned: slotObj.tableNumber.toString(),
          participants: [user1, user2],
        }
      );

      // 2. Actualizar el slot en agenda
      await updateDoc(doc(db, "agenda", slotObj.id), {
        available: false,
        meetingId: meetingRef.id,
      });

      setGlobalMessage("¡Reunión creada correctamente!");
      // Elimina el slot de la lista de disponibles localmente:
      setAgenda((prev) =>
        prev.map((slot) =>
          slot.id === slotObj.id ? { ...slot, available: false } : slot
        )
      );
      // Opcional: elimina el match de la lista para evitar repetirlo
      setMatches((prev) => prev.filter((m) => m !== selectedMatch));
      setSelectedMatch(null);
      setSelectedSlot(null);
    } catch (e) {
      setGlobalMessage("Error creando la reunión.");
      console.error(e);
    }
    setLoading(false);
  };

  // 4. Lista de slots disponibles para asignar la reunión
  const availableSlots = agenda
    .filter((s) => s.available)
    .map((s) => ({
      value: s.id,
      label: `Mesa ${s.tableNumber} - ${s.startTime} a ${s.endTime}`,
    }));

  return (
    <Container>
      <Group mb="md">
        <Button component={Link} to={`/admin/event/${eventId}`}>
          Volver
        </Button>
        <Title order={2}>Generar Match entre Asistentes</Title>
      </Group>
      <Text mb="sm">
        Aquí puedes consultar los mejores pares de asistentes para reunirse,
        según la IA. (Se usa necesidad y descripción)
      </Text>
      <Button onClick={handleMatch} loading={loading} mb="md">
        Generar Matches con IA
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
      {matches &&
        matches.length > 0 &&
        matches.map((match, idx) => (
          <Card key={idx} shadow="xs" my="sm" p="md" withBorder>
            <Text>
              <b>Pareja:</b> {match.asistentes?.join(" y ")}
            </Text>
            <Text color="dimmed" size="sm">
              {match.motivo}
            </Text>
            <Button
              mt="md"
              onClick={() => setSelectedMatch(match)}
              disabled={availableSlots.length === 0}
            >
              Crear reunión
            </Button>
          </Card>
        ))}

      {/* Modal para elegir el slot de la agenda */}
      <Modal
        opened={!!selectedMatch}
        onClose={() => {
          setSelectedMatch(null);
          setSelectedSlot(null);
        }}
        title={`Asignar reunión a la agenda`}
      >
        <Text mb="xs">
          ¿Con qué slot (mesa y hora) quieres agendar a{" "}
          <b>{selectedMatch?.asistentes?.join(" y ")}</b>?
        </Text>
        <Select
          data={availableSlots}
          value={selectedSlot}
          onChange={setSelectedSlot}
          placeholder="Elige un slot"
          mb="md"
        />
        <Button
          disabled={!selectedSlot}
          onClick={handleCreateMeeting}
          loading={loading}
        >
          Confirmar reunión
        </Button>
      </Modal>
    </Container>
  );
};

export default EventMatchPage;

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
  Stack,
  Modal,
  Checkbox,
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

const LLAMA_API = "http://localhost:8080/api/match";

const EventMatchPage = () => {
  const { eventId } = useParams();
  const [attendees, setAttendees] = useState([]);
  const [agenda, setAgenda] = useState([]);
  const [matchesMatrix, setMatchesMatrix] = useState([]);
  const [loading, setLoading] = useState(false);
  const [globalMessage, setGlobalMessage] = useState("");
  const [error, setError] = useState("");
  const [eventConfig, setEventConfig] = useState(null);
  const [previewModalOpened, setPreviewModalOpened] = useState(false);
  const [selectedMatches, setSelectedMatches] = useState(new Set());
  const [useLocalLlama, setUseLocalLlama] = useState(false);

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

  // Filtrar compradores y vendedores (adaptarse a diferentes modelos de datos)
  const getAsistenteType = (attendee) => {
    // Modelo 1: Si existe tipoAsistente, usarlo
    if (attendee.tipoAsistente) {
      return attendee.tipoAsistente;
    }

    // Modelo 2: Si existe interesPrincipal, usarlo para inferir
    if (attendee.interesPrincipal === "proveedores") {
      return "vendedor";
    }
    if (attendee.interesPrincipal === "clientes") {
      return "comprador";
    }
    if (attendee.interesPrincipal === "abierto") {
      // Inferir basado en descripción o necesidad
      // Si tiene descripción detallada, probablemente sea vendedor
      const descripcionLen = (attendee.descripcion || "").length;
      const necesidadLen = (attendee.necesidad || "").length;
      
      if (descripcionLen > necesidadLen) {
        return "vendedor";
      } else if (necesidadLen > descripcionLen) {
        return "comprador";
      }
      // Si son similares o ambos están presentes, asumir que puede ser ambos
      return "flexible";
    }

    return "flexible";
  };

  const compradores = attendees.filter((a) => {
    const tipo = getAsistenteType(a);
    return tipo === "comprador" || tipo === "flexible";
  });

  const vendedores = attendees.filter((a) => {
    const tipo = getAsistenteType(a);
    return tipo === "vendedor" || tipo === "flexible";
  });

  // Detectar campos disponibles en los datos
  const getAvailableFields = () => {
    const fields = {
      tieneInteresPrincipal: false,
      tieneNecesidad: false,
      tieneDescripcion: false,
      tieneEmpresa: false,
    };

    // Verificar en compradores
    compradores.forEach((c) => {
      if (c.interesPrincipal) fields.tieneInteresPrincipal = true;
      if (c.necesidad) fields.tieneNecesidad = true;
      if (c.descripcion) fields.tieneDescripcion = true;
      if (c.empresa) fields.tieneEmpresa = true;
    });

    // Verificar en vendedores
    vendedores.forEach((v) => {
      if (v.interesPrincipal) fields.tieneInteresPrincipal = true;
      if (v.necesidad) fields.tieneNecesidad = true;
      if (v.descripcion) fields.tieneDescripcion = true;
      if (v.empresa) fields.tieneEmpresa = true;
    });

    return fields;
  };

  const availableFields = getAvailableFields();

  // Función para calcular compatibilidad local
  const calculateLocalMatch = (comprador, vendedor) => {
    // No crear match con la misma empresa (si el campo existe)
    if (availableFields.tieneEmpresa) {
      if (comprador.empresa?.trim().toLowerCase() === vendedor.empresa?.trim().toLowerCase()) {
        return { score: 0, motivo: "Misma empresa", razonMatch: "" };
      }
    }

    // No crear match consigo mismo
    if (comprador.id === vendedor.id) {
      return { score: 0, motivo: "Mismo usuario", razonMatch: "" };
    }

    let score = 0;
    let razonMatch = "";

    // Verificar intereses complementarios basado en tipo de asistente
    const compradorTipo = getAsistenteType(comprador);
    const vendedorTipo = getAsistenteType(vendedor);

    if (compradorTipo === "comprador" && vendedorTipo === "vendedor") {
      score += 0.3;
    }

    // Analizar necesidad del comprador vs descripción del vendedor (si existen)
    if (availableFields.tieneNecesidad && availableFields.tieneDescripcion) {
      const necesidadBaja = (comprador.necesidad || "").toLowerCase();
      const descripcionBaja = (vendedor.descripcion || "").toLowerCase();

      if (necesidadBaja && descripcionBaja) {
        const palabrasClave = necesidadBaja.split(/\s+/).filter((p) => p.length > 3);
        let coincidencias = 0;
        palabrasClave.forEach((palabra) => {
          if (descripcionBaja.includes(palabra)) {
            coincidencias++;
          }
        });

        if (palabrasClave.length > 0) {
          const matchPercentage = coincidencias / palabrasClave.length;
          score += matchPercentage * 0.5; // Aumenté el peso
        } else if (necesidadBaja && descripcionBaja) {
          // Si no hay palabras clave detectadas pero ambos campos existen
          score += 0.2;
        }
      }
    }

    // Bonus por interés principal (si existe)
    if (availableFields.tieneInteresPrincipal) {
      const compradorInteres = comprador.interesPrincipal?.toLowerCase();
      const vendedorInteres = vendedor.interesPrincipal?.toLowerCase();

      if (compradorInteres === "abierto" || vendedorInteres === "abierto") {
        score += 0.15; // Bonus por disponibilidad
      }

      if (compradorInteres === "proveedores" && vendedorTipo === "vendedor") {
        score += 0.2;
      }
      if (compradorInteres === "clientes" && vendedorTipo === "comprador") {
        score += 0.1;
      }
    }

    // Bonus si ambos tienen descripción y necesidad
    if ((comprador.descripcion || "").length > 10 && (vendedor.descripcion || "").length > 10) {
      score += 0.1;
    }

    // Generar razón del match según los campos disponibles
    if (score > 0.3) {
      const partes = [];
      if (availableFields.tieneNecesidad && comprador.necesidad) {
        partes.push(`${comprador.nombre} busca: "${comprador.necesidad}"`);
      }
      if (availableFields.tieneDescripcion && vendedor.descripcion) {
        partes.push(`${vendedor.nombre} ofrece: "${vendedor.descripcion}"`);
      }
      if (partes.length === 0) {
        partes.push(`Match entre ${comprador.nombre} y ${vendedor.nombre}`);
      }
      razonMatch = partes.join(" | ");
    } else if (score > 0) {
      razonMatch = `Potencial match entre ${comprador.nombre} y ${vendedor.nombre}`;
    }

    return {
      score: Math.min(score, 1),
      motivo: score > 0.6 ? "Match por afinidad" : score > 0.3 ? "Match potencial" : "Sin compatibilidad",
      razonMatch,
    };
  };

  // 2. Intentar hacer match con Llama Server local, fallback a cálculo local
  const handleMatchAll = async () => {
    setError("");
    setLoading(true);
    setMatchesMatrix([]);

    // Intentar usar Llama Server
    try {
      const res = await fetch(LLAMA_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          compradores,
          vendedores,
          empresaIgnore: true,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setMatchesMatrix(data.results || []);
        setUseLocalLlama(true);
        if (data.message) setGlobalMessage(data.message);
      } else {
        // Fallback a cálculo local
        generateLocalMatches();
      }
    } catch (e) {
      console.log("Llama Server no disponible, usando matching local");
      generateLocalMatches();
    }

    setLoading(false);
  };

  // Generar matches localmente
  const generateLocalMatches = () => {
    const results = compradores.map((comprador) => {
      const matches = vendedores
        .map((vendedor) => {
          const matchData = calculateLocalMatch(comprador, vendedor);
          return {
            vendedor: vendedor.nombre,
            vendedorId: vendedor.id,
            score: matchData.score,
            motivo: matchData.motivo,
            razonMatch: matchData.razonMatch,
          };
        })
        .filter((m) => m.score > 0) // Mostrar todos los matches con score > 0
        .sort((a, b) => b.score - a.score);

      return {
        compradorId: comprador.id,
        compradorNombre: comprador.nombre,
        matches,
      };
    });

    setMatchesMatrix(results);
    setUseLocalLlama(false);
    const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);
    const matchesMsg = totalMatches > 0 
      ? `Matches generados localmente. Total: ${totalMatches} matches`
      : "⚠️ No se generaron matches. Verifica que haya suficientes asistentes con descripción y necesidad.";
    setGlobalMessage(matchesMsg);
  };

  // --------- AGENDAMIENTO CON PREVIEW ---------
  const handleShowPreview = () => {
    if (!matchesMatrix || matchesMatrix.length === 0) {
      setError("No hay matches para agendar.");
      return;
    }
    // Inicializar todas las selecciones
    const allMatches = new Set();
    matchesMatrix.forEach((m) => {
      m.matches.forEach((match, idx) => {
        allMatches.add(`${m.compradorId}_${match.vendedorId}_${idx}`);
      });
    });
    setSelectedMatches(allMatches);
    setPreviewModalOpened(true);
  };

  // --------- AGENDAMIENTO MASIVO INTELIGENTE Y POR MESA (Actualizado) ---------
  const handleAgendarMasivo = async (selectedSet = null) => {
    const matchesToSchedule = selectedSet || selectedMatches;

    if (matchesToSchedule.size === 0) {
      setError("Selecciona al menos un match para agendar.");
      return;
    }

    setLoading(true);
    setGlobalMessage("");
    setPreviewModalOpened(false);

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

    // Construir lista de matches a agendar desde selectedMatches
    const matchesToProcess = [];
    matchesMatrix.forEach((m) => {
      m.matches.forEach((match, idx) => {
        const key = `${m.compradorId}_${match.vendedorId}_${idx}`;
        if (matchesToSchedule.has(key)) {
          matchesToProcess.push({
            compradorId: m.compradorId,
            match,
          });
        }
      });
    });

    // Agendar los matches seleccionados
    for (let item of matchesToProcess) {
      const cmp = compradores.find((c) => c.id === item.compradorId);
      const vendedor = vendedores.find((v) => v.id === item.match.vendedorId);

      if (!cmp || !vendedor) continue;

      // Evita agendar si ya existe
      if (reunionesAgendadas.has(`${cmp.id}_${vendedor.id}`)) {
        pendientes.push({
          compradorId: cmp.id,
          vendedorId: vendedor.id,
          motivo: "Ya agendado",
        });
        continue;
      }

      // Si el comprador ya alcanzó el máximo
      const meetingsComprador = [...reunionesAgendadas].filter(
        (r) => r.startsWith(`${cmp.id}_`)
      ).length;
      if (meetingsComprador >= maxMeetings) {
        pendientes.push({
          compradorId: cmp.id,
          vendedorId: vendedor.id,
          motivo: "Comprador alcanzó máximo de reuniones",
        });
        continue;
      }

      // Buscar slot disponible
      let slotDisponible = null;
      for (let mesa in mesas) {
        if (mesas[mesa].length > 0) {
          slotDisponible = mesas[mesa].shift();
          break;
        }
      }

      if (!slotDisponible) {
        pendientes.push({
          compradorId: cmp.id,
          vendedorId: vendedor.id,
          motivo: "No hay slots disponibles",
        });
        continue;
      }

      try {
        await addDoc(collection(db, "events", eventId, "meetings"), {
          eventId,
          requesterId: cmp.id,
          receiverId: vendedor.id,
          status: "accepted",
          createdAt: new Date(),
          timeSlot: `${slotDisponible.startTime} - ${slotDisponible.endTime}`,
          tableAssigned: slotDisponible.tableNumber.toString(),
          participants: [cmp.id, vendedor.id],
          motivoMatch: item.match.motivo,
          razonMatch: item.match.razonMatch,
          scoreMatch: item.match.score,
          agendadoAutomatico: true,
        });

        await updateDoc(doc(db, "agenda", slotDisponible.id), {
          available: false,
          meetingId: "asignado-ia",
        });

        reunionesPorVendedor[vendedor.id]++;
        reunionesAgendadas.add(`${cmp.id}_${vendedor.id}`);
        scheduled.push({
          compradorId: cmp.id,
          vendedorId: vendedor.id,
        });
      } catch (e) {
        pendientes.push({
          compradorId: cmp.id,
          vendedorId: vendedor.id,
          motivo: "Error al agendar",
        });
      }
    }

    setGlobalMessage(
      `✅ Se agendaron ${scheduled.length} reuniones. ⚠️ Pendientes: ${pendientes.length}`
    );
    setLoading(false);
  };

  return (
    <Container>
      <Group mb="md">
        <Button component={Link} to={`/admin/event/${eventId}`}>
          Volver
        </Button>
        <Title order={2}>Agendar Reuniones Inteligentes</Title>
      </Group>

      <Stack gap="md">
        <Alert title="ℹ️ Información" color="blue">
          {useLocalLlama ? (
            <>Usando <strong>Llama Server</strong> (localhost:8080) para análisis de compatibilidad</>
          ) : (
            <>Usando <strong>Análisis Local</strong> considerando campos: 
              {availableFields.tieneInteresPrincipal && " interés principal,"}
              {availableFields.tieneNecesidad && " necesidad,"}
              {availableFields.tieneDescripcion && " descripción,"}
              {availableFields.tieneEmpresa && " empresa"}
            </>
          )}
        </Alert>

        <Text>
          Genera matches inteligentes considerando: intereses, descripción, necesidad, empresa
          (no se crean matches entre asistentes de la misma empresa).
        </Text>

        <Group grow>
          <Button
            onClick={handleMatchAll}
            loading={loading}
            color="blue"
            variant="light"
          >
            Generar Matches
          </Button>
          <Button
            onClick={handleShowPreview}
            loading={loading}
            color="teal"
            disabled={matchesMatrix.length === 0 || !agenda.some((a) => a.available)}
          >
            Vista Previa y Agendar
          </Button>
        </Group>

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
        {matchesMatrix.length > 0 && (
          <>
            <Title order={4}>
              Matches Generados ({matchesMatrix.reduce((sum, m) => sum + m.matches.length, 0)} total)
            </Title>
            <ScrollArea h={600} type="auto" scrollbars="y">
              {matchesMatrix.map((m, idx) => {
                const cmp = compradores.find((c) => c.id === m.compradorId);
                return (
                  <Card key={idx} shadow="xs" my="sm" p="md" withBorder>
                    <Group justify="space-between" mb="sm">
                      <div>
                        <Text fw={700}>
                          {cmp?.nombre || m.compradorNombre || m.compradorId}
                        </Text>
                        <Text c="dimmed" size="sm">
                          {cmp?.empresa} | Necesidad: {cmp?.necesidad}
                        </Text>
                      </div>
                      <Badge variant="light">
                        {m.matches.length} match{m.matches.length !== 1 ? "es" : ""}
                      </Badge>
                    </Group>

                    {m.matches.length === 0 ? (
                      <Text c="dimmed" size="sm">
                        Sin matches compatibles
                      </Text>
                    ) : (
                      <ScrollArea h={250} type="auto" scrollbars="y">
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
                              <Card
                                key={ix}
                                shadow="xs"
                                my="xs"
                                p="sm"
                                withBorder
                                style={{ backgroundColor: "#fafafa" }}
                              >
                                <Group position="apart" mb="xs">
                                  <div>
                                    <Text fw={600}>
                                      {vendedor?.nombre || match.vendedor || "-"}
                                    </Text>
                                    <Text c="dimmed" size="sm">
                                      {vendedor?.empresa}
                                    </Text>
                                  </div>
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
                                      {(match.score * 100).toFixed(0)}%
                                    </Badge>
                                  )}
                                </Group>
                                <Text color="dimmed" size="sm" mb="xs">
                                  {match.motivo}
                                </Text>
                                <Text color="dark" size="sm" style={{ fontStyle: "italic" }}>
                                  {match.razonMatch || "Compatibilidad potencial"}
                                </Text>
                              </Card>
                            );
                          })}
                      </ScrollArea>
                    )}
                  </Card>
                );
              })}
            </ScrollArea>
          </>
        )}
      </Stack>

      {/* Modal de Preview y Selección */}
      <Modal
        opened={previewModalOpened}
        onClose={() => setPreviewModalOpened(false)}
        title="Vista Previa - Selecciona Matches para Agendar"
        size="xl"
        centered
      >
        <Stack gap="md">
          <Alert color="yellow" title="⚠️ Selecciona los matches a agendar">
            Desselecciona aquellos que no quieras incluir en el agendamiento.
          </Alert>

          <ScrollArea h={500} type="auto" scrollbars="y">
            {matchesMatrix.map((m, idx) => {
              const cmp = compradores.find((c) => c.id === m.compradorId);
              return (
                <Card key={idx} shadow="xs" my="sm" p="md" withBorder>
                  <Text fw={700} mb="sm">
                    {cmp?.nombre || m.compradorNombre}
                  </Text>

                  {m.matches.map((match, ix) => {
                    const vendedor = vendedores.find(
                      (v) => v.id === match.vendedorId
                    );
                    const checkboxKey = `${m.compradorId}_${match.vendedorId}_${ix}`;

                    return (
                      <Group key={ix} mb="sm" wrap="nowrap">
                        <Checkbox
                          checked={selectedMatches.has(checkboxKey)}
                          onChange={(e) => {
                            const newSet = new Set(selectedMatches);
                            if (e.currentTarget.checked) {
                              newSet.add(checkboxKey);
                            } else {
                              newSet.delete(checkboxKey);
                            }
                            setSelectedMatches(newSet);
                          }}
                          style={{ minWidth: "20px" }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Group justify="space-between" wrap="nowrap">
                            <div>
                              <Text size="sm" fw={600} lineClamp={1}>
                                → {vendedor?.nombre || match.vendedor}
                              </Text>
                              <Text size="xs" c="dimmed">
                                {match.razonMatch || match.motivo}
                              </Text>
                            </div>
                            <Badge
                              color={
                                match.score > 0.8
                                  ? "green"
                                  : match.score > 0.5
                                  ? "yellow"
                                  : "red"
                              }
                              style={{ minWidth: "60px" }}
                            >
                              {(match.score * 100).toFixed(0)}%
                            </Badge>
                          </Group>
                        </div>
                      </Group>
                    );
                  })}
                </Card>
              );
            })}
          </ScrollArea>

          <Group grow>
            <Button
              variant="default"
              onClick={() => setPreviewModalOpened(false)}
            >
              Cancelar
            </Button>
            <Button
              color="teal"
              loading={loading}
              onClick={() => handleAgendarMasivo(selectedMatches)}
            >
              Agendar Seleccionados ({selectedMatches.size})
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
};

export default EventMatchPage;

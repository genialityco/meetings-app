import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  getDoc,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import {
  Button,
  Loader,
  Group,
  Title,
  Alert,
  Container,
  Card,
  Text,
  Table,
  Select,
  Tabs,
  Badge,
} from "@mantine/core";

// Simula y agenda con swaps entre vendedores
function simulateScheduleWithSwaps(matches, slotsByMesa, compradorMesa) {
  // Agrupa matches por comprador
  const matchesPorComprador = {};
  matches.forEach((row) => {
    if (!matchesPorComprador[row.compradorId])
      matchesPorComprador[row.compradorId] = [];
    matchesPorComprador[row.compradorId].push(row);
  });

  let resultado = []; // { match, slot }
  let pendientes = [];
  let vendedorSlotMap = new Map();
  let compradorSlotMap = new Map();

  for (const compradorId in matchesPorComprador) {
    const mesa = compradorMesa[compradorId];
    if (!mesa || !slotsByMesa[mesa]) {
      pendientes.push(
        ...matchesPorComprador[compradorId].map((match) => ({
          ...match,
          motivo: "No tiene mesa o no hay slots en mesa",
        }))
      );
      continue;
    }
    const misSlots = slotsByMesa[mesa];
    const matchesOrdenados = matchesPorComprador[compradorId].sort(
      (a, b) => Number(b.matchScore) - Number(a.matchScore)
    );

    for (let i = 0; i < matchesOrdenados.length; i++) {
      let asignado = false;

      // 1. Intentar slot directo
      for (let slotIdx = 0; slotIdx < misSlots.length; slotIdx++) {
        const slot = misSlots[slotIdx];
        const slotKey = slot.startTime;
        if (
          !compradorSlotMap.has(`${compradorId}_${slotKey}`) &&
          !vendedorSlotMap.has(`${matchesOrdenados[i].vendedorId}_${slotKey}`)
        ) {
          resultado.push({ match: matchesOrdenados[i], slot });
          compradorSlotMap.set(`${compradorId}_${slotKey}`, true);
          vendedorSlotMap.set(
            `${matchesOrdenados[i].vendedorId}_${slotKey}`,
            true
          );
          asignado = true;
          break;
        }
      }

      // 2. Intentar swap solo si no fue posible directo
      if (!asignado) {
        for (let swapIdx = 0; swapIdx < resultado.length; swapIdx++) {
          const agendada = resultado[swapIdx];
          // SWAP entre slots de este comprador (vendedores distintos)
          if (
            agendada.match.compradorId === compradorId &&
            agendada.slot !== undefined &&
            misSlots[i] !== undefined &&
            !vendedorSlotMap.has(
              `${matchesOrdenados[i].vendedorId}_${agendada.slot.startTime}`
            ) && // nuevo vendedor libre en ese slot
            !vendedorSlotMap.has(
              `${agendada.match.vendedorId}_${misSlots[i].startTime}`
            ) // viejo vendedor libre en slot futuro
          ) {
            // Swap!
            resultado[swapIdx] = {
              match: agendada.match,
              slot: misSlots[i],
            };
            resultado.push({
              match: matchesOrdenados[i],
              slot: agendada.slot,
            });
            vendedorSlotMap.set(
              `${matchesOrdenados[i].vendedorId}_${agendada.slot.startTime}`,
              true
            );
            vendedorSlotMap.set(
              `${agendada.match.vendedorId}_${misSlots[i].startTime}`,
              true
            );
            compradorSlotMap.set(
              `${compradorId}_${agendada.slot.startTime}`,
              true
            );
            compradorSlotMap.set(
              `${compradorId}_${misSlots[i].startTime}`,
              true
            );
            asignado = true;
            break;
          }
        }
      }

      // 3. Si ni así, a pendientes
      if (!asignado) {
        pendientes.push({
          ...matchesOrdenados[i],
          motivo: "No se pudo asignar, ni con swap",
        });
      }
    }
  }
  return { resultado, pendientes };
}

const ImportMeetingsFromExcelPage = () => {
  const { eventId } = useParams();

  // --- Estado compartido ---
  const [event, setEvent] = useState(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [attendees, setAttendees] = useState([]);
  const [agenda, setAgenda] = useState([]);
  const [loading, setLoading] = useState(false);

  // --- Estado importación Excel ---
  const [file, setFile] = useState(null);
  const [matches, setMatches] = useState([]);
  const [globalMessage, setGlobalMessage] = useState("");
  const [createdMeetings, setCreatedMeetings] = useState(0);
  const [compradorMesa, setCompradorMesa] = useState({});
  const [simResults, setSimResults] = useState(null);

  // --- Estado importación JSON ---
  const [jsonData, setJsonData] = useState([]);
  const [empresaMesa, setEmpresaMesa] = useState({});
  const [jsonSimResults, setJsonSimResults] = useState(null);
  const [jsonMessage, setJsonMessage] = useState("");

  // 1. Cargar asistentes y slots de agenda
  useEffect(() => {
    if (!eventId) return;
    const fetchAll = async () => {
      setLoading(true);
      // Cargar evento
      const eventSnap = await getDoc(doc(db, "events", eventId));
      if (eventSnap.exists()) {
        const eventData = { id: eventSnap.id, ...eventSnap.data() };
        setEvent(eventData);
        // Inicializar fecha seleccionada con la primera fecha del evento
        const dates = eventData.config?.eventDates || (eventData.config?.eventDate ? [eventData.config.eventDate] : []);
        if (dates.length > 0) setSelectedDate(dates[0]);
      }
      const snap = await getDocs(
        query(collection(db, "users"), where("eventId", "==", eventId))
      );
      setAttendees(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      const snap2 = await getDocs(
        collection(db, "events", eventId, "agenda")
      );
      setAgenda(snap2.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    };
    fetchAll();
  }, [eventId]);

  // ─── HANDLERS EXCEL ────────────────────────────────────────────────────────

  const handleFile = (e) => {
    const file = e.target.files[0];
    setFile(file);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target.result);
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

      const normalized = rows.map((row) => ({
        compradorId: row.compradorId,
        compradorNombre: row.comprador_nombre,
        compradorEmpresa: row.comprador_empresa,
        compradorNecesidad: row.comprador_necesidad,
        vendedorId: row.vendedorId,
        vendedorNombre: row.vendedor_nombre,
        vendedorEmpresa: row.vendedor_empresa,
        vendedorDescripcion: row.vendedor_descripcion,
        vendedorNecesidad: row.vendedor_necesidad,
        matchScore: Number(row.match_score ?? 0),
        ordenMatchComprador: row.orden_match_comprador,
        ordenMatchVendedor: row.orden_match_vendedor,
        mesa: row.mesa !== undefined && row.mesa !== null && String(row.mesa).trim() !== "" ? String(row.mesa) : "",
      }));
      setMatches(normalized);

      const compradoresUnicos = Array.from(
        new Set(normalized.map((m) => m.compradorId))
      );

      const asignacionPorDefecto = {};
      compradoresUnicos.forEach((c) => {
        const matchWithMesa = normalized.find(
          (m) =>
            m.compradorId === c &&
            m.mesa !== undefined &&
            m.mesa !== null &&
            String(m.mesa).trim() !== ""
        );
        asignacionPorDefecto[c] = matchWithMesa ? String(matchWithMesa.mesa) : "";
      });

      Object.entries(asignacionPorDefecto).forEach(([cid, mesa]) => {
        if (!mesa) {
          const info = normalized.find(m => m.compradorId === cid);
          console.log(`(Debug) Comprador sin mesa: ID=${cid} | Nombre=${info?.compradorNombre} | Empresa=${info?.compradorEmpresa}`);
        }
      });

      setCompradorMesa(asignacionPorDefecto);
      setSimResults(null);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSimulateAgenda = () => {
    setLoading(true);

    const slotsByMesa = {};
    agenda
      .filter((a) => a.available)
      .forEach((slot) => {
        const mesa = String(slot.tableNumber);
        if (!slotsByMesa[mesa]) slotsByMesa[mesa] = [];
        slotsByMesa[mesa].push(slot);
      });
    Object.values(slotsByMesa).forEach((arr) =>
      arr.sort((a, b) =>
        a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0
      )
    );

    const { resultado, pendientes } = simulateScheduleWithSwaps(
      matches,
      slotsByMesa,
      compradorMesa
    );

    setSimResults({ resultado, pendientes });
    setGlobalMessage(
      `Simulación: ${resultado.length} reuniones asignadas, ${pendientes.length} pendientes por conflictos.`
    );
    setCreatedMeetings(resultado.length);
    setLoading(false);
  };

  const handleCreateMeetings = async () => {
    if (!simResults || !simResults.resultado) {
      setGlobalMessage("Primero debes simular la agenda.");
      return;
    }
    setLoading(true);
    setCreatedMeetings(0);
    setGlobalMessage("");

    const validIds = new Set(attendees.map((a) => a.id));
    let created = 0;
    let skipped = 0;

    for (const { match, slot } of simResults.resultado) {
      const compradorExiste = validIds.has(match.compradorId);
      const vendedorExiste = validIds.has(match.vendedorId);
      if (!compradorExiste || !vendedorExiste) {
        console.warn(
          `[ImportMeetings] Skipping meeting: compradorId=${match.compradorId} (${compradorExiste ? "ok" : "NOT FOUND"}), vendedorId=${match.vendedorId} (${vendedorExiste ? "ok" : "NOT FOUND"})`
        );
        skipped++;
        continue;
      }

      try {
        const meetingRef = await addDoc(
          collection(db, "events", eventId, "meetings"),
          {
            eventId,
            requesterId: match.compradorId,
            receiverId: match.vendedorId,
            status: "accepted",
            createdAt: new Date(),
            timeSlot: `${slot.startTime} - ${slot.endTime}`,
            tableAssigned: slot.tableNumber?.toString(),
            meetingDate: selectedDate || null,
            participants: [match.compradorId, match.vendedorId],
            motivoMatch: "Compatibilidad IA",
            razonMatch: `Score: ${match.matchScore}`,
            scoreMatch: match.matchScore,
            agendadoAutomatico: true,
            ordenMatchComprador: match.ordenMatchComprador,
            ordenMatchVendedor: match.ordenMatchVendedor,
          }
        );
        await updateDoc(doc(db, "events", eventId, "agenda", slot.id), {
          available: false,
          meetingId: meetingRef.id,
        });
        created++;
      } catch (e) {
        console.error("[ImportMeetings] Error:", e);
      }
    }

    const skipMsg = skipped > 0 ? ` (${skipped} omitidas por IDs no encontrados — ver consola)` : "";
    setGlobalMessage(`¡Listo! Se crearon ${created} reuniones en agenda.${skipMsg}`);
    setCreatedMeetings(created);
    setLoading(false);
  };

  // ─── HANDLERS JSON ─────────────────────────────────────────────────────────

  const handleJsonFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        setJsonData(data);
        setEmpresaMesa({});
        setJsonSimResults(null);
        setJsonMessage("");
      } catch {
        setJsonMessage("Error al leer el archivo JSON. Verifica que sea válido.");
      }
    };
    reader.readAsText(file);
  };

  const handleSimulateJson = () => {
    setLoading(true);

    // Índice de slots disponibles: { "HH:MM_tableNumber": slot }
    const slotLookup = {};
    agenda
      .filter((a) => a.available)
      .forEach((slot) => {
        const key = `${slot.startTime}_${String(slot.tableNumber)}`;
        slotLookup[key] = slot;
      });

    const resultado = [];
    const pendientes = [];
    // Copia consumible para detectar doble-booking
    const usedSlots = new Set();

    for (const record of jsonData) {
      const mesa = empresaMesa[record.comprador_empresa];
      if (!mesa) {
        pendientes.push({ ...record, motivo: "Empresa sin mesa asignada" });
        continue;
      }

      // Parsear bloque "HH:MM-HH:MM"
      const dashIdx = record.bloque.indexOf("-");
      const startTime = record.bloque.substring(0, dashIdx);

      const slotKey = `${startTime}_${mesa}`;

      if (usedSlots.has(slotKey)) {
        pendientes.push({
          ...record,
          motivo: `Conflicto: ya hay otra reunión en mesa ${mesa} a las ${startTime}`,
        });
        continue;
      }

      const slot = slotLookup[slotKey];
      if (!slot) {
        pendientes.push({
          ...record,
          motivo: `No hay slot disponible en mesa ${mesa} para el bloque ${record.bloque}`,
        });
        continue;
      }

      usedSlots.add(slotKey);
      resultado.push({ record, slot });
    }

    setJsonSimResults({ resultado, pendientes });
    setJsonMessage(
      `Simulación: ${resultado.length} reuniones asignadas, ${pendientes.length} con problemas.`
    );
    setLoading(false);
  };

  const handleCreateJsonMeetings = async () => {
    if (!jsonSimResults?.resultado?.length) {
      setJsonMessage("Primero debes simular la agenda.");
      return;
    }
    setLoading(true);

    const validIds = new Set(attendees.map((a) => a.id));
    let created = 0;
    let skipped = 0;

    for (const { record, slot } of jsonSimResults.resultado) {
      if (!validIds.has(record.comprador_id) || !validIds.has(record.vendedor_id)) {
        console.warn(
          `[ImportJSON] Skipping: comprador=${record.comprador_id}, vendedor=${record.vendedor_id}`
        );
        skipped++;
        continue;
      }

      try {
        const meetingRef = await addDoc(
          collection(db, "events", eventId, "meetings"),
          {
            eventId,
            requesterId: record.comprador_id,
            receiverId: record.vendedor_id,
            status: "accepted",
            createdAt: new Date(),
            timeSlot: `${slot.startTime} - ${slot.endTime}`,
            tableAssigned: String(slot.tableNumber),
            meetingDate: selectedDate || null,
            participants: [record.comprador_id, record.vendedor_id],
            motivoMatch: "Compatibilidad IA",
            razonMatch: `Afinidad: ${record.afinidad}`,
            scoreMatch: record.afinidad,
            agendadoAutomatico: true,
            isNotificated: false
          }
        );
        await updateDoc(doc(db, "events", eventId, "agenda", slot.id), {
          available: false,
          meetingId: meetingRef.id,
        });
        created++;
      } catch (e) {
        console.error("[ImportJSON] Error creando reunión:", e);
      }
    }

    const skipMsg = skipped > 0 ? ` (${skipped} omitidas por IDs no encontrados — ver consola)` : "";
    setJsonMessage(`¡Listo! Se crearon ${created} reuniones desde JSON.${skipMsg}`);
    setLoading(false);
  };

  // ─── COMPUTED ──────────────────────────────────────────────────────────────

  // Fechas del evento
  const eventDates = event?.config?.eventDates || (event?.config?.eventDate ? [event.config.eventDate] : []);
  const isMultiDay = eventDates.length > 1;

  const formatDate = (dateStr) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
  };

  // Excel
  const compradoresUnicos = Array.from(new Set(matches.map((m) => m.compradorId)));
  const compradoresData = compradoresUnicos.map((cid) => {
    const m = matches.find((r) => r.compradorId === cid);
    return {
      compradorId: cid,
      compradorNombre: m.compradorNombre,
      compradorEmpresa: m.compradorEmpresa,
      reuniones: matches.filter((r) => r.compradorId === cid).length,
    };
  });

  const mesasDisponibles = Array.from(
    new Set(agenda.filter((a) => a.available).map((a) => String(a.tableNumber)))
  ).sort((a, b) => Number(a) - Number(b));

  const resumen = (() => {
    if (matches.length === 0) return null;
    const compradoresUnicosSet = new Set(matches.map((m) => m.compradorId));
    const vendedoresUnicos = new Set(matches.map((m) => m.vendedorId));
    const slotsDisponibles = agenda.filter((a) => a.available).length;
    const reunionesPorComprador = matches.reduce((acc, m) => {
      acc[m.compradorNombre] = (acc[m.compradorNombre] || 0) + 1;
      return acc;
    }, {});
    const reunionesPorVendedor = matches.reduce((acc, m) => {
      acc[m.vendedorNombre] = (acc[m.vendedorNombre] || 0) + 1;
      return acc;
    }, {});
    const compradoresPorCompletar = Object.entries(reunionesPorComprador)
      .filter(([, n]) => n < 18)
      .map(([nombre]) => nombre);
    const vendedoresConMenosDe3 = Object.entries(reunionesPorVendedor)
      .filter(([, n]) => n < 3)
      .map(([nombre]) => nombre);
    const matchFuerte = matches.filter((m) => Number(m.matchScore) >= 80).length;
    const matchMedio = matches.filter((m) => Number(m.matchScore) >= 40 && Number(m.matchScore) < 80).length;
    const matchDebil = matches.filter((m) => Number(m.matchScore) > 0 && Number(m.matchScore) < 40).length;
    const scoreMax = Math.max(...matches.map((m) => Number(m.matchScore)));
    const scoreMin = Math.min(...matches.map((m) => Number(m.matchScore)));

    return {
      compradoresUnicos: compradoresUnicosSet,
      vendedoresUnicos,
      slotsDisponibles,
      reunionesPorComprador,
      reunionesPorVendedor,
      compradoresPorCompletar,
      vendedoresConMenosDe3,
      matchFuerte,
      matchMedio,
      matchDebil,
      scoreMax,
      scoreMin,
    };
  })();

  // JSON
  const empresasUnicas = [...new Set(jsonData.map((r) => r.comprador_empresa))].sort();
  const empresasData = empresasUnicas.map((emp) => {
    const records = jsonData.filter((r) => r.comprador_empresa === emp);
    const compradores = [...new Set(records.map((r) => r.comprador_id))];
    return {
      empresa: emp,
      compradores: compradores.length,
      reuniones: records.length,
    };
  });
  const todasEmpresasConMesa = empresasUnicas.every((e) => empresaMesa[e]);

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <Container>
      <Group mb="md">
        <Button component={Link} to={`/admin/event/${eventId}`}>
          Volver
        </Button>
        <Title order={2}>Importar reuniones</Title>
      </Group>

      {/* Selector de fecha */}
      {isMultiDay ? (
        <Card withBorder shadow="sm" p="sm" mb="md" style={{ maxWidth: 320 }}>
          <Text size="sm" fw={600} mb={6}>Fecha de las reuniones a importar</Text>
          <Select
            data={eventDates.map((d) => ({ value: d, label: `${formatDate(d)} (${d})` }))}
            value={selectedDate}
            onChange={setSelectedDate}
            placeholder="Seleccionar día"
            withinPortal
          />
        </Card>
      ) : selectedDate ? (
        <Text size="sm" c="dimmed" mb="md">
          Fecha del evento: <b>{selectedDate}</b>
        </Text>
      ) : null}

      {loading && <Loader mb="md" />}

      <Tabs defaultValue="json">
        <Tabs.List>
          <Tabs.Tab value="json">Desde JSON</Tabs.Tab>
          <Tabs.Tab value="excel">Desde Excel</Tabs.Tab>
        </Tabs.List>

        {/* ══════════════════ TAB JSON ══════════════════ */}
        <Tabs.Panel value="json" pt="md">

          <input type="file" accept=".json" onChange={handleJsonFile} />

          {/* Resumen JSON */}
          {jsonData.length > 0 && (
            <Card mt="md" shadow="sm" p="md" withBorder>
              <Title order={5} mb="xs">Resumen del archivo</Title>
              <Text>
                <b>Total reuniones:</b> {jsonData.length}<br />
                <b>Empresas compradoras:</b> {empresasUnicas.length}<br />
                <b>Slots disponibles en agenda:</b> {agenda.filter((a) => a.available).length}<br />
                <b>Bloques horarios:</b> {[...new Set(jsonData.map((r) => r.bloque))].sort().join(", ")}
              </Text>
              {agenda.filter((a) => a.available).length < jsonData.length && (
                <Text mt="xs" c="orange">
                  ⚠ Hay menos slots disponibles que reuniones a crear.
                </Text>
              )}
            </Card>
          )}

          {/* Tabla asignación de mesa por empresa compradora */}
          {empresasData.length > 0 && (
            <Card mt="md" shadow="sm" p="md" withBorder>
              <Title order={5} mb="xs">Asignación de mesa por empresa compradora</Title>
              <Text size="sm" c="dimmed" mb="sm">
                Cada empresa compradora permanece en su mesa durante todo el evento.
                Si dos nombres de empresa son la misma, asigna la misma mesa.
              </Text>
              <Table striped withBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Empresa compradora</Table.Th>
                    <Table.Th>Compradores</Table.Th>
                    <Table.Th>Reuniones</Table.Th>
                    <Table.Th>Mesa asignada</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {empresasData.map((e) => (
                    <Table.Tr key={e.empresa}>
                      <Table.Td>{e.empresa}</Table.Td>
                      <Table.Td>{e.compradores}</Table.Td>
                      <Table.Td>{e.reuniones}</Table.Td>
                      <Table.Td>
                        <Select
                          data={mesasDisponibles.map((num) => ({
                            value: num,
                            label: `Mesa ${num}`,
                          }))}
                          value={empresaMesa[e.empresa] || ""}
                          onChange={(val) =>
                            setEmpresaMesa((em) => ({ ...em, [e.empresa]: val }))
                          }
                          placeholder="Seleccionar mesa"
                          searchable
                          withinPortal
                          required
                        />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Card>
          )}

          {/* Botón simular */}
          {jsonData.length > 0 && (
            <Button
              mt="md"
              color="orange"
              loading={loading}
              disabled={!todasEmpresasConMesa}
              onClick={handleSimulateJson}
            >
              Simular asignación de reuniones
            </Button>
          )}

          {/* Resultados simulación JSON */}
          {jsonSimResults && (
            <Card mt="md" shadow="sm" p="md" withBorder>
              <Title order={5} mb="xs">Resultados de simulación</Title>
              <Text>
                <b>Reuniones listas para crear:</b> {jsonSimResults.resultado.length}<br />
                <b>Con problemas:</b> {jsonSimResults.pendientes.length}
              </Text>
              {jsonSimResults.pendientes.length > 0 && (
                <Card mt="sm" p="xs" withBorder bg="red.0">
                  <Text size="sm" fw={500} c="red" mb={4}>Reuniones con problemas:</Text>
                  <Table striped withBorder fz="xs">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Comprador</Table.Th>
                        <Table.Th>Empresa</Table.Th>
                        <Table.Th>Vendedor</Table.Th>
                        <Table.Th>Bloque</Table.Th>
                        <Table.Th>Motivo</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {jsonSimResults.pendientes.map((p, i) => (
                        <Table.Tr key={i}>
                          <Table.Td>{p.comprador_nombre}</Table.Td>
                          <Table.Td>{p.comprador_empresa}</Table.Td>
                          <Table.Td>{p.vendedor_nombre}</Table.Td>
                          <Table.Td>{p.bloque}</Table.Td>
                          <Table.Td>
                            <Badge color="red" size="sm">{p.motivo}</Badge>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Card>
              )}
            </Card>
          )}

          {/* Botón crear en Firestore */}
          {jsonSimResults?.resultado?.length > 0 && (
            <Button
              mt="md"
              color="teal"
              loading={loading}
              onClick={handleCreateJsonMeetings}
            >
              Crear {jsonSimResults.resultado.length} reuniones en Firebase
            </Button>
          )}

          {jsonMessage && (
            <Alert
              color={jsonMessage.startsWith("Error") ? "red" : "green"}
              mt="md"
            >
              {jsonMessage}
            </Alert>
          )}
        </Tabs.Panel>

        {/* ══════════════════ TAB EXCEL ══════════════════ */}
        <Tabs.Panel value="excel" pt="md">

          <input type="file" accept=".xlsx,.xls" onChange={handleFile} />

          {/* RESUMEN */}
          {resumen && (
            <Card mt="md" shadow="sm" p="md" withBorder>
              <Title order={5} mb="xs">Resumen de datos a importar</Title>
              <Text>
                <b>Compradores únicos:</b> {resumen.compradoresUnicos.size}<br />
                <b>Vendedores únicos:</b> {resumen.vendedoresUnicos.size}<br />
                <b>Reuniones a crear:</b> {matches.length}<br />
                <b>Slots de agenda disponibles:</b> {resumen.slotsDisponibles}
              </Text>
              <Text mt="xs">
                <b>Reuniones por comprador (ejemplo):</b><br />
                {Object.entries(resumen.reunionesPorComprador)
                  .slice(0, 5)
                  .map(([nombre, n]) => (
                    <span key={nombre}>{nombre}: {n} &nbsp; </span>
                  ))}
                {Object.keys(resumen.reunionesPorComprador).length > 5 && <span>... (y más)</span>}
              </Text>
              <Text mt="xs">
                <b>Reuniones por vendedor (ejemplo):</b><br />
                {Object.entries(resumen.reunionesPorVendedor)
                  .slice(0, 5)
                  .map(([nombre, n]) => (
                    <span key={nombre}>{nombre}: {n} &nbsp; </span>
                  ))}
                {Object.keys(resumen.reunionesPorVendedor).length > 5 && <span>... (y más)</span>}
              </Text>
              <Text mt="xs">
                <b>Compradores con menos de 18 reuniones:</b>{" "}
                {resumen.compradoresPorCompletar.length ? resumen.compradoresPorCompletar.join(", ") : "Ninguno"}
              </Text>
              <Text mt="xs">
                <b>Vendedores con menos de 3 reuniones:</b>{" "}
                {resumen.vendedoresConMenosDe3.length ? resumen.vendedoresConMenosDe3.join(", ") : "Ninguno"}
              </Text>
              <Text mt="xs">
                <b>Match fuerte (score ≥ 80):</b> {resumen.matchFuerte}<br />
                <b>Match medio (score 40-79):</b> {resumen.matchMedio}<br />
                <b>Match débil (score 1-39):</b> {resumen.matchDebil}
              </Text>
              <Text mt="xs">
                <b>Score máximo:</b> {resumen.scoreMax}<br />
                <b>Score mínimo:</b> {resumen.scoreMin}
              </Text>
              <Text mt="xs" color="orange">
                <b>¿Alcanza la agenda?</b>{" "}
                {resumen.slotsDisponibles >= matches.length
                  ? "Sí, hay suficientes slots."
                  : "No, FALTAN slots, algunos compradores quedarán sin reuniones."}
              </Text>
            </Card>
          )}

          {/* Tabla editable para asignación de mesa por comprador */}
          {matches.length > 0 && (
            <Card mt="md" shadow="sm" p="md" withBorder>
              <Title order={5} mb="xs">Asignación de Mesa por Comprador</Title>
              <Table striped withBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Comprador</Table.Th>
                    <Table.Th>Empresa</Table.Th>
                    <Table.Th>Reuniones</Table.Th>
                    <Table.Th>Mesa Asignada</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {compradoresData.map((c) => (
                    <Table.Tr key={c.compradorId}>
                      <Table.Td>{c.compradorNombre}</Table.Td>
                      <Table.Td>{c.compradorEmpresa}</Table.Td>
                      <Table.Td>{c.reuniones}</Table.Td>
                      <Table.Td>
                        <Select
                          data={mesasDisponibles.map((num) => ({
                            value: num,
                            label: `Mesa ${num}`,
                          }))}
                          value={compradorMesa[c.compradorId] || ""}
                          onChange={(val) =>
                            setCompradorMesa((cm) => ({ ...cm, [c.compradorId]: val }))
                          }
                          placeholder="Seleccionar mesa"
                          searchable
                          withinPortal
                          required
                        />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Card>
          )}

          {/* Botón simular agenda Excel */}
          {matches.length > 0 && (
            <Button
              mt="md"
              onClick={handleSimulateAgenda}
              loading={loading}
              color="orange"
              disabled={Object.values(compradorMesa).some((m) => !m)}
            >
              Simular agenda y asignar reuniones
            </Button>
          )}

          {/* Resultados de la simulación Excel */}
          {simResults && (
            <Card mt="md" shadow="sm" p="md" withBorder>
              <Title order={5} mb="xs">Resultados de Simulación</Title>
              <Text>
                Reuniones simuladas/agendadas: {simResults.resultado.length}<br />
                Reuniones NO agendadas: {simResults.pendientes.length}
              </Text>
              {simResults.pendientes.length > 0 && (
                <Text mt="xs" color="red">
                  Ejemplo pendiente:{" "}
                  {simResults.pendientes
                    .slice(0, 5)
                    .map((p) => `${p.compradorNombre} vs ${p.vendedorNombre} (${p.motivo})`)
                    .join("; ")}
                  {simResults.pendientes.length > 5 && " ..."}
                </Text>
              )}
            </Card>
          )}

          {/* Botón crear en Firestore (Excel) */}
          {simResults && simResults.resultado.length > 0 && (
            <Button
              mt="md"
              onClick={handleCreateMeetings}
              loading={loading}
              color="teal"
            >
              Crear reuniones en agenda de Firebase
            </Button>
          )}

          {globalMessage && (
            <Alert color="green" mt="md">
              {globalMessage}
            </Alert>
          )}
          {matches.length > 0 && (
            <Card mt="md">
              <Text>Se cargaron {matches.length} matches desde Excel.</Text>
            </Card>
          )}
        </Tabs.Panel>
      </Tabs>
    </Container>
  );
};

export default ImportMeetingsFromExcelPage;

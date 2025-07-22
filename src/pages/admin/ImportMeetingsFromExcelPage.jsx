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
  const [file, setFile] = useState(null);
  const [matches, setMatches] = useState([]);
  const [attendees, setAttendees] = useState([]);
  const [agenda, setAgenda] = useState([]);
  const [loading, setLoading] = useState(false);
  const [globalMessage, setGlobalMessage] = useState("");
  const [createdMeetings, setCreatedMeetings] = useState(0);
  const [compradorMesa, setCompradorMesa] = useState({}); // { compradorId: mesa }
  const [simResults, setSimResults] = useState(null); // { resultado, pendientes }

  // 1. Cargar asistentes y slots de agenda
  useEffect(() => {
    if (!eventId) return;
    const fetchAll = async () => {
      setLoading(true);
      const snap = await getDocs(
        query(collection(db, "users"), where("eventId", "==", eventId))
      );
      setAttendees(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      const snap2 = await getDocs(
        query(collection(db, "agenda"), where("eventId", "==", eventId))
      );
      setAgenda(snap2.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    };
    fetchAll();
  }, [eventId]);

  // 2. Procesar Excel cargado
const handleFile = (e) => {
  const file = e.target.files[0];
  setFile(file);
  const reader = new FileReader();
  reader.onload = (evt) => {
    const data = new Uint8Array(evt.target.result);
    const wb = XLSX.read(data, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

    // Incluye la columna "mesa" y normaliza todos los datos relevantes
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

    // Asignación robusta de mesa: busca la PRIMERA mesa no vacía para cada comprador
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

    // Debug opcional: compradores sin mesa detectada
    Object.entries(asignacionPorDefecto).forEach(([cid, mesa]) => {
      if (!mesa) {
        const info = normalized.find(m => m.compradorId === cid);
        console.log(`(Debug) Comprador sin mesa: ID=${cid} | Nombre=${info?.compradorNombre} | Empresa=${info?.compradorEmpresa}`);
      }
    });

    setCompradorMesa(asignacionPorDefecto);
    setSimResults(null); // Limpiar simulación al recargar Excel
  };
  reader.readAsArrayBuffer(file);
};


  // 3. Simular la agenda antes de crear en Firebase
  const handleSimulateAgenda = () => {
    setLoading(true);

    // Prepara slots por mesa y hora
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

    // SIMULAR
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

  // 4. Crear en Firestore solo las asignadas en simResults
  const handleCreateMeetings = async () => {
    if (!simResults || !simResults.resultado) {
      setGlobalMessage("Primero debes simular la agenda.");
      return;
    }
    setLoading(true);
    setCreatedMeetings(0);
    setGlobalMessage("");

    for (const { match, slot } of simResults.resultado) {
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
            participants: [match.compradorId, match.vendedorId],
            motivoMatch: "Compatibilidad IA",
            razonMatch: `Score: ${match.matchScore}`,
            scoreMatch: match.matchScore,
            agendadoAutomatico: true,
            ordenMatchComprador: match.ordenMatchComprador,
            ordenMatchVendedor: match.ordenMatchVendedor,
          }
        );
        await updateDoc(doc(db, "agenda", slot.id), {
          available: false,
          meetingId: meetingRef.id,
        });
      } catch (e) {
        // Manejo de errores si falla
      }
    }

    setGlobalMessage(
      `¡Listo! Se crearon ${simResults.resultado.length} reuniones en agenda.`
    );
    setCreatedMeetings(simResults.resultado.length);
    setLoading(false);
  };

  // -- Tabla editable de asignación de mesas por comprador --
  const compradoresUnicos = Array.from(
    new Set(matches.map((m) => m.compradorId))
  );
  const compradoresData = compradoresUnicos.map((cid) => {
    const m = matches.find((r) => r.compradorId === cid);
    return {
      compradorId: cid,
      compradorNombre: m.compradorNombre,
      compradorEmpresa: m.compradorEmpresa,
      reuniones: matches.filter((r) => r.compradorId === cid).length,
    };
  });

  // Opciones de mesas en agenda
  const mesasDisponibles = Array.from(
    new Set(agenda.filter((a) => a.available).map((a) => String(a.tableNumber)))
  ).sort((a, b) => Number(a) - Number(b));

  // -- RESUMEN DINÁMICO --
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

    const matchFuerte = matches.filter(
      (m) => Number(m.matchScore) >= 80
    ).length;
    const matchMedio = matches.filter(
      (m) => Number(m.matchScore) >= 40 && Number(m.matchScore) < 80
    ).length;
    const matchDebil = matches.filter(
      (m) => Number(m.matchScore) > 0 && Number(m.matchScore) < 40
    ).length;
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

  return (
    <Container>
      <Group mb="md">
        <Button component={Link} to={`/admin/event/${eventId}`}>
          Volver
        </Button>
        <Title order={2}>Importar reuniones desde Excel</Title>
      </Group>

      <input type="file" accept=".xlsx,.xls" onChange={handleFile} />

      {/* RESUMEN */}
      {resumen && (
        <Card mt="md" shadow="sm" p="md" withBorder>
          <Title order={5} mb="xs">
            Resumen de datos a importar
          </Title>
          <Text>
            <b>Compradores únicos:</b> {resumen.compradoresUnicos.size}
            <br />
            <b>Vendedores únicos:</b> {resumen.vendedoresUnicos.size}
            <br />
            <b>Reuniones a crear:</b> {matches.length}
            <br />
            <b>Slots de agenda disponibles:</b> {resumen.slotsDisponibles}
          </Text>
          <Text mt="xs">
            <b>Reuniones por comprador (ejemplo):</b>
            <br />
            {Object.entries(resumen.reunionesPorComprador)
              .slice(0, 5)
              .map(([nombre, n]) => (
                <span key={nombre}>
                  {nombre}: {n} &nbsp;{" "}
                </span>
              ))}
            {Object.keys(resumen.reunionesPorComprador).length > 5 && (
              <span>... (y más)</span>
            )}
          </Text>
          <Text mt="xs">
            <b>Reuniones por vendedor (ejemplo):</b>
            <br />
            {Object.entries(resumen.reunionesPorVendedor)
              .slice(0, 5)
              .map(([nombre, n]) => (
                <span key={nombre}>
                  {nombre}: {n} &nbsp;{" "}
                </span>
              ))}
            {Object.keys(resumen.reunionesPorVendedor).length > 5 && (
              <span>... (y más)</span>
            )}
          </Text>
          <Text mt="xs">
            <b>Compradores con menos de 18 reuniones:</b>{" "}
            {resumen.compradoresPorCompletar.length
              ? resumen.compradoresPorCompletar.join(", ")
              : "Ninguno"}
          </Text>
          <Text mt="xs">
            <b>Vendedores con menos de 3 reuniones:</b>{" "}
            {resumen.vendedoresConMenosDe3.length
              ? resumen.vendedoresConMenosDe3.join(", ")
              : "Ninguno"}
          </Text>
          <Text mt="xs">
            <b>Match fuerte (score ≥ 80):</b> {resumen.matchFuerte} <br />
            <b>Match medio (score 40-79):</b> {resumen.matchMedio} <br />
            <b>Match débil (score 1-39):</b> {resumen.matchDebil}
          </Text>
          <Text mt="xs">
            <b>Score máximo:</b> {resumen.scoreMax} <br />
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
          <Title order={5} mb="xs">
            Asignación de Mesa por Comprador
          </Title>
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
                        setCompradorMesa((cm) => ({
                          ...cm,
                          [c.compradorId]: val,
                        }))
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

      {/* Botón para simular agenda */}
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

      {/* Resultados de la simulación */}
      {simResults && (
        <Card mt="md" shadow="sm" p="md" withBorder>
          <Title order={5} mb="xs">
            Resultados de Simulación
          </Title>
          <Text>
            Reuniones simuladas/agendadas: {simResults.resultado.length}
            <br />
            Reuniones NO agendadas: {simResults.pendientes.length}
          </Text>
          {simResults.pendientes.length > 0 && (
            <Text mt="xs" color="red">
              Ejemplo pendiente:{" "}
              {simResults.pendientes
                .slice(0, 5)
                .map(
                  (p) =>
                    `${p.compradorNombre} vs ${p.vendedorNombre} (${p.motivo})`
                )
                .join("; ")}
              {simResults.pendientes.length > 5 && " ..."}
            </Text>
          )}
        </Card>
      )}

      {/* Botón para crear en firestore */}
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
      {loading && <Loader />}
      {matches.length > 0 && (
        <Card mt="md">
          <Text>Se cargaron {matches.length} matches desde Excel.</Text>
        </Card>
      )}
    </Container>
  );
};

export default ImportMeetingsFromExcelPage;

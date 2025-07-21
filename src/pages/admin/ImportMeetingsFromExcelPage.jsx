// ./pages/admin/ImportMeetingsFromExcelPage.jsx
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
} from "@mantine/core";

const ImportMeetingsFromExcelPage = () => {
  const { eventId } = useParams();
  const [file, setFile] = useState(null);
  const [matches, setMatches] = useState([]);
  const [attendees, setAttendees] = useState([]);
  const [agenda, setAgenda] = useState([]);
  const [loading, setLoading] = useState(false);
  const [globalMessage, setGlobalMessage] = useState("");
  const [createdMeetings, setCreatedMeetings] = useState(0);

  // 1. Cargar asistentes y slots de agenda
  useEffect(() => {
    if (!eventId) return;
    const fetchAll = async () => {
      setLoading(true);
      // Asistentes
      const snap = await getDocs(
        query(collection(db, "users"), where("eventId", "==", eventId))
      );
      setAttendees(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      // Slots de agenda
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
      setMatches(rows);
    };
    reader.readAsArrayBuffer(file);
  };

  // 3. Crear reuniones en slots disponibles de agenda, manteniendo comprador en la misma mesa
const handleCreateMeetings = async () => {
  setLoading(true);
  setCreatedMeetings(0);
  setGlobalMessage("");

  // Agrupa slots disponibles por mesa
  const mesas = {};
  agenda.filter(a => a.available).forEach(slot => {
    if (!mesas[slot.tableNumber]) mesas[slot.tableNumber] = [];
    mesas[slot.tableNumber].push(slot);
  });

  // Agrupa matches por comprador
  const grouped = {};
  matches.forEach(row => {
    if (!grouped[row.compradorId]) grouped[row.compradorId] = [];
    grouped[row.compradorId].push(row);
  });

  let totalCreated = 0;
  let pendientes = [];
  let mesasAsignadas = Object.keys(mesas); // Lista de mesas disponibles

  let compradorIndex = 0;
  for (const compradorId in grouped) {
    // Asigna la siguiente mesa libre
    const mesaActual = mesasAsignadas[compradorIndex];
    compradorIndex++;

    const slotsMesa = mesas[mesaActual]?.splice(0, 24) || [];

    if (slotsMesa.length < 24) {
      pendientes.push(compradorId);
      continue;
    }

    for (let i = 0; i < grouped[compradorId].length && i < slotsMesa.length; i++) {
      const match = grouped[compradorId][i];
      try {
        await addDoc(collection(db, "events", eventId, "meetings"), {
          eventId,
          requesterId: match.compradorId,
          receiverId: match.vendedorId,
          status: "accepted",
          createdAt: new Date(),
          timeSlot: `${slotsMesa[i].startTime} - ${slotsMesa[i].endTime}`,
          tableAssigned: slotsMesa[i].tableNumber.toString(),
          participants: [match.compradorId, match.vendedorId],
          motivoMatch:
            match.tipoAsignacion === "MATCH"
              ? "Compatibilidad"
              : "Mínimo por vendedor",
          razonMatch: match.razon,
          scoreMatch: match.score,
          agendadoAutomatico: true,
        });
        await updateDoc(doc(db, "agenda", slotsMesa[i].id), {
          available: false,
          meetingId: "asignado-ia",
        });
        totalCreated++;
      } catch (e) {
        // Si falla, simplemente lo omite y sigue
      }
    }
  }

  setGlobalMessage(
    `Se crearon ${totalCreated} reuniones. ${
      pendientes.length
        ? `Pendientes: ${pendientes.length} compradores sin slots.`
        : ""
    }`
  );
  setCreatedMeetings(totalCreated);
  setLoading(false);
};


  // -- RESUMEN DINÁMICO --
  const resumen = (() => {
    if (matches.length === 0) return null;

    const compradoresUnicos = new Set(matches.map((m) => m.compradorId));
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
      .filter(([, n]) => n < 24)
      .map(([nombre]) => nombre);
    const vendedoresConMenosDe3 = Object.entries(reunionesPorVendedor)
      .filter(([, n]) => n < 3)
      .map(([nombre]) => nombre);

    const matchFuerte = matches.filter((m) => m.score >= 8).length;
    const matchMedio = matches.filter(
      (m) => m.score >= 4 && m.score < 8
    ).length;
    const matchDebil = matches.filter((m) => m.score > 0 && m.score < 4).length;
    const comodin = matches.filter(
      (m) => m.tipoAsignacion === "COMODIN"
    ).length;
    const scoreMax = Math.max(...matches.map((m) => Number(m.score)));
    const scoreMin = Math.min(...matches.map((m) => Number(m.score)));

    return {
      compradoresUnicos,
      vendedoresUnicos,
      slotsDisponibles,
      reunionesPorComprador,
      reunionesPorVendedor,
      compradoresPorCompletar,
      vendedoresConMenosDe3,
      matchFuerte,
      matchMedio,
      matchDebil,
      comodin,
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
            <b>Compradores con menos de 24 reuniones:</b>{" "}
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
            <b>Match fuerte (score ≥ 8):</b> {resumen.matchFuerte} <br />
            <b>Match medio (score 4-7):</b> {resumen.matchMedio} <br />
            <b>Match débil (score 1-3):</b> {resumen.matchDebil} <br />
            <b>Asignaciones COMODIN:</b> {resumen.comodin}
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

      {matches.length > 0 && (
        <Button
          mt="md"
          onClick={handleCreateMeetings}
          loading={loading}
          color="teal"
        >
          Crear reuniones en agenda
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

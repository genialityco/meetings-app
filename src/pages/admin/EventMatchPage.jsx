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
  TextInput,
  Radio,
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
  getDoc,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import * as XLSX from "xlsx";
import ManualMeetingModal from "./ManualMeetingModal";

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
  const [searchEmail, setSearchEmail] = useState("");
  const [matchesWithSlots, setMatchesWithSlots] = useState([]);
  const [assignmentMode, setAssignmentMode] = useState("auto"); // 'auto' | 'manual'
  const [availableSlots, setAvailableSlots] = useState([]);
  const [manualAssignments, setManualAssignments] = useState({}); // key -> slotId
  const [slotPickerOpened, setSlotPickerOpened] = useState(false);
  const [slotPickerKey, setSlotPickerKey] = useState(null);
  const [slotPickerSelectedId, setSlotPickerSelectedId] = useState(null);
  const [manualModalOpened, setManualModalOpened] = useState(false);
  const [manualModalParticipants, setManualModalParticipants] = useState({ p1: null, p2: null });

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

        // Cargar el documento del evento (por ID, no por campo "id")
        const eventDoc = await getDoc(doc(db, "events", eventId));
        if (eventDoc.exists()) {
          const eventData = eventDoc.data();
          setEventConfig(eventData.config || {});
          console.log("Event config cargada:", eventData.config);
        } else {
          console.warn("Evento no encontrado");
          setEventConfig({});
        }
      } catch (e) {
        console.error("Error cargando datos:", e);
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

  // Exportar matches a Excel
  const exportToExcel = () => {
    if (matchesMatrix.length === 0) {
      alert("No hay matches para exportar");
      return;
    }

    // Crear array de datos para Excel
    const data = [];
    matchesMatrix.forEach((comprador) => {
      const cmp = compradores.find((c) => c.id === comprador.compradorId);
      
      if (comprador.matches.length === 0) {
        data.push({
          "Comprador": cmp?.nombre || comprador.compradorNombre,
          "Email Comprador": comprador.compradorEmail || "",
          "Empresa Comprador": cmp?.empresa || "",
          "Necesidad": cmp?.necesidad || "",
          "Vendedor": "-",
          "Email Vendedor": "-",
          "Empresa Vendedor": "-",
          "Score (%)": "-",
          "Motivo Match": "-",
          "Razón Match": "-",
          "Horario Tentativo": "-",
          "Mesa": "-",
        });
      } else {
        comprador.matches.forEach((match) => {
          const vendedor = vendedores.find((v) => v.id === match.vendedorId);
          data.push({
            "Comprador": cmp?.nombre || comprador.compradorNombre,
            "Email Comprador": comprador.compradorEmail || "",
            "Empresa Comprador": cmp?.empresa || "",
            "Necesidad": cmp?.necesidad || "",
            "Vendedor": vendedor?.nombre || match.vendedor || "-",
            "Email Vendedor": match.vendedorEmail || "",
            "Empresa Vendedor": vendedor?.empresa || "",
            "Score (%)": match.score ? (match.score * 100).toFixed(0) : "-",
            "Motivo Match": match.motivo || "-",
            "Razón Match": match.razonMatch || "-",
            "Horario Tentativo": match.tentativeSlot 
              ? `${match.tentativeSlot.startTime} - ${match.tentativeSlot.endTime}`
              : "No asignado",
            "Mesa": match.tentativeSlot 
              ? match.tentativeSlot.tableNumber
              : "-",
          });
        });
      }
    });

    // Crear workbook
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Matches");

    // Ajustar ancho de columnas
    const colWidths = [
      { wch: 18 },  // Comprador
      { wch: 22 },  // Email Comprador
      { wch: 18 },  // Empresa Comprador
      { wch: 20 },  // Necesidad
      { wch: 18 },  // Vendedor
      { wch: 22 },  // Email Vendedor
      { wch: 18 },  // Empresa Vendedor
      { wch: 12 },  // Score
      { wch: 18 },  // Motivo Match
      { wch: 30 },  // Razón Match
      { wch: 22 },  // Horario Tentativo
      { wch: 8 },   // Mesa
    ];
    worksheet["!cols"] = colWidths;

    // Descargar archivo
    const fileName = `matches_${new Date().toISOString().split("T")[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };
  const assignTentativeSlots = (results) => {
    // Default behavior: simple sequential assignment
    const slots = agenda
      .filter((slot) => slot.available)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    // If manual mode, apply manualAssignments mapping
    if (assignmentMode === "manual") {
      const usedSlotIds = new Set();
      const resultsWithSlots = results.map((comprador) => ({
        ...comprador,
        matches: comprador.matches.map((match, idx) => {
          const key = `${comprador.compradorId}_${match.vendedorId}_${idx}`;
          const slotId = manualAssignments[key];
          const slot = slots.find((s) => s.id === slotId && !usedSlotIds.has(s.id));
          if (slot) usedSlotIds.add(slot.id);
          return {
            ...match,
            tentativeSlot: slot
              ? {
                  id: slot.id,
                  startTime: slot.startTime,
                  endTime: slot.endTime,
                  tableNumber: slot.tableNumber,
                }
              : null,
            slotAssigned: slot ? true : false,
          };
        }),
      }));
      return resultsWithSlots;
    }

    // AUTOMATIC MODE: assign by score and distribute equitably if slots < total matches
    const flatMatches = [];
    results.forEach((r, ri) => {
      r.matches.forEach((m, mi) => {
        flatMatches.push({ compradorId: r.compradorId, rIndex: ri, mIndex: mi, match: m });
      });
    });

    // Sort by score desc
    flatMatches.sort((a, b) => (b.match.score || 0) - (a.match.score || 0));

    // If enough slots for all matches, assign top matches by score sequentially
    if (slots.length >= flatMatches.length) {
      let slotIdx = 0;
      const resultsCopy = results.map((r) => ({ ...r, matches: [...r.matches] }));
      for (let f of flatMatches) {
        const slot = slots[slotIdx++];
        resultsCopy[f.rIndex].matches[f.mIndex] = {
          ...f.match,
          tentativeSlot: slot
            ? {
                id: slot.id,
                startTime: slot.startTime,
                endTime: slot.endTime,
                tableNumber: slot.tableNumber,
              }
            : null,
          slotAssigned: !!slot,
        };
      }
      return resultsCopy;
    }

    // Not enough slots: distribute equitably among compradores
    const numBuyers = results.length || 1;
    const maxPerUser = eventConfig?.maxMeetingsPerUser ?? 10;
    const baseQuota = Math.floor(slots.length / numBuyers);
    let remainder = slots.length % numBuyers;

    // Determine order of buyers by their top match score
    const buyersOrder = results
      .map((r, idx) => ({ idx, maxScore: (r.matches[0]?.score || 0) }))
      .sort((a, b) => b.maxScore - a.maxScore)
      .map((b) => b.idx);

    const buyerAllowed = {};
    buyersOrder.forEach((buyerIdx) => {
      buyerAllowed[buyerIdx] = Math.min(baseQuota + (remainder > 0 ? 1 : 0), maxPerUser);
      if (remainder > 0) remainder--;
    });

    // Now assign slots to each buyer up to their allowed, taking their top matches
    const resultsAssigned = results.map((r) => ({ ...r, matches: [...r.matches] }));
    let slotPointer = 0;
    for (let bi = 0; bi < results.length; bi++) {
      const buyerIdx = bi; // iterate in original order
      const allowed = buyerAllowed[buyerIdx] ?? baseQuota;
      if (allowed <= 0) continue;
      // sort buyer's matches by score desc
      const sortedMatchIdxs = results[buyerIdx].matches
        .map((m, i) => ({ i, score: m.score || 0 }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.i);

      for (let mi = 0; mi < sortedMatchIdxs.length && slotPointer < slots.length && mi < allowed; mi++) {
        const matchIdx = sortedMatchIdxs[mi];
        const slot = slots[slotPointer++];
        resultsAssigned[buyerIdx].matches[matchIdx] = {
          ...resultsAssigned[buyerIdx].matches[matchIdx],
          tentativeSlot: slot
            ? {
                id: slot.id,
                startTime: slot.startTime,
                endTime: slot.endTime,
                tableNumber: slot.tableNumber,
              }
            : null,
          slotAssigned: !!slot,
        };
      }
    }

    return resultsAssigned;
  };
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
        const resultsWithSlots = assignTentativeSlots(data.results || []);
        setMatchesMatrix(resultsWithSlots);
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
    const maxMeetingsPerUser = eventConfig?.maxMeetingsPerUser ?? 10;

    const results = compradores.map((comprador) => {
      const matches = vendedores
        .map((vendedor) => {
          const matchData = calculateLocalMatch(comprador, vendedor);
          return {
            vendedor: vendedor.nombre,
            vendedorId: vendedor.id,
            vendedorEmail: vendedor.correo,
            score: matchData.score,
            motivo: matchData.motivo,
            razonMatch: matchData.razonMatch,
          };
        })
        .filter((m) => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxMeetingsPerUser);

      return {
        compradorId: comprador.id,
        compradorNombre: comprador.nombre,
        compradorEmail: comprador.correo,
        matches,
      };
    });

    // Asignar slots tentativos
    const resultsWithSlots = assignTentativeSlots(results);

    setMatchesMatrix(resultsWithSlots);
    setUseLocalLlama(false);
    const totalMatches = resultsWithSlots.reduce((sum, r) => sum + r.matches.length, 0);
    const matchesMsg = totalMatches > 0 
      ? `Matches generados localmente. Total: ${totalMatches} matches (máx ${maxMeetingsPerUser} por asistente)`
      : "⚠️ No se generaron matches. Verifica que haya suficientes asistentes con descripción y necesidad.";
    setGlobalMessage(matchesMsg);
  };

  // --------- AGENDAMIENTO CON PREVIEW ---------
  const handleShowPreview = () => {
    if (!matchesMatrix || matchesMatrix.length === 0) {
      setError("No hay matches para agendar.");
      return;
    }
    // Inicializar selecciones solo para matches que tienen slot asignado
    const allMatches = new Set();
    matchesMatrix.forEach((m) => {
      m.matches.forEach((match, idx) => {
        if (match.slotAssigned || match.tentativeSlot) {
          allMatches.add(`${m.compradorId}_${match.vendedorId}_${idx}`);
        }
      });
    });

    if (allMatches.size === 0) {
      setError("No hay matches con slot asignado para previsualizar.");
      return;
    }
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

    // Obtener configuración del evento
    const maxMeetingsPerUser = eventConfig?.maxMeetingsPerUser ?? 10;
    const meetingDuration = eventConfig?.meetingDuration ?? 15;
    const numTables = eventConfig?.numTables ?? 9;
    const tableNames = eventConfig?.tableNames || [];
    const startTime = eventConfig?.startTime || "16:30";
    const endTime = eventConfig?.endTime || "17:30";

    console.log("Configuración del evento:", {
      maxMeetingsPerUser,
      meetingDuration,
      numTables,
      tableNames,
      startTime,
      endTime,
    });

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

    console.log("Mesas disponibles:", mesas);

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
            idx,
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
      if (meetingsComprador >= maxMeetingsPerUser) {
        pendientes.push({
          compradorId: cmp.id,
          vendedorId: vendedor.id,
          motivo: `Comprador alcanzó máximo de ${maxMeetingsPerUser} reuniones`,
        });
        continue;
      }

      // Preferir asignación manual si está activa
      let slotDisponible = null;
      if (assignmentMode === "manual") {
        const key = `${cmp.id}_${vendedor.id}_${item.idx}`;
        const slotId = manualAssignments[key];
        if (slotId) {
          slotDisponible = agenda.find((s) => s.id === slotId);
        }
      }

      // Si no hay asignación manual, usar el slot tentativo
      if (!slotDisponible) {
        slotDisponible = item.match.tentativeSlot;
      }

      if (!slotDisponible) {
        pendientes.push({
          compradorId: cmp.id,
          vendedorId: vendedor.id,
          motivo: "No hay slot tentativo asignado",
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
        console.error("Error agendando:", e);
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
    <>
    
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
          <Group align="center" spacing="sm">
            <Text size="sm">Modo de asignación:</Text>
            <Radio.Group value={assignmentMode} onChange={(val) => setAssignmentMode(val)}>
              <Radio value="auto" label="Automático" />
              <Radio value="manual" label="Manual" />
            </Radio.Group>
          </Group>
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
          <Button
            onClick={exportToExcel}
            loading={loading}
            color="green"
            variant="light"
            disabled={matchesMatrix.length === 0}
          >
            📥 Descargar Excel
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

        {/* Buscador por correo */}
        {matchesMatrix.length > 0 && (
          <TextInput
            placeholder="Buscar por correo o nombre del asistente..."
            value={searchEmail}
            onChange={(e) => setSearchEmail(e.currentTarget.value.toLowerCase())}
            rightSection={searchEmail && <Badge variant="light">{matchesMatrix.filter((m) => 
              m.compradorEmail?.toLowerCase().includes(searchEmail) || 
              m.compradorNombre?.toLowerCase().includes(searchEmail)
            ).length} resultados</Badge>}
          />
        )}

        {/* Preview de matches por comprador */}
        {matchesMatrix.length > 0 && (
          <>
            <Title order={4}>
              Matches Generados ({
                searchEmail 
                  ? matchesMatrix
                      .filter((m) => 
                        m.compradorEmail?.toLowerCase().includes(searchEmail) ||
                        m.compradorNombre?.toLowerCase().includes(searchEmail)
                      )
                      .reduce((sum, m) => sum + m.matches.length, 0)
                  : matchesMatrix.reduce((sum, m) => sum + m.matches.length, 0)
              } total)
            </Title>
            <ScrollArea h={600} type="auto" scrollbars="y">
              {matchesMatrix
                .filter((m) => !searchEmail || m.compradorEmail?.toLowerCase().includes(searchEmail) || m.compradorNombre?.toLowerCase().includes(searchEmail))
                .map((m, idx) => {
                  const cmp = compradores.find((c) => c.id === m.compradorId);
                  return (
                    <Card key={idx} shadow="xs" my="sm" p="md" withBorder>
                      <Group justify="space-between" mb="sm">
                        <div>
                          <Text fw={700}>
                            {cmp?.nombre || m.compradorNombre || m.compradorId}
                          </Text>
                          <Group gap="xs">
                            <Text c="dimmed" size="sm">
                              {cmp?.empresa} | Necesidad: {cmp?.necesidad}
                            </Text>
                            {m.compradorEmail && (
                              <Badge size="sm" variant="dot" color="blue">
                                {m.compradorEmail}
                              </Badge>
                            )}
                          </Group>
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
                                      <Group gap="xs">
                                        <Text c="dimmed" size="sm">
                                          {vendedor?.empresa}
                                        </Text>
                                        {match.vendedorEmail && (
                                          <Badge size="xs" variant="light" color="gray">
                                            {match.vendedorEmail}
                                          </Badge>
                                        )}
                                      </Group>
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
                                  {match.tentativeSlot && (
                                    <Group gap="xs" mt="xs">
                                      <Badge size="sm" color="cyan" variant="light">
                                        📅 {match.tentativeSlot.startTime} - {match.tentativeSlot.endTime}
                                      </Badge>
                                      <Badge size="sm" color="teal" variant="light">
                                        🪑 Mesa {match.tentativeSlot.tableNumber}
                                      </Badge>
                                    </Group>
                                  )}
                                      {assignmentMode === "manual" && (
                                <div style={{ marginTop: 6 }}>
                                 
                                    <Button
                                      size="xs"
                                      onClick={() => {
                                        // Open manual meeting modal, prefill participants
                                        setManualModalParticipants({ p1: m.compradorId, p2: match.vendedorId });
                                        setManualModalOpened(true);
                                      }}
                                    >
                                      Buscar slots
                                    </Button>
                                
                                </div>
                              )}
                                  {!match.slotAssigned &&  (
                                    <Text size="xs" c="red" mt="xs">
                                      ⚠️ No hay slots disponibles
                                    </Text>
                                  )}
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
                  <Group justify="space-between" mb="sm">
                    <div>
                      <Text fw={700}>
                        {cmp?.nombre || m.compradorNombre}
                      </Text>
                      {m.compradorEmail && (
                        <Text c="dimmed" size="sm">
                          📧 {m.compradorEmail}
                        </Text>
                      )}
                    </div>
                  </Group>

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
                              {match.vendedorEmail && (
                                <Text size="xs" c="dimmed">
                                  📧 {match.vendedorEmail}
                                </Text>
                              )}
                              <Text size="xs" c="dimmed">
                                {match.razonMatch || match.motivo}
                              </Text>
                              {match.tentativeSlot && (
                                <Text size="xs" c="teal" fw={500}>
                                  ⏰ {match.tentativeSlot.startTime} - Mesa {match.tentativeSlot.tableNumber}
                                </Text>
                              )}
                          
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
      {/* Modal: Selector local de slots para asignación manual */}
     
    </Container>
      <ManualMeetingModal
        opened={manualModalOpened}
        onClose={() => setManualModalOpened(false)}
        event={{ id: eventId, config: eventConfig || {} }}
        setGlobalMessage={setGlobalMessage}
        initialParticipant1={manualModalParticipants.p1}
        initialParticipant2={manualModalParticipants.p2}
      />
      </>
  );
};

export default EventMatchPage;

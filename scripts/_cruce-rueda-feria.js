const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const sa = require("./serviceAccountKey.json");
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const RUEDA_ID = "Dr2GOaFklFr8jm340hPV";
const FERIA_ID = "0ei1JsHIlhJS3xKizHhq";
const OUT = "C:/Users/pipe0/AppData/Local/Temp/claude/d--gen-iality-Proyectos-my-meetings-app/dc2ddcd4-84c4-457d-ac68-481bb41b9888/scratchpad/cruce-result.json";

function stripAccents(s) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function normName(s) {
  return stripAccents(String(s || "").toLowerCase().trim()).replace(/\s+/g, " ");
}
function normEmail(s) {
  return String(s || "").toLowerCase().trim();
}
function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}
function normCedula(s) {
  const d = digitsOnly(s);
  return d.length >= 5 ? d : null;
}
function phoneKey(s) {
  const d = digitsOnly(s);
  if (d.length < 7) return null;
  return d.slice(-9); // last 9 digits, drops country code variance
}

(async () => {
  console.log("Cargando usuarios de FERIA...");
  const feriaSnap = await db.collection("users").where("eventId", "==", FERIA_ID).get();
  const feriaUsers = [];
  feriaSnap.forEach((d) => {
    const u = d.data();
    feriaUsers.push({
      id: d.id,
      nombre: u.nombre,
      cedula: u.cedula,
      correo: u.correo,
      telefono: u.telefono,
      empresa: u.empresa || u.company_razonSocial,
      companyId: u.companyId,
      checkIns: u.checkIns || {},
    });
  });
  console.log(`  ${feriaUsers.length} usuarios feria cargados`);

  const byEmail = new Map();
  const byCedula = new Map();
  const byPhone = new Map();
  const byNameEmpresa = new Map();
  for (const u of feriaUsers) {
    const e = normEmail(u.correo);
    if (e) { if (!byEmail.has(e)) byEmail.set(e, []); byEmail.get(e).push(u); }
    const c = normCedula(u.cedula);
    if (c) { if (!byCedula.has(c)) byCedula.set(c, []); byCedula.get(c).push(u); }
    const p = phoneKey(u.telefono);
    if (p) { if (!byPhone.has(p)) byPhone.set(p, []); byPhone.get(p).push(u); }
    const key = normName(u.nombre) + "|" + normName(u.empresa);
    if (normName(u.nombre)) { if (!byNameEmpresa.has(key)) byNameEmpresa.set(key, []); byNameEmpresa.get(key).push(u); }
  }

  console.log("Cargando usuarios de RUEDA...");
  const ruedaSnap = await db.collection("users").where("eventId", "==", RUEDA_ID).get();
  const ruedaUsersById = new Map();
  ruedaSnap.forEach((d) => {
    const u = d.data();
    ruedaUsersById.set(d.id, {
      id: d.id,
      nombre: u.nombre,
      cedula: u.cedula,
      correo: u.correo,
      telefono: u.telefono,
      empresa: u.empresa || u.company_razonSocial,
      companyId: u.companyId,
      checkIns: u.checkIns || {},
    });
  });
  console.log(`  ${ruedaUsersById.size} usuarios rueda cargados`);

  function findFeriaMatch(ruedaUser) {
    if (!ruedaUser) return { match: null, method: null };
    const e = normEmail(ruedaUser.correo);
    if (e && byEmail.has(e)) return { match: byEmail.get(e)[0], method: "correo" };
    const c = normCedula(ruedaUser.cedula);
    if (c && byCedula.has(c)) return { match: byCedula.get(c)[0], method: "cedula" };
    const p = phoneKey(ruedaUser.telefono);
    if (p && byPhone.has(p)) return { match: byPhone.get(p)[0], method: "telefono" };
    const key = normName(ruedaUser.nombre) + "|" + normName(ruedaUser.empresa);
    if (normName(ruedaUser.nombre) && byNameEmpresa.has(key)) return { match: byNameEmpresa.get(key)[0], method: "nombre+empresa" };
    return { match: null, method: null };
  }

  console.log("Cargando reuniones de RUEDA...");
  const meetingsSnap = await db.collection("events").doc(RUEDA_ID).collection("meetings").get();
  const pending = [];
  meetingsSnap.forEach((d) => {
    const m = d.data();
    if (m.status === "accepted" && m.completed === undefined) {
      pending.push({ id: d.id, ...m });
    }
  });
  console.log(`  ${pending.length} reuniones aceptadas sin corroborar (completed=undefined)`);

  function evaluateParticipant(uid, meetingDate) {
    const ru = ruedaUsersById.get(uid);
    const ruedaCheckedIn = !!(ru && ru.checkIns && ru.checkIns[meetingDate]);
    const { match, method } = findFeriaMatch(ru);
    const feriaCheckedIn = !!(match && match.checkIns && match.checkIns[meetingDate]);
    const feriaCheckedInAnyDay = !!(match && match.checkIns && Object.keys(match.checkIns).length > 0);
    const hasEvidence = ruedaCheckedIn || feriaCheckedIn;
    let nivel, motivo;
    if (ruedaCheckedIn) { nivel = "fuerte"; motivo = "checkin_rueda_mismo_dia"; }
    else if (feriaCheckedIn) { nivel = "fuerte"; motivo = "checkin_feria_mismo_dia"; }
    else if (feriaCheckedInAnyDay) { nivel = "debil"; motivo = "match_feria_otro_dia"; }
    else if (match) { nivel = "ninguna"; motivo = "match_feria_sin_checkin"; }
    else { nivel = "ninguna"; motivo = "sin_match_feria"; }
    return {
      uid,
      nombre: ru?.nombre || "(no encontrado)",
      empresa: ru?.empresa || "",
      cedula: ru?.cedula || "",
      telefono: ru?.telefono || "",
      correo: ru?.correo || "",
      ruedaCheckedIn,
      feriaMatchId: match?.id || null,
      feriaMatchMethod: method,
      feriaMatchNombre: match?.nombre || null,
      feriaCheckedIn,
      feriaCheckedInAnyDay,
      feriaCheckInDates: match ? Object.keys(match.checkIns || {}) : [],
      hasEvidence,
      nivel,
      motivo,
    };
  }

  const results = pending.map((m) => {
    const p1 = evaluateParticipant(m.requesterId, m.meetingDate);
    const p2 = evaluateParticipant(m.receiverId, m.meetingDate);
    const evidenceCount = (p1.hasEvidence ? 1 : 0) + (p2.hasEvidence ? 1 : 0);
    const weakCount = (p1.nivel === "debil" ? 1 : 0) + (p2.nivel === "debil" ? 1 : 0);
    let classification;
    if (evidenceCount === 2) classification = "auto";
    else if (evidenceCount === 1 || weakCount >= 1) classification = "revisar";
    else classification = "sin_evidencia";
    return {
      meetingId: m.id,
      meetingDate: m.meetingDate,
      timeSlot: m.timeSlot,
      tableAssigned: m.tableAssigned,
      companyId: m.companyId,
      contextNote: m.contextNote || "",
      requester: p1,
      receiver: p2,
      classification,
    };
  });

  const counts = { auto: 0, revisar: 0, sin_evidencia: 0 };
  for (const r of results) counts[r.classification]++;
  console.log("\n=== RESUMEN ===");
  console.log(`Total reuniones a corroborar: ${results.length}`);
  console.log(`  -> Auto (ambos con evidencia de presencia): ${counts.auto}`);
  console.log(`  -> Revisar (un participante con evidencia): ${counts.revisar}`);
  console.log(`  -> Sin evidencia: ${counts.sin_evidencia}`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\nResultado completo escrito en: ${OUT}`);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

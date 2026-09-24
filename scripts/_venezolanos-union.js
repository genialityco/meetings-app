const admin = require("firebase-admin");
const sa = require("./serviceAccountKey.json");
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const RUEDA_ID = "Dr2GOaFklFr8jm340hPV";
const FERIA_ID = "0ei1JsHIlhJS3xKizHhq";

function stripAccents(s) { return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, ""); }
function normName(s) { return stripAccents(String(s || "").toLowerCase().trim()).replace(/\s+/g, " "); }
function normEmail(s) { return String(s || "").toLowerCase().trim(); }
function digitsOnly(s) { return String(s || "").replace(/\D/g, ""); }
function normCedula(s) { const d = digitsOnly(s); return d.length >= 5 ? d : null; }
function phoneKey(s) { const d = digitsOnly(s); if (d.length < 7) return null; return d.slice(-9); }

function classifyCountry(rawPhone) {
  const raw = String(rawPhone || "").trim();
  if (!raw) return "SIN_TELEFONO";
  const hasPlus = raw.startsWith("+");
  const d = digitsOnly(raw);
  if (hasPlus) {
    if (raw.startsWith("+58")) return "VE";
    if (raw.startsWith("+57")) return "CO";
    return "OTRO";
  }
  if (d.startsWith("58") && d.length >= 11) return "VE";
  if (d.startsWith("57") && d.length >= 11) return "CO";
  if (/^0?4(12|14|16|24|26)\d{6,7}$/.test(d)) return "VE";
  if (/^3\d{9}$/.test(d)) return "CO";
  return "DESCONOCIDO";
}

(async () => {
  const [ruedaSnap, feriaSnap] = await Promise.all([
    db.collection("users").where("eventId", "==", RUEDA_ID).get(),
    db.collection("users").where("eventId", "==", FERIA_ID).get(),
  ]);
  const ruedaUsers = [];
  ruedaSnap.forEach((d) => ruedaUsers.push({ id: d.id, ...d.data() }));
  const feriaUsers = [];
  feriaSnap.forEach((d) => feriaUsers.push({ id: d.id, ...d.data() }));

  // Indice de FERIA para saber si un asistente de rueda tambien esta en feria
  const byEmailF = new Map(), byCedulaF = new Map(), byPhoneF = new Map(), byNameEmpresaF = new Map();
  for (const u of feriaUsers) {
    const e = normEmail(u.correo);
    if (e) { if (!byEmailF.has(e)) byEmailF.set(e, []); byEmailF.get(e).push(u); }
    const c = normCedula(u.cedula);
    if (c) { if (!byCedulaF.has(c)) byCedulaF.set(c, []); byCedulaF.get(c).push(u); }
    const p = phoneKey(u.telefono);
    if (p) { if (!byPhoneF.has(p)) byPhoneF.set(p, []); byPhoneF.get(p).push(u); }
    const key = normName(u.nombre) + "|" + normName(u.empresa || u.company_razonSocial);
    if (normName(u.nombre)) { if (!byNameEmpresaF.has(key)) byNameEmpresaF.set(key, []); byNameEmpresaF.get(key).push(u); }
  }
  function findInFeria(ru) {
    const e = normEmail(ru.correo);
    if (e && byEmailF.has(e)) return byEmailF.get(e)[0];
    const c = normCedula(ru.cedula);
    if (c && byCedulaF.has(c)) return byCedulaF.get(c)[0];
    const p = phoneKey(ru.telefono);
    if (p && byPhoneF.has(p)) return byPhoneF.get(p)[0];
    const key = normName(ru.nombre) + "|" + normName(ru.empresa || ru.company_razonSocial);
    if (normName(ru.nombre) && byNameEmpresaF.has(key)) return byNameEmpresaF.get(key)[0];
    return null;
  }

  const ruedaSoloIds = new Set();
  let ruedaEnFeria = 0;
  for (const ru of ruedaUsers) {
    const m = findInFeria(ru);
    if (m) ruedaEnFeria++;
    else ruedaSoloIds.add(ru.id);
  }
  const ruedaSolo = ruedaUsers.filter((u) => ruedaSoloIds.has(u.id));

  console.log(`Rueda: ${ruedaUsers.length} | de esos, tambien en feria: ${ruedaEnFeria} | SOLO en rueda (sin match en feria): ${ruedaSolo.length}`);

  // Union real: feria (1089) + rueda-solo (no matcheados en feria)
  const union = [
    ...feriaUsers.map((u) => ({ ...u, origen: "feria", enRueda: false })),
    ...ruedaSolo.map((u) => ({ ...u, origen: "rueda_solo", enRueda: true })),
  ];

  // Marcar tambien enRueda=true para los de feria que matchean con rueda
  const byEmailR = new Map(), byCedulaR = new Map(), byPhoneR = new Map(), byNameEmpresaR = new Map();
  for (const u of ruedaUsers) {
    const e = normEmail(u.correo);
    if (e) { if (!byEmailR.has(e)) byEmailR.set(e, []); byEmailR.get(e).push(u); }
    const c = normCedula(u.cedula);
    if (c) { if (!byCedulaR.has(c)) byCedulaR.set(c, []); byCedulaR.get(c).push(u); }
    const p = phoneKey(u.telefono);
    if (p) { if (!byPhoneR.has(p)) byPhoneR.set(p, []); byPhoneR.get(p).push(u); }
    const key = normName(u.nombre) + "|" + normName(u.empresa || u.company_razonSocial);
    if (normName(u.nombre)) { if (!byNameEmpresaR.has(key)) byNameEmpresaR.set(key, []); byNameEmpresaR.get(key).push(u); }
  }
  function isInRueda(fu) {
    const e = normEmail(fu.correo);
    if (e && byEmailR.has(e)) return true;
    const c = normCedula(fu.cedula);
    if (c && byCedulaR.has(c)) return true;
    const p = phoneKey(fu.telefono);
    if (p && byPhoneR.has(p)) return true;
    const key = normName(fu.nombre) + "|" + normName(fu.empresa || fu.company_razonSocial);
    if (normName(fu.nombre) && byNameEmpresaR.has(key)) return true;
    return false;
  }
  for (const u of union) {
    if (u.origen === "feria") u.enRueda = isInRueda(u);
  }

  console.log(`\nUnion total de asistentes unicos (feria + solo-rueda): ${union.length}`);

  const countryCounts = {};
  for (const u of union) {
    const country = classifyCountry(u.telefono);
    countryCounts[country] = (countryCounts[country] || 0) + 1;
  }
  console.log("Clasificacion por pais (union):", countryCounts);

  const veUnion = union.filter((u) => classifyCountry(u.telefono) === "VE");
  const veEnRueda = veUnion.filter((u) => u.enRueda);
  console.log(`\nVenezolanos en la union (feria + rueda): ${veUnion.length}`);
  console.log(`De esos, registrados tambien en rueda de negocios: ${veEnRueda.length}`);
  console.log(`  - provenientes de feria y con match en rueda: ${veEnRueda.filter(u=>u.origen==='feria').length}`);
  console.log(`  - exclusivos de rueda (no estaban en feria): ${veEnRueda.filter(u=>u.origen==='rueda_solo').length}`);

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

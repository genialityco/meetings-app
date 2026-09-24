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
  const hasPlus = raw.trim().startsWith("+");
  const d = digitsOnly(raw);
  if (hasPlus) {
    if (raw.startsWith("+58")) return "VE";
    if (raw.startsWith("+57")) return "CO";
    if (raw.startsWith("+1")) return "OTRO";
    if (raw.startsWith("+34")) return "OTRO";
    return "OTRO";
  }
  // sin "+": intentar inferir por formato local
  if (d.startsWith("58") && d.length >= 11) return "VE";
  if (d.startsWith("57") && d.length >= 11) return "CO";
  if (/^0?4(12|14|16|24|26)\d{6,7}$/.test(d)) return "VE"; // formato movil venezolano local
  if (/^3\d{9}$/.test(d)) return "CO"; // formato movil colombiano local
  return "DESCONOCIDO";
}

(async () => {
  console.log("Cargando usuarios de RUEDA (para indexar identidad)...");
  const ruedaSnap = await db.collection("users").where("eventId", "==", RUEDA_ID).get();
  const ruedaUsers = [];
  ruedaSnap.forEach((d) => ruedaUsers.push({ id: d.id, ...d.data() }));

  const byEmail = new Map(), byCedula = new Map(), byPhone = new Map(), byNameEmpresa = new Map();
  for (const u of ruedaUsers) {
    const e = normEmail(u.correo);
    if (e) { if (!byEmail.has(e)) byEmail.set(e, []); byEmail.get(e).push(u); }
    const c = normCedula(u.cedula);
    if (c) { if (!byCedula.has(c)) byCedula.set(c, []); byCedula.get(c).push(u); }
    const p = phoneKey(u.telefono);
    if (p) { if (!byPhone.has(p)) byPhone.set(p, []); byPhone.get(p).push(u); }
    const key = normName(u.nombre) + "|" + normName(u.empresa || u.company_razonSocial);
    if (normName(u.nombre)) { if (!byNameEmpresa.has(key)) byNameEmpresa.set(key, []); byNameEmpresa.get(key).push(u); }
  }

  function matchesRueda(feriaUser) {
    const e = normEmail(feriaUser.correo);
    if (e && byEmail.has(e)) return true;
    const c = normCedula(feriaUser.cedula);
    if (c && byCedula.has(c)) return true;
    const p = phoneKey(feriaUser.telefono);
    if (p && byPhone.has(p)) return true;
    const key = normName(feriaUser.nombre) + "|" + normName(feriaUser.empresa || feriaUser.company_razonSocial);
    if (normName(feriaUser.nombre) && byNameEmpresa.has(key)) return true;
    return false;
  }

  console.log("Cargando usuarios de FERIA...");
  const feriaSnap = await db.collection("users").where("eventId", "==", FERIA_ID).get();
  const feriaUsers = [];
  feriaSnap.forEach((d) => feriaUsers.push({ id: d.id, ...d.data() }));
  console.log(`  ${feriaUsers.length} usuarios feria`);

  const countryCounts = {};
  const veUsers = [];
  for (const u of feriaUsers) {
    const country = classifyCountry(u.telefono);
    countryCounts[country] = (countryCounts[country] || 0) + 1;
    if (country === "VE") veUsers.push(u);
  }

  console.log("\n=== Clasificación por prefijo/formato telefónico (todos los asistentes feria) ===");
  console.log(countryCounts);

  let veEnRueda = 0;
  const veEnRuedaDetalle = [];
  for (const u of veUsers) {
    if (matchesRueda(u)) { veEnRueda++; veEnRuedaDetalle.push({ nombre: u.nombre, empresa: u.empresa, telefono: u.telefono }); }
  }

  console.log(`\nTotal asistentes feria: ${feriaUsers.length}`);
  console.log(`Venezolanos (por teléfono) en asistencia: ${veUsers.length}`);
  console.log(`De esos, con registro también en la rueda de negocios: ${veEnRueda}`);

  console.log("\n=== Muestra de venezolanos SIN match en rueda (primeros 10) ===");
  veUsers.filter(u => !matchesRueda(u)).slice(0, 10).forEach(u => console.log({ nombre: u.nombre, empresa: u.empresa, telefono: u.telefono }));

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

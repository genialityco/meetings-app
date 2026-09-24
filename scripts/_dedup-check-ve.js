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
  if (hasPlus) { if (raw.startsWith("+58")) return "VE"; if (raw.startsWith("+57")) return "CO"; return "OTRO"; }
  if (d.startsWith("58") && d.length >= 11) return "VE";
  if (d.startsWith("57") && d.length >= 11) return "CO";
  if (/^0?4(12|14|16|24|26)\d{6,7}$/.test(d)) return "VE";
  if (/^3\d{9}$/.test(d)) return "CO";
  return "DESCONOCIDO";
}
function tokenSet(name) {
  return new Set(normName(name).split(" ").filter((w) => w.length >= 3));
}
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

(async () => {
  const [ruedaSnap, feriaSnap] = await Promise.all([
    db.collection("users").where("eventId", "==", RUEDA_ID).get(),
    db.collection("users").where("eventId", "==", FERIA_ID).get(),
  ]);
  const rueda = []; ruedaSnap.forEach((d) => rueda.push({ id: d.id, ...d.data() }));
  const feria = []; feriaSnap.forEach((d) => feria.push({ id: d.id, ...d.data() }));

  const byEmailF = new Map(), byCedulaF = new Map(), byPhoneF = new Map(), byNameEmpresaF = new Map();
  for (const u of feria) {
    const e = normEmail(u.correo); if (e) { if (!byEmailF.has(e)) byEmailF.set(e, []); byEmailF.get(e).push(u); }
    const c = normCedula(u.cedula); if (c) { if (!byCedulaF.has(c)) byCedulaF.set(c, []); byCedulaF.get(c).push(u); }
    const p = phoneKey(u.telefono); if (p) { if (!byPhoneF.has(p)) byPhoneF.set(p, []); byPhoneF.get(p).push(u); }
    const key = normName(u.nombre) + "|" + normName(u.empresa || u.company_razonSocial);
    if (normName(u.nombre)) { if (!byNameEmpresaF.has(key)) byNameEmpresaF.set(key, []); byNameEmpresaF.get(key).push(u); }
  }
  function findInFeria(ru) {
    const e = normEmail(ru.correo); if (e && byEmailF.has(e)) return true;
    const c = normCedula(ru.cedula); if (c && byCedulaF.has(c)) return true;
    const p = phoneKey(ru.telefono); if (p && byPhoneF.has(p)) return true;
    const key = normName(ru.nombre) + "|" + normName(ru.empresa || ru.company_razonSocial);
    if (normName(ru.nombre) && byNameEmpresaF.has(key)) return true;
    return false;
  }
  const ruedaSolo = rueda.filter((u) => !findInFeria(u));

  const union = [
    ...feria.map((u) => ({ ...u, origen: "feria" })),
    ...ruedaSolo.map((u) => ({ ...u, origen: "rueda_solo" })),
  ];
  const veUnion = union.filter((u) => classifyCountry(u.telefono) === "VE");
  const veFeria = veUnion.filter((u) => u.origen === "feria");
  const veRuedaSolo = veUnion.filter((u) => u.origen === "rueda_solo");
  console.log(`VE union total: ${veUnion.length} (feria: ${veFeria.length}, rueda_solo: ${veRuedaSolo.length})`);

  // Buscar posibles duplicados: comparar cada VE de rueda_solo contra cada VE de feria por similitud de nombre
  console.log("\n=== Posibles duplicados (similitud de nombre >= 0.5, Jaccard de tokens) ===");
  let suspiciousPairs = 0;
  for (const r of veRuedaSolo) {
    const rTokens = tokenSet(r.nombre);
    let best = null, bestScore = 0;
    for (const f of veFeria) {
      const score = jaccard(rTokens, tokenSet(f.nombre));
      if (score > bestScore) { bestScore = score; best = f; }
    }
    if (bestScore >= 0.5) {
      suspiciousPairs++;
      console.log({
        score: bestScore.toFixed(2),
        rueda: { nombre: r.nombre, cedula: r.cedula, correo: r.correo, telefono: r.telefono, empresa: r.empresa },
        feria: { nombre: best.nombre, cedula: best.cedula, correo: best.correo, telefono: best.telefono, empresa: best.empresa },
      });
    }
  }
  console.log(`\nTotal pares sospechosos encontrados: ${suspiciousPairs}`);

  // Tambien buscar duplicados DENTRO de cada lista (mismo evento, doble registro)
  function findInternalDupes(list, label) {
    console.log(`\n=== Posibles duplicados internos dentro de ${label} (VE) ===`);
    let found = 0;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const score = jaccard(tokenSet(list[i].nombre), tokenSet(list[j].nombre));
        if (score >= 0.66) {
          found++;
          console.log({ score: score.toFixed(2), a: list[i].nombre, b: list[j].nombre, ida: list[i].id, idb: list[j].id });
        }
      }
    }
    console.log(`Total: ${found}`);
  }
  findInternalDupes(veFeria, "feria");
  findInternalDupes(veRuedaSolo, "rueda_solo");

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

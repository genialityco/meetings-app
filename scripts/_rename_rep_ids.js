// Uso: node scripts/_rename_rep_ids.js [--apply]
// Renombra los docs users/rep_<nitViejo> -> rep_<nitNuevo> y actualiza toda referencia al uid viejo.
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const APPLY = process.argv.includes("--apply");
const E = "ihIlXCreXToidw1wsI9a";
const PAIRS = [
  ["8190052974", "819005297"],
  ["9009134582", "900913458"],
  ["J30317498", "J303174981"],
  ["J31628759", "J316287599"],
  ["J09028384", "J090283846"],
];

// Reemplaza el uid viejo por el nuevo en valores string y arrays (primer nivel y mapas anidados)
const swap = (val, o, n) => {
  if (val === o) return [n, true];
  if (Array.isArray(val)) { let ch = false; const r = val.map((x) => { const [y, c] = swap(x, o, n); ch ||= c; return y; }); return [r, ch]; }
  if (val && typeof val === "object" && val.constructor === Object) {
    let ch = false; const r = {};
    for (const [k, v] of Object.entries(val)) { const [y, c] = swap(v, o, n); ch ||= c; r[k === o ? n : k] = y; if (k === o) ch = true; }
    return [r, ch];
  }
  return [val, false];
};

(async () => {
  const ev = db.collection("events").doc(E);
  const colls = [
    ["meetings", ev.collection("meetings")],
    ["products", ev.collection("products")],
    ["notifications", db.collection("notifications").where("eventId", "==", E)],
    ["meetingSurveys", db.collection("meetingSurveys").where("eventId", "==", E)],
    ["aiChats", db.collection("aiChats").where("eventId", "==", E)],
  ];
  const snaps = {};
  for (const [name, q] of colls) { try { snaps[name] = await q.get(); } catch (e) { console.log("no se pudo leer", name, e.message); snaps[name] = { docs: [] }; } }
  const locks = (await db.collection("locks").get()).docs.filter((d) => d.id.startsWith(E + "_"));
  const companies = await ev.collection("companies").get();

  for (const [OLDN, NEWN] of PAIRS) {
    const O = "rep_" + OLDN, N = "rep_" + NEWN;
    console.log(`\n=== ${O} -> ${N}`);
    const oRef = db.collection("users").doc(O), nRef = db.collection("users").doc(N);
    const [o, n] = await Promise.all([oRef.get(), nRef.get()]);
    if (!o.exists) { console.log("  SKIP: no existe el usuario viejo"); continue; }
    if (n.exists) { console.log("  SKIP: ya existe el usuario nuevo"); continue; }
    const updates = [];
    for (const [name, s] of Object.entries(snaps)) {
      for (const d of s.docs) {
        const [nd, ch] = swap(d.data(), O, N);
        if (ch) { updates.push({ ref: d.ref, data: nd }); console.log(`  ref en ${name}/${d.id}`); }
      }
    }
    const myLocks = locks.filter((d) => d.id.includes("_" + O + "_") || JSON.stringify(d.data()).includes(O));
    myLocks.forEach((d) => console.log("  lock", d.id));
    const myVisits = [];
    for (const c of companies.docs) {
      const v = await c.ref.collection("visits").doc(O).get();
      if (v.exists) { myVisits.push({ c, v }); console.log(`  visita en companies/${c.id}/visits/${O}`); }
    }
    console.log(`  total refs: ${updates.length} docs, ${myLocks.length} locks, ${myVisits.length} visitas`);
    if (!APPLY) continue;

    await nRef.set(o.data());
    for (const u of updates) await u.ref.set(u.data);
    for (const l of myLocks) {
      const [nd] = swap(l.data(), O, N);
      await db.collection("locks").doc(l.id.replace("_" + O + "_", "_" + N + "_")).set(nd);
      await l.ref.delete();
    }
    for (const { c, v } of myVisits) {
      const [nd] = swap(v.data(), O, N);
      await c.ref.collection("visits").doc(N).set(nd);
      await v.ref.delete();
    }
    await oRef.delete();
    console.log("  OK");
  }
  if (!APPLY) console.log("\nDRY RUN. Usa --apply para ejecutar.");
  process.exit(0);
})();

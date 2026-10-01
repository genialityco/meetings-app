// Uso: node scripts/_migrate_nits_csv.js [--apply]
// Mueve empresas simples al NIT del CSV (el NIT es el id del doc): copia empresa + visitas,
// actualiza companyId en usuarios/productos/citas y borra el doc viejo. No toca ids de usuarios (rep_*).
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const APPLY = process.argv.includes("--apply");
const E = "ihIlXCreXToidw1wsI9a";
const PAIRS = [
  ["8190052974", "819005297"], // DAABON
  ["9009134582", "900913458"], // GRANDES MARCAS
  ["J30317498", "J303174981"], // SERVIFLETES
  ["J31628759", "J316287599"], // BANCAMIGA
  ["J09028384", "J090283846"], // BANCO SOFITASA
];

(async () => {
  const ev = db.collection("events").doc(E);
  const users = await db.collection("users").where("eventId", "==", E).get();
  const meetings = await ev.collection("meetings").get();
  const products = await ev.collection("products").get();
  const hasOld = (data, old) => Object.entries(data).filter(([, v]) => v === old).map(([k]) => k);

  for (const [OLD, NEW] of PAIRS) {
    console.log(`\n=== ${OLD} -> ${NEW}`);
    const oldRef = ev.collection("companies").doc(OLD);
    const newRef = ev.collection("companies").doc(NEW);
    const [o, n] = await Promise.all([oldRef.get(), newRef.get()]);
    if (!o.exists) { console.log("  SKIP: no existe el doc viejo"); continue; }
    if (n.exists) { console.log("  SKIP: ya existe doc con el NIT nuevo"); continue; }
    const visits = await oldRef.collection("visits").get();
    const us = users.docs.filter((d) => hasOld(d.data(), OLD).length);
    const ms = meetings.docs.filter((d) => hasOld(d.data(), OLD).length);
    const ps = products.docs.filter((d) => hasOld(d.data(), OLD).length);
    console.log(`  "${o.data().razonSocial}" | visitas ${visits.size} | usuarios ${us.length} | citas ${ms.length} | productos ${ps.length}`);
    us.forEach((d) => console.log("   user", d.id, hasOld(d.data(), OLD).join(",")));
    ms.forEach((d) => console.log("   meeting", d.id, hasOld(d.data(), OLD).join(",")));
    if (!APPLY) continue;

    const fix = (data) => {
      const upd = {};
      for (const [k, v] of Object.entries(data)) if (v === OLD) upd[k] = NEW;
      return upd;
    };
    await newRef.set({ ...o.data(), ...fix(o.data()), nitNorm: NEW, updatedAt: new Date() });
    for (const v of visits.docs) await newRef.collection("visits").doc(v.id).set(v.data());
    for (const d of us) await d.ref.update(fix(d.data()));
    for (const d of ms) await d.ref.update(fix(d.data()));
    for (const d of ps) await d.ref.update(fix(d.data()));
    for (const v of visits.docs) await v.ref.delete();
    await oldRef.delete();
    console.log("  OK");
  }
  if (!APPLY) console.log("\nDRY RUN. Usa --apply para ejecutar.");
  process.exit(0);
})();

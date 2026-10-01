// Uso: node scripts/_merge_castellanos.js [--apply]
// Unifica Castellanos bajo J300951308: mueve a sus 2 representantes reales, los deja como vendedor,
// y elimina rep_J30095130 y los docs de empresa duplicados (J30095130, RIFJ300951308).
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const APPLY = process.argv.includes("--apply");
const E = "ihIlXCreXToidw1wsI9a";
const KEEP = "J300951308";
const DROP_COMPANIES = ["J30095130", "RIFJ300951308"];
const DROP_USER = "rep_J30095130";
const REAL_USERS = ["gWvAeN7tWrMX7YbYTAUd98hcZWF2", "ypKNanv7SiSDAo3ApZW1KJ3ssZ93"];

(async () => {
  const ev = db.collection("events").doc(E);
  const ids = [...DROP_COMPANIES, DROP_USER];
  const mentions = (data) => JSON.stringify(data).match(new RegExp(`"(${ids.join("|")})"`));

  // Seguridad: no debe haber nada más apuntando a lo que se borra
  for (const [name, snap] of [["meetings", await ev.collection("meetings").get()], ["products", await ev.collection("products").get()]]) {
    snap.docs.filter((d) => mentions(d.data())).forEach((d) => { console.log("ABORTA: referencia en", name, d.id); process.exit(1); });
  }
  for (const c of DROP_COMPANIES) {
    const v = await ev.collection("companies").doc(c).collection("visits").get();
    if (v.size) { console.log("ABORTA: visitas en", c); process.exit(1); }
  }

  const keep = await ev.collection("companies").doc(KEEP).get();
  if (!keep.exists) { console.log("ABORTA: no existe", KEEP); process.exit(1); }
  console.log("Empresa que queda:", KEEP, keep.data().razonSocial);

  for (const uid of REAL_USERS) {
    const u = await db.collection("users").doc(uid).get();
    const d = u.data();
    const upd = { companyId: KEEP, tipoAsistente: "vendedor", updatedAt: new Date().toISOString() };
    for (const k of ["company_nit", "nit", "nitNorm"]) if (k in d) upd[k] = KEEP;
    console.log(`USER ${uid} (${d.nombre}): companyId ${d.companyId} -> ${KEEP}, tipoAsistente ${d.tipoAsistente} -> vendedor`);
    if (APPLY) await u.ref.update(upd);
  }
  console.log("BORRAR usuario", DROP_USER);
  DROP_COMPANIES.forEach((c) => console.log("BORRAR empresa", c));
  if (!APPLY) { console.log("\nDRY RUN. Usa --apply para ejecutar."); process.exit(0); }
  await db.collection("users").doc(DROP_USER).delete();
  for (const c of DROP_COMPANIES) await ev.collection("companies").doc(c).delete();
  console.log("Listo.");
  process.exit(0);
})();

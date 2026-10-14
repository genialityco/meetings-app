// Une empresas duplicadas de un evento: OLD -> NEW (generaliza _merge-armametal.js).
// - Reemplaza OLD por NEW en campos de primer nivel de users / meetings / products del evento
//   (companyId, company_nit, ...). Los usos anidados solo se reportan.
// - Mueve las visitas de stand (companies/OLD/visits) a NEW si NEW no tiene la del mismo visitante.
// - Completa en NEW los campos vacíos con los de OLD (logo, descripción...).
// - Guarda respaldo JSON de todo lo que toca y borra companies/OLD.
//   node _merge-companies.js <eventId> OLD:NEW [OLD:NEW ...]            # dry-run
//   node _merge-companies.js <eventId> OLD:NEW [OLD:NEW ...] --apply
const admin = require("firebase-admin");
const fs = require("fs");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const E = args[0];
const pairs = args.slice(1).filter((a) => a.includes(":")).map((a) => a.split(":"));
const isEmpty = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
const nestedHas = (v, needle, path = "") => {
  if (v === needle && path.includes(".")) return [path];
  if (v && typeof v === "object" && !(v instanceof admin.firestore.Timestamp)) {
    return Object.entries(v).flatMap(([k, x]) => nestedHas(x, needle, path ? `${path}.${k}` : k));
  }
  return [];
};

(async () => {
  if (!E || !pairs.length) return console.log("Uso: node _merge-companies.js <eventId> OLD:NEW [...] [--apply]");
  const ev = db.collection("events").doc(E);
  const [users, meetings, products] = await Promise.all([
    db.collection("users").where("eventId", "==", E).get(),
    ev.collection("meetings").get(),
    ev.collection("products").get(),
  ]);
  const all = [...users.docs, ...meetings.docs, ...products.docs];
  const backup = {};
  const ops = [];

  for (const [OLD, NEW] of pairs) {
    const oldRef = ev.collection("companies").doc(OLD);
    const newRef = ev.collection("companies").doc(NEW);
    const [o, n] = await Promise.all([oldRef.get(), newRef.get()]);
    if (!o.exists || !n.exists) { console.log(`\n✘ ${OLD} -> ${NEW}: falta algún doc de empresa, se omite`); continue; }
    console.log(`\n=== ${OLD} "${o.data().razonSocial}"  ->  ${NEW} "${n.data().razonSocial}"`);
    backup[oldRef.path] = o.data();
    backup[newRef.path] = n.data();

    const subs = (await oldRef.listCollections()).map((c) => c.id).filter((id) => id !== "visits");
    if (subs.length) { console.log(`  ✘ OLD tiene subcolecciones no previstas (${subs.join(", ")}), se omite`); continue; }

    for (const d of all) {
      const upd = {};
      for (const [k, v] of Object.entries(d.data())) if (v === OLD) upd[k] = NEW;
      const nested = nestedHas(d.data(), OLD);
      if (Object.keys(upd).length) {
        backup[d.ref.path] = d.data();
        ops.push((b) => b.update(d.ref, upd));
        const x = d.data();
        console.log(`  · ${d.ref.parent.id}/${d.id} ${Object.keys(upd).join(",")}${x.nombre ? ` (${x.nombre.trim()})` : x.status ? ` (${x.status})` : x.title ? ` (${x.title})` : ""}`);
      }
      if (nested.length) console.log(`  ⚠ ${d.ref.path} contiene ${OLD} anidado en ${nested.join(", ")} (no se modifica)`);
    }

    const [ov, nv] = await Promise.all([oldRef.collection("visits").get(), newRef.collection("visits").get()]);
    const have = new Set(nv.docs.map((d) => d.id));
    ov.docs.forEach((d) => {
      backup[d.ref.path] = d.data();
      if (!have.has(d.id)) ops.push((b) => b.set(newRef.collection("visits").doc(d.id), { ...d.data(), companyId: NEW }));
      ops.push((b) => b.delete(d.ref));
    });
    if (ov.size) console.log(`  · visitas: ${ov.size} (${ov.docs.filter((d) => !have.has(d.id)).length} se mueven a NEW)`);

    const fill = Object.fromEntries(Object.entries(o.data()).filter(([k, v]) => !isEmpty(v) && isEmpty(n.data()[k]) && k !== "nitNorm" && k !== "nit"));
    if (Object.keys(fill).length) { ops.push((b) => b.update(newRef, fill)); console.log(`  · completa en NEW: ${Object.keys(fill).join(", ")}`); }
    ops.push((b) => b.delete(oldRef));
    console.log(`  · borra companies/${OLD}`);
  }

  console.log(`\nOperaciones: ${ops.length}`);
  if (!apply) return console.log("DRY-RUN (agrega --apply para escribir)");
  const file = `_merge-companies-backup-${E}-${Date.now()}.json`;
  fs.writeFileSync(file, JSON.stringify(backup, null, 1));
  console.log(`Respaldo: ${file} (${Object.keys(backup).length} docs)`);
  for (let i = 0; i < ops.length; i += 400) {
    const b = db.batch();
    ops.slice(i, i + 400).forEach((op) => op(b));
    await b.commit();
  }
  console.log("APLICADO");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

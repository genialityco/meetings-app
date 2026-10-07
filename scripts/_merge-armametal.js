// Une ARMAMETAL S.A.S duplicada: 9004971758 (NIT con DV) -> 900497175 (correcto).
// Uso: node scripts/_merge-armametal.js <ruta-respaldo.json>
const admin = require("firebase-admin");
const fs = require("fs");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const E = "ihIlXCreXToidw1wsI9a";
const OLD = "9004971758";
const NEW = "900497175";

(async () => {
  const ev = db.collection("events").doc(E);
  const oldRef = ev.collection("companies").doc(OLD);
  const [o, n] = await Promise.all([oldRef.get(), ev.collection("companies").doc(NEW).get()]);
  if (!o.exists || !n.exists) throw new Error("Falta alguno de los dos docs de empresa");
  const visits = await oldRef.collection("visits").get();
  if (!visits.empty) throw new Error("El doc viejo tiene visitas; revisar antes de unir");

  const hasOld = (d) => Object.values(d.data()).some((v) => v === OLD);
  const [users, meetings, products] = await Promise.all([
    db.collection("users").where("eventId", "==", E).get(),
    ev.collection("meetings").get(),
    ev.collection("products").get(),
  ]);
  const targets = [...users.docs, ...meetings.docs, ...products.docs].filter(hasOld);

  const backup = { [oldRef.path]: o.data() };
  targets.forEach((d) => (backup[d.ref.path] = d.data()));
  fs.writeFileSync(process.argv[2], JSON.stringify(backup, null, 1));
  console.log(`Respaldo: ${Object.keys(backup).length} docs`);

  const batch = db.batch();
  for (const d of targets) {
    const upd = {};
    for (const [k, v] of Object.entries(d.data())) if (v === OLD) upd[k] = NEW;
    batch.update(d.ref, upd);
    console.log("actualizado", d.ref.path, Object.keys(upd).join(","));
  }
  batch.delete(oldRef);
  await batch.commit();
  console.log("eliminado", oldRef.path);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });

// Une GRANDES MARCAS duplicada: 9009134582 (NIT con DV, registro de Wilson Camacho)
// -> 900913458, con el nombre y datos del registro de Wilson.
// Uso: node scripts/_merge-grandes-marcas.js <ruta-respaldo.json>
const admin = require("firebase-admin");
const fs = require("fs");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const E = "ihIlXCreXToidw1wsI9a";
const OLD = "9009134582";
const NEW = "900913458";
const NAME = "RODAMIENTOS TRANSMISIONES GRANDES MARCAS SAS";

(async () => {
  const ev = db.collection("events").doc(E);
  const oldRef = ev.collection("companies").doc(OLD);
  const newRef = ev.collection("companies").doc(NEW);
  const [o, n] = await Promise.all([oldRef.get(), newRef.get()]);
  if (!o.exists || !n.exists) throw new Error("Falta alguno de los dos docs de empresa");
  if (!(await oldRef.collection("visits").get()).empty) throw new Error("El doc viejo tiene visitas");

  const [users, meetings, products] = await Promise.all([
    db.collection("users").where("eventId", "==", E).get(),
    ev.collection("meetings").get(),
    ev.collection("products").get(),
  ]);
  const hasOld = (d) => Object.values(d.data()).some((v) => v === OLD);
  const moved = [...users.docs, ...meetings.docs, ...products.docs].filter(hasOld);
  // Usuarios de la empresa final (incluye el rep genérico) para alinear el nombre
  const companyUsers = users.docs.filter((d) => [OLD, NEW].includes(d.data().companyId));

  const backup = { [oldRef.path]: o.data(), [newRef.path]: n.data() };
  [...moved, ...companyUsers].forEach((d) => (backup[d.ref.path] = d.data()));
  fs.writeFileSync(process.argv[2], JSON.stringify(backup, null, 1));
  console.log(`Respaldo: ${Object.keys(backup).length} docs`);

  const od = o.data();
  const batch = db.batch();
  batch.update(newRef, {
    razonSocial: NAME,
    company_razonSocial: NAME,
    ...(od.logoUrl ? { logoUrl: od.logoUrl } : {}),
    ...(od.descripcion ? { descripcion: od.descripcion } : {}),
    updatedAt: new Date(),
  });
  const upd = new Map();
  for (const d of moved) {
    const u = {};
    for (const [k, v] of Object.entries(d.data())) if (v === OLD) u[k] = NEW;
    upd.set(d.ref.path, { ref: d.ref, data: u });
  }
  for (const d of companyUsers) {
    const cur = upd.get(d.ref.path) || { ref: d.ref, data: {} };
    cur.data.empresa = NAME;
    cur.data.company_razonSocial = NAME;
    upd.set(d.ref.path, cur);
  }
  for (const { ref, data } of upd.values()) {
    batch.update(ref, data);
    console.log("actualizado", ref.path, Object.keys(data).join(","));
  }
  batch.delete(oldRef);
  await batch.commit();
  console.log("actualizado", newRef.path, "razonSocial/logo/descripcion");
  console.log("eliminado", oldRef.path);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });

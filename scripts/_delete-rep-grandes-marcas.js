// Elimina el representante genérico rep_900913458 (RODAMIENTOS TRANSMISIONES GRANDES MARCAS SAS)
// y sus notificaciones. Las solicitudes de la empresa (receiverId null) no dependen de él.
// Uso: node scripts/_delete-rep-grandes-marcas.js <ruta-respaldo.json>
const admin = require("firebase-admin");
const fs = require("fs");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const E = "ihIlXCreXToidw1wsI9a";
const R = "rep_900913458";

(async () => {
  const ev = db.collection("events").doc(E);
  const userRef = db.collection("users").doc(R);
  const user = await userRef.get();
  if (!user.exists) throw new Error("El rep no existe");
  // Seguridad: no borrar si participa en alguna reunión
  const [asReq, asPart] = await Promise.all([
    ev.collection("meetings").where("requesterId", "==", R).get(),
    ev.collection("meetings").where("participants", "array-contains", R).get(),
  ]);
  if (!asReq.empty || !asPart.empty) throw new Error("El rep participa en reuniones; revisar antes de borrar");
  const notifs = await db.collection("notifications").where("userId", "==", R).get();

  const backup = { [userRef.path]: user.data() };
  notifs.forEach((d) => (backup[d.ref.path] = d.data()));
  fs.writeFileSync(process.argv[2], JSON.stringify(backup, null, 1));
  console.log(`Respaldo: ${Object.keys(backup).length} docs`);

  const batch = db.batch();
  notifs.forEach((d) => batch.delete(d.ref));
  batch.delete(userRef);
  await batch.commit();
  Object.keys(backup).forEach((p) => console.log("eliminado", p));
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });

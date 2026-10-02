// Restaura agenda, meetings y locks de un evento desde la base clonada (PITR clone)
// hacia la base (default). No sobrescribe docs que ya existan en destino.
//
// Uso:
//   node scripts/_restore-from-clone.js <eventId>            # dry-run (solo cuenta)
//   node scripts/_restore-from-clone.js <eventId> --apply    # escribe
const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");
const sa = require("./serviceAccountKey.json");

const SOURCE_DB = "recuperacion";
const eventId = process.argv[2];
const apply = process.argv.includes("--apply");
if (!eventId) {
  console.error("Falta eventId");
  process.exit(1);
}

const app = admin.initializeApp({ credential: admin.credential.cert(sa) });
const dst = getFirestore(app);
const src = getFirestore(app, SOURCE_DB);

async function copyDocs(label, srcDocs) {
  const refs = srcDocs.map((d) => dst.doc(d.ref.path));
  const existing = new Set();
  for (let i = 0; i < refs.length; i += 300) {
    const snaps = await dst.getAll(...refs.slice(i, i + 300));
    snaps.forEach((s) => s.exists && existing.add(s.ref.path));
  }
  const toWrite = srcDocs.filter((d) => !existing.has(d.ref.path));
  console.log(
    `${label}: ${srcDocs.length} en backup, ${existing.size} ya existen en destino, ${toWrite.length} a restaurar`,
  );
  if (!apply) return;
  for (let i = 0; i < toWrite.length; i += 400) {
    const batch = dst.batch();
    toWrite.slice(i, i + 400).forEach((d) => batch.set(dst.doc(d.ref.path), d.data()));
    await batch.commit();
  }
  console.log(`${label}: restaurados ${toWrite.length}`);
}

(async () => {
  console.log(apply ? "MODO APLICAR" : "DRY-RUN (agrega --apply para escribir)");
  const ev = await src.collection("events").doc(eventId).get();
  console.log(`Evento en backup: ${ev.exists ? ev.data().eventName : "NO EXISTE"}`);
  if (!ev.exists) process.exit(1);

  const meetings = await src.collection("events").doc(eventId).collection("meetings").get();
  const byStatus = {};
  meetings.forEach((d) => {
    const s = d.data().status || "?";
    byStatus[s] = (byStatus[s] || 0) + 1;
  });
  console.log("Reuniones por estado:", byStatus);

  const agenda = await src.collection("events").doc(eventId).collection("agenda").get();
  const locks = await src.collection("locks").where("eventId", "==", eventId).get();

  await copyDocs("meetings", meetings.docs);
  await copyDocs("agenda", agenda.docs);
  await copyDocs("locks", locks.docs);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

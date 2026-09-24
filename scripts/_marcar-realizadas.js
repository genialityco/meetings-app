const admin = require("firebase-admin");
const fs = require("fs");
const sa = require("./serviceAccountKey.json");
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const RUEDA_ID = "Dr2GOaFklFr8jm340hPV";
const RESULT_PATH = "C:/Users/pipe0/AppData/Local/Temp/claude/d--gen-iality-Proyectos-my-meetings-app/dc2ddcd4-84c4-457d-ac68-481bb41b9888/scratchpad/cruce-result.json";

(async () => {
  const results = JSON.parse(fs.readFileSync(RESULT_PATH, "utf8"));
  const targetIds = results
    .filter((r) => r.classification === "auto" || r.classification === "revisar")
    .map((r) => r.meetingId);

  console.log(`Objetivo: ${targetIds.length} reuniones (auto + revisar)`);

  const meetingsCol = db.collection("events").doc(RUEDA_ID).collection("meetings");

  // Re-leer cada doc para verificar que sigue en el mismo estado antes de escribir
  const refs = targetIds.map((id) => meetingsCol.doc(id));
  const snaps = await db.getAll(...refs);

  const toUpdate = [];
  const skipped = [];
  snaps.forEach((snap) => {
    if (!snap.exists) { skipped.push({ id: snap.id, reason: "no existe" }); return; }
    const d = snap.data();
    if (d.status !== "accepted") { skipped.push({ id: snap.id, reason: `status=${d.status}` }); return; }
    if (d.completed !== undefined) { skipped.push({ id: snap.id, reason: `completed ya definido=${d.completed}` }); return; }
    toUpdate.push(snap.ref);
  });

  console.log(`A actualizar: ${toUpdate.length}`);
  if (skipped.length) {
    console.log(`Omitidas (${skipped.length}) por cambio de estado desde el análisis:`);
    skipped.forEach((s) => console.log(`  - ${s.id}: ${s.reason}`));
  }

  if (toUpdate.length === 0) {
    console.log("Nada que actualizar.");
    process.exit(0);
  }

  // Firestore batch limit is 500 writes; here we're well under that.
  const batch = db.batch();
  toUpdate.forEach((ref) => batch.update(ref, { completed: true }));
  await batch.commit();

  console.log(`\nListo: ${toUpdate.length} reuniones marcadas como completed=true.`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

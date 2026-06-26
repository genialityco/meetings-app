const admin = require("firebase-admin");
const sa = require("./serviceAccountKey.json");
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
(async () => {
  const eventId = "lQLBj6eEaBlM03RTHx0O";
  const snap = await db.collection("events").doc(eventId).get();
  if (!snap.exists) { console.log("EVENT NOT FOUND"); process.exit(0); }
  const ev = snap.data();
  console.log("eventName:", ev.name || ev.eventName || "(sin nombre)");
  console.log("eventType:", ev.eventType);
  console.log("roleMode (policies):", ev.config?.policies?.roleMode);
  const fields = ev.config?.formFields || [];
  const tipo = fields.find(f => f.name === "tipoAsistente");
  console.log("\n=== tipoAsistente field ===");
  console.log(JSON.stringify(tipo, null, 2));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

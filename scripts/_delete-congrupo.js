const admin = require("firebase-admin");
const fs = require("fs");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const eventId = "ihIlXCreXToidw1wsI9a";
const companyId = "800146643";
const userId = "rep_800146643";
const backupPath = process.argv[2];

(async () => {
  const evRef = db.collection("events").doc(eventId);
  const refs = [evRef.collection("companies").doc(companyId), db.collection("users").doc(userId)];
  (await evRef.collection("meetings").where("companyId", "==", companyId).get()).forEach((d) => refs.push(d.ref));
  (await evRef.collection("meetings").where("receiverId", "==", userId).get()).forEach((d) => refs.push(d.ref));
  (await evRef.collection("meetings").where("requesterId", "==", userId).get()).forEach((d) => refs.push(d.ref));
  (await db.collection("notifications").where("userId", "==", userId).get()).forEach((d) => refs.push(d.ref));
  const unique = [...new Map(refs.map((r) => [r.path, r])).values()];

  const backup = {};
  for (const r of unique) { const s = await r.get(); if (s.exists) backup[r.path] = s.data(); }
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 1));
  console.log(`Respaldo: ${Object.keys(backup).length} docs -> ${backupPath}`);

  const batch = db.batch();
  Object.keys(backup).forEach((p) => batch.delete(db.doc(p)));
  await batch.commit();
  Object.keys(backup).forEach((p) => console.log("eliminado", p));
  process.exit(0);
})();

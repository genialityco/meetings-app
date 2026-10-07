const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const eventId = "ihIlXCreXToidw1wsI9a";
(async () => {
  const s = await db.collection("events").doc(eventId).collection("meetings").where("companyId", "==", "800146643").get();
  s.forEach((d) => { const m = d.data(); console.log(d.id, JSON.stringify({ status: m.status, requesterId: m.requesterId, receiverId: m.receiverId, companyId: m.companyId, productId: m.productId, contextNote: m.contextNote, createdAt: m.createdAt?.toDate?.() || m.createdAt })); });
  const n = await db.collection("notifications").where("userId", "==", "rep_800146643").get();
  n.forEach((d) => console.log("notif", d.id, d.data().title, d.data().type));
  const u = await db.collection("users").doc("rep_800146643").get();
  console.log(JSON.stringify(u.data(), null, 1));
  process.exit(0);
})();

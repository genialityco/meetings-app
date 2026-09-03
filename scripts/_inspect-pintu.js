const admin = require("firebase-admin");
const sa = require("./serviceAccountKey.json");
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

(async () => {
  const eventId = "Dr2GOaFklFr8jm340hPV";
  const idA = "DJ1ltex42SRo20POfu4B92OP8IG3"; // comprador, real cedula
  const idB = "dU2aIwJeJb5F6vk5mlBd"; // Vendedor, short cedula
  const companyId = "901569289";

  console.log("=== Meetings referencing either id ===");
  const meetingsRef = db.collection("events").doc(eventId).collection("meetings");
  const [asRequesterA, asReceiverA, asRequesterB, asReceiverB] = await Promise.all([
    meetingsRef.where("requesterId", "==", idA).get(),
    meetingsRef.where("receiverId", "==", idA).get(),
    meetingsRef.where("requesterId", "==", idB).get(),
    meetingsRef.where("receiverId", "==", idB).get(),
  ]);
  const seen = new Set();
  const printMeeting = (doc) => {
    if (seen.has(doc.id)) return;
    seen.add(doc.id);
    const d = doc.data();
    console.log({
      id: doc.id,
      requesterId: d.requesterId,
      receiverId: d.receiverId,
      status: d.status,
      companyId: d.companyId,
      productId: d.productId,
      date: d.date,
      startTime: d.startTime,
      endTime: d.endTime,
      slotId: d.slotId,
      isExternal: d.isExternal,
      completed: d.completed,
    });
  };
  [asRequesterA, asReceiverA, asRequesterB, asReceiverB].forEach((s) => s.forEach(printMeeting));
  console.log(`Total meetings (unique): ${seen.size}`);

  console.log("\n=== Products owned by either id ===");
  const productsRef = db.collection("events").doc(eventId).collection("products");
  const [pA, pB] = await Promise.all([
    productsRef.where("ownerUserId", "==", idA).get(),
    productsRef.where("ownerUserId", "==", idB).get(),
  ]);
  console.log("owned by A:", pA.size, "owned by B:", pB.size);

  console.log("\n=== Locks referencing either id ===");
  const locksSnap = await db.collection("locks").get();
  locksSnap.forEach((doc) => {
    if (doc.id.includes(idA) || doc.id.includes(idB)) console.log(doc.id, doc.data());
  });

  console.log("\n=== Visits (across all companies) referencing either id ===");
  const companiesSnap = await db.collection("events").doc(eventId).collection("companies").get();
  for (const c of companiesSnap.docs) {
    const vA = await c.ref.collection("visits").doc(idA).get();
    const vB = await c.ref.collection("visits").doc(idB).get();
    if (vA.exists || vB.exists) console.log(`company ${c.id}: visitA=${vA.exists} visitB=${vB.exists}`);
  }

  console.log("\n=== notifications referencing either id ===");
  for (const id of [idA, idB]) {
    const s = await db.collection("notifications").where("userId", "==", id).get();
    console.log(id, "notifications:", s.size);
    s.forEach((d) => console.log(" -", d.id, d.data().type, d.data().message));
  }

  console.log("\n=== raffleTickets / checkIns on user docs ===");
  const [snapA, snapB] = await Promise.all([
    db.collection("users").doc(idA).get(),
    db.collection("users").doc(idB).get(),
  ]);
  console.log("A raffleTickets:", snapA.data().raffleTickets, "checkIns:", snapA.data().checkIns);
  console.log("B raffleTickets:", snapB.data().raffleTickets, "checkIns:", snapB.data().checkIns);

  console.log("\n=== Full docs (trimmed) ===");
  const strip = (d) => {
    const c = { ...d };
    delete c.search_vector; delete c.vector; delete c.search_vectorText; delete c.condensedText; delete c.descripcion;
    return c;
  };
  console.log("A:", JSON.stringify(strip(snapA.data()), null, 2));
  console.log("B:", JSON.stringify(strip(snapB.data()), null, 2));

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

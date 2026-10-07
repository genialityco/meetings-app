const admin = require("firebase-admin");
const sa = require("./serviceAccountKey.json");
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const eventId = "ihIlXCreXToidw1wsI9a";
const term = "congrupo";
const has = (v) => String(v || "").toLowerCase().includes(term);

(async () => {
  const ev = await db.collection("events").doc(eventId).get();
  console.log("Evento:", ev.data()?.eventName || ev.data()?.name);

  const evRef = db.collection("events").doc(eventId);
  const compSnap = await evRef.collection("companies").get();
  const companies = compSnap.docs.filter((d) => has(d.data().razonSocial) || has(d.id) || has(d.data().company_razonSocial));
  console.log(`\n=== Empresas (${companies.length}) ===`);
  for (const c of companies) {
    const d = c.data();
    const visits = await c.ref.collection("visits").get();
    const subcols = (await c.ref.listCollections()).map((s) => s.id);
    console.log({ id: c.id, razonSocial: d.razonSocial, nit: d.nit, fixedTable: d.fixedTable, visits: visits.size, subcols });
  }
  const companyIds = new Set(companies.map((c) => c.id));

  const usersSnap = await db.collection("users").where("eventId", "==", eventId).get();
  const users = usersSnap.docs.filter((d) => {
    const u = d.data();
    return companyIds.has(u.companyId) || has(u.empresa) || has(u.company_razonSocial);
  });
  console.log(`\n=== Asistentes (${users.length}) ===`);
  users.forEach((d) => { const u = d.data(); console.log({ id: d.id, nombre: u.nombre, correo: u.correo, cedula: u.cedula, tipo: u.tipoAsistente, companyId: u.companyId, empresa: u.empresa || u.company_razonSocial }); });
  const userIds = new Set(users.map((d) => d.id));

  const mtgSnap = await evRef.collection("meetings").get();
  const mtgs = mtgSnap.docs.filter((d) => { const m = d.data(); return userIds.has(m.requesterId) || userIds.has(m.receiverId) || companyIds.has(m.companyId) || (m.participants || []).some((p) => userIds.has(p)); });
  const byStatus = {};
  mtgs.forEach((d) => { const s = d.data().status; byStatus[s] = (byStatus[s] || 0) + 1; });
  console.log(`\n=== Reuniones (${mtgs.length}) ===`, byStatus);
  const mtgIds = new Set(mtgs.map((d) => d.id));
  mtgs.forEach((d) => { const m = d.data(); console.log(d.id, m.status, m.requesterId, "->", m.receiverId, m.timeSlot || "", m.tableAssigned || "", m.meetingDate || ""); });

  const agSnap = await evRef.collection("agenda").get();
  const slots = agSnap.docs.filter((d) => mtgIds.has(d.data().meetingId));
  console.log(`\n=== Slots de agenda ocupados por esas reuniones (${slots.length}) ===`);

  const prodSnap = await evRef.collection("products").get();
  const prods = prodSnap.docs.filter((d) => userIds.has(d.data().ownerUserId) || companyIds.has(d.data().companyId));
  console.log(`\n=== Productos (${prods.length}) ===`);
  prods.forEach((d) => console.log(d.id, d.data().title));

  let locks = 0;
  for (const uid of userIds) { const s = await db.collection("locks").where(admin.firestore.FieldPath.documentId(), ">=", `${eventId}_${uid}_`).where(admin.firestore.FieldPath.documentId(), "<", `${eventId}_${uid}_\uf8ff`).get(); locks += s.size; }
  console.log(`\n=== Locks: ${locks}`);

  let notifs = 0, surveys = 0;
  for (const uid of userIds) {
    notifs += (await db.collection("notifications").where("userId", "==", uid).get()).size;
  }
  for (const mid of mtgIds) surveys += (await db.collection("meetingSurveys").where("meetingId", "==", mid).get()).size;
  console.log(`Notificaciones: ${notifs}, Encuestas de reunión: ${surveys}`);

  // Visitas que asistentes de CONGRUPO hicieron a otros stands
  let outVisits = 0;
  for (const c of compSnap.docs) for (const uid of userIds) { const v = await c.ref.collection("visits").doc(uid).get(); if (v.exists && !companyIds.has(c.id)) outVisits++; }
  console.log(`Visitas de asistentes CONGRUPO a otros stands: ${outVisits}`);
  process.exit(0);
})();

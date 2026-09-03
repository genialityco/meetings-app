const admin = require("firebase-admin");
const sa = require("./serviceAccountKey.json");
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

(async () => {
  const eventId = "Dr2GOaFklFr8jm340hPV";

  console.log("=== Company docs matching Gerfor ===");
  const companiesSnap = await db.collection("events").doc(eventId).collection("companies").get();
  const matches = [];
  companiesSnap.forEach((doc) => {
    const d = doc.data();
    if ((d.razonSocial || "").toLowerCase().includes("gerfor") || (d.company_razonSocial || "").toLowerCase().includes("gerfor")) {
      matches.push({ id: doc.id, ...d });
      console.log({ id: doc.id, razonSocial: d.razonSocial, company_razonSocial: d.company_razonSocial, nitNorm: d.nitNorm, fixedTable: d.fixedTable, createdAt: d.createdAt, updatedAt: d.updatedAt, logoUrl: d.logoUrl, sharedAgenda: d.sharedAgenda });
    }
  });

  if (matches.length === 0) {
    console.log("No se encontró ninguna empresa con 'Gerfor' en el nombre.");
    process.exit(0);
  }

  for (const m of matches) {
    const companyId = m.id;
    console.log(`\n=== Usuarios con companyId="${companyId}" ===`);
    const usersSnap = await db.collection("users").where("eventId", "==", eventId).where("companyId", "==", companyId).get();
    usersSnap.forEach((doc) => {
      const d = doc.data();
      console.log({
        id: doc.id,
        nombre: d.nombre,
        cedula: d.cedula,
        correo: d.correo,
        telefono: d.telefono,
        tipoAsistente: d.tipoAsistente,
        empresa: d.empresa,
        cargo: d.cargo,
        companyId: d.companyId,
        company_nit: d.company_nit,
      });
    });

    console.log(`\n=== Productos con companyId="${companyId}" ===`);
    const productsSnap = await db.collection("events").doc(eventId).collection("products").where("companyId", "==", companyId).get();
    productsSnap.forEach((doc) => console.log({ id: doc.id, ...doc.data() }));

    console.log(`\n=== Reuniones con companyId="${companyId}" ===`);
    const meetingsSnap = await db.collection("events").doc(eventId).collection("meetings").where("companyId", "==", companyId).get();
    meetingsSnap.forEach((doc) => {
      const d = doc.data();
      console.log({ id: doc.id, requesterId: d.requesterId, receiverId: d.receiverId, status: d.status, companyId: d.companyId });
    });

    console.log(`\n=== Visits subcollection de companies/${companyId} ===`);
    const visitsSnap = await db.collection("events").doc(eventId).collection("companies").doc(companyId).collection("visits").get();
    console.log("count:", visitsSnap.size);
    visitsSnap.forEach((doc) => console.log({ id: doc.id, ...doc.data() }));
  }

  console.log("\n=== ¿Ya existe una empresa con NIT 8605025091? ===");
  const target = await db.collection("events").doc(eventId).collection("companies").doc("8605025091").get();
  console.log("existe:", target.exists, target.exists ? target.data() : null);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

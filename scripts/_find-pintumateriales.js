const admin = require("firebase-admin");
const sa = require("./serviceAccountKey.json");
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

(async () => {
  const eventId = "Dr2GOaFklFr8jm340hPV";
  const snap = await db.collection("users").where("eventId", "==", eventId).get();
  const rows = [];
  snap.forEach((doc) => rows.push({ id: doc.id, ...doc.data() }));

  const matches = rows.filter((r) =>
    (r.empresa || "").toLowerCase().includes("pintumateriales") ||
    (r.company_razonSocial || "").toLowerCase().includes("pintumateriales")
  );

  console.log(`Encontrados ${matches.length} perfiles para "Pintumateriales":\n`);
  for (const r of matches) {
    console.log({
      id: r.id,
      nombre: r.nombre,
      cedula: r.cedula,
      correo: r.correo,
      telefono: r.telefono,
      tipoAsistente: r.tipoAsistente,
      companyId: r.companyId,
      empresa: r.empresa,
      cargo: r.cargo,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
    console.log("---");
  }

  // Also check the companies collection for the razon social, in case companyId differs across profiles
  console.log("\n=== Company docs matching Pintumateriales ===");
  const companiesSnap = await db.collection("events").doc(eventId).collection("companies").get();
  companiesSnap.forEach((doc) => {
    const d = doc.data();
    if ((d.razonSocial || "").toLowerCase().includes("pintumateriales") || (d.company_razonSocial || "").toLowerCase().includes("pintumateriales")) {
      console.log({ id: doc.id, razonSocial: d.razonSocial, company_razonSocial: d.company_razonSocial, fixedTable: d.fixedTable });
    }
  });

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

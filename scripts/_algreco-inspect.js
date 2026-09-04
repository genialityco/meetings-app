const admin = require("firebase-admin");
const sa = require("./serviceAccountKey.json");
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const eventIds = ["Dr2GOaFklFr8jm340hPV", "0ei1JsHIlhJS3xKizHhq"];

(async () => {
  for (const eventId of eventIds) {
    const evSnap = await db.collection("events").doc(eventId).get();
    const evName = evSnap.exists ? (evSnap.data().name || evSnap.data().eventName) : "(?)";
    console.log("\n================================");
    console.log("EVENT:", eventId, "-", evName);
    console.log("================================");

    const evRef = db.collection("events").doc(eventId);

    // Companies matching "algreco"
    const companiesSnap = await evRef.collection("companies").get();
    const allCompanies = companiesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const matches = allCompanies.filter((c) => norm(c.razonSocial).includes("algreco"));
    console.log(`\nEmpresas que matchean "algreco" (${matches.length}):`);
    matches.forEach((c) => {
      console.log(`  - id=${c.id} | razonSocial="${c.razonSocial}" | logoUrl=${c.logoUrl ? "sí" : "no"} | descripcion=${c.descripcion ? c.descripcion.slice(0,60)+"..." : "(vacío)"}`);
    });

    // Users: match by companyId in matches, by empresa text containing algreco, or by nombre containing "empresa" / "henry"
    const usersSnap = await db.collection("users").where("eventId", "==", eventId).get();
    const allUsers = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const algrecoIds = new Set(matches.map((c) => c.id));

    const relatedUsers = allUsers.filter((u) =>
      (u.companyId && algrecoIds.has(u.companyId)) ||
      norm(u.empresa).includes("algreco") ||
      norm(u.nombre) === "empresa" ||
      norm(u.nombre).includes("henry orlando")
    );

    console.log(`\nAsistentes relacionados (${relatedUsers.length}):`);
    relatedUsers.forEach((u) => {
      console.log(`  - id=${u.id} | nombre="${u.nombre}" | cedula=${u.cedula ?? "?"} | correo=${u.correo ?? "?"} | telefono=${u.telefono ?? "?"} | empresa(texto)="${u.empresa ?? "?"}" | companyId=${u.companyId ?? "?"} | tipoAsistente=${u.tipoAsistente ?? "?"}`);
    });
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

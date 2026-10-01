// Uso: node scripts/_create_parque_industrial.js [--apply]
// Crea la empresa (sin descripción) y su representante genérico rep_<nit>, mismo formato que _create_company_reps.js
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const APPLY = process.argv.includes("--apply");
const E = "ihIlXCreXToidw1wsI9a";
const NIT = "901838320";
const NOMBRE = "Parque Industrial y Energético Valle de San José";
const slug = NOMBRE.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

(async () => {
  const cRef = db.collection("events").doc(E).collection("companies").doc(NIT);
  const uRef = db.collection("users").doc("rep_" + NIT);
  const [c, u] = await Promise.all([cRef.get(), uRef.get()]);
  if (c.exists || u.exists) { console.log("ABORTA: ya existe", { empresa: c.exists, usuario: u.exists }); process.exit(1); }
  const now = new Date();
  const company = { nitNorm: NIT, razonSocial: NOMBRE, company_razonSocial: NOMBRE, createdAt: now, updatedAt: now };
  const user = {
    eventId: E, nombre: "Representante", correo: `rueda${slug}@geniality.com.co`, telefono: "",
    tipoAsistente: "vendedor", companyId: NIT, company_razonSocial: NOMBRE, empresa: NOMBRE,
    custom_pas_8769: "Colombia", welcomePopupSeen: true,
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  };
  console.log("EMPRESA", NIT, company);
  console.log("USUARIO rep_" + NIT, user);
  if (!APPLY) { console.log("\nDRY RUN. Usa --apply para ejecutar."); process.exit(0); }
  await cRef.set(company);
  await uRef.set(user);
  console.log("Creados.");
  process.exit(0);
})();

// Uso: node scripts/_fix_nit_banco.js [--apply]
const admin = require("firebase-admin");
const sa = require("./serviceAccountKey.json");
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");
const eventId = "ihIlXCreXToidw1wsI9a";
const OLD = "J30988413";
const NEW = "J309841327";

(async () => {
  const ev = db.collection("events").doc(eventId);
  const oldRef = ev.collection("companies").doc(OLD);
  const newRef = ev.collection("companies").doc(NEW);
  const [oldSnap, newSnap] = await Promise.all([oldRef.get(), newRef.get()]);
  console.log("Empresa vieja existe:", oldSnap.exists, "| nueva existe:", newSnap.exists);
  if (oldSnap.exists) console.log(oldSnap.data());
  if (newSnap.exists) { console.log("ABORTA: ya existe doc con el NIT nuevo"); process.exit(1); }
  if (!oldSnap.exists) process.exit(1);

  const visits = await oldRef.collection("visits").get();
  const users = await db.collection("users").where("eventId", "==", eventId).get();
  const refUsers = users.docs.filter((d) => {
    const u = d.data();
    return [u.companyId, u.company_nit, u.nit, u.nitNorm].some((v) => v === OLD);
  });
  const products = await ev.collection("products").where("companyId", "==", OLD).get();
  const meetings = await ev.collection("meetings").where("companyId", "==", OLD).get();

  console.log(`visits: ${visits.size}, users: ${refUsers.length}, products: ${products.size}, meetings: ${meetings.size}`);
  refUsers.forEach((d) => { const u = d.data(); console.log("USER", d.id, { name: u.name, companyId: u.companyId, company_nit: u.company_nit, tipoAsistente: u.tipoAsistente }); });

  if (!APPLY) { console.log("\nDRY RUN. Usa --apply para ejecutar."); return; }

  const data = oldSnap.data();
  const newData = { ...data };
  for (const k of ["nitNorm", "nit", "companyId"]) if (newData[k] === OLD) newData[k] = NEW;
  await newRef.set(newData);
  for (const v of visits.docs) await newRef.collection("visits").doc(v.id).set(v.data());
  for (const d of refUsers) {
    const u = d.data(); const upd = {};
    for (const k of ["companyId", "company_nit", "nit", "nitNorm"]) if (u[k] === OLD) upd[k] = NEW;
    await d.ref.update(upd);
  }
  for (const d of products.docs) await d.ref.update({ companyId: NEW });
  for (const d of meetings.docs) await d.ref.update({ companyId: NEW });
  for (const v of visits.docs) await v.ref.delete();
  await oldRef.delete();
  console.log("Listo.");
})();

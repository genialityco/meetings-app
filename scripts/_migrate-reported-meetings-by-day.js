// Pasa el conteo manual único de reuniones (companies/{nit}.reunionesReportadas) al conteo
// por día (reunionesReportadasPorDia.{día}) en el día indicado (por defecto el primer día
// del evento) y borra el campo anterior. No pisa un valor por día que ya exista.
//   node _migrate-reported-meetings-by-day.js <eventId> [YYYY-MM-DD]            # dry-run
//   node _migrate-reported-meetings-by-day.js <eventId> [YYYY-MM-DD] --apply
const admin = require("firebase-admin");
const fs = require("fs");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const apply = process.argv.includes("--apply");
const [E, dayArg] = args;

(async () => {
  if (!E) return console.log("Uso: node _migrate-reported-meetings-by-day.js <eventId> [YYYY-MM-DD] [--apply]");
  const ev = db.collection("events").doc(E);
  const e = (await ev.get()).data();
  const days = e.eventDates || e.config?.eventDates || (e.config?.eventDate ? [e.config.eventDate] : []);
  const day = dayArg || days[0];
  if (!day) throw new Error("No se pudo determinar el día");
  const docs = (await ev.collection("companies").get()).docs.filter((d) => typeof d.data().reunionesReportadas === "number");
  const backup = {};
  const ops = [];
  let total = 0;
  for (const d of docs) {
    const x = d.data();
    backup[d.ref.path] = x;
    const existing = x.reunionesReportadasPorDia?.[day];
    const upd = { reunionesReportadas: admin.firestore.FieldValue.delete() };
    if (typeof existing === "number") {
      console.log(`  ⚠ ${d.id} ya tiene ${day}=${existing}; se conserva y se descarta el anterior (${x.reunionesReportadas})`);
    } else {
      upd[`reunionesReportadasPorDia.${day}`] = x.reunionesReportadas;
      total += x.reunionesReportadas;
    }
    ops.push([d.ref, upd]);
  }
  console.log(`Día destino: ${day} | empresas a migrar: ${docs.length} | reuniones: ${total}`);
  if (!apply) return console.log("DRY-RUN (agrega --apply para escribir)");
  const file = `_migrate-reported-meetings-backup-${E}-${Date.now()}.json`;
  fs.writeFileSync(file, JSON.stringify(backup, null, 1));
  console.log(`Respaldo: ${file} (${Object.keys(backup).length} docs)`);
  for (let i = 0; i < ops.length; i += 400) {
    const b = db.batch();
    ops.slice(i, i + 400).forEach(([ref, upd]) => b.update(ref, upd));
    await b.commit();
  }
  console.log("APLICADO");
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });

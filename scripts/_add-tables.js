// Añade mesas a un evento: crea sus slots copiando los horarios existentes de la agenda
// (igual que "Añadir mesa" en EventAdmin) y actualiza config.numTables / config.tableNames
// (que "Añadir mesa" no actualiza; sin eso _sync-agenda-to-config.js borraría los slots nuevos).
// Los horarios que caen en --block (descanso por aplicar) se crean bloqueados como descanso
// (isBreak: true, available: false), igual que "Bloquear" en AgendaAdminPanel.
//   node _add-tables.js <eventId> <cantidad> [--block 13:00-14:00]            # dry-run
//   node _add-tables.js <eventId> <cantidad> [--block 13:00-14:00] --apply
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const [id, countArg] = process.argv.slice(2);
const apply = process.argv.includes("--apply");
const blockArg = process.argv.includes("--block") ? process.argv[process.argv.indexOf("--block") + 1] : null;
const toM = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const block = blockArg ? { s: toM(blockArg.split("-")[0]), e: toM(blockArg.split("-")[1]) } : null;
(async () => {
  const count = parseInt(countArg, 10);
  if (!id || !(count > 0)) return console.log("Uso: node _add-tables.js <eventId> <cantidad> [--block HH:MM-HH:MM] [--apply]");
  const ref = db.collection("events").doc(id);
  const c = (await ref.get()).data().config;
  const snap = await ref.collection("agenda").get();
  const slots = snap.docs.map((d) => d.data());
  const maxTable = Math.max(c.numTables || 0, ...slots.map((s) => Number(s.tableNumber) || 0));
  const newTables = Array.from({ length: count }, (_, i) => maxTable + 1 + i);

  const times = new Map();
  slots.forEach((s) => { if (s.startTime && s.endTime) times.set(`${s.date || ""}_${s.startTime}_${s.endTime}`, s); });
  const create = [];
  for (const t of newTables) for (const s of times.values()) {
    const inBlock = block && toM(s.startTime) < block.e && toM(s.endTime) > block.s;
    const slot = { tableNumber: t, startTime: s.startTime, endTime: s.endTime, available: !inBlock };
    if (s.date) slot.date = s.date;
    if (inBlock) { slot.isBreak = true; slot.meetingId = null; }
    create.push(slot);
  }
  const numTables = maxTable + count;
  const tableNames = Array.from({ length: numTables }, (_, i) => (c.tableNames || [])[i] || `Mesa ${i + 1}`);

  const per = create.reduce((o, s) => { const k = `${s.date} ${s.available ? "libres" : "descanso"}`; o[k] = (o[k] || 0) + 1; return o; }, {});
  console.log(`numTables: ${c.numTables} -> ${numTables} | mesas nuevas: ${newTables.join(", ")} | horarios únicos: ${times.size}`);
  console.log(`slots a crear: ${create.length}`, per);
  console.log("tableNames nuevos:", tableNames.slice(maxTable));
  if (!apply) return console.log("DRY-RUN (agrega --apply para escribir)");

  for (let i = 0; i < create.length; i += 400) {
    const b = db.batch();
    create.slice(i, i + 400).forEach((s) => b.set(ref.collection("agenda").doc(), s));
    await b.commit();
  }
  await ref.update({ "config.numTables": numTables, "config.tableNames": tableNames });
  console.log("APLICADO");
})();

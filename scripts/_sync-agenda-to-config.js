// Alinea events/{id}/agenda con event.config.dailyConfig (misma lógica que generateAgendaForEvent).
// Crea slots faltantes; elimina slots fuera de horario SOLO si están libres (sin meetingId).
//   node _sync-agenda-to-config.js <eventId>            # dry-run
//   node _sync-agenda-to-config.js <eventId> --apply
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const id = process.argv[2], apply = process.argv.includes("--apply");
const toM = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const toT = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
(async () => {
  const ref = db.collection("events").doc(id);
  const c = (await ref.get()).data().config;
  const block = c.meetingDuration + c.breakTime;
  const desired = new Map();
  for (const [date, d] of Object.entries(c.dailyConfig)) {
    const brs = (d.breakBlocks || []).filter((b) => b.start && b.end).map((b) => ({ s: toM(b.start), e: toM(b.end) })).sort((a, b) => a.s - b.s);
    const segs = []; let s0 = toM(d.startTime); const end = toM(d.endTime);
    for (const b of brs) { if (b.s > s0) segs.push([s0, b.s]); s0 = b.e; }
    if (s0 < end) segs.push([s0, end]);
    for (const [a, z] of segs) for (let i = 0; i < Math.floor((z - a) / block); i++) {
      const st = a + i * block;
      for (let t = 1; t <= c.numTables; t++) desired.set(`${date}_${t}_${toT(st)}`, { date, tableNumber: t, startTime: toT(st), endTime: toT(st + c.meetingDuration), available: true });
    }
  }
  const snap = await ref.collection("agenda").get();
  const have = new Set(); const del = []; const keepOut = [];
  snap.forEach((d) => {
    const s = d.data(); const k = `${s.date}_${s.tableNumber}_${s.startTime}`;
    if (desired.has(k)) { have.add(k); return; }
    if (s.meetingId || s.available === false) keepOut.push({ id: d.id, ...s }); else del.push(d.ref);
  });
  const create = [...desired.entries()].filter(([k]) => !have.has(k)).map(([, v]) => v);
  const per = (arr, f) => arr.reduce((o, x) => { const k = f(x); o[k] = (o[k] || 0) + 1; return o; }, {});
  console.log("deseados:", desired.size, "| existentes que coinciden:", have.size);
  console.log("a crear:", create.length, per(create, (s) => s.date + " " + s.startTime));
  console.log("a eliminar (libres, fuera de horario):", del.length);
  console.log("fuera de horario pero OCUPADOS (no se tocan):", keepOut);
  if (!apply) return console.log("DRY-RUN");
  const ops = [...create.map((s) => ({ t: "c", s })), ...del.map((r) => ({ t: "d", r }))];
  for (let i = 0; i < ops.length; i += 400) {
    const b = db.batch();
    ops.slice(i, i + 400).forEach((o) => o.t === "c" ? b.set(ref.collection("agenda").doc(), o.s) : b.delete(o.r));
    await b.commit();
  }
  console.log("APLICADO");
})();

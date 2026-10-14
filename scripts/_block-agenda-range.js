// Bloquea como descanso (isBreak: true, available: false — igual que "Bloquear" en
// AgendaAdminPanel) los slots LIBRES de la agenda que se cruzan con un rango horario.
// No toca slots con reunión. Con --unblock hace lo inverso (solo slots isBreak sin reunión).
//   node _block-agenda-range.js <eventId> <HH:MM-HH:MM> [--dates 2026-10-14,2026-10-15]            # dry-run
//   node _block-agenda-range.js <eventId> <HH:MM-HH:MM> [--dates ...] [--unblock] --apply
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const [E, range] = process.argv.slice(2);
const apply = process.argv.includes("--apply");
const unblock = process.argv.includes("--unblock");
const datesArg = process.argv.includes("--dates") ? process.argv[process.argv.indexOf("--dates") + 1].split(",") : null;
const toM = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
(async () => {
  if (!E || !/^\d\d:\d\d-\d\d:\d\d$/.test(range || "")) return console.log("Uso: node _block-agenda-range.js <eventId> <HH:MM-HH:MM> [--dates a,b] [--unblock] [--apply]");
  const [rs, re] = range.split("-").map(toM);
  const ag = await db.collection("events").doc(E).collection("agenda").get();
  const inRange = ag.docs.filter((d) => { const s = d.data(); return (!datesArg || datesArg.includes(s.date)) && toM(s.startTime) < re && toM(s.endTime) > rs; });
  const target = inRange.filter((d) => { const s = d.data(); return unblock ? s.isBreak === true && !s.meetingId : s.available === true && !s.isBreak && !s.meetingId; });
  const summary = {};
  inRange.forEach((d) => { const s = d.data(); const k = `${s.date} ${s.startTime}`; summary[k] ||= { libres: 0, ocupados: 0, descanso: 0, aCambiar: 0 };
    s.isBreak ? summary[k].descanso++ : s.meetingId || s.available === false ? summary[k].ocupados++ : summary[k].libres++; });
  target.forEach((d) => summary[`${d.data().date} ${d.data().startTime}`].aCambiar++);
  console.log(`${unblock ? "DESBLOQUEAR" : "BLOQUEAR"} ${range}${datesArg ? " en " + datesArg.join(",") : " (todos los días)"}`);
  Object.keys(summary).sort().forEach((k) => console.log(" ", k, JSON.stringify(summary[k])));
  console.log(`Slots a ${unblock ? "desbloquear" : "bloquear"}: ${target.length}`);
  if (!apply) return console.log("DRY-RUN (agrega --apply para escribir)");
  let done = 0, skipped = 0;
  for (const d of target) {
    await db.runTransaction(async (tx) => {
      const s = (await tx.get(d.ref)).data();
      const ok = unblock ? s.isBreak === true && !s.meetingId : s.available === true && !s.isBreak && !s.meetingId;
      if (!ok) { skipped++; return; }
      tx.update(d.ref, unblock ? { isBreak: false, available: true } : { isBreak: true, available: false, meetingId: null });
      done++;
    });
  }
  console.log(`APLICADO: ${done} ${unblock ? "desbloqueados" : "bloqueados"}${skipped ? `, ${skipped} omitidos (cambiaron entretanto)` : ""}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

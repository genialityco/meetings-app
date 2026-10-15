// Pasa todas las reuniones de una cuenta duplicada (FROM) a la cuenta que se conserva (TO):
// requesterId/receiverId/participants y sus locks (cuyo id lleva el uid). Opcionalmente
// reagenda reuniones (p. ej. las que chocarían con las de TO) a otro slot libre.
// Se niega a aplicar si TO quedaría con dos reuniones aceptadas a la misma hora.
// Guarda respaldo JSON antes de escribir. Después se puede borrar FROM con _delete-duplicate-users.js.
//   node _move-user-meetings.js <eventId> <FROM> <TO> [--move <meetingId>=<YYYY-MM-DD>@<HH:MM>[@mesa]] [--apply]
const admin = require("firebase-admin");
const fs = require("fs");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const moves = {};
args.forEach((a, i) => {
  if (a === "--move") {
    const [id, spec] = args[i + 1].split("=");
    const [date, time, table] = spec.split("@");
    moves[id] = { date, time, table: table || null };
  }
});
const [E, FROM, TO] = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--move");
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const lockId = (uid, date, start, end) => `${E}_${uid}_${String(date).replace(/-/g, "")}_${start}-${end}`;

(async () => {
  if (!E || !FROM || !TO) return console.log("Uso: node _move-user-meetings.js <eventId> <FROM> <TO> [--move id=fecha@HH:MM[@mesa]] [--apply]");
  const ev = db.collection("events").doc(E);
  const [from, to] = await Promise.all([db.collection("users").doc(FROM).get(), db.collection("users").doc(TO).get()]);
  if (!from.exists || !to.exists || from.data().eventId !== E || to.data().eventId !== E) throw new Error("Cuentas inexistentes o de otro evento");
  console.log(`${FROM} (${from.data().nombre}) -> ${TO} (${to.data().nombre})`);
  const all = (await ev.collection("meetings").get()).docs;
  const mine = all.filter((d) => { const m = d.data(); return m.requesterId === FROM || m.receiverId === FROM || (m.participants || []).includes(FROM); });
  const agenda = (await ev.collection("agenda").get()).docs;
  const backup = {};
  const ops = [];
  const finalSlots = []; // horarios aceptados de TO al terminar, para detectar cruces

  all.forEach((d) => { const m = d.data(); if (m.status === "accepted" && m.timeSlot && !mine.includes(d) && (m.participants || []).includes(TO)) finalSlots.push({ date: m.meetingDate, ts: m.timeSlot, id: d.id }); });

  for (const d of mine) {
    const m = d.data();
    backup[d.ref.path] = m;
    const swap = (v) => (v === FROM ? TO : v);
    const upd = { requesterId: swap(m.requesterId), receiverId: swap(m.receiverId), updatedAt: new Date() };
    if (m.participants) upd.participants = m.participants.map(swap);
    const oldLocks = m.lockIds || [];
    let newLocks = oldLocks.map((l) => l.replace(`_${FROM}_`, `_${TO}_`));
    const mv = moves[d.id];
    let label = `${m.status} ${m.meetingDate || ""} ${m.timeSlot || ""}`;

    if (mv) {
      const [s, e] = [mv.time, null];
      const cands = agenda.filter((a) => { const x = a.data(); return x.date === mv.date && x.startTime === s && x.available === true && !x.isBreak && !x.meetingId; });
      const slot = cands.find((a) => mv.table && String(a.data().tableNumber) === String(mv.table)) ||
        cands.find((a) => String(a.data().tableNumber) === String(m.tableAssigned)) || cands[0];
      if (!slot) throw new Error(`No hay slot libre ${mv.date} ${s} para ${d.id}`);
      const sd = slot.data();
      const others = (upd.participants || [upd.requesterId, upd.receiverId]);
      newLocks = others.map((u) => lockId(u, sd.date, sd.startTime, sd.endTime));
      Object.assign(upd, {
        meetingDate: sd.date, timeSlot: `${sd.startTime} - ${sd.endTime}`, tableAssigned: String(sd.tableNumber),
        startMinutes: toMin(sd.startTime), endMinutes: toMin(sd.endTime), slotId: slot.id, lockIds: newLocks,
      });
      backup[slot.ref.path] = sd;
      ops.push({ t: "update", ref: slot.ref, data: { available: false, meetingId: d.id }, check: slot.ref });
      if (m.slotId) {
        const old = agenda.find((a) => a.id === m.slotId);
        if (old && old.data().meetingId === d.id) { backup[old.ref.path] = old.data(); ops.push({ t: "update", ref: old.ref, data: { available: true, meetingId: null } }); }
      }
      // locks: borra los viejos y crea los nuevos (uno por participante)
      for (const l of oldLocks) { const r = db.collection("locks").doc(l); const s0 = await r.get(); if (s0.exists) { backup[r.path] = s0.data(); ops.push({ t: "delete", ref: r }); } }
      others.forEach((u, i) => ops.push({ t: "set", ref: db.collection("locks").doc(newLocks[i]), data: { eventId: E, userId: u, meetingId: d.id, date: sd.date, start: sd.startTime, end: sd.endTime, createdAt: new Date() } }));
      label += `  =>  REAGENDADA ${sd.date} ${sd.startTime}-${sd.endTime} mesa ${sd.tableNumber}`;
    } else {
      if (oldLocks.length) upd.lockIds = newLocks;
      for (const l of oldLocks.filter((x) => x.includes(`_${FROM}_`))) {
        const r = db.collection("locks").doc(l); const s0 = await r.get();
        if (s0.exists) { backup[r.path] = s0.data(); ops.push({ t: "delete", ref: r }); ops.push({ t: "set", ref: db.collection("locks").doc(l.replace(`_${FROM}_`, `_${TO}_`)), data: { ...s0.data(), userId: TO } }); }
      }
    }
    ops.unshift({ t: "update", ref: d.ref, data: upd });
    if (m.status === "accepted" && (upd.timeSlot || m.timeSlot)) finalSlots.push({ date: upd.meetingDate || m.meetingDate, ts: upd.timeSlot || m.timeSlot, id: d.id });
    console.log(`  · ${d.id} ${label}`);
  }

  const seen = {}; const clashes = [];
  finalSlots.forEach((s) => { const k = `${s.date} ${s.ts.split(" - ")[0]}`; if (seen[k]) clashes.push(`${k} (${seen[k]} / ${s.id})`); else seen[k] = s.id; });
  console.log(clashes.length ? `✘ CRUCES para ${TO}: ${clashes.join(", ")}` : `Sin cruces de horario para ${TO}`);
  console.log(`Operaciones: ${ops.length}`);
  if (!apply) return console.log("DRY-RUN (agrega --apply para escribir)");
  if (clashes.length) return console.log("No se aplica: resuelve los cruces con --move.");
  for (const op of ops.filter((o) => o.check)) { const s = (await op.check.get()).data(); if (s.available !== true || s.meetingId) throw new Error(`El slot ${op.check.id} se ocupó entretanto; vuelve a correr`); }
  const file = `_move-user-meetings-backup-${E}-${Date.now()}.json`;
  fs.writeFileSync(file, JSON.stringify(backup, null, 1));
  console.log(`Respaldo: ${file} (${Object.keys(backup).length} docs)`);
  const b = db.batch();
  ops.forEach((o) => (o.t === "delete" ? b.delete(o.ref) : o.t === "set" ? b.set(o.ref, o.data) : b.update(o.ref, o.data)));
  await b.commit();
  console.log("APLICADO");
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });

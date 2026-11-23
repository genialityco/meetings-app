// Marca como realizadas (completed: true) las reuniones aceptadas del evento Encuentros Empresariales
// en las que AMBOS participantes tienen check-in el día de la reunión y que no tienen reporte previo
// (completed sin definir). No toca las marcadas como realizadas ni como no realizadas.
// Deja rastro: confirmedByCheckIn: true, confirmedAt.
//   node _marcar-realizadas-checkin-ee.js            # dry-run
//   node _marcar-realizadas-checkin-ee.js --apply
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const apply = process.argv.includes("--apply");
const E = "ihIlXCreXToidw1wsI9a";

(async () => {
  const ev = (await db.doc("events/" + E).get()).data();
  const DAYS = ev.config.eventDates;
  const users = Object.fromEntries((await db.collection("users").where("eventId", "==", E).get()).docs.map((d) => [d.id, d.data()]));
  const checkedIn = (uid, day) => !!(users[uid]?.checkIns || {})[day];

  const snap = await db.collection(`events/${E}/meetings`).where("status", "==", "accepted").get();
  const target = [];
  const stats = { aceptadas: snap.size, yaRealizada: 0, noRealizada: 0, sinReporte: 0, sinCheckinAmbos: 0 };
  snap.forEach((d) => {
    const m = d.data();
    if (!DAYS.includes(m.meetingDate)) return;
    if (m.completed === true) return void stats.yaRealizada++;
    if (m.completed === false) return void stats.noRealizada++;
    stats.sinReporte++;
    if (!checkedIn(m.requesterId, m.meetingDate) || !checkedIn(m.receiverId, m.meetingDate)) return void stats.sinCheckinAmbos++;
    target.push(d);
  });

  const byDay = {};
  target.forEach((d) => {
    const m = d.data();
    byDay[m.meetingDate] = (byDay[m.meetingDate] || 0) + 1;
    const name = (uid) => `${users[uid]?.nombre || uid} (${users[uid]?.company_razonSocial || users[uid]?.empresa || "-"})`.replace(/\s+/g, " ");
    console.log(`${m.meetingDate} ${m.timeSlot || ""} mesa ${m.tableAssigned || "-"} · ${name(m.requesterId)} ↔ ${name(m.receiverId)}`);
  });
  console.log("\n", stats);
  console.log(`A marcar como realizadas por check-in: ${target.length}`, byDay);
  if (!apply) return console.log("DRY-RUN: no se escribió nada. Usa --apply.");

  const now = admin.firestore.Timestamp.now();
  for (let i = 0; i < target.length; i += 400) {
    const batch = db.batch();
    target.slice(i, i + 400).forEach((d) => batch.update(d.ref, { completed: true, confirmedByCheckIn: true, confirmedAt: now }));
    await batch.commit();
  }
  console.log("Aplicado.");
})();

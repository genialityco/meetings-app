// Llena el conteo manual de reuniones por empresa (CompanyMeetingCountPage) con las reuniones
// PROBABLES de la plataforma, SOLO para empresas expositoras y SOLO en días sin conteo manual
// (o que ya habían sido llenados por este script). No toca lo que anotó el equipo.
// Probable = aceptada ese día y (marcada como realizada, o con check-in de ambos participantes
// ese día y no marcada como no realizada). Marca reunionesReportadasFuente.{día} = "plataforma".
// Si el valor probable es 0, borra el campo de ese día (vuelve a "Sin conteo").
//   node _conteo-expositores-plataforma.js            # dry-run
//   node _conteo-expositores-plataforma.js --apply
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const { FieldValue } = admin.firestore;
const apply = process.argv.includes("--apply");
const E = "ihIlXCreXToidw1wsI9a";
const role = (r) => String(r || "").trim().toLowerCase();

(async () => {
  const ev = (await db.doc("events/" + E).get()).data();
  const DAYS = ev.config.eventDates;
  const users = (await db.collection("users").where("eventId", "==", E).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const U = Object.fromEntries(users.map((u) => [u.id, u]));
  const expo = new Set(users.filter((u) => role(u.tipoAsistente) === "vendedor" && u.companyId).map((u) => u.companyId));
  const checkedIn = (id, day) => !!(U[id]?.checkIns || {})[day];

  // Reuniones probables por empresa expositora y día (una reunión cuenta una vez por empresa)
  const prob = {};
  const ms = await db.collection(`events/${E}/meetings`).where("status", "==", "accepted").get();
  ms.forEach((d) => {
    const m = d.data(), day = m.meetingDate;
    if (!DAYS.includes(day)) return;
    const ok = m.completed === true || (m.completed !== false && checkedIn(m.requesterId, day) && checkedIn(m.receiverId, day));
    if (!ok) return;
    new Set([U[m.requesterId]?.companyId, U[m.receiverId]?.companyId].filter(Boolean)).forEach((c) => {
      if (expo.has(c)) ((prob[c] ||= {})[day] = (prob[c][day] || 0) + 1);
    });
  });

  const writes = [];
  const tot = Object.fromEntries(DAYS.map((d) => [d, { antes: 0, ahora: 0 }]));
  for (const nit of expo) {
    const ref = db.doc(`events/${E}/companies/${nit}`);
    const snap = await ref.get();
    if (!snap.exists) { console.log("SIN DOC empresa", nit); continue; }
    const c = snap.data();
    const man = c.reunionesReportadasPorDia || {}, src = c.reunionesReportadasFuente || {};
    const legacy = typeof c.reunionesReportadas === "number";
    const upd = {}, desc = [];
    DAYS.forEach((day, i) => {
      const nuestro = src[day] === "plataforma";
      const manual = !nuestro && (typeof man[day] === "number" || (i === 0 && legacy));
      if (manual) return;
      const actual = typeof man[day] === "number" ? man[day] : null;
      const n = prob[nit]?.[day] || 0;
      tot[day].antes += actual || 0; tot[day].ahora += n;
      if (n === actual || (n === 0 && actual === null)) return;
      if (n > 0) {
        upd[`reunionesReportadasPorDia.${day}`] = n;
        upd[`reunionesReportadasFuente.${day}`] = "plataforma";
      } else {
        upd[`reunionesReportadasPorDia.${day}`] = FieldValue.delete();
        upd[`reunionesReportadasFuente.${day}`] = FieldValue.delete();
      }
      desc.push(`${day.slice(5)}: ${actual ?? "—"} → ${n || "—"}`);
    });
    if (desc.length) {
      upd.reunionesReportadasAt = FieldValue.serverTimestamp();
      writes.push([ref, upd]);
      console.log(`${(c.razonSocial || nit).trim().slice(0, 45).padEnd(45)} ${desc.join("   ")}`);
    }
  }
  console.log(`\nEmpresas a actualizar: ${writes.length} · días llenados desde plataforma: ${DAYS.map((d) => `${d} ${tot[d].antes} → ${tot[d].ahora}`).join(", ")}`);
  if (!apply) return console.log("DRY-RUN: no se escribió nada. Usa --apply.");
  const batch = db.batch();
  writes.forEach(([ref, u]) => batch.update(ref, u));
  await batch.commit();
  console.log("Aplicado.");
})();

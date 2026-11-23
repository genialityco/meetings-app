// Elimina a Felipe Lasso (juan.lasso@geniality.com.co) del evento Encuentros Empresariales con su
// empresa de prueba, y las solicitudes pendientes dirigidas a la empresa ya borrada 91234567.
//   node _delete-test-user3-ee.js [--apply]
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const apply = process.argv.includes("--apply");
const E = "ihIlXCreXToidw1wsI9a", U = "Kya90vZBRDeOoewY0UTukZG6COP2";
const docId = admin.firestore.FieldPath.documentId();
(async () => {
  const ev = db.doc("events/" + E);
  const ops = new Map();
  const add = (label, ref, upd = null) => ops.set(ref.path, [label, ref, upd]);
  const user = await db.doc("users/" + U).get();
  if (!user.exists || user.data().eventId !== E) throw new Error("usuario no es del evento");
  const companyId = user.data().companyId;
  const mids = new Set();
  const addMeeting = (d) => { mids.add(d.id); add(`del meeting ${d.id} (${d.data().status})`, d.ref); };
  for (const f of ["requesterId", "receiverId"]) (await ev.collection("meetings").where(f, "==", U).get()).forEach(addMeeting);
  for (const c of [companyId, "91234567"]) (await ev.collection("meetings").where("companyId", "==", c).get()).forEach(addMeeting);
  (await db.collection("notifications").where("userId", "==", U).get()).forEach((d) => add("del notification " + d.id, d.ref));
  (await db.collection("locks").where(docId, ">=", `${E}_${U}`).where(docId, "<", `${E}_${U}~`).get()).forEach((d) => add("del lock " + d.id, d.ref));
  for (const m of mids) (await ev.collection("agenda").where("meetingId", "==", m).get()).forEach((d) => {
    const s = d.data(); add(`free slot ${s.date} ${s.startTime} mesa ${s.tableNumber}`, d.ref, { available: true, meetingId: null });
  });
  add(`del user ${U} (${user.data().nombre})`, user.ref);
  const reps = await db.collection("users").where("eventId", "==", E).where("companyId", "==", companyId).get();
  if (reps.docs.every((d) => d.id === U)) {
    (await ev.collection(`companies/${companyId}/visits`).get()).forEach((d) => add("del visit " + d.id, d.ref));
    add("del company " + companyId, ev.collection("companies").doc(companyId));
  } else console.log(`empresa ${companyId} tiene otros reps, no se borra`);
  for (const [label] of ops.values()) console.log(label);
  if (!apply) return console.log("DRY-RUN —", ops.size, "ops");
  const b = db.batch();
  for (const [, ref, upd] of ops.values()) upd ? b.update(ref, upd) : b.delete(ref);
  await b.commit();
  console.log("APLICADO —", ops.size, "ops");
})();

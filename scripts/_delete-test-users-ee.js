// Elimina los usuarios de prueba Felipe lasso (pipe081970@hotmail.com) y Juan Mosquera
// (lassojuanfe@gmail.com) del evento Encuentros Empresariales, con sus reuniones,
// notificaciones, locks y empresas de prueba; libera los slots de agenda que ocupaban.
//   node _delete-test-users-ee.js            # dry-run
//   node _delete-test-users-ee.js --apply
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const apply = process.argv.includes("--apply");
const E = "ihIlXCreXToidw1wsI9a";
const U = ["5kkyGbSGtOUV8Oo1j9kTZ5SkIoX2", "Jwn7jfZA93MJxtLPAnSfSEdbdq02"];
const C = ["312312312", "91234567"]; // Geniality Asistente / Geniality Expositor (sin otros reps)
const docId = admin.firestore.FieldPath.documentId();

(async () => {
  const ev = db.doc("events/" + E);
  const ops = new Map(); // path -> [label, ref, update|null]
  const add = (label, ref, upd = null) => ops.set(ref.path, [label, ref, upd]);
  const mids = new Set();

  for (const u of U) {
    const user = await db.doc("users/" + u).get();
    if (!user.exists || user.data().eventId !== E) throw new Error(`usuario ${u} no existe o no es de ${E}`);
    for (const f of ["requesterId", "receiverId"])
      (await ev.collection("meetings").where(f, "==", u).get()).forEach((d) => {
        mids.add(d.id);
        add(`del meeting ${d.id} (${d.data().status})`, d.ref);
      });
    (await db.collection("notifications").where("userId", "==", u).get()).forEach((d) => add("del notification " + d.id, d.ref));
    (await db.collection("locks").where(docId, ">=", `${E}_${u}`).where(docId, "<", `${E}_${u}~`).get())
      .forEach((d) => add("del lock " + d.id, d.ref));
    add(`del user ${u} (${user.data().nombre})`, user.ref);
  }
  for (const m of mids)
    (await ev.collection("agenda").where("meetingId", "==", m).get()).forEach((d) => {
      const s = d.data();
      add(`free slot ${s.date} ${s.startTime} mesa ${s.tableNumber}`, d.ref, { available: true, meetingId: null });
    });
  for (const c of C) {
    const reps = await db.collection("users").where("eventId", "==", E).where("companyId", "==", c).get();
    const otros = reps.docs.filter((d) => !U.includes(d.id));
    if (otros.length) { console.log(`empresa ${c} tiene otros reps, no se borra`); continue; }
    (await ev.collection(`companies/${c}/visits`).get()).forEach((d) => add("del visit " + d.id, d.ref));
    add("del company " + c, ev.collection("companies").doc(c));
  }

  for (const [label] of ops.values()) console.log(label);
  if (!apply) return console.log("DRY-RUN —", ops.size, "ops");
  const b = db.batch();
  for (const [, ref, upd] of ops.values()) upd ? b.update(ref, upd) : b.delete(ref);
  await b.commit();
  console.log("APLICADO —", ops.size, "ops");
})();

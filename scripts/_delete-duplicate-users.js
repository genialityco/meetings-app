// Borra cuentas de asistente duplicadas (la persona ya tiene otra cuenta en el evento).
// Se niega a borrar una cuenta que participe en cualquier reunión (cualquier estado).
// Borra también lo que cuelga de la cuenta: users/{uid}/* (affinityScores, blockedSlots...),
// los affinityScores de los demás usuarios del evento que la apuntan, sus notificaciones,
// locks, pendingReminders/{uid} y visitas a stand. Guarda respaldo JSON antes de escribir.
//   node _delete-duplicate-users.js <eventId> <uid> [<uid> ...]            # dry-run
//   node _delete-duplicate-users.js <eventId> <uid> [<uid> ...] --apply
const admin = require("firebase-admin");
const fs = require("fs");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const [E, ...uids] = args.filter((a) => !a.startsWith("--"));

(async () => {
  if (!E || !uids.length) return console.log("Uso: node _delete-duplicate-users.js <eventId> <uid> [...] [--apply]");
  const ev = db.collection("events").doc(E);
  const [meetings, eventUsers, companies] = await Promise.all([
    ev.collection("meetings").get(),
    db.collection("users").where("eventId", "==", E).get(),
    ev.collection("companies").get(),
  ]);
  const backup = {};
  const refs = [];
  let blocked = false;

  for (const uid of uids) {
    const userRef = db.collection("users").doc(uid);
    const u = await userRef.get();
    if (!u.exists) { console.log(`✘ ${uid}: no existe, se omite`); continue; }
    if (u.data().eventId !== E) { console.log(`✘ ${uid}: es de otro evento, se omite`); blocked = true; continue; }
    const inMeetings = meetings.docs.filter((d) => {
      const m = d.data();
      return m.requesterId === uid || m.receiverId === uid || (m.participants || []).includes(uid);
    });
    if (inMeetings.length) {
      console.log(`✘ ${uid} (${u.data().nombre}): participa en ${inMeetings.length} reuniones, NO se borra`);
      blocked = true;
      continue;
    }
    const mine = [userRef];
    for (const sub of await userRef.listCollections()) (await sub.get()).docs.forEach((d) => mine.push(d.ref));
    const othersAff = (
      await db.getAll(...eventUsers.docs.filter((d) => d.id !== uid).map((d) => d.ref.collection("affinityScores").doc(uid)))
    ).filter((d) => d.exists).map((d) => d.ref);
    const notifs = (await db.collection("notifications").where("userId", "==", uid).get()).docs.map((d) => d.ref);
    const locks = (await db.collection("locks").where("userId", "==", uid).get()).docs.map((d) => d.ref);
    const pr = ev.collection("pendingReminders").doc(uid);
    const extra = (await pr.get()).exists ? [pr] : [];
    const visits = (
      await db.getAll(...companies.docs.map((c) => c.ref.collection("visits").doc(uid)))
    ).filter((d) => d.exists).map((d) => d.ref);
    const all = [...mine, ...othersAff, ...notifs, ...locks, ...extra, ...visits];
    console.log(
      `· ${uid} (${u.data().nombre?.trim()}, ${u.data().correo}): doc + ${mine.length - 1} subdocs, ` +
        `${othersAff.length} affinity de otros, ${notifs.length} notificaciones, ${locks.length} locks, ` +
        `${extra.length} pendingReminders, ${visits.length} visitas`,
    );
    refs.push(...all);
  }

  console.log(`\nDocumentos a borrar: ${refs.length}`);
  if (!apply) return console.log("DRY-RUN (agrega --apply para escribir)");
  if (blocked) return console.log("Hay cuentas bloqueadas o fuera del evento: corrige la lista antes de aplicar.");
  const snaps = [];
  for (let i = 0; i < refs.length; i += 300) snaps.push(...(await db.getAll(...refs.slice(i, i + 300))));
  snaps.forEach((s) => { if (s.exists) backup[s.ref.path] = s.data(); });
  const file = `_delete-duplicate-users-backup-${E}-${Date.now()}.json`;
  fs.writeFileSync(file, JSON.stringify(backup, null, 1));
  console.log(`Respaldo: ${file} (${Object.keys(backup).length} docs)`);
  for (let i = 0; i < refs.length; i += 400) {
    const b = db.batch();
    refs.slice(i, i + 400).forEach((r) => b.delete(r));
    await b.commit();
  }
  console.log("APLICADO");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

// Uso: node scripts/_dedupe_pending_requests.js [--apply]
// Aplica retroactivamente las reglas de assertMeetingRequestAllowed (meetingSlotEngine.ts):
//  1. Elimina solicitudes pendientes a la propia empresa (o a uno mismo).
//  2. Por cada solicitante+empresa con varias pendientes, conserva una (la más antigua con
//     mensaje propio; si ninguna tiene, la más antigua) y elimina las demás.
// También elimina las notificaciones "Nueva solicitud de reunión" de las solicitudes borradas.
// Las notificaciones no guardan el id de la reunión: se emparejan por destinatario, nombre
// del solicitante y hora (±20s), asignando cada notificación a la reunión más cercana para
// no borrar la de la solicitud que se conserva.
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const APPLY = process.argv.includes("--apply");
const E = "ihIlXCreXToidw1wsI9a";
const WINDOW_MS = 20000;

const norm = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const ms = (t) => (t?.toDate ? t.toDate().getTime() : new Date(t).getTime());
const isAutoNote = (n) => !n || /^Reunión (desde vista de empresa|con empresa):/i.test(n);

(async () => {
  const users = Object.fromEntries((await db.collection("users").where("eventId", "==", E).get()).docs.map((d) => [d.id, d.data()]));
  const ev = db.collection("events").doc(E);
  const pending = (await ev.collection("meetings").where("status", "==", "pending").get()).docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
  const agendaMeetingIds = new Set((await ev.collection("agenda").get()).docs.map((d) => d.data().meetingId).filter(Boolean));

  const targetOf = (m) => norm(m.companyId) || norm(users[m.receiverId]?.companyId);
  const toDelete = []; // { m, reason }

  // 1. A la propia empresa
  for (const m of pending) {
    const t = targetOf(m);
    const mine = norm(users[m.requesterId]?.companyId);
    if (m.receiverId === m.requesterId || (t && mine && t === mine)) toDelete.push({ m, reason: "a su propia empresa" });
  }
  const deletedIds = new Set(toDelete.map((x) => x.m.id));

  // 2. Duplicados solicitante+empresa
  const groups = {};
  for (const m of pending) {
    if (deletedIds.has(m.id)) continue;
    const t = targetOf(m);
    if (!t) continue;
    (groups[`${m.requesterId}|${t}`] ||= []).push(m);
  }
  const keepByGroup = [];
  for (const g of Object.values(groups)) {
    if (g.length < 2) continue;
    g.sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
    const keep = g.find((m) => !isAutoNote(m.contextNote)) || g[0];
    keepByGroup.push({ keep, group: g });
    g.filter((m) => m !== keep).forEach((m) => toDelete.push({ m, reason: `duplicada (se conserva ${keep.id})` }));
  }

  for (const { m } of toDelete) {
    if (agendaMeetingIds.has(m.id)) { console.log("ABORTA: la reunión tiene slot de agenda", m.id); process.exit(1); }
  }

  // Notificaciones: candidatas por solicitante (mensaje empieza con su nombre)
  const involved = [...new Set(toDelete.map((x) => x.m.requesterId))];
  const notifOps = [];
  for (const requesterId of involved) {
    const name = String(users[requesterId]?.nombre || "").trim();
    if (!name) continue;
    // Todas las reuniones pendientes de este solicitante (borradas y conservadas) compiten por las notificaciones
    const meetingsOfReq = pending.filter((m) => m.requesterId === requesterId);
    const recipientsOf = (m) => {
      if (m.receiverId) return [m.receiverId];
      const t = targetOf(m);
      return Object.entries(users).filter(([, u]) => norm(u.companyId) === t).map(([id]) => id);
    };
    const allRecipients = [...new Set(meetingsOfReq.flatMap(recipientsOf))];
    for (const recipient of allRecipients) {
      const snap = await db.collection("notifications").where("userId", "==", recipient).get();
      const cands = snap.docs
        .map((d) => ({ ref: d.ref, id: d.id, ...d.data() }))
        .filter((n) => n.type === "meeting_request" && String(n.message || "").startsWith(name));
      const used = new Set();
      const ms4 = meetingsOfReq.filter((m) => recipientsOf(m).includes(recipient)).sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
      for (const m of ms4) {
        let best = null;
        for (const n of cands) {
          if (used.has(n.id)) continue;
          const dt = Math.abs(ms(n.timestamp) - ms(m.createdAt));
          if (dt > WINDOW_MS) continue;
          // Si la reunión tiene mensaje propio, la notificación debe contenerlo
          if (m.contextNote && !isAutoNote(m.contextNote) && !String(n.message).includes(m.contextNote)) continue;
          if (!best || dt < best.dt) best = { n, dt };
        }
        if (!best) continue;
        used.add(best.n.id);
        if (toDelete.some((x) => x.m.id === m.id)) notifOps.push({ n: best.n, meetingId: m.id, recipient });
      }
    }
  }

  // Reporte
  const label = (m) => `${users[m.requesterId]?.nombre?.trim()} -> ${m.receiverId ? users[m.receiverId]?.nombre?.trim() : "(empresa)"} [${users[m.receiverId]?.empresa || m.companyId}] ${new Date(ms(m.createdAt)).toISOString()} "${(m.contextNote || "").slice(0, 40)}"`;
  console.log("SE CONSERVAN:");
  keepByGroup.forEach(({ keep, group }) => console.log(`  ${keep.id} ${label(keep)}  (grupo de ${group.length})`));
  console.log(`\nSOLICITUDES A ELIMINAR (${toDelete.length}):`);
  toDelete.forEach(({ m, reason }) => console.log(`  ${m.id} ${label(m)} — ${reason}`));
  console.log(`\nNOTIFICACIONES A ELIMINAR (${notifOps.length}):`);
  notifOps.forEach(({ n, meetingId, recipient }) => console.log(`  ${n.id} -> ${users[recipient]?.nombre?.trim()} (reunión ${meetingId}): ${String(n.message).split("\n")[0]}`));

  if (!APPLY) { console.log("\nDRY RUN. Usa --apply para ejecutar."); process.exit(0); }

  const backup = { meetings: {}, notifications: {} };
  toDelete.forEach(({ m }) => { const { ref, ...data } = m; backup.meetings[m.id] = data; });
  notifOps.forEach(({ n }) => { const { ref, ...data } = n; backup.notifications[n.id] = data; });
  require("fs").writeFileSync(process.argv[process.argv.indexOf("--apply") + 1] || "backup_dedupe.json", JSON.stringify(backup, null, 1));
  for (const { n } of notifOps) await n.ref.delete();
  for (const { m } of toDelete) await m.ref.delete();
  console.log("\nAplicado.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

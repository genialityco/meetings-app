// Uso: node scripts/_merge_generic_reps.js [--apply]
// Elimina los representantes genéricos (rep_<nit>, "Asistente", correo rueda...@geniality.com.co) de las
// empresas que ya tienen a su contacto real registrado, y pasa sus citas y notificaciones a esa persona.
// Citas que no tienen sentido tras el traspaso se eliminan:
//  - solicitudes de un miembro de la misma empresa a su propio genérico (quedarían consigo mismo / su colega)
//  - solicitudes que ya existen entre el solicitante y la persona real (duplicadas)
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const APPLY = process.argv.includes("--apply");
const E = "ihIlXCreXToidw1wsI9a";

// genérico -> persona real (contacto del CSV)
const MAP = {
  rep_800078269: "w7NaznipuGfmYkfTos35", // RODANDO -> Isabel Londoño (se resuelve por prefijo)
  rep_800192215: "mzd0Faw2QKOYplKTf0lCxm0fX4p2", // SAN CARGA -> Andrés Valencia
  rep_860325638: "zmnGBQTOVsWNH2ICg5YpKwwefB63", // PORKCOLOMBIA -> Sebastian Garcia
  rep_900259885: "jykyx0qdHCMKDiWogzpDIs20wx83", // EMPAQUES CARDENAS -> Alfredo Quintero
  rep_900743001: "D69eYIMl4mVdtW5pHQ6Wg9JAb5D2", // TRANSINVER -> Karen Cepeda
  rep_902024750: "TOfAF5cJ1NcaQXgfYEh04V8z9ad2", // MANUFEX -> Yeferson Gonzalez
  rep_J316287599: "wCCvqtugFQegGWJLapaR9laA5673", // BANCAMIGA -> Luisa Ochoa
};

(async () => {
  const ev = db.collection("events").doc(E);
  const users = (await db.collection("users").where("eventId", "==", E).get()).docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const ops = [];
  const add = (label, run) => ops.push({ label, run });

  // Validaciones: el genérico existe y es genérico; la persona real existe, es vendedora y de la misma empresa
  for (const [gen, realPrefix] of Object.entries(MAP)) {
    const g = byId[gen];
    const r = users.find((u) => u.id.startsWith(realPrefix));
    if (!g) { console.log("ABORTA: no existe", gen); process.exit(1); }
    if (!/@geniality\.com\.co$/i.test(g.correo || "")) { console.log("ABORTA: no es genérico", gen, g.correo); process.exit(1); }
    if (!r) { console.log("ABORTA: no existe persona real", realPrefix); process.exit(1); }
    if (r.companyId !== g.companyId) { console.log("ABORTA: empresa distinta", gen, r.id); process.exit(1); }
    if (String(r.tipoAsistente).toLowerCase() !== "vendedor") { console.log("ABORTA: no es vendedor", r.id, r.nombre); process.exit(1); }
    MAP[gen] = r.id;
  }
  const GENS = Object.keys(MAP);

  // Citas
  const meetings = (await ev.collection("meetings").get()).docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
  const agenda = await ev.collection("agenda").get();
  for (const m of meetings) {
    const gen = GENS.find((g) => m.requesterId === g || m.receiverId === g || (m.participants || []).includes(g));
    if (!gen) continue;
    const real = MAP[gen];
    const other = m.requesterId === gen ? m.receiverId : m.requesterId;
    const o = byId[other] || {};
    const desc = `cita ${m.id} [${m.status}] ${byId[m.requesterId]?.nombre || m.requesterId} -> ${byId[m.receiverId]?.nombre || m.receiverId}`;
    if (agenda.docs.some((s) => s.data().meetingId === m.id)) { console.log("ABORTA: la cita tiene slot de agenda", m.id); process.exit(1); }
    if (o.companyId === byId[gen].companyId) {
      add(`ELIMINAR ${desc} (solicitud a su propia empresa)`, () => m.ref.delete());
      continue;
    }
    const dup = meetings.find((x) => x.id !== m.id && x.status !== "cancelled" && (x.participants || []).includes(other) && (x.participants || []).includes(real));
    if (dup) {
      add(`ELIMINAR ${desc} (duplicada: ya existe ${dup.id} [${dup.status}] con ${byId[real].nombre})`, () => m.ref.delete());
      continue;
    }
    const upd = { participants: (m.participants || []).map((p) => (p === gen ? real : p)) };
    if (m.requesterId === gen) upd.requesterId = real;
    if (m.receiverId === gen) upd.receiverId = real;
    add(`MOVER ${desc} => ahora con ${byId[real].nombre}`, () => m.ref.update(upd));
  }

  // Notificaciones: se pasan a la persona real salvo que ya tenga una igual o hablen de ella misma / su colega
  const notifs = await db.collection("notifications").where("userId", "in", GENS).get();
  const realNotifs = await db.collection("notifications").where("userId", "in", Object.values(MAP)).get();
  for (const n of notifs.docs) {
    const x = n.data();
    const real = MAP[x.userId];
    const colleagues = users.filter((u) => u.companyId === byId[x.userId].companyId && !u.id.startsWith("rep_")).map((u) => u.nombre.trim());
    const selfRef = colleagues.some((c) => String(x.message || "").startsWith(c));
    const dup = realNotifs.docs.some((r) => r.data().userId === real && r.data().message === x.message);
    // MANUFEX: Yeferson es el único de la empresa, así que "tu compañero" es él mismo; la de Yelitza
    // corresponde a la solicitud duplicada que se elimina arriba.
    const manual = ["cLGF05VCFFoljawqWcPT", "qHfdRsaVdN6IIFi72sI7", "kVTNP65PdsSAxmX472HJ"].includes(n.id);
    if (selfRef || dup || manual) add(`ELIMINAR notif ${n.id} (${selfRef ? "sobre su propia empresa" : dup ? "ya la tiene" : "obsoleta"}): ${String(x.message).split("\n")[0]}`, () => n.ref.delete());
    else add(`MOVER notif ${n.id} -> ${byId[real].nombre}: ${String(x.message).split("\n")[0]}`, () => n.ref.update({ userId: real }));
  }

  // Usuarios genéricos
  for (const gen of GENS) add(`BORRAR usuario ${gen} (${byId[gen].empresa}, ${byId[gen].correo})`, () => db.collection("users").doc(gen).delete());

  ops.forEach((o) => console.log(o.label));
  console.log(`\nOperaciones: ${ops.length}`);
  if (!APPLY) { console.log("DRY RUN. Usa --apply para ejecutar."); process.exit(0); }
  // Primero citas/notificaciones, al final los usuarios (si algo falla, el genérico sigue existiendo)
  for (const o of ops) await o.run();
  console.log("Aplicado.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

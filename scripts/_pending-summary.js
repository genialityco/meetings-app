const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const eventId = process.argv[2];
(async () => {
  const ev = (await db.collection("events").doc(eventId).get()).data();
  console.log("eventDates:", ev.eventDates || ev.config?.eventDate, "| waVersion:", ev.config?.policies?.whatsappApiVersion, "| waEnabled:", ev.config?.policies?.whatsappNotificationsEnabled, "| fallbackEmail:", ev.config?.policies?.fallbackEmailOnWaFailure);
  const users = {}; (await db.collection("users").where("eventId", "==", eventId).get()).forEach((d) => users[d.id] = d.data());
  const s = await db.collection("events").doc(eventId).collection("meetings").where("status", "==", "pending").get();
  const companies = new Map(); let direct = 0, shared = 0;
  s.forEach((d) => { const m = d.data(); const key = m.receiverId ? (users[m.receiverId]?.companyId || "user:" + m.receiverId) : m.companyId; m.receiverId ? direct++ : shared++; companies.set(key, (companies.get(key) || 0) + 1); });
  console.log(`Pendientes: ${s.size} (directas ${direct}, a empresa ${shared}); destinos distintos: ${companies.size}`);
  const advisors = {}; Object.entries(users).forEach(([id, u]) => { if (u.companyId) (advisors[u.companyId] ||= []).push(u); });
  let noPhone = 0, noMail = 0, reps = 0;
  for (const k of companies.keys()) for (const u of advisors[k] || []) { if (!u.telefono) noPhone++; if (!u.correo) noMail++; }
  Object.entries(users).forEach(([id]) => { if (id.startsWith("rep_")) reps++; });
  console.log(`Asesores sin teléfono: ${noPhone}, sin correo: ${noMail}; usuarios rep_ genéricos en evento: ${reps}`);
  console.log("Top:", [...companies.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));
  process.exit(0);
})();

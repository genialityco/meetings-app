const admin = require('firebase-admin');
const sa = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const EVENT_ID = 'ihIlXCreXToidw1wsI9a';

(async () => {
  const companiesSnap = await db
    .collection('events')
    .doc(EVENT_ID)
    .collection('companies')
    .get();
  const descByNit = new Map();
  companiesSnap.forEach((d) => {
    const c = d.data();
    if (c.descripcion && String(c.descripcion).trim()) {
      descByNit.set(d.id, String(c.descripcion).trim());
    }
  });
  console.log(`Empresas con descripción: ${descByNit.size} / ${companiesSnap.size}`);

  const usersSnap = await db.collection('users').where('eventId', '==', EVENT_ID).get();
  const reps = usersSnap.docs.filter((d) => d.id.startsWith('rep_'));
  console.log(`Cuentas rep_* encontradas: ${reps.length}`);

  const batch = db.batch();
  let updated = 0;
  const missing = [];

  reps.forEach((docSnap) => {
    const u = docSnap.data();
    const desc = descByNit.get(u.companyId);
    if (!desc) {
      missing.push(`${docSnap.id} (${u.company_razonSocial}, companyId=${u.companyId})`);
      return;
    }
    batch.update(docSnap.ref, { descripcion: desc, updatedAt: new Date().toISOString() });
    updated++;
  });

  if (updated > 0) await batch.commit();
  console.log(`Actualizadas con descripción (copiada de la empresa): ${updated}`);
  console.log(`Sin match: ${missing.length}`);
  missing.forEach((m) => console.log(`  - ${m}`));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

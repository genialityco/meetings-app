const admin = require('firebase-admin');
const sa = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const EVENT_ID = 'ihIlXCreXToidw1wsI9a';

(async () => {
  const snap = await db
    .collection('users')
    .where('eventId', '==', EVENT_ID)
    .where('nombre', '==', 'Representante')
    .get();

  console.log(`Encontrados con nombre "Representante": ${snap.size}`);

  const batch = db.batch();
  let count = 0;
  snap.forEach((docSnap) => {
    if (!docSnap.id.startsWith('rep_')) return; // solo los creados por el script
    batch.update(docSnap.ref, { nombre: 'Asistente', updatedAt: new Date().toISOString() });
    count++;
  });

  if (count > 0) await batch.commit();
  console.log(`Actualizados a "Asistente": ${count}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

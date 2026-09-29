const admin = require('firebase-admin');
const sa = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const EVENT_ID = 'ihIlXCreXToidw1wsI9a';

(async () => {
  const snap = await db
    .collection('users')
    .where('eventId', '==', EVENT_ID)
    .get();

  const reps = snap.docs.filter((d) => d.id.startsWith('rep_'));
  console.log(`Cuentas rep_* encontradas: ${reps.length}`);

  const batch = db.batch();
  reps.forEach((docSnap) => {
    batch.update(docSnap.ref, {
      aceptaTratamiento: true,
      updatedAt: new Date().toISOString(),
    });
  });

  if (reps.length > 0) await batch.commit();
  console.log(`Actualizados con aceptaTratamiento=true: ${reps.length}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

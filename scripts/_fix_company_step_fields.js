const admin = require('firebase-admin');
const sa = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const EVENT_ID = 'ihIlXCreXToidw1wsI9a';
const FIELDS_TO_ADD = ['company_logo', 'custom_pas_8769', 'custom_sector_7991'];

(async () => {
  const ref = db.collection('events').doc(EVENT_ID);
  const doc = await ref.get();
  const registrationForm = doc.data().config.registrationForm;
  const steps = registrationForm.steps;

  const companyStepIdx = steps.findIndex((s) => (s.fields || []).includes('company_nit'));
  if (companyStepIdx === -1) {
    console.log('No se encontró el paso de empresa');
    process.exit(1);
  }

  const before = [...steps[companyStepIdx].fields];
  const merged = [...new Set([...steps[companyStepIdx].fields, ...FIELDS_TO_ADD])];
  steps[companyStepIdx] = { ...steps[companyStepIdx], fields: merged };

  console.log('Antes:', before);
  console.log('Después:', merged);

  await ref.update({ 'config.registrationForm.steps': steps });
  console.log('Actualizado OK');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

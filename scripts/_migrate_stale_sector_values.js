const admin = require('firebase-admin');
const sa = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const EVENT_ID = 'ihIlXCreXToidw1wsI9a';

// Mapa de fragmentos viejos (antes de fusionar el campo Sector) -> valor fusionado actual.
// Cubre ambas mitades de cada par, por si alguien alcanzó a seleccionar la segunda mitad.
const OLD_TO_NEW = {
  'Banca': 'Banca, finanzas y seguros',
  'finanzas y seguros': 'Banca, finanzas y seguros',
  'Construcción': 'Construcción, materiales e inmobiliario',
  'materiales e inmobiliario': 'Construcción, materiales e inmobiliario',
  'Consultoría': 'Consultoría, auditoría y servicios profesionales',
  'auditoría y servicios profesionales': 'Consultoría, auditoría y servicios profesionales',
  'Consumo masivo': 'Consumo masivo, aseo y cuidado personal',
  'aseo y cuidado personal': 'Consumo masivo, aseo y cuidado personal',
  'Cuero': 'Cuero, calzado y marroquinería',
  'calzado y marroquinería': 'Cuero, calzado y marroquinería',
  'Cámaras de comercio': 'Cámaras de comercio, gremios e instituciones',
  'gremios e instituciones': 'Cámaras de comercio, gremios e instituciones',
  'Logística': 'Logística, transporte y zonas francas',
  'transporte y zonas francas': 'Logística, transporte y zonas francas',
  'Medios': 'Medios, editorial y comunicación',
  'editorial y comunicación': 'Medios, editorial y comunicación',
  'Minero': 'Minero, metalúrgico y metalmecánico',
  'metalúrgico y metalmecánico': 'Minero, metalúrgico y metalmecánico',
  'Papel': 'Papel, plásticos y empaques',
  'plásticos y empaques': 'Papel, plásticos y empaques',
  'Textil': 'Textil, confección y moda',
  'confección y moda': 'Textil, confección y moda',
};

(async () => {
  const eventDoc = await db.collection('events').doc(EVENT_ID).get();
  const sectorField = eventDoc.data().config.formFields.find((f) => f.name === 'custom_sector_7991');
  const validValues = new Set(sectorField.options.map((o) => o.value));

  const snap = await db.collection('users').where('eventId', '==', EVENT_ID).get();

  const batch = db.batch();
  let updated = 0;
  const unmapped = [];

  snap.forEach((docSnap) => {
    const u = docSnap.data();
    const val = u.custom_sector_7991;
    if (val === undefined || validValues.has(val)) return; // ya válido o sin valor

    const newVal = OLD_TO_NEW[val];
    if (!newVal) {
      unmapped.push(`${docSnap.id} (${u.nombre}): "${val}"`);
      return;
    }
    batch.update(docSnap.ref, { custom_sector_7991: newVal, updatedAt: new Date().toISOString() });
    updated++;
    console.log(`${docSnap.id} (${u.nombre}): "${val}" -> "${newVal}"`);
  });

  if (updated > 0) await batch.commit();
  console.log(`\nActualizados: ${updated}`);
  console.log(`Sin mapeo conocido: ${unmapped.length}`);
  unmapped.forEach((m) => console.log(`  - ${m}`));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

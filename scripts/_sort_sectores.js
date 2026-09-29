const admin = require('firebase-admin');
const sa = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const ORDER = [
  "Agropecuario y agroindustria",
  "Alimentos y bebidas",
  "Automotriz y autopartes",
  "Banca, finanzas y seguros",
  "Comercio exterior y aduanas",
  "Comercio y distribución",
  "Construcción, materiales e inmobiliario",
  "Consultoría, auditoría y servicios profesionales",
  "Consumo masivo, aseo y cuidado personal",
  "Cuero, calzado y marroquinería",
  "Cámaras de comercio, gremios e instituciones",
  "Energía y combustibles",
  "Eventos y ferias comerciales",
  "Farmacéutico y salud",
  "Industrial y manufactura",
  "Logística, transporte y zonas francas",
  "Madera y muebles",
  "Maquinaria y equipos industriales",
  "Medios, editorial y comunicación",
  "Minero, metalúrgico y metalmecánico",
  "Papel, plásticos y empaques",
  "Químicos y agroquímicos",
  "Servicios jurídicos",
  "Tecnología y telecomunicaciones",
  "Textil, confección y moda",
  "Transporte aéreo",
  "Turismo y hotelería",
  "Otro",
];

(async () => {
  const ref = db.collection('events').doc('ihIlXCreXToidw1wsI9a');
  const doc = await ref.get();
  const data = doc.data();
  const fields = data.config.formFields;
  const idx = fields.findIndex((f) => f.name === 'custom_sector_7991');
  if (idx === -1) {
    console.log('Field not found');
    process.exit(1);
  }

  const oldOptions = fields[idx].options;
  console.log('Old count:', oldOptions.length);

  const newOptions = ORDER.map((text) => ({ value: text, label: text }));
  console.log('New count:', newOptions.length);

  fields[idx] = { ...fields[idx], options: newOptions };

  await ref.update({ 'config.formFields': fields });
  console.log('Updated OK');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

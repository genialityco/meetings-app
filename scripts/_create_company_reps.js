const admin = require('firebase-admin');
const sa = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const EVENT_ID = 'ihIlXCreXToidw1wsI9a';

// Excluidas explícitamente (no son expositores reales, son la cámara organizadora y Geniality)
const EXCLUDE_NIT = new Set(['860055008', '901555490']);

// Sector económico tomado de la tabla de la organización, mapeado por NIT/NIF
// (más confiable que por nombre, ya que 2 empresas cambiaron de razón social
// entre esa tabla y el registro real: KAESER -> KAESER COMPRESORES, BNC -> BANCO
// NACIONAL DE CRÉDITO). Los valores son exactamente los de las opciones ya
// fusionadas del campo custom_sector_7991.
const SECTOR_BY_NIT = {
  '800078269': 'Comercio y distribución', // RODANDO
  '800146643': 'Alimentos y bebidas', // CONGRUPO
  '800192215': 'Logística, transporte y zonas francas', // SAN CARGA
  '802022269': 'Comercio y distribución', // ACPYCIA
  '804016740': 'Maquinaria y equipos industriales', // INAL Industrias Acuña
  '811022981': 'Alimentos y bebidas', // SOBERANA SAS
  '8190052974': 'Agropecuario y agroindustria', // DAABON
  '830006735': 'Alimentos y bebidas', // ALIMENTOS POLAR
  '830067414': 'Maquinaria y equipos industriales', // KAESER COMPRESORES
  '860005194': 'Alimentos y bebidas', // HARINERA PARDO
  '860026753': 'Minero, metalúrgico y metalmecánico', // ACESCO
  '860067802': 'Logística, transporte y zonas francas', // TRANSPORTES CONDOR
  '860325638': 'Agropecuario y agroindustria', // PORKCOLOMBIA
  '860523227': 'Industrial y manufactura', // GRUPO A
  '890103161': 'Alimentos y bebidas', // TRANSPORTES SANCHEZ POLO
  '890504820': 'Comercio exterior y aduanas', // GRUPO COEX
  '890802586': 'Minero, metalúrgico y metalmecánico', // ARME
  '890805267': 'Alimentos y bebidas', // SUPER DE ALIMENTOS
  '900259885': 'Papel, plásticos y empaques', // EMPAQUES CARDENAS
  '900669915': 'Industrial y manufactura', // SEGUREX
  '900743001': 'Logística, transporte y zonas francas', // TRANSINVER
  '900905459': 'Logística, transporte y zonas francas', // CALIDEX TRADING CO SAS
  '9009134582': 'Comercio y distribución', // GRANDES MARCAS
  '901139615': 'Comercio exterior y aduanas', // ARAUJO IBARRA | ZONA FRANCA SANTANDER
  '901189336': 'Alimentos y bebidas', // CHIRROS
  '901244239': 'Comercio exterior y aduanas', // SOFIMAR
  '901422577': 'Logística, transporte y zonas francas', // WED ENVIOS
  '901524433': 'Construcción, materiales e inmobiliario', // GRUPO PROMAT
  '901742681': 'Comercio exterior y aduanas', // AGENCIA RUBICAM
  '902024750': 'Industrial y manufactura', // MANUFEX GROUP
  'J09028384': 'Banca, finanzas y seguros', // BANCO SOFITASA
  'J29942968': 'Consultoría, auditoría y servicios profesionales', // ATENAS CONSULTORES
  'J30095130': 'Comercio exterior y aduanas', // CASTELLANOS Y ASOCIADOS C.A
  'J30317498': 'Logística, transporte y zonas francas', // SERVIFLETES
  'J30988413': 'Banca, finanzas y seguros', // BANCO NACIONAL DE CRÉDITO
  'J31628759': 'Banca, finanzas y seguros', // BANCAMIGA
  'J50086837': 'Alimentos y bebidas', // BBI | IDEAL
  'J501913285': 'Agropecuario y agroindustria', // AVIMAX
  'J507907228': 'Logística, transporte y zonas francas', // AMERILOG AMERICAN CARGO
};

function slugify(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quitar tildes
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ''); // quitar espacios, puntuación, |, etc.
}

function countryFromNit(nitNorm) {
  return /^[0-9]+$/.test(nitNorm) ? 'Colombia' : 'Venezuela';
}

(async () => {
  const snap = await db.collection('events').doc(EVENT_ID).collection('companies').get();
  console.log(`Empresas encontradas: ${snap.size}`);

  const results = { created: [], skippedExcluded: [], skippedNoSector: [] };

  const batch = db.batch();
  let batchCount = 0;

  for (const docSnap of snap.docs) {
    const company = docSnap.data();
    const nitNorm = company.nitNorm || docSnap.id;
    const razonSocial = company.razonSocial || '';

    if (EXCLUDE_NIT.has(nitNorm)) {
      results.skippedExcluded.push(razonSocial);
      continue;
    }

    const sector = SECTOR_BY_NIT[nitNorm];
    if (!sector) {
      results.skippedNoSector.push(`${razonSocial} (nit=${nitNorm})`);
      continue;
    }

    const slug = slugify(razonSocial);
    const correo = `rueda${slug}@geniality.com.co`;
    const pais = countryFromNit(nitNorm);
    const userId = `rep_${nitNorm}`;

    const userData = {
      eventId: EVENT_ID,
      nombre: 'Representante',
      correo,
      telefono: '',
      tipoAsistente: 'vendedor',
      companyId: nitNorm,
      company_razonSocial: razonSocial,
      empresa: razonSocial,
      custom_sector_7991: sector,
      custom_pas_8769: pais,
      welcomePopupSeen: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    batch.set(db.collection('users').doc(userId), userData, { merge: true });
    batchCount++;
    results.created.push({ userId, razonSocial, correo, pais, sector });
  }

  if (batchCount > 0) await batch.commit();

  console.log(`\nCreados/actualizados: ${results.created.length}`);
  results.created.forEach((r) =>
    console.log(`  - ${r.razonSocial} | ${r.correo} | ${r.pais} | ${r.sector} | doc=${r.userId}`),
  );

  console.log(`\nExcluidas (organizador): ${results.skippedExcluded.length}`);
  results.skippedExcluded.forEach((n) => console.log(`  - ${n}`));

  console.log(`\nSin sector mapeado (revisar manualmente): ${results.skippedNoSector.length}`);
  results.skippedNoSector.forEach((n) => console.log(`  - ${n}`));

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

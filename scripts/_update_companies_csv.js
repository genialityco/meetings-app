// Uso: node scripts/_update_companies_csv.js [--apply]
// Actualiza razonSocial/descripcion de las empresas del evento (y de sus usuarios) desde el CSV.
// NO cambia IDs de documentos: citas, visitas, productos y representantes quedan intactos.
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccountKey.json')) });
const db = admin.firestore();
const APPLY = process.argv.includes('--apply');
const E = 'ihIlXCreXToidw1wsI9a';
const rows = require('./_update_companies_csv_data.js');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const nitN = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^RIF/, '');

(async () => {
  const cs = await db.collection('events').doc(E).collection('companies').get();
  const us = await db.collection('users').where('eventId', '==', E).get();
  const ops = [];
  const noMatch = [];
  for (const [stand, nombre, nit, desc] of rows) {
    // El id en Firestore a veces omite/agrega el dígito verificador respecto al CSV: se compara por prefijo.
    const matches = cs.docs.filter((d) => {
      const a = nitN(d.id), b = nitN(nit);
      const nitOk = a === b || (a.length >= 8 && b.length >= 8 && (a.startsWith(b) || b.startsWith(a)));
      return nitOk || norm(d.data().razonSocial) === norm(nombre);
    });
    if (!matches.length) { noMatch.push(`${stand} ${nombre} (${nit})`); continue; }
    for (const m of matches) {
      const c = m.data();
      const upd = { razonSocial: nombre, updatedAt: new Date() };
      if ('company_razonSocial' in c) upd.company_razonSocial = nombre;
      if (desc) upd.descripcion = desc;
      ops.push({ ref: m.ref, upd, label: `[${stand}] ${m.id} "${c.razonSocial}" -> "${nombre}"`, descChanged: desc && desc !== c.descripcion });
      for (const u of us.docs.filter((x) => x.data().companyId === m.id)) {
        const uu = { empresa: nombre, company_razonSocial: nombre, updatedAt: new Date().toISOString() };
        if (desc) uu.descripcion = desc;
        ops.push({ ref: u.ref, upd: uu, label: `   user ${u.id.slice(0, 24)} (${u.data().nombre})`, descChanged: desc && desc !== u.data().descripcion, user: true });
      }
    }
  }
  ops.forEach((o) => console.log(o.label, o.descChanged ? '[desc cambia]' : '[desc igual]'));
  console.log(`\nSin match en Firestore: ${noMatch.length}`); noMatch.forEach((n) => console.log('  -', n));
  const matchedIds = new Set(ops.filter((o) => !o.user).map((o) => o.ref.id));
  console.log('Empresas en Firestore sin fila en CSV:'); cs.docs.filter((d) => !matchedIds.has(d.id)).forEach((d) => console.log('  -', d.id, d.data().razonSocial));
  console.log(`\nOperaciones: ${ops.length} (${ops.filter((o) => !o.user).length} empresas, ${ops.filter((o) => o.user).length} usuarios)`);
  if (!APPLY) { console.log('DRY RUN. Usa --apply para escribir.'); process.exit(0); }
  for (let i = 0; i < ops.length; i += 400) {
    const b = db.batch(); ops.slice(i, i + 400).forEach((o) => b.update(o.ref, o.upd)); await b.commit();
  }
  console.log('Aplicado.'); process.exit(0);
})();

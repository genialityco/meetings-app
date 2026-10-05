// Uso: node scripts/_fill_generic_contacts.js [--apply]
// Pone el correo/WhatsApp del CSV "PERFILES - Encuentro Cámara Colombo Venezolana" en los
// representantes genéricos (rep_<nit>, correo rueda...@geniality.com.co) de cada empresa.
// Si el contacto del CSV ya está registrado como usuario real del evento, se omite la empresa
// (evita dos cuentas con el mismo correo para el login y WhatsApp duplicados).
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const APPLY = process.argv.includes("--apply");
const E = "ihIlXCreXToidw1wsI9a";

// [nit, nombre, whatsapp, correo] — tal cual el CSV
const ROWS = [
  ["819005297", "DAABON", "", "jgonzalez@zonafrancalasamericas.com"],
  ["J300951308", "CASTELLANOS Y ASOCIADOS C.A", "58 4247827481", "logisticfrontera@gmail.com"],
  ["901139615", "ARAUJO IBARRA | ZONA FRANCA SANTANDER", "", "lacosta@araujoibarra.com"],
  ["J29942968", "ATENAS CONSULTORES", "58 412 3438824", "mariajaramillo@atenasconsultores.com"],
  ["J303174981", "SERVIFLETES", "57 3053724796", "RAMON.BUSTOS@OKENDO.COM.CO"],
  ["901742681", "AGENCIA RUBICAM", "57 3202689430", "camilorubio@rubicam.co"],
  ["900905459", "CALIDEX TRADING CO SAS", "57 3022016615", "administracion@calidexco.com"],
  ["811022981", "SOBERANA SAS", "573106371851", "laura.escobar@soberana.com.co"],
  ["890103161", "TRANSPORTES SANCHEZ POLO", "310 3609858", "gcitarella@sanchezpolo.com"],
  ["J50086837", "BBI | IDEAL", "57 3208176783", "gerenciacomercial@holdingbbi.com"],
  ["901422577", "WED ENVIOS", "573115167770", "John.Guerrero@wedenvios.com"],
  ["890504820", "GRUPO COEX", "57 3212403366", "murbina@coexnort.com"],
  ["860026753", "ACESCO", "", "lpadilla@acesco.com"],
  ["900913458", "GRANDES MARCAS", "57 3015523948", "direccionadmon@rtgrandesmarcas.com"],
  ["800078269", "RODANDO", "300 3076530", "Isabel.londono@rodando.com.co"],
  ["900259885", "EMPAQUES CARDENAS", "57 3160253415", "ADMON@EMPAQUESCARDENAS.COM"],
  ["802022269", "ACPYCIA", "18259827118", "elvispalomino@me.com"],
  ["900669915", "SEGUREX", "3176395607", "Anderson.Avendano@segurex.com"],
  ["901189336", "CHIRROS", "573124514014", "alimentoschirros@gmail.com"],
  ["860325638", "PORKCOLOMBIA", "573213726739", "sgarcia@porkcolombia.co"],
  ["804016740", "INAL Industrias Acuña", "57 3167897956", "natalia@inal.com.co"],
  ["901244239", "SOFIMAR", "57 3118094607", "cilogisticasofimarsas@gmail.com"],
  ["J507907228", "AMERILOG AMERICAN CARGO", "584245364480", "j.montesinos@ameri-log.com"],
  ["890802586", "ARME", "573132476189", "mercadeo@arme.co"],
  ["901838320", "Parque Industrial y Energético Valle de San José", "57 3005259382", "asistenteejecutiva@holdingbbi.com"],
  ["830006735", "ALIMENTOS POLAR", "573017515890", "alejandra.lopez@empesaspolar.com"],
  ["J309841327", "BANCO NACIONAL DE CRÉDITO", "573104803092", "cf.ahumada@hotmail.com"],
  ["900743001", "TRANSINVER", "57 3005722096", "transinver.cumplimiento@gmail.com"],
  ["830067414", "KAESER COMPRESORES", "57 3108034616", "ivon.gomez@kaeser.com"],
  ["J316287599", "BANCAMIGA", "584125497305", "luisa.ochoa@bancamiga.com"],
  ["902024750", "MANUFEX GROUP", "57 3124389476", "gerencia@manufex.com.co"],
  ["901524433", "GRUPO PROMAT", "58 4247005243", "grupopromatsas@gmail.com"],
  ["860005194", "HARINERA PARDO", "57 3123793301", "diradmon@harinerapardo.co"],
  ["800192215", "SAN CARGA", "57 3133969974", "info@sancarga.com"],
  ["860067802", "TRANSPORTES CONDOR", "573006351745", "comercial2bogota@tcondor.com"],
  ["890805267", "SUPER DE ALIMENTOS", "3163303782", "roberto.isaza@super.com.co"],
  ["860523227", "GRUPO A", "", "david.wilches@somosgrupo-a.com"],
  ["J501913285", "AVIMAX", "58 04147183660", "avimaxmarketing@gmail.com"],
  ["J090283846", "BANCO SOFITASA", "", "sostos@sofitasa.com"],
  ["800146643", "CONGRUPO", "", "juan.villafuerte@congrupo.com.co"],
];

// Formato de la app: "+<indicativo> <número>". Celular colombiano de 10 dígitos sin indicativo -> +57.
// Venezuela: se quita el 0 troncal tras el 58 (58 0414... -> +58 414...).
function normPhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 10 && d.startsWith("3")) return `+57 ${d}`;
  if (d.startsWith("57") && d.length === 12) return `+57 ${d.slice(2)}`;
  if (d.startsWith("58")) { d = d.slice(2).replace(/^0/, ""); return `+58 ${d}`; }
  if (d.startsWith("1") && d.length === 11) return `+1 ${d.slice(1)}`;
  return `+${d}`;
}
const digits = (s) => String(s || "").replace(/\D/g, "");
const sameTel = (a, b) => digits(a) && digits(b) && digits(a).slice(-10) === digits(b).slice(-10);
const isGeneric = (id, u) => id.startsWith("rep_") && /@geniality\.com\.co$/i.test(u.correo || "");

(async () => {
  const snap = await db.collection("users").where("eventId", "==", E).get();
  const users = snap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
  const reals = users.filter((u) => !isGeneric(u.id, u));
  const ops = [], skipped = [];

  for (const [nit, nombre, wa, mail] of ROWS) {
    const correo = mail.trim().toLowerCase();
    const telefono = normPhone(wa);
    const gens = users.filter((u) => u.companyId === nit && isGeneric(u.id, u));
    if (!gens.length) { skipped.push(`${nombre}: no tiene genérico`); continue; }
    const taken = reals.find((u) => (u.correo || "").toLowerCase() === correo || (telefono && sameTel(u.telefono, telefono)));
    if (taken) { skipped.push(`${nombre}: el contacto del CSV ya es usuario real (${taken.nombre}, ${taken.correo})`); continue; }
    for (const g of gens) {
      const upd = { correo, updatedAt: new Date().toISOString() };
      if (telefono) upd.telefono = telefono;
      ops.push({ ref: g.ref, upd, label: `${nombre.padEnd(30)} ${g.id.padEnd(16)} ${g.correo} -> ${correo} | tel "${g.telefono || ""}" -> "${telefono || "(sin cambio)"}"  [csv: ${wa || "-"}]` });
    }
  }

  ops.forEach((o) => console.log(o.label));
  console.log(`\nOmitidas (${skipped.length}):`); skipped.forEach((s) => console.log("  -", s));
  console.log(`\nGenéricos a actualizar: ${ops.length}`);
  if (!APPLY) { console.log("DRY RUN. Usa --apply para escribir."); process.exit(0); }
  const b = db.batch(); ops.forEach((o) => b.update(o.ref, o.upd)); await b.commit();
  console.log("Aplicado.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

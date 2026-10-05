// Uso: node scripts/_sync_perfiles_csv.js [--apply]
// Ajustes tras cruzar "PERFILES - Encuentro Cámara Colombo Venezolana" contra el evento:
//  1. Crea CHIRROS (901189336) + su representante genérico rep_<nit> (mismo formato que _create_company_reps.js)
//  2. Corrige nombres: SAN CARGA, BANCAMIGA, AVIMAX (empresa + usuarios asociados)
//  3. Unifica Atenas bajo J29942968: mueve usuarios/productos/citas de J299429686 y borra esa empresa
// No toca WhatsApp/correos de contacto.
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require("./serviceAccountKey.json")) });
const db = admin.firestore();
const APPLY = process.argv.includes("--apply");
const E = "ihIlXCreXToidw1wsI9a";
const ev = db.collection("events").doc(E);
const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const CHIRROS = {
  nit: "901189336",
  nombre: "CHIRROS",
  sector: "Alimentos y bebidas",
  desc: "Creada en marzo de 2005, en Bogotá, Colombia, Chirro's es una empresa familiar dedicada a la transformación y comercialización de snacks, principalmente chicharrones de cerdo. Su oferta comprende chicharrón en presentaciones de 30 g, 45 g y 115 g, en sabores natural, BBQ, ahumado y picante, con distribución a nivel nacional.",
};
const RENAMES = { "800192215": "SAN CARGA", J316287599: "BANCAMIGA", J501913285: "AVIMAX" };
const ATENAS_KEEP = "J29942968";
const ATENAS_DROP = "J299429686";

(async () => {
  const ops = []; // { label, run }
  const nowIso = new Date().toISOString();

  // 1. CHIRROS
  const cRef = ev.collection("companies").doc(CHIRROS.nit);
  const uRef = db.collection("users").doc("rep_" + CHIRROS.nit);
  const [c, u] = await Promise.all([cRef.get(), uRef.get()]);
  if (c.exists || u.exists) {
    console.log("CHIRROS: ya existe, se omite", { empresa: c.exists, usuario: u.exists });
  } else {
    const now = new Date();
    const company = {
      nitNorm: CHIRROS.nit, razonSocial: CHIRROS.nombre, company_razonSocial: CHIRROS.nombre,
      descripcion: CHIRROS.desc, custom_sector_7991: CHIRROS.sector, custom_pas_8769: "Colombia",
      createdAt: now, updatedAt: now,
    };
    const user = {
      eventId: E, nombre: "Asistente", correo: `rueda${slug(CHIRROS.nombre)}@geniality.com.co`, telefono: "",
      tipoAsistente: "vendedor", companyId: CHIRROS.nit, company_razonSocial: CHIRROS.nombre, empresa: CHIRROS.nombre,
      descripcion: CHIRROS.desc, custom_sector_7991: CHIRROS.sector, custom_pas_8769: "Colombia",
      aceptaTratamiento: true, welcomePopupSeen: true, createdAt: nowIso, updatedAt: nowIso,
    };
    ops.push({ label: `CREAR empresa ${CHIRROS.nit} "${CHIRROS.nombre}"`, run: () => cRef.set(company) });
    ops.push({ label: `CREAR usuario rep_${CHIRROS.nit} (${user.correo})`, run: () => uRef.set(user) });
  }

  // 2. Renombres
  for (const [nit, nombre] of Object.entries(RENAMES)) {
    const ref = ev.collection("companies").doc(nit);
    const snap = await ref.get();
    if (!snap.exists) { console.log("ABORTA: no existe empresa", nit); process.exit(1); }
    const d = snap.data();
    if (d.razonSocial !== nombre) {
      const upd = { razonSocial: nombre, updatedAt: new Date() };
      if ("company_razonSocial" in d) upd.company_razonSocial = nombre;
      ops.push({ label: `RENOMBRAR empresa ${nit}: "${d.razonSocial}" -> "${nombre}"`, run: () => ref.update(upd) });
    }
    const users = await db.collection("users").where("eventId", "==", E).where("companyId", "==", nit).get();
    for (const us of users.docs) {
      const ud = us.data();
      if (ud.empresa === nombre && ud.company_razonSocial === nombre) continue;
      ops.push({
        label: `   usuario ${us.id} (${ud.nombre}): empresa "${ud.empresa}" -> "${nombre}"`,
        run: () => us.ref.update({ empresa: nombre, company_razonSocial: nombre, updatedAt: nowIso }),
      });
    }
  }

  // 3. Unificar Atenas
  const keep = await ev.collection("companies").doc(ATENAS_KEEP).get();
  const drop = await ev.collection("companies").doc(ATENAS_DROP).get();
  if (!drop.exists) {
    console.log("Atenas: ya no existe", ATENAS_DROP, ", se omite");
  } else {
    if (!keep.exists) { console.log("ABORTA: no existe", ATENAS_KEEP); process.exit(1); }
    const visits = await drop.ref.collection("visits").get();
    if (visits.size) { console.log(`ABORTA: ${ATENAS_DROP} tiene ${visits.size} visitas, revisar a mano`); process.exit(1); }
    const keepName = keep.data().razonSocial;
    const users = await db.collection("users").where("eventId", "==", E).where("companyId", "==", ATENAS_DROP).get();
    for (const us of users.docs) {
      const ud = us.data();
      const upd = { companyId: ATENAS_KEEP, empresa: keepName, company_razonSocial: keepName, updatedAt: nowIso };
      for (const k of ["company_nit", "nit", "nitNorm"]) if (k in ud) upd[k] = ATENAS_KEEP;
      ops.push({ label: `MOVER usuario ${us.id} (${ud.nombre}) ${ATENAS_DROP} -> ${ATENAS_KEEP}`, run: () => us.ref.update(upd) });
    }
    for (const col of ["products", "meetings"]) {
      const snap = await ev.collection(col).where("companyId", "==", ATENAS_DROP).get();
      for (const d of snap.docs) {
        ops.push({ label: `MOVER ${col}/${d.id} companyId -> ${ATENAS_KEEP}`, run: () => d.ref.update({ companyId: ATENAS_KEEP }) });
      }
    }
    ops.push({ label: `BORRAR empresa ${ATENAS_DROP} "${drop.data().razonSocial}"`, run: () => drop.ref.delete() });
  }

  ops.forEach((o) => console.log(o.label));
  console.log(`\nOperaciones: ${ops.length}`);
  if (!APPLY) { console.log("DRY RUN. Usa --apply para ejecutar."); process.exit(0); }
  for (const o of ops) await o.run();
  console.log("Aplicado.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

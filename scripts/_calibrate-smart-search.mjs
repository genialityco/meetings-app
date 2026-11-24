// Calibra los umbrales de la búsqueda inteligente con datos reales, SIN escribir en Firestore:
// arma el texto de cada empresa/asistente (functions/smartSearchText.js), lo embebe con la llave
// Gemini de las Cloud Functions y muestra los cosenos de consultas de prueba. La llave de .env
// (VITE_GEMINI_API) es de cliente y no tiene acceso a la API de embeddings.
// Uso (PowerShell):
//   $env:GEMINI_KEY = (firebase functions:secrets:access GEMINI_API_KEY)
//   node scripts/_calibrate-smart-search.mjs <eventId> [cacheDir] [consulta extra…]
// Los embeddings se guardan en cacheDir (por defecto la carpeta temporal del sistema) para no repetirlos.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { buildCompanyText, buildAttendeeText, EMBEDDING_MODEL, EMBEDDING_DIMENSION } from "../functions/smartSearchText.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../functions/package.json"));
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require(path.join(here, "serviceAccountKey.json"))) });
const db = admin.firestore();

const [eventId, cacheDir = os.tmpdir(), ...extra] = process.argv.slice(2);
const apiKey = process.env.GEMINI_KEY;
if (!apiKey) throw new Error("Falta la variable de entorno GEMINI_KEY (ver el encabezado)");

const BASE = "https://generativelanguage.googleapis.com/v1beta";
async function embedBatch(texts, taskType, titles = []) {
  const res = await fetch(`${BASE}/models/${EMBEDDING_MODEL}:batchEmbedContents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      requests: texts.map((text, i) => ({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: EMBEDDING_DIMENSION,
        ...(taskType === "RETRIEVAL_DOCUMENT" && titles[i] ? { title: titles[i] } : {}),
      })),
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).embeddings.map((e) => e.values);
}
const cos = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / Math.sqrt(na * nb); };

const ev = (await db.doc(`events/${eventId}`).get()).data();
const formFields = ev.config?.formFields || [];
const [cs, ps, us] = await Promise.all([
  db.collection(`events/${eventId}/companies`).get(),
  db.collection(`events/${eventId}/products`).get(),
  db.collection("users").where("eventId", "==", eventId).get(),
]);
const users = us.docs.map((d) => ({ id: d.id, ...d.data() }));
const products = ps.docs.map((d) => ({ id: d.id, ...d.data() }));
const companies = new Map(cs.docs.map((d) => [d.id, d.data()]));
const docs = [];
for (const [nit, company] of companies) {
  const reps = users.filter((u) => u.companyId === nit);
  const { title, text } = buildCompanyText({ company, reps, products: products.filter((p) => p.companyId === nit), formFields });
  docs.push({ kind: "company", id: nit, name: title, text });
}
for (const user of users) {
  const { title, text } = buildAttendeeText({ user, company: companies.get(user.companyId), products: products.filter((p) => p.ownerUserId === user.id), formFields });
  docs.push({ kind: "attendee", id: user.id, name: `${user.nombre} (${title})`, text });
}
const lens = docs.map((d) => d.text.length);
console.log(`docs ${docs.length}; chars avg ${Math.round(lens.reduce((a, b) => a + b, 0) / lens.length)} max ${Math.max(...lens)}`);
console.log("--- ejemplo empresa ---\n" + docs.find((d) => d.kind === "company" && d.text.includes("Producto:"))?.text.slice(0, 900));
console.log("--- ejemplo asistente ---\n" + docs.find((d) => d.kind === "attendee")?.text.slice(0, 600));

const cacheFile = path.join(cacheDir, `smart-search-emb-${eventId}.json`);
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};
const missing = docs.filter((d) => !cache[d.kind + d.id + d.text.length]);
for (let i = 0; i < missing.length; i += 100) {
  const chunk = missing.slice(i, i + 100);
  const vecs = await embedBatch(chunk.map((d) => d.text), "RETRIEVAL_DOCUMENT", chunk.map((d) => d.name));
  chunk.forEach((d, j) => (cache[d.kind + d.id + d.text.length] = vecs[j]));
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  console.log(`embebidos ${Math.min(i + 100, missing.length)}/${missing.length}`);
}
const queries = extra.length ? extra : [
  "transporte de carga", "aceites naturales para el cabello", "tubería pvc", "desarrollo de software",
  "café", "maquinaria agrícola", "materiales de construcción", "agencia de aduanas", "ropa y confección",
  "productos de limpieza", "energía solar", "proveedores de empaques", "turismo", "harina de maíz",
  "quiero exportar a Venezuela", "astronautas en marte", "receta de torta de chocolate",
];
const qv = await embedBatch(queries, "RETRIEVAL_QUERY");
queries.forEach((q, qi) => {
  for (const kind of ["company", "attendee"]) {
    const scored = docs.filter((d) => d.kind === kind).map((d) => ({ d, s: cos(qv[qi], cache[d.kind + d.id + d.text.length]) })).sort((a, b) => b.s - a.s);
    const s = scored.map((x) => x.s);
    console.log(`\n[${kind}] "${q}" best ${s[0].toFixed(3)} p50 ${s[Math.floor(s.length / 2)].toFixed(3)} p90 ${s[Math.floor(s.length * 0.1)].toFixed(3)}`);
    scored.slice(0, 7).forEach(({ d, s }) => console.log(`  ${s.toFixed(3)} ${d.name.slice(0, 60)} | ${d.text.replace(/\n/g, " ").slice(d.name.length, d.name.length + 90)}`));
  }
});
process.exit(0);

/**
 * Script para crear el primer administrador (super-admin) de la plataforma.
 *
 * USO:
 *   1. Descarga el Service Account Key desde Firebase Console > Configuración del proyecto
 *      > Cuentas de servicio > Generar nueva clave privada
 *   2. Guarda el archivo como scripts/serviceAccountKey.json
 *   3. Edita las constantes ADMIN_EMAIL, ADMIN_PASSWORD y ADMIN_NAME abajo
 *   4. Ejecuta: node scripts/seed-admin.js
 *
 * El script es idempotente: si el usuario ya existe en Firebase Auth,
 * solo actualiza/crea el documento en Firestore.
 */

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const auth = admin.auth();
const db = admin.firestore();

// ─── Configura aquí el primer super-admin ───────────────────────────────────
const ADMIN_EMAIL = 'admin@geniality.com.co';
const ADMIN_PASSWORD = '';
const ADMIN_NAME = 'Super Admin Geniality';
const IS_SUPER_ADMIN = true;
// ────────────────────────────────────────────────────────────────────────────

async function seedAdmin() {
  console.log('🚀 Creando cuenta de administrador...\n');

  let uid;

  // 1. Crear usuario en Firebase Auth (o recuperar si ya existe)
  try {
    const userRecord = await auth.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      displayName: ADMIN_NAME,
    });
    uid = userRecord.uid;
    console.log(`✅ Usuario creado en Firebase Auth: ${uid}`);
  } catch (error) {
    if (error.code === 'auth/email-already-exists') {
      const existingUser = await auth.getUserByEmail(ADMIN_EMAIL);
      uid = existingUser.uid;
      console.log(`ℹ️  El usuario ya existe en Firebase Auth: ${uid}`);
    } else {
      throw error;
    }
  }

  // 2. Crear/actualizar documento en colección admins
  await db.collection('admins').doc(uid).set({
    email: ADMIN_EMAIL,
    displayName: ADMIN_NAME,
    isSuperAdmin: IS_SUPER_ADMIN,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`✅ Documento creado en admins/${uid}`);
  console.log('\n🎉 Super-admin creado correctamente:');
  console.log(`   Email:       ${ADMIN_EMAIL}`);
  console.log(`   UID:         ${uid}`);
  console.log(`   Super Admin: ${IS_SUPER_ADMIN}`);
  console.log('\n⚠️  Recuerda cambiar la contraseña después del primer login.\n');

  process.exit(0);
}

seedAdmin().catch((err) => {
  console.error('❌ Error al crear admin:', err);
  process.exit(1);
});

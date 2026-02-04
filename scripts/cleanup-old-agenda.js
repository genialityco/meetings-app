const admin = require('firebase-admin');

// Inicializar Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function cleanupOldAgenda() {
  console.log('🧹 Iniciando limpieza de colección antigua "agenda"...\n');

  try {
    // 1. Contar documentos a eliminar
    console.log('📊 Contando documentos en colección antigua...');
    const agendaSnap = await db.collection('agenda').get();
    const totalDocs = agendaSnap.size;

    console.log(`   Documentos encontrados: ${totalDocs}\n`);

    if (totalDocs === 0) {
      console.log('✅ La colección "agenda" ya está vacía. No hay nada que limpiar.\n');
      return;
    }

    // 2. Confirmación (este script solo debe ejecutarse después de verificar que todo funciona)
    console.log('⚠️  ADVERTENCIA: Este script eliminará TODOS los documentos de la colección "agenda".');
    console.log('   Asegúrate de que:');
    console.log('   - La migración se completó exitosamente');
    console.log('   - El código actualizado está en producción');
    console.log('   - Has monitoreado la aplicación por al menos 24-48 horas');
    console.log('   - NO hay errores relacionados con agenda en los logs\n');

    // 3. Eliminar documentos en batches
    console.log('🗑️  Eliminando documentos...\n');
    let batch = db.batch();
    let batchCount = 0;
    let batchNumber = 1;
    let totalDeleted = 0;

    for (const doc of agendaSnap.docs) {
      batch.delete(doc.ref);
      batchCount++;

      if (batchCount >= 450) {
        await batch.commit();
        totalDeleted += batchCount;
        console.log(`   ✅ Batch ${batchNumber} completado (${batchCount} docs eliminados) - Total: ${totalDeleted}/${totalDocs}`);
        batch = db.batch();
        batchCount = 0;
        batchNumber++;
      }
    }

    // Commit del último batch
    if (batchCount > 0) {
      await batch.commit();
      totalDeleted += batchCount;
      console.log(`   ✅ Batch ${batchNumber} completado (${batchCount} docs eliminados) - Total: ${totalDeleted}/${totalDocs}`);
    }

    console.log();
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ LIMPIEZA COMPLETADA EXITOSAMENTE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\nDocumentos eliminados: ${totalDeleted}`);
    console.log('La colección "agenda" ha sido eliminada completamente.\n');

    // 4. Verificación final
    console.log('🔍 Verificando limpieza...');
    const verifySnap = await db.collection('agenda').get();

    if (verifySnap.size === 0) {
      console.log('✅ Verificación exitosa: La colección está vacía\n');
    } else {
      console.warn(`⚠️  Advertencia: Aún quedan ${verifySnap.size} documentos en la colección\n`);
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
}

// Ejecutar limpieza
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║      LIMPIEZA DE COLECCIÓN ANTIGUA "agenda"               ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

cleanupOldAgenda()
  .then(() => {
    console.log('✅ Script finalizado exitosamente\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Script finalizado con error:', error);
    process.exit(1);
  });

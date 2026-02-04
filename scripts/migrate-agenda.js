const admin = require('firebase-admin');

// Inicializar Firebase Admin
// IMPORTANTE: Debes descargar el Service Account Key desde Firebase Console
// y guardarlo como serviceAccountKey.json en esta carpeta
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function migrateAgenda() {
  console.log('🚀 Iniciando migración de agenda de colección global a subcolección...\n');

  try {
    // 1. Obtener todos los slots de la colección global
    console.log('📊 Obteniendo slots de colección global "agenda"...');
    const agendaSnap = await db.collection('agenda').get();
    console.log(`   Total slots encontrados: ${agendaSnap.size}\n`);

    if (agendaSnap.size === 0) {
      console.log('⚠️  No hay slots para migrar. Finalizando.\n');
      return;
    }

    // 2. Agrupar slots por eventId
    console.log('📂 Agrupando slots por eventId...');
    const slotsByEvent = {};
    let slotsWithoutEventId = 0;

    agendaSnap.forEach(doc => {
      const data = doc.data();
      if (!data.eventId) {
        console.warn(`   ⚠️  Slot sin eventId encontrado: ${doc.id}`);
        slotsWithoutEventId++;
        return;
      }
      if (!slotsByEvent[data.eventId]) {
        slotsByEvent[data.eventId] = [];
      }
      slotsByEvent[data.eventId].push({ id: doc.id, data });
    });

    const eventIds = Object.keys(slotsByEvent);
    console.log(`   Eventos encontrados: ${eventIds.length}`);
    if (slotsWithoutEventId > 0) {
      console.log(`   ⚠️  Slots sin eventId (no migrados): ${slotsWithoutEventId}\n`);
    } else {
      console.log();
    }

    // 3. Migrar slots por evento
    console.log('🔄 Iniciando migración por evento...\n');
    let totalMigrated = 0;
    let totalErrors = 0;

    for (const [eventId, slots] of Object.entries(slotsByEvent)) {
      console.log(`📦 Migrando evento: ${eventId} (${slots.length} slots)`);

      try {
        // Usar batches para operaciones eficientes (Firestore limit: 500 ops per batch)
        let batch = db.batch();
        let batchCount = 0;
        let batchNumber = 1;

        for (const slot of slots) {
          // Copiar datos sin el campo eventId (es redundante en subcoleción)
          const newData = { ...slot.data };
          delete newData.eventId;

          // Crear referencia a la nueva ubicación
          const newRef = db.collection('events').doc(eventId)
            .collection('agenda').doc(slot.id);

          batch.set(newRef, newData);
          batchCount++;

          // Commit batch si alcanzamos el límite de 450 (margen de seguridad)
          if (batchCount >= 450) {
            await batch.commit();
            console.log(`   ✅ Batch ${batchNumber} completado (${batchCount} slots)`);
            batch = db.batch();
            batchCount = 0;
            batchNumber++;
          }
        }

        // Commit del último batch si tiene operaciones pendientes
        if (batchCount > 0) {
          await batch.commit();
          console.log(`   ✅ Batch ${batchNumber} completado (${batchCount} slots)`);
        }

        totalMigrated += slots.length;
        console.log(`   ✅ Evento ${eventId} migrado exitosamente\n`);

      } catch (error) {
        console.error(`   ❌ Error migrando evento ${eventId}:`, error.message);
        totalErrors++;
      }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📈 RESUMEN DE MIGRACIÓN');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total de eventos: ${eventIds.length}`);
    console.log(`Total de slots migrados: ${totalMigrated}`);
    console.log(`Errores: ${totalErrors}`);
    console.log();

    // 4. Validación
    console.log('🔍 Validando migración...\n');
    let validationErrors = 0;

    for (const [eventId, slots] of Object.entries(slotsByEvent)) {
      const newSnap = await db.collection('events').doc(eventId)
        .collection('agenda').get();

      if (newSnap.size !== slots.length) {
        console.error(`❌ ${eventId}: Esperados ${slots.length} slots, encontrados ${newSnap.size}`);
        validationErrors++;
      } else {
        console.log(`✅ ${eventId}: ${newSnap.size} slots validados`);
      }
    }

    console.log();
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (validationErrors === 0 && totalErrors === 0) {
      console.log('✅ MIGRACIÓN COMPLETADA EXITOSAMENTE');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('\n📝 Próximos pasos:');
      console.log('   1. Actualizar el código de la aplicación');
      console.log('   2. Hacer deploy del código actualizado');
      console.log('   3. Monitorear por 24-48 horas');
      console.log('   4. Eliminar colección antigua "agenda" si todo funciona correctamente');
      console.log('   5. Ejecutar scripts/cleanup-old-agenda.js para limpieza final\n');
    } else {
      console.log('⚠️  MIGRACIÓN COMPLETADA CON ERRORES');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`\nErrores de migración: ${totalErrors}`);
      console.log(`Errores de validación: ${validationErrors}`);
      console.log('\n⚠️  Revisa los errores antes de proceder con el deploy del código.\n');
    }

  } catch (error) {
    console.error('\n❌ ERROR CRÍTICO:', error);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
}

// Ejecutar migración
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  MIGRACIÓN DE AGENDA: COLECCIÓN GLOBAL → SUBCOLECCIÓN     ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

migrateAgenda()
  .then(() => {
    console.log('✅ Script finalizado exitosamente\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Script finalizado con error:', error);
    process.exit(1);
  });

/**
 * Script de migración para convertir eventos de un solo día a soporte multi-día
 * 
 * Este script:
 * 1. Convierte eventDate → eventDates (array)
 * 2. Agrega campo 'date' a todos los slots de agenda existentes
 * 3. Agrega campo 'meetingDate' a reuniones que no lo tengan
 * 
 * IMPORTANTE: Ejecutar en ambiente de prueba primero
 */

import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  getDocs, 
  doc, 
  updateDoc,
  writeBatch 
} from "firebase/firestore";

// Configuración de Firebase (usar las mismas credenciales del proyecto)
const firebaseConfig = {
  // Copiar de .env o firebaseConfig.js
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function migrateEvent(eventId) {
  console.log(`\n📅 Migrando evento: ${eventId}`);
  
  try {
    // 1. Leer configuración del evento
    const eventRef = doc(db, "events", eventId);
    const eventSnap = await getDocs(collection(db, "events"));
    const eventDoc = eventSnap.docs.find(d => d.id === eventId);
    
    if (!eventDoc) {
      console.error(`❌ Evento ${eventId} no encontrado`);
      return;
    }
    
    const eventData = eventDoc.data();
    const config = eventData.config || {};
    
    // 2. Migrar eventDate → eventDates
    if (!config.eventDates && config.eventDate) {
      console.log(`  ✅ Convirtiendo eventDate → eventDates`);
      const eventDates = [config.eventDate];
      
      await updateDoc(eventRef, {
        "config.eventDates": eventDates,
        // Mantener eventDate para compatibilidad
      });
      
      console.log(`  ✅ eventDates: ${eventDates.join(", ")}`);
    } else if (config.eventDates) {
      console.log(`  ℹ️  Ya tiene eventDates: ${config.eventDates.join(", ")}`);
    }
    
    // 3. Migrar slots de agenda (agregar campo 'date')
    const agendaSnap = await getDocs(collection(db, "events", eventId, "agenda"));
    console.log(`  📋 Migrando ${agendaSnap.size} slots de agenda...`);
    
    const eventDate = config.eventDates?.[0] || config.eventDate;
    if (!eventDate) {
      console.warn(`  ⚠️  No se encontró fecha del evento, saltando migración de agenda`);
    } else {
      let batch = writeBatch(db);
      let batchCount = 0;
      let totalUpdated = 0;
      
      for (const slotDoc of agendaSnap.docs) {
        const slotData = slotDoc.data();
        
        // Solo actualizar si no tiene campo 'date'
        if (!slotData.date) {
          const slotRef = doc(db, "events", eventId, "agenda", slotDoc.id);
          batch.update(slotRef, { date: eventDate });
          batchCount++;
          totalUpdated++;
          
          // Firestore limita a 500 operaciones por batch
          if (batchCount >= 500) {
            await batch.commit();
            console.log(`    ✅ Batch de ${batchCount} slots actualizado`);
            batch = writeBatch(db);
            batchCount = 0;
          }
        }
      }
      
      // Commit del último batch
      if (batchCount > 0) {
        await batch.commit();
        console.log(`    ✅ Batch final de ${batchCount} slots actualizado`);
      }
      
      console.log(`  ✅ Total slots actualizados: ${totalUpdated}`);
    }
    
    // 4. Migrar reuniones (agregar campo 'meetingDate' si no existe)
    const meetingsSnap = await getDocs(collection(db, "events", eventId, "meetings"));
    console.log(`  🤝 Migrando ${meetingsSnap.size} reuniones...`);
    
    let batch = writeBatch(db);
    let batchCount = 0;
    let totalUpdated = 0;
    
    for (const meetingDoc of meetingsSnap.docs) {
      const meetingData = meetingDoc.data();
      
      // Solo actualizar si no tiene campo 'meetingDate'
      if (!meetingData.meetingDate && eventDate) {
        const meetingRef = doc(db, "events", eventId, "meetings", meetingDoc.id);
        batch.update(meetingRef, { meetingDate: eventDate });
        batchCount++;
        totalUpdated++;
        
        if (batchCount >= 500) {
          await batch.commit();
          console.log(`    ✅ Batch de ${batchCount} reuniones actualizado`);
          batch = writeBatch(db);
          batchCount = 0;
        }
      }
    }
    
    if (batchCount > 0) {
      await batch.commit();
      console.log(`    ✅ Batch final de ${batchCount} reuniones actualizado`);
    }
    
    console.log(`  ✅ Total reuniones actualizadas: ${totalUpdated}`);
    console.log(`✅ Migración completada para evento ${eventId}\n`);
    
  } catch (error) {
    console.error(`❌ Error migrando evento ${eventId}:`, error);
  }
}

async function migrateAllEvents() {
  console.log("🚀 Iniciando migración de eventos a soporte multi-día\n");
  
  try {
    const eventsSnap = await getDocs(collection(db, "events"));
    console.log(`📊 Total de eventos encontrados: ${eventsSnap.size}\n`);
    
    for (const eventDoc of eventsSnap.docs) {
      await migrateEvent(eventDoc.id);
    }
    
    console.log("\n✅ ¡Migración completada exitosamente!");
    console.log("\n⚠️  IMPORTANTE: Verifica los datos en Firebase Console antes de usar en producción");
    
  } catch (error) {
    console.error("❌ Error en la migración:", error);
  }
}

// Ejecutar migración
// Para un evento específico: migrateEvent("EVENT_ID")
// Para todos los eventos: migrateAllEvents()

const args = process.argv.slice(2);
if (args.length > 0 && args[0] !== "all") {
  // Migrar evento específico
  migrateEvent(args[0]);
} else {
  // Migrar todos los eventos
  migrateAllEvents();
}

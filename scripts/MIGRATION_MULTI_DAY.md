# Migración a Soporte Multi-Día

Este documento explica cómo migrar eventos existentes para soportar múltiples días.

## ⚠️ IMPORTANTE

**EJECUTAR PRIMERO EN AMBIENTE DE PRUEBA**

Antes de ejecutar en producción:
1. Hacer backup de Firestore
2. Probar en un evento de prueba
3. Verificar resultados en Firebase Console

## Cambios Realizados

### 1. Estructura de Datos

#### Eventos (`events/{eventId}`)
```javascript
// ANTES
config: {
  eventDate: "2024-03-15"
}

// DESPUÉS
config: {
  eventDates: ["2024-03-15", "2024-03-16"], // Array de fechas
  eventDate: "2024-03-15" // Mantenido para compatibilidad
}
```

#### Agenda (`events/{eventId}/agenda/{slotId}`)
```javascript
// ANTES
{
  startTime: "09:00",
  endTime: "09:15",
  tableNumber: 1
}

// DESPUÉS
{
  date: "2024-03-15", // NUEVO campo
  startTime: "09:00",
  endTime: "09:15",
  tableNumber: 1
}
```

#### Reuniones (`events/{eventId}/meetings/{meetingId}`)
```javascript
// Ya existía meetingDate, pero se asegura que todos lo tengan
{
  meetingDate: "2024-03-15",
  timeSlot: "09:00 - 09:15",
  // ... otros campos
}
```

## Ejecución del Script

### Opción 1: Migrar un evento específico
```bash
cd scripts
node migrate-multi-day-events.js EVENT_ID
```

### Opción 2: Migrar todos los eventos
```bash
cd scripts
node migrate-multi-day-events.js all
```

## Verificación Post-Migración

1. **Firebase Console**
   - Verificar que `config.eventDates` existe en eventos
   - Verificar que slots de agenda tienen campo `date`
   - Verificar que reuniones tienen campo `meetingDate`

2. **Aplicación**
   - Crear nuevo evento con múltiples días
   - Verificar que se generan slots para cada día
   - Agendar reunión y verificar que se guarda la fecha correcta

## Rollback

Si algo sale mal, puedes revertir los cambios:

```javascript
// Eliminar eventDates y mantener solo eventDate
await updateDoc(eventRef, {
  "config.eventDates": deleteField()
});

// Eliminar campo date de slots
// (ejecutar para cada slot)
await updateDoc(slotRef, {
  date: deleteField()
});
```

## Compatibilidad

El código mantiene compatibilidad hacia atrás:
- Si `eventDates` no existe, usa `eventDate`
- Si un slot no tiene `date`, usa `eventDate` del evento
- Eventos de un solo día funcionan igual que antes

## Próximos Pasos

Después de la migración:
1. ✅ Configurar eventos con múltiples días en el admin
2. ✅ Probar selección de slots por día
3. ✅ Verificar notificaciones incluyen fecha correcta
4. ✅ Probar filtros y visualización de reuniones por día

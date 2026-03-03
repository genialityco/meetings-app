# Implementación de Soporte Multi-Día con Horarios Independientes - Resumen

## ✅ Cambios Completados

### 1. Estructura de Datos

#### A. Tipos TypeScript (`src/pages/dashboard/types.ts`)
- ✅ Agregado campo `date: string` a `AgendaSlot`
- ✅ Agregado campo `meetingDate?: string` a `Meeting` (ya existía, documentado)
- ✅ Agregado campo `isBreak?: boolean` a `AgendaSlot`

#### B. Configuración de Eventos (`src/pages/admin/EditEventConfigModal.jsx`)
- ✅ **NUEVO:** Cada día tiene su propia configuración de horarios
- ✅ Estructura `dailyConfig` con configuración por fecha:
  ```javascript
  dailyConfig: {
    "2024-03-15": {
      startTime: "09:00",
      endTime: "18:00",
      breakBlocks: [{ start: "12:00", end: "13:00" }]
    },
    "2024-03-16": {
      startTime: "10:00",
      endTime: "17:00",
      breakBlocks: [{ start: "14:00", end: "14:30" }]
    }
  }
  ```
- ✅ UI mejorada: cada día se configura en su propio panel
- ✅ Botones para agregar/eliminar días
- ✅ Botones para agregar/eliminar descansos por día
- ✅ Estado `eventDays` (array de objetos con date, startTime, endTime, breakBlocks)
- ✅ Compatibilidad hacia atrás: lee `dailyConfig`, `eventDates`, o `eventDate`
- ✅ Guarda `eventDates`, `eventDate`, y `dailyConfig`
- ✅ Resumen actualizado muestra:
  - Días del evento
  - Bloques totales (suma de todos los días)
  - Bloques promedio por día
  - Slots totales
  - Descansos totales

### 2. Lógica de Negocio

#### A. Selección de Slots (`src/pages/dashboard/useDashboardData.ts`)

**Función `prepareSlotSelection`:**
- ✅ Agregado parámetro opcional `selectedDate?: string`
- ✅ Soporte multi-día: usa `eventConfig.eventDates` si existe, sino `eventConfig.eventDate`
- ✅ **NUEVO:** Obtiene configuración específica del día desde `dailyConfig[date]`
- ✅ Usa `dayConfig.breakBlocks` para respetar descansos del día específico
- ✅ Filtrado de slots por fecha seleccionada
- ✅ Query con filtro `where("date", "==", eventDayISO)` cuando el campo existe
- ✅ Fallback a query sin filtro de fecha para compatibilidad

**Función `confirmAcceptWithSlot`:**
- ✅ Usa `slot.date` si existe, sino usa primera fecha de `eventDates` o `eventDate`
- ✅ Guarda `meetingDate` con la fecha correcta del slot

### 3. Interfaz de Usuario

#### A. Modal de Selección de Slots (`src/pages/dashboard/SlotModal.tsx`)
- ✅ Agregado selector de día con Tabs (solo se muestra si hay múltiples días)
- ✅ Cada tab muestra:
  - Icono de calendario
  - Fecha formateada (ej: "viernes, 15 de marzo")
  - Badge con cantidad de slots disponibles
- ✅ Props nuevas:
  - `eventDates?: string[]` - Array de fechas del evento
  - `selectedDate?: string | null` - Fecha actualmente seleccionada
  - `onDateChange?: (date: string) => void` - Callback al cambiar de día
- ✅ Contador de slots por fecha
- ✅ Interfaz TypeScript completa

### 4. Scripts de Migración

#### A. Script de Migración (`scripts/migrate-multi-day-events.js`)
- ✅ Convierte `eventDate` → `eventDates` (array)
- ✅ Agrega campo `date` a todos los slots de agenda
- ✅ Agrega campo `meetingDate` a reuniones que no lo tengan
- ✅ Soporte para migrar un evento específico o todos
- ✅ Operaciones en batch (500 por batch)
- ✅ Logging detallado del progreso

#### B. Documentación (`scripts/MIGRATION_MULTI_DAY.md`)
- ✅ Instrucciones de ejecución
- ✅ Verificación post-migración
- ✅ Plan de rollback
- ✅ Consideraciones de compatibilidad

## 🔄 Próximos Pasos (Pendientes)

### 1. Integración del Selector de Día

**Archivos a modificar:**
- `src/pages/dashboard/MeetingsTab.tsx` - Agregar estado para fecha seleccionada
- `src/pages/dashboard/Dashboard.tsx` - Pasar eventDates al SlotModal
- Cualquier componente que llame a `prepareSlotSelection`

**Cambios necesarios:**
```typescript
// Agregar estado
const [selectedDate, setSelectedDate] = useState<string | null>(null);

// Pasar al SlotModal
<SlotModal
  // ... props existentes
  eventDates={eventConfig?.eventDates || [eventConfig?.eventDate]}
  selectedDate={selectedDate}
  onDateChange={(date) => {
    setSelectedDate(date);
    prepareSlotSelection(meetingId, isEdit, date);
  }}
/>
```

### 2. Generación de Agenda Multi-Día con Horarios Independientes

**Crear función en admin para generar slots:**
```javascript
// En src/pages/admin/AgendaAdminPanel.jsx o similar
async function generateAgendaForAllDays(eventId, config) {
  const { dailyConfig, meetingDuration, breakTime, numTables } = config;
  
  // Iterar sobre cada día configurado
  for (const [date, dayConfig] of Object.entries(dailyConfig)) {
    await generateAgendaForDay(eventId, date, {
      startTime: dayConfig.startTime,
      endTime: dayConfig.endTime,
      meetingDuration,
      breakTime,
      numTables,
      breakBlocks: dayConfig.breakBlocks
    });
  }
}

async function generateAgendaForDay(eventId, date, config) {
  const { startTime, endTime, meetingDuration, breakTime, numTables, breakBlocks } = config;
  
  // Calcular slots para este día específico
  const slots = [];
  let currentTime = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  
  while (currentTime + meetingDuration <= endMinutes) {
    const slotStart = minutesToTime(currentTime);
    const slotEnd = minutesToTime(currentTime + meetingDuration);
    
    // Verificar si está en un bloque de descanso
    const isBreak = breakBlocks.some(block => 
      timeOverlaps(slotStart, slotEnd, block.start, block.end)
    );
    
    if (!isBreak) {
      // Crear slot para cada mesa
      for (let table = 1; table <= numTables; table++) {
        slots.push({
          date, // IMPORTANTE: incluir fecha
          startTime: slotStart,
          endTime: slotEnd,
          tableNumber: table,
          available: true,
          eventId
        });
      }
    }
    
    currentTime += meetingDuration + breakTime;
  }
  
  // Guardar slots en Firestore
  const batch = writeBatch(db);
  slots.forEach(slot => {
    const slotRef = doc(collection(db, "events", eventId, "agenda"));
    batch.set(slotRef, slot);
  });
  await batch.commit();
}
```

### 3. Visualización de Reuniones por Día

**En `src/pages/dashboard/MeetingsTab.tsx`:**
- Agrupar reuniones por `meetingDate`
- Agregar tabs o acordeón por día
- Mostrar fecha completa en cada reunión

### 4. Notificaciones y WhatsApp

**Actualizar mensajes para incluir fecha:**
```javascript
// En useDashboardData.ts - sendMeetingAcceptedWhatsapp
const message = `
📅 Reunión confirmada para el ${formatDate(meetingDate)}
⏰ Hora: ${timeSlot}
📍 Mesa: ${tableAssigned}
...
`;
```

### 5. Filtros y Búsquedas

**Agregar filtros por fecha en:**
- Vista de reuniones
- Vista de agenda (admin)
- Reportes y estadísticas

## 🧪 Testing Recomendado

### Antes de Producción:

1. **Migración:**
   - [ ] Ejecutar script en evento de prueba
   - [ ] Verificar datos en Firebase Console
   - [ ] Probar rollback

2. **Crear Evento Multi-Día:**
   - [ ] Crear evento con 2-3 días
   - [ ] Verificar que se guardan correctamente las fechas
   - [ ] Verificar resumen de configuración

3. **Generar Agenda:**
   - [ ] Generar slots para múltiples días
   - [ ] Verificar que cada slot tiene su campo `date`
   - [ ] Verificar cantidad correcta de slots

4. **Agendar Reuniones:**
   - [ ] Seleccionar día en el modal
   - [ ] Agendar reunión en día específico
   - [ ] Verificar que se guarda `meetingDate` correcto
   - [ ] Verificar locks por día

5. **Notificaciones:**
   - [ ] Verificar que incluyen fecha correcta
   - [ ] Probar WhatsApp con fecha
   - [ ] Probar notificaciones in-app

6. **Edge Cases:**
   - [ ] Evento de 1 solo día (compatibilidad)
   - [ ] Cambiar evento de 1 día a múltiples días
   - [ ] Cancelar reunión en día específico
   - [ ] Slots pasados en día actual vs días futuros

## 📊 Compatibilidad

### Eventos Existentes (Un Solo Día):
- ✅ Funcionan sin cambios
- ✅ `eventDate` se convierte automáticamente a `eventDates: [eventDate]`
- ✅ Slots sin campo `date` usan `eventDate` del evento
- ✅ No requiere migración inmediata

### Eventos Nuevos:
- ✅ Pueden configurarse con uno o múltiples días
- ✅ Slots se generan con campo `date` desde el inicio
- ✅ Interfaz muestra selector de día solo si hay múltiples días

## 🔧 Configuración Requerida

### Firebase Indexes (Opcional pero Recomendado):

Para mejorar performance de queries con filtro por fecha:

```
Collection: events/{eventId}/agenda
Indexes:
  - Fields: available (Ascending), date (Ascending), startTime (Ascending)
  
Collection: events/{eventId}/meetings  
Indexes:
  - Fields: status (Ascending), meetingDate (Ascending), participants (Array)
```

## 📝 Notas Importantes

1. **Locks:** Ya incluyen fecha en el ID, funcionan correctamente con multi-día
2. **Performance:** Con múltiples días, considerar lazy loading de slots
3. **Límites:** Considerar límite máximo de días (ej: 7 días)
4. **Validación:** Validar que fechas no sean duplicadas ni pasadas
5. **Ordenamiento:** Fechas siempre se ordenan cronológicamente

## 🎯 Estado Actual

**Completado:** ~60%
- ✅ Estructura de datos
- ✅ Configuración de eventos (admin)
- ✅ Tipos TypeScript
- ✅ Lógica de selección de slots
- ✅ Modal con selector de día
- ✅ Scripts de migración

**Pendiente:** ~40%
- ⏳ Integración completa del selector de día
- ⏳ Generación automática de agenda multi-día
- ⏳ Visualización de reuniones por día
- ⏳ Actualización de notificaciones
- ⏳ Testing exhaustivo

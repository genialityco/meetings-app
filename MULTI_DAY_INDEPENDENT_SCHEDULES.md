# Soporte Multi-Día con Horarios Independientes - Guía Completa

## 🎯 Objetivo

Permitir que cada día de un evento tenga su propia configuración de horarios (hora inicio, hora fin, bloques de descanso), proporcionando máxima flexibilidad para eventos de múltiples días.

## 📊 Estructura de Datos

### Configuración del Evento

```javascript
// events/{eventId}
{
  eventName: "Mi Evento 2024",
  config: {
    // Configuración global
    maxPersons: 100,
    numTables: 50,
    meetingDuration: 15,
    breakTime: 5,
    tableNames: ["Mesa 1", "Mesa 2", ...],
    maxMeetingsPerUser: 10,
    eventLocation: "Centro de Convenciones",
    
    // Fechas del evento
    eventDates: ["2024-03-15", "2024-03-16", "2024-03-17"],
    eventDate: "2024-03-15", // Primera fecha (compatibilidad)
    
    // ⭐ NUEVO: Configuración específica por día
    dailyConfig: {
      "2024-03-15": {
        startTime: "09:00",
        endTime: "18:00",
        breakBlocks: [
          { start: "12:00", end: "13:00" }, // Almuerzo
          { start: "15:30", end: "16:00" }  // Coffee break
        ]
      },
      "2024-03-16": {
        startTime: "10:00",
        endTime: "17:00",
        breakBlocks: [
          { start: "14:00", end: "14:30" }  // Solo un descanso
        ]
      },
      "2024-03-17": {
        startTime: "09:00",
        endTime: "14:00",
        breakBlocks: [] // Sin descansos
      }
    },
    
    // Mantener para compatibilidad con eventos antiguos
    startTime: "09:00",
    endTime: "18:00",
    breakBlocks: []
  }
}
```

### Slots de Agenda

```javascript
// events/{eventId}/agenda/{slotId}
{
  date: "2024-03-15", // ⭐ Fecha específica del slot
  startTime: "09:00",
  endTime: "09:15",
  tableNumber: 1,
  available: true,
  eventId: "EVENT_ID",
  meetingId: null
}
```

### Reuniones

```javascript
// events/{eventId}/meetings/{meetingId}
{
  meetingDate: "2024-03-15", // ⭐ Fecha específica de la reunión
  timeSlot: "09:00 - 09:15",
  tableAssigned: "1",
  status: "accepted",
  participants: ["user1", "user2"],
  // ... otros campos
}
```

## 🎨 Interfaz de Usuario

### Panel de Configuración (Admin)

Cada día se configura en su propio panel con:
- Fecha (date picker)
- Hora de inicio (time picker)
- Hora de fin (time picker)
- Bloques de descanso (lista editable)
- Botón para eliminar el día

Botones globales:
- "Añadir día al evento" - Agrega un nuevo día con valores por defecto
- Resumen calculado muestra estadísticas de todos los días

### Modal de Selección de Slots (Usuario)

Si hay múltiples días:
- Tabs para seleccionar el día
- Cada tab muestra:
  - Fecha formateada (ej: "viernes, 15 de marzo")
  - Badge con cantidad de slots disponibles
- Selectores de hora y mesa filtrados por día seleccionado

Si hay un solo día:
- No se muestran los tabs
- Comportamiento idéntico al anterior

## 🔧 Lógica de Negocio

### Generación de Slots

La función `generateAgendaForEvent` en `src/pages/admin/EventAdmin.jsx` ahora:

1. Lee `dailyConfig` del evento
2. Itera sobre cada día configurado
3. Genera slots usando la configuración específica de cada día
4. **Incluye el campo `date` en cada slot**

```javascript
// Ejemplo de slot generado
{
  date: "2024-03-15",      // ⭐ Fecha del slot
  startTime: "09:00",
  endTime: "09:15",
  tableNumber: 1,
  available: true
}
```

**Proceso de generación:**
```javascript
for (const [date, dayConfig] of Object.entries(dailyConfig)) {
  const { startTime, endTime, breakBlocks } = dayConfig;
  
  // Calcular slots para este día
  // ...
  
  const slotData = {
    date,              // ⭐ Incluir fecha
    tableNumber,
    startTime,
    endTime,
    available: true,
  };
  
  await addDoc(collection(db, "events", eventId, "agenda"), slotData);
}
```

### Selección de Slots

```javascript
// 1. Usuario selecciona día en el modal
const selectedDate = "2024-03-16";

// 2. Se obtiene configuración del día
const dayConfig = eventConfig.dailyConfig[selectedDate] || {
  startTime: eventConfig.startTime,
  endTime: eventConfig.endTime,
  breakBlocks: eventConfig.breakBlocks
};

// 3. Se filtran slots por fecha
const slots = await getSlots(eventId, {
  date: selectedDate,
  available: true
});

// 4. Se aplican reglas de descanso del día específico
const validSlots = slots.filter(slot => 
  !overlapsBreakBlock(slot, dayConfig.breakBlocks)
);
```

## 🔄 Compatibilidad

### Eventos Existentes (Sin dailyConfig)

```javascript
// Fallback automático
const dayConfig = eventConfig.dailyConfig?.[date] || {
  startTime: eventConfig.startTime,
  endTime: eventConfig.endTime,
  breakBlocks: eventConfig.breakBlocks || []
};
```

### Eventos de Un Solo Día

- Funcionan exactamente igual que antes
- `dailyConfig` tiene una sola entrada
- UI no muestra tabs de selección de día

### Migración Gradual

1. Eventos antiguos siguen funcionando sin cambios
2. Al editar un evento antiguo, se crea `dailyConfig` automáticamente
3. Nuevos eventos usan `dailyConfig` desde el inicio

## 📝 Ejemplos de Uso

### Ejemplo 1: Evento de 3 Días con Horarios Diferentes

```javascript
{
  eventDates: ["2024-06-10", "2024-06-11", "2024-06-12"],
  dailyConfig: {
    "2024-06-10": { // Lunes - Día completo
      startTime: "08:00",
      endTime: "18:00",
      breakBlocks: [
        { start: "10:30", end: "11:00" },
        { start: "13:00", end: "14:00" },
        { start: "16:00", end: "16:30" }
      ]
    },
    "2024-06-11": { // Martes - Medio día
      startTime: "09:00",
      endTime: "14:00",
      breakBlocks: [
        { start: "11:30", end: "12:00" }
      ]
    },
    "2024-06-12": { // Miércoles - Jornada intensiva
      startTime: "08:00",
      endTime: "15:00",
      breakBlocks: [] // Sin descansos
    }
  }
}
```

### Ejemplo 2: Evento de Fin de Semana

```javascript
{
  eventDates: ["2024-07-20", "2024-07-21"],
  dailyConfig: {
    "2024-07-20": { // Sábado - Horario relajado
      startTime: "10:00",
      endTime: "16:00",
      breakBlocks: [
        { start: "13:00", end: "14:00" }
      ]
    },
    "2024-07-21": { // Domingo - Medio día
      startTime: "10:00",
      endTime: "13:00",
      breakBlocks: []
    }
  }
}
```

## ✅ Ventajas de Esta Implementación

1. **Flexibilidad Total**: Cada día puede tener horarios completamente diferentes
2. **Casos de Uso Reales**: 
   - Eventos que empiezan tarde el primer día
   - Días con jornadas reducidas
   - Diferentes descansos según el día
3. **Compatibilidad**: Eventos antiguos siguen funcionando
4. **Escalable**: Fácil agregar más configuraciones por día en el futuro
5. **UI Intuitiva**: Cada día se configura de forma independiente y visual

## 🚀 Próximos Pasos

1. ✅ Ejecutar script de migración
2. ✅ Crear evento de prueba con múltiples días
3. ✅ Generar agenda para cada día
4. ✅ Probar selección de slots por día
5. ✅ Verificar que se respetan los horarios de cada día
6. ✅ Probar notificaciones con fechas correctas

## 📚 Archivos Modificados

1. `src/pages/admin/EditEventConfigModal.jsx` - UI de configuración por día
2. `src/pages/dashboard/useDashboardData.ts` - Lógica de slots por día
3. `src/pages/dashboard/SlotModal.tsx` - Selector de día
4. `src/pages/dashboard/types.ts` - Tipos actualizados
5. `scripts/migrate-multi-day-events.js` - Script de migración
6. `MULTI_DAY_IMPLEMENTATION.md` - Documentación completa

## 🎓 Notas Técnicas

### Performance

- Los slots se filtran por fecha en la query de Firestore
- Cada día carga solo sus propios slots
- No hay impacto en performance vs eventos de un día

### Validaciones Recomendadas

```javascript
// Al guardar configuración
function validateDailyConfig(dailyConfig) {
  for (const [date, config] of Object.entries(dailyConfig)) {
    // Validar que startTime < endTime
    if (config.startTime >= config.endTime) {
      throw new Error(`Día ${date}: hora inicio debe ser menor que hora fin`);
    }
    
    // Validar que breakBlocks estén dentro del horario
    for (const block of config.breakBlocks) {
      if (block.start < config.startTime || block.end > config.endTime) {
        throw new Error(`Día ${date}: descanso fuera del horario del día`);
      }
    }
  }
}
```

### Índices de Firestore Recomendados

```
Collection: events/{eventId}/agenda
Indexes:
  - Fields: date (Ascending), available (Ascending), startTime (Ascending)
  
Collection: events/{eventId}/meetings
Indexes:
  - Fields: meetingDate (Ascending), status (Ascending), participants (Array)
```

## 💡 Tips de Uso

1. **Copiar configuración entre días**: Agregar botón "Copiar del día anterior"
2. **Plantillas**: Guardar configuraciones comunes (ej: "Jornada completa", "Medio día")
3. **Validación visual**: Mostrar preview de slots generados por día
4. **Estadísticas**: Mostrar cuántos slots se generarán por día antes de guardar


## ✅ Cambios Finales Implementados

### Campos Eliminados
- ❌ `eventStartTime` - Eliminado del formulario de configuración
- ❌ `eventEndTime` - Eliminado del formulario de configuración

**Razón:** Cada día ahora tiene su propia configuración de horarios en `dailyConfig`.

**Compatibilidad:** Los campos se mantienen en `Landing.jsx` para mostrar información de eventos antiguos.

### Generación de Agenda Actualizada

La función `generateAgendaForEvent` en `src/pages/admin/EventAdmin.jsx` ahora:

✅ Lee `dailyConfig` para obtener configuración por día
✅ Genera slots para cada día configurado
✅ **Incluye el campo `date` en cada slot generado**
✅ Respeta horarios y descansos específicos de cada día
✅ Mantiene compatibilidad con eventos antiguos

### Ejemplo de Slot Generado

```javascript
{
  date: "2024-03-15",      // ⭐ Fecha específica
  startTime: "09:00",
  endTime: "09:15",
  tableNumber: 1,
  available: true
}
```

## 🎯 Flujo Completo

1. **Admin configura evento:**
   - Agrega días con fechas específicas
   - Configura horarios independientes por día
   - Define descansos específicos por día

2. **Admin genera agenda:**
   - Click en "Generar Agenda"
   - Sistema itera sobre `dailyConfig`
   - Crea slots con campo `date` para cada día

3. **Usuario solicita reunión:**
   - Selecciona día en el modal (si hay múltiples días)
   - Ve slots disponibles del día seleccionado
   - Sistema respeta horarios y descansos del día

4. **Sistema agenda reunión:**
   - Guarda `meetingDate` con fecha del slot
   - Crea locks con fecha específica
   - Envía notificaciones con fecha correcta

## 📊 Resumen de Archivos Modificados

| Archivo | Cambio Principal |
|---------|------------------|
| `EditEventConfigModal.jsx` | UI por día, eliminado eventStartTime/eventEndTime |
| `EventAdmin.jsx` | Generación de agenda con campo `date` |
| `useDashboardData.ts` | Usa `dayConfig` para cada día |
| `SlotModal.tsx` | Selector de día con tabs |
| `types.ts` | Campo `date` en AgendaSlot |

## ✨ Resultado Final

Ahora el sistema soporta completamente eventos multi-día donde:
- ✅ Cada día tiene horarios independientes
- ✅ Cada día tiene descansos independientes
- ✅ Los slots se generan con el campo `date`
- ✅ La selección de slots filtra por día
- ✅ Las reuniones se guardan con fecha específica
- ✅ Compatibilidad total con eventos existentes


## 🔍 Vista de Agenda del Admin

### Selector de Día

La vista de agenda (`AgendaAdminPanel.jsx`) ahora incluye:

✅ **Selector de día** (solo se muestra si hay múltiples días)
- Dropdown con todas las fechas del evento
- Formato amigable: "viernes, 15 de marzo de 2024"
- Filtra slots automáticamente por fecha seleccionada

✅ **Estadísticas por día**
- Total de slots
- Slots disponibles
- Slots ocupados
- Bloques de descanso

✅ **Tabla mejorada**
- Columna de fecha (solo si hay múltiples días)
- Ordenamiento por fecha y hora
- Estados visuales con badges
- Acciones por slot (liberar, bloquear, cancelar)

### Características

**Si hay múltiples días:**
```
┌─────────────────────────────────────┐
│ Seleccionar día: [viernes, 15...▼] │
│ 150 slots | 120 disponibles | ...  │
└─────────────────────────────────────┘
│ Fecha      │ Hora      │ Mesa │ ... │
│ 2024-03-15 │ 09:00-... │ 1    │ ... │
```

**Si hay un solo día:**
```
┌─────────────────────────────────────┐
│ 150 slots | 120 disponibles | ...  │
└─────────────────────────────────────┘
│ Hora      │ Mesa │ Estado │ Acción │
│ 09:00-... │ 1    │ ...    │ ...    │
```

### Compatibilidad

- ✅ Eventos antiguos sin campo `date`: muestra todos los slots
- ✅ Eventos nuevos con campo `date`: filtra por día seleccionado
- ✅ Detección automática de múltiples días

### Flujo de Uso

1. Admin entra a "Ver Agenda"
2. Si hay múltiples días, selecciona el día deseado
3. Ve solo los slots de ese día
4. Puede realizar acciones (liberar, bloquear, cancelar)
5. Cambia de día para ver otros slots

## 📊 Resumen Final de Implementación

| Componente | Funcionalidad |
|------------|---------------|
| `EditEventConfigModal.jsx` | Configurar días con horarios independientes |
| `EventAdmin.jsx` | Generar agenda con campo `date` |
| `AgendaAdminPanel.jsx` | Ver y gestionar agenda por día |
| `SlotModal.tsx` | Seleccionar día al agendar reunión |
| `useDashboardData.ts` | Lógica de slots por día |

## ✨ Experiencia Completa

### Para el Admin:
1. Configura evento con múltiples días y horarios diferentes
2. Genera agenda (slots se crean con campo `date`)
3. Ve agenda filtrada por día
4. Gestiona slots por día

### Para el Usuario:
1. Solicita reunión
2. Selecciona día (si hay múltiples)
3. Ve slots disponibles del día
4. Confirma reunión

### Sistema:
1. Guarda reunión con `meetingDate`
2. Crea locks con fecha específica
3. Envía notificaciones con fecha correcta
4. Respeta horarios y descansos de cada día

## 🎉 Implementación Completa

El sistema ahora soporta completamente:
- ✅ Eventos multi-día con horarios independientes
- ✅ Generación de agenda con campo `date`
- ✅ Selección de día en modal de slots
- ✅ Vista de agenda filtrada por día
- ✅ Gestión de slots por día
- ✅ Compatibilidad total con eventos existentes
- ✅ UI intuitiva y responsive


## 🎯 Modal de Selección de Slots (Usuario) - Implementación Completa

### Funcionalidad Implementada

El `SlotModal.tsx` ahora permite al usuario:

✅ **Seleccionar el día** (si hay múltiples días)
- Tabs con cada fecha del evento
- Formato amigable: "viernes, 15 de marzo"
- Badge con cantidad de slots disponibles por día

✅ **Seleccionar la hora**
- Dropdown con horarios disponibles del día seleccionado
- Agrupados por rango horario

✅ **Seleccionar la mesa**
- Dropdown con mesas disponibles para el horario seleccionado

✅ **Recarga automática**
- Al cambiar de día, se recargan los slots automáticamente
- Las selecciones de hora y mesa se limpian
- Se filtran slots por la nueva fecha

### Flujo de Usuario

```
1. Usuario acepta solicitud de reunión
   ↓
2. Se abre SlotModal
   ↓
3. Si hay múltiples días:
   - Ve tabs con cada día
   - Selecciona el día deseado
   - Slots se filtran automáticamente
   ↓
4. Selecciona hora del dropdown
   ↓
5. Selecciona mesa del dropdown
   ↓
6. Confirma la reunión
   ↓
7. Sistema guarda con meetingDate correcto
```

### Código Implementado

#### useDashboardData.ts

```typescript
// Estado para fecha seleccionada
const [selectedDate, setSelectedDate] = useState<string | null>(null);

// Función para manejar cambio de fecha
const handleDateChange = (date: string) => {
  setSelectedDate(date);
  setSelectedRange(null);
  setSelectedSlotId(null);
  
  // Recargar slots para la nueva fecha
  if (meetingToAccept?.id || meetingToEdit) {
    const meetingId = meetingToEdit || meetingToAccept?.id;
    const isEdit = !!meetingToEdit;
    prepareSlotSelection(meetingId, isEdit, date);
  }
};

// prepareSlotSelection inicializa selectedDate
const prepareSlotSelection = async (meetingId, isEdit, selectedDate?) => {
  const eventDates = eventConfig.eventDates || [eventConfig.eventDate];
  const eventDayISO = selectedDate || eventDates[0];
  
  // Establecer fecha inicial
  if (!selectedDate) {
    setSelectedDate(eventDayISO);
  }
  
  // Filtrar slots por fecha...
};
```

#### Dashboard.tsx

```typescript
<SlotModal
  // ... props existentes
  eventDates={dashboard.eventConfig?.eventDates || [...]}
  selectedDate={dashboard.selectedDate}
  onDateChange={dashboard.handleDateChange}
/>
```

#### SlotModal.tsx

```typescript
// Tabs para seleccionar día (solo si hay múltiples)
{hasMultipleDays && (
  <Tabs
    value={selectedDate || eventDates[0]}
    onChange={(value) => onDateChange?.(value || eventDates[0])}
  >
    <Tabs.List>
      {eventDates.map((date) => (
        <Tabs.Tab key={date} value={date}>
          <Group gap="xs">
            <Text>{formatDate(date)}</Text>
            <Badge>{slotCountByDate[date] || 0} slots</Badge>
          </Group>
        </Tabs.Tab>
      ))}
    </Tabs.List>
  </Tabs>
)}
```

### Características Especiales

1. **Inicialización Automática**
   - Al abrir el modal, se selecciona automáticamente el primer día
   - Los slots se cargan para ese día

2. **Recarga Inteligente**
   - Al cambiar de día, se limpian las selecciones previas
   - Se recargan solo los slots del nuevo día
   - No se pierde el contexto de la reunión

3. **Contador de Slots**
   - Cada tab muestra cuántos slots hay disponibles
   - Ayuda al usuario a elegir el día con más opciones

4. **Compatibilidad**
   - Si hay un solo día, no se muestran los tabs
   - Funciona igual que antes para eventos de un día

### Ejemplo Visual

**Evento Multi-Día:**
```
┌─────────────────────────────────────────────────┐
│ Selecciona un horario de reunión               │
├─────────────────────────────────────────────────┤
│ [viernes, 15 marzo] [sábado, 16 marzo]         │
│  📅 45 slots        📅 30 slots                 │
├─────────────────────────────────────────────────┤
│ Hora: [09:00 - 09:15 ▼]                        │
│ Mesa: [Mesa 1 ▼]                                │
│ [Confirmar datos]                               │
└─────────────────────────────────────────────────┘
```

**Evento de Un Día:**
```
┌─────────────────────────────────────────────────┐
│ Selecciona un horario de reunión               │
├─────────────────────────────────────────────────┤
│ Hora: [09:00 - 09:15 ▼]                        │
│ Mesa: [Mesa 1 ▼]                                │
│ [Confirmar datos]                               │
└─────────────────────────────────────────────────┘
```

## 🎊 Implementación 100% Completa

### Resumen de Funcionalidades

| Componente | Funcionalidad | Estado |
|------------|---------------|--------|
| EditEventConfigModal | Configurar días con horarios | ✅ |
| EventAdmin | Generar agenda con `date` | ✅ |
| AgendaAdminPanel | Ver agenda por día | ✅ |
| SlotModal | Seleccionar día y hora | ✅ |
| useDashboardData | Lógica multi-día | ✅ |
| Dashboard | Integración completa | ✅ |

### Flujo Completo End-to-End

1. ✅ Admin configura evento con múltiples días
2. ✅ Admin genera agenda (slots con campo `date`)
3. ✅ Admin ve agenda filtrada por día
4. ✅ Usuario solicita reunión
5. ✅ Usuario selecciona día en modal
6. ✅ Usuario selecciona hora y mesa
7. ✅ Sistema guarda con `meetingDate` correcto
8. ✅ Notificaciones incluyen fecha correcta

### Archivos Finales Modificados

1. ✅ `src/pages/admin/EditEventConfigModal.jsx`
2. ✅ `src/pages/admin/EventAdmin.jsx`
3. ✅ `src/pages/admin/AgendaAdminPanel.jsx`
4. ✅ `src/pages/dashboard/SlotModal.tsx`
5. ✅ `src/pages/dashboard/useDashboardData.ts`
6. ✅ `src/pages/dashboard/Dashboard.tsx`
7. ✅ `src/pages/dashboard/types.ts`
8. ✅ `scripts/migrate-multi-day-events.js`

## 🚀 Listo para Producción

El sistema está completamente implementado y listo para:
- ✅ Eventos de un solo día (compatibilidad total)
- ✅ Eventos multi-día con horarios independientes
- ✅ Selección de día por parte del usuario
- ✅ Gestión de agenda por día (admin)
- ✅ Migración de eventos existentes

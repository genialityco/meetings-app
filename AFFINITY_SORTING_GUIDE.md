# Guía de Implementación: Ordenamiento por Afinidad

## Descripción General

El sistema de afinidad calcula automáticamente scores de compatibilidad entre usuarios cuando se registran en un evento. Los scores se almacenan en una subcolección `affinityScores` dentro de cada usuario.

**Importante**: El cálculo es **simétrico** - se calcula una sola vez por par de usuarios y se guarda el mismo score en ambas direcciones. Esto optimiza el rendimiento y asegura consistencia.

## Estructura de Datos

### Subcolección: `users/{userId}/affinityScores/{targetUserId}`

```javascript
{
  targetUserId: "abc123",
  targetName: "Juan Pérez",
  targetCompany: "Empresa XYZ",
  score: 75,  // 0-100
  reasons: [
    "Roles complementarios",
    "Mismo interés principal",
    "3 palabras clave coinciden"
  ],
  eventId: "event123",
  calculatedAt: Timestamp
}
```

## Funciones de Firebase

### 1. `calculateAffinityOnUserCreate` (Trigger automático)
- **Trigger**: Se ejecuta automáticamente cuando se crea un usuario
- **Acción**: Calcula afinidad con todos los usuarios del mismo evento
- **Optimización**: Calcula **una sola vez** por par y guarda el **mismo score** en ambos usuarios
- **Resultado**: Crea documentos en `affinityScores` para ambos usuarios con el mismo puntaje

### 2. `recalculateEventAffinity` (HTTP Function)
- **URL**: `https://[region]-[project].cloudfunctions.net/recalculateEventAffinity`
- **Método**: POST
- **Body**: `{ "eventId": "xxx" }`
- **Uso**: Recalcular afinidad de todos los usuarios (útil después de cambios en el algoritmo)

## Algoritmo de Cálculo de Afinidad

El score se calcula sumando puntos por diferentes criterios:

1. **Roles complementarios** (+30 puntos)
   - Comprador ↔ Vendedor

2. **Mismo interés principal** (+25 puntos)
   - Coincidencia exacta en `interesPrincipal`

3. **Keywords coincidentes** (+20 puntos máximo)
   - Palabras clave de `necesidad`/`descripcion` que aparecen en el otro usuario
   - 5 puntos por cada keyword (máximo 4 keywords)

4. **Mismo sector** (+15 puntos)
   - Detecta sectores comunes en nombres de empresa

5. **Actividad reciente** (+10 puntos)
   - Usuario activo en las últimas 24 horas

**Score total**: 0-100 puntos

## Implementación en Frontend

### Paso 1: Cargar Scores de Afinidad

En `useDashboardData.ts`, agregar un efecto para cargar los scores:

```typescript
const [affinityScores, setAffinityScores] = useState<Record<string, number>>({});

useEffect(() => {
  if (!uid || !eventId) return;
  
  const unsubscribe = onSnapshot(
    collection(db, "users", uid, "affinityScores"),
    (snap) => {
      const scores: Record<string, number> = {};
      snap.docs.forEach(doc => {
        const data = doc.data();
        scores[data.targetUserId] = data.score;
      });
      setAffinityScores(scores);
      console.log(`Loaded ${snap.size} affinity scores`);
    }
  );
  
  return unsubscribe;
}, [uid, eventId]);
```

### Paso 2: Ordenar por Afinidad

En el componente de vista (ej: `AttendeesView.tsx`):

```typescript
const sortedAssistants = useMemo(() => {
  return [...filteredAssistants].sort((a, b) => {
    const scoreA = affinityScores[a.id] || 0;
    const scoreB = affinityScores[b.id] || 0;
    return scoreB - scoreA; // Mayor score primero
  });
}, [filteredAssistants, affinityScores]);
```

### Paso 3: Mostrar Badge de Afinidad (Opcional)

En la tarjeta de usuario:

```tsx
{affinityScores[assistant.id] && affinityScores[assistant.id] > 50 && (
  <Badge 
    color="teal" 
    variant="light"
    leftSection={<IconSparkles size={12} />}
  >
    {affinityScores[assistant.id]}% afinidad
  </Badge>
)}
```

### Paso 4: Toggle de Ordenamiento (Opcional)

Permitir al usuario elegir entre ordenamiento por afinidad o por fecha:

```typescript
const [sortBy, setSortBy] = useState<"affinity" | "date">("affinity");

const sortedAssistants = useMemo(() => {
  const sorted = [...filteredAssistants];
  
  if (sortBy === "affinity") {
    sorted.sort((a, b) => {
      const scoreA = affinityScores[a.id] || 0;
      const scoreB = affinityScores[b.id] || 0;
      return scoreB - scoreA;
    });
  } else {
    sorted.sort((a, b) => {
      const timeA = a.createdAt?.toMillis?.() || 0;
      const timeB = b.createdAt?.toMillis?.() || 0;
      return timeA - timeB;
    });
  }
  
  return sorted;
}, [filteredAssistants, affinityScores, sortBy]);
```

UI para el toggle:

```tsx
<SegmentedControl
  value={sortBy}
  onChange={(value) => setSortBy(value as "affinity" | "date")}
  data={[
    { label: "Por afinidad", value: "affinity" },
    { label: "Por fecha", value: "date" },
  ]}
/>
```

## Ejemplo Completo: AttendeesView con Afinidad

```typescript
// En useDashboardData.ts
const [affinityScores, setAffinityScores] = useState<Record<string, number>>({});

useEffect(() => {
  if (!uid || !eventId) return;
  
  return onSnapshot(
    collection(db, "users", uid, "affinityScores"),
    (snap) => {
      const scores: Record<string, number> = {};
      snap.docs.forEach(doc => {
        scores[doc.data().targetUserId] = doc.data().score;
      });
      setAffinityScores(scores);
    }
  );
}, [uid, eventId]);

// Retornar en el objeto del hook
return {
  // ... otros valores
  affinityScores,
};

// En AttendeesView.tsx
interface AttendeesViewProps {
  // ... otras props
  affinityScores: Record<string, number>;
}

export default function AttendeesView({ 
  filteredAssistants,
  affinityScores,
  // ... otras props
}: AttendeesViewProps) {
  const [sortBy, setSortBy] = useState<"affinity" | "date">("affinity");
  
  const sortedAssistants = useMemo(() => {
    const sorted = [...filteredAssistants];
    
    if (sortBy === "affinity") {
      sorted.sort((a, b) => {
        const scoreA = affinityScores[a.id] || 0;
        const scoreB = affinityScores[b.id] || 0;
        return scoreB - scoreA;
      });
    } else {
      sorted.sort((a, b) => {
        const timeA = a.createdAt?.toMillis?.() || 0;
        const timeB = b.createdAt?.toMillis?.() || 0;
        return timeA - timeB;
      });
    }
    
    return sorted;
  }, [filteredAssistants, affinityScores, sortBy]);
  
  return (
    <Stack>
      <Group justify="space-between">
        <SegmentedControl
          value={sortBy}
          onChange={(value) => setSortBy(value as "affinity" | "date")}
          data={[
            { label: "Por afinidad", value: "affinity" },
            { label: "Por fecha", value: "date" },
          ]}
        />
      </Group>
      
      <Grid>
        {sortedAssistants.map((assistant) => (
          <Grid.Col key={assistant.id} span={{ base: 12, sm: 6, md: 4 }}>
            <Card>
              {/* Contenido de la tarjeta */}
              
              {/* Badge de afinidad */}
              {affinityScores[assistant.id] > 50 && (
                <Badge 
                  color="teal" 
                  variant="light"
                  leftSection={<IconSparkles size={12} />}
                >
                  {affinityScores[assistant.id]}% afinidad
                </Badge>
              )}
            </Card>
          </Grid.Col>
        ))}
      </Grid>
    </Stack>
  );
}
```

## Despliegue

1. Desplegar las funciones:
```bash
firebase deploy --only functions:calculateAffinityOnUserCreate,functions:recalculateEventAffinity
```

2. Para eventos existentes, ejecutar recálculo:
```bash
curl -X POST https://[region]-[project].cloudfunctions.net/recalculateEventAffinity \
  -H "Content-Type: application/json" \
  -d '{"eventId": "tu-event-id"}'
```

## Ventajas de este Enfoque

1. **Cálculo automático**: Se ejecuta al crear usuarios, sin intervención manual
2. **Simétrico y eficiente**: Calcula una sola vez por par, usa el mismo score en ambas direcciones
3. **Escalable**: Usa batching de Firestore para manejar muchos usuarios
4. **Flexible**: Fácil ajustar el algoritmo y recalcular
5. **Performante**: El ordenamiento se hace en el cliente con datos pre-calculados
6. **Sin latencia**: No requiere llamadas a APIs externas en cada carga
7. **Consistente**: Ambos usuarios ven el mismo nivel de afinidad mutua

## Notas

- Los scores se calculan automáticamente al crear usuarios
- Para recalcular después de cambios en el algoritmo, usar `recalculateEventAffinity`
- El ordenamiento en el frontend es instantáneo (datos ya están en Firestore)
- Puedes personalizar el algoritmo de scoring en `calculateAffinityScore()`

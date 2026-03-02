# Sistema de Matching con IA usando Gemini

## Descripción General

El sistema de cálculo de afinidad ahora utiliza **Gemini AI** para analizar perfiles de usuarios y calcular scores de compatibilidad de manera más inteligente y contextual.

## Características Principales

### 1. Análisis Inteligente con IA
- Utiliza Gemini AI para evaluar la compatibilidad entre dos perfiles
- Analiza múltiples dimensiones: roles, intereses, necesidades, descripciones, sectores
- Genera razones específicas y contextuales para cada match

### 2. Fallback Automático
- Si la API de Gemini falla, el sistema automáticamente usa el algoritmo manual
- Garantiza que el matching siempre funcione, incluso sin conexión a la IA
- El campo `aiGenerated` indica si el score fue calculado por IA o manualmente

### 3. Criterios de Evaluación

La IA evalúa los siguientes aspectos:

1. **Roles complementarios** (Alta prioridad)
   - Comprador-Vendedor
   - Sinergia entre posiciones

2. **Coincidencia de intereses y necesidades** (Alta prioridad)
   - Interés principal
   - Necesidades específicas
   - Objetivos del evento

3. **Sinergia entre descripciones** (Media prioridad)
   - Análisis semántico de descripciones
   - Compatibilidad de necesidades

4. **Compatibilidad de sectores** (Media prioridad)
   - Industrias relacionadas
   - Sectores complementarios

5. **Nivel jerárquico** (Baja prioridad)
   - Cargos compatibles
   - Nivel de decisión

## Rangos de Score

- **70-100**: Alta compatibilidad - Deberían reunirse
- **50-69**: Compatibilidad media - Podrían beneficiarse
- **30-49**: Baja compatibilidad
- **0-29**: Muy baja compatibilidad

## Funciones Modificadas

### `calculateAffinityScoreWithAI(userA, userB)`
Función principal que usa Gemini AI para calcular afinidad.

**Retorna:**
```javascript
{
  score: number,        // 0-100
  reasons: string[],    // Máximo 5 razones
  aiGenerated: boolean  // true si fue calculado por IA
}
```

### `calculateAffinityScoreFallback(userA, userB)`
Algoritmo manual usado como fallback si falla la IA.

**Criterios del fallback:**
- Roles complementarios: +30 puntos
- Mismo interés principal: +25 puntos
- Keywords coincidentes: +20 puntos (máx)
- Mismo sector: +15 puntos
- Activo recientemente: +10 puntos

## Triggers Actualizados

### `calculateAffinityOnUserCreate`
Se ejecuta automáticamente cuando se crea un nuevo usuario.
- Calcula afinidad con todos los usuarios existentes del evento
- Usa IA para cada cálculo
- Crea notificaciones para afinidades >80%
- Crea matches para afinidades ≥70%

### `recalculateEventAffinity` (HTTP)
Función HTTP para recalcular todas las afinidades de un evento.
- Útil después de actualizar el algoritmo
- Usa IA para todos los cálculos
- Endpoint: `POST /recalculateEventAffinity`
- Body: `{ "eventId": "xxx" }`

## Estructura de Datos

### AffinityScore Document
```javascript
{
  targetUserId: string,
  targetName: string,
  targetCompany: string,
  score: number,           // 0-100
  reasons: string[],       // Razones específicas
  aiGenerated: boolean,    // true si fue calculado por IA
  eventId: string,
  calculatedAt: Timestamp
}
```

### Match Document
```javascript
{
  userId: string,
  userName: string,
  userCompany: string,
  userRole: string,
  userInterest: string,
  userPhoto: string,
  userEmail: string,
  userPhone: string,
  userPosition: string,
  userDescription: string,
  userNeed: string,
  affinityScore: number,
  reasons: string[],
  aiGenerated: boolean,    // NUEVO: indica si fue calculado por IA
  status: "pending" | "meeting_requested" | "dismissed",
  eventId: string,
  createdAt: Timestamp
}
```

## Ventajas del Sistema con IA

1. **Análisis Contextual**: La IA entiende el contexto completo de cada perfil
2. **Razones Específicas**: Genera explicaciones personalizadas para cada match
3. **Adaptabilidad**: Se adapta a diferentes tipos de eventos y perfiles
4. **Mejora Continua**: El prompt puede ajustarse para mejorar la precisión
5. **Fallback Robusto**: Siempre funciona, incluso si falla la IA

## Consideraciones de Rendimiento

- **Tiempo de cálculo**: ~1-2 segundos por par de usuarios (con IA)
- **Fallback**: <100ms por par (algoritmo manual)
- **Límite de batch**: 450 operaciones por batch de Firestore
- **Timeout**: 540 segundos para recalculación completa

## Monitoreo

Los logs incluyen:
- `AI Affinity: UserA <-> UserB = X% (reasons)`
- Indicación de fallback si la IA falla
- Conteo de cálculos realizados

## Próximas Mejoras

1. Cache de cálculos para evitar recalcular pares ya evaluados
2. Ajuste dinámico del threshold según el tamaño del evento
3. Análisis de feedback para mejorar el algoritmo
4. Integración con embeddings para búsqueda semántica

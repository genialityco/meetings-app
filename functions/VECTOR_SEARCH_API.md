# Vector Search API

Nueva función HTTP para búsqueda por vectores pura (sin keywords).

## Endpoint

```
POST https://[region]-[project-id].cloudfunctions.net/vectorSearch
```

## Parámetros

### Request Body (JSON)

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `text` | string | Sí | Texto a buscar (se convertirá en embedding) |
| `category` | string | Sí | Categoría: `"assistants"`, `"products"`, o `"companies"` |
| `eventId` | string | Sí | ID del evento |
| `userId` | string | No | ID del usuario (para filtrar resultados propios) |
| `limit` | number | No | Número máximo de resultados (default: 10) |
| `threshold` | number | No | Umbral mínimo de similitud 0-1 (default: 0.35) |

## Ejemplos de uso

### 1. Buscar asistentes

```javascript
const response = await fetch('https://us-central1-[project].cloudfunctions.net/vectorSearch', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    text: "Busco proveedores de tecnología y software empresarial",
    category: "assistants",
    eventId: "DKyGhDkDlzXRBfnCxnrk",
    userId: "user123", // Opcional: excluye este usuario de resultados
    limit: 15,
    threshold: 0.4
  })
});

const data = await response.json();
console.log(data.results);
```

**Respuesta:**
```json
{
  "category": "assistants",
  "query": "Busco proveedores de tecnología y software empresarial",
  "threshold": 0.4,
  "limit": 15,
  "count": 8,
  "results": [
    {
      "id": "user456",
      "nombre": "Juan Pérez",
      "empresa": "TechCorp SA",
      "descripcion": "Proveedor de soluciones de software empresarial",
      "necesidad": "Expandir cartera de clientes",
      "interesPrincipal": "Networking con empresas medianas",
      "tipoAsistente": "vendedor",
      "photoURL": "https://...",
      "similarity": 0.78
    },
    // ... más resultados
  ]
}
```

### 2. Buscar productos

```javascript
const response = await fetch('https://us-central1-[project].cloudfunctions.net/vectorSearch', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    text: "sillas ergonómicas para oficina",
    category: "products",
    eventId: "DKyGhDkDlzXRBfnCxnrk",
    userId: "user123", // Opcional: excluye productos de este usuario
    limit: 20,
    threshold: 0.35
  })
});

const data = await response.json();
```

**Respuesta:**
```json
{
  "category": "products",
  "query": "sillas ergonómicas para oficina",
  "threshold": 0.35,
  "limit": 20,
  "count": 12,
  "results": [
    {
      "id": "prod789",
      "title": "Silla Ejecutiva Ergonómica Premium",
      "description": "Silla de oficina con soporte lumbar ajustable...",
      "category": "Mobiliario",
      "ownerUserId": "user456",
      "imageUrl": "https://...",
      "similarity": 0.82
    },
    // ... más resultados
  ]
}
```

### 3. Buscar empresas

```javascript
const response = await fetch('https://us-central1-[project].cloudfunctions.net/vectorSearch', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    text: "empresas de construcción y materiales",
    category: "companies",
    eventId: "DKyGhDkDlzXRBfnCxnrk",
    limit: 10
  })
});

const data = await response.json();
```

**Respuesta:**
```json
{
  "category": "companies",
  "query": "empresas de construcción y materiales",
  "threshold": 0.35,
  "limit": 10,
  "count": 7,
  "results": [
    {
      "id": "comp123",
      "razonSocial": "Constructora ABC SAS",
      "descripcion": "Empresa líder en construcción de proyectos residenciales...",
      "nitNorm": "900123456",
      "similarity": 0.75
    },
    // ... más resultados
  ]
}
```

## Características

### ✅ Ventajas

1. **Búsqueda semántica pura**: Solo usa embeddings, sin keywords
2. **Rápida**: No hace análisis de intención ni ranking con IA
3. **Flexible**: Ajusta threshold y limit según necesidad
4. **Filtros automáticos**:
   - Asistentes: excluye el usuario actual
   - Productos: excluye productos propios del usuario
5. **Resultados ordenados**: Por similitud descendente

### 🎯 Casos de uso

- **Autocompletado**: Sugerencias mientras el usuario escribe
- **Búsqueda rápida**: Cuando no se necesita análisis complejo
- **Exploración**: Encontrar contenido similar a un texto dado
- **Recomendaciones**: Basadas en descripción de perfil
- **Testing**: Probar calidad de embeddings

### ⚙️ Configuración del threshold

| Threshold | Uso recomendado |
|-----------|------------------|
| 0.2 - 0.3 | Búsqueda amplia, muchos resultados |
| 0.35 - 0.4 | Balance (default) |
| 0.45 - 0.6 | Búsqueda estricta, alta precisión |
| 0.6+ | Solo resultados muy similares |

## Errores comunes

### 400 - Bad Request
```json
{
  "error": "Missing required parameters: text, category, eventId"
}
```
**Solución**: Verifica que envías todos los parámetros requeridos.

### 400 - Invalid category
```json
{
  "error": "Invalid category. Must be: assistants, products, or companies"
}
```
**Solución**: Usa solo: `"assistants"`, `"products"`, o `"companies"`.

### 500 - Failed to generate embedding
```json
{
  "error": "Failed to generate embedding",
  "details": "..."
}
```
**Solución**: Verifica que los secrets de Gemini estén configurados correctamente.

## Diferencias con aiProxy

| Característica | vectorSearch | aiProxy |
|----------------|--------------|---------|
| Análisis de intención | ❌ No | ✅ Sí |
| Keywords | ❌ No | ✅ Sí |
| Búsqueda híbrida | ❌ No | ✅ Sí |
| Ranking con IA | ❌ No | ✅ Sí |
| Múltiples categorías | ❌ No | ✅ Sí |
| Velocidad | ⚡ Muy rápida | 🐢 Más lenta |
| Complejidad | 🟢 Simple | 🔴 Compleja |
| Uso | Búsquedas específicas | Búsquedas generales |

## Deployment

```bash
cd functions
npm run deploy
```

O solo esta función:
```bash
firebase deploy --only functions:vectorSearch
```

# Configuración de Secrets en Firebase Functions

Este documento explica cómo configurar los secrets necesarios para las Firebase Functions.

## Secrets Requeridos

### 1. Secrets de IA (Gemini)
```bash
firebase functions:secrets:set GEMINI_API_KEY
# Valor: Tu API key de Google Gemini

firebase functions:secrets:set GEMINI_API_URL
# Valor: https://generativelanguage.googleapis.com/v1beta

firebase functions:secrets:set DEFAULT_AI_MODEL
# Valor: gemini-2.5-flash-lite
```

### 2. Secrets de WhatsApp

#### API V1 (Simple)
```bash
firebase functions:secrets:set WHATSAPP_API_V1
# Valor: https://apiwhatsapp.geniality.com.co/api/send
```

#### API V2 (Meeting Request)
```bash
firebase functions:secrets:set WHATSAPP_API_V2
# Valor: https://apiwhatsapp.geniality.com.co

firebase functions:secrets:set WHATSAPP_ACCOUNT_ID
# Valor: Tu account ID de la API de WhatsApp
```

## Verificar Secrets Configurados

Para ver todos los secrets configurados:
```bash
firebase functions:secrets:access
```

## Uso en el Código

Los secrets se definen al inicio del archivo `functions/index.js`:

```javascript
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const WHATSAPP_API_V1 = defineSecret("WHATSAPP_API_V1");
const WHATSAPP_API_V2 = defineSecret("WHATSAPP_API_V2");
const WHATSAPP_ACCOUNT_ID = defineSecret("WHATSAPP_ACCOUNT_ID");
```

Y se acceden con `.value()`:
```javascript
const apiKey = GEMINI_API_KEY.value();
```

## Configuración en el Admin Panel

En el panel de administración del evento, en "Políticas", puedes seleccionar qué versión de la API de WhatsApp usar:

- **API V1 (Geniality Simple)**: Envío simple de mensajes
- **API V2 (Meeting Request)**: Envío con metadata adicional y botones de acción

## Deploy

Después de configurar los secrets, despliega las funciones:
```bash
firebase deploy --only functions
```

## Notas Importantes

1. Los secrets NO se guardan en el código ni en `.env`
2. Cada ambiente (dev/prod) tiene sus propios secrets
3. Los secrets se encriptan automáticamente por Firebase
4. Para actualizar un secret, usa el mismo comando `firebase functions:secrets:set`

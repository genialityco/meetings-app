# Scripts de Migración de Agenda

Este directorio contiene scripts para migrar la colección `agenda` de global a subcolección.

## Prerequisitos

1. **Descargar Service Account Key:**
   - Ve a Firebase Console → Project Settings → Service Accounts
   - Click en "Generate new private key"
   - Guarda el archivo JSON como `serviceAccountKey.json` en esta carpeta (`scripts/`)
   - **IMPORTANTE:** Este archivo contiene credenciales sensibles. NO lo subas a git (está en `.gitignore`)

2. **Instalar dependencias:**
   ```bash
   cd scripts
   npm install
   ```

## Scripts Disponibles

### 1. migrate-agenda.js - Migración de Datos

Copia todos los slots de la colección global `agenda` a las subcolecciones `events/{eventId}/agenda`.

**Cuándo ejecutar:** ANTES de hacer deploy del código actualizado.

**Qué hace:**
- Lee todos los documentos de `collection(db, "agenda")`
- Los agrupa por `eventId`
- Los copia a `collection(db, "events", eventId, "agenda")`
- **Elimina el campo `eventId`** de los documentos copiados (es redundante en subcoleción)
- Valida que todos los documentos se copiaron correctamente

**Cómo ejecutar:**
```bash
cd scripts
npm run migrate
```

**Resultado esperado:**
```
✅ MIGRACIÓN COMPLETADA EXITOSAMENTE

Total de eventos: 5
Total de slots migrados: 150
Errores: 0
```

**Si hay errores:**
- Revisa los logs de error
- Verifica que el Service Account Key tenga permisos de lectura/escritura en Firestore
- Verifica que los eventos existan en la colección `events`

### 2. cleanup-old-agenda.js - Limpieza de Colección Antigua

Elimina la colección antigua `agenda` después de confirmar que todo funciona correctamente.

**Cuándo ejecutar:** SOLO después de:
1. Migración completada exitosamente
2. Código actualizado desplegado en producción
3. Monitoreo por 24-48 horas sin errores
4. Verificación de que la aplicación funciona correctamente

**Qué hace:**
- Elimina TODOS los documentos de la colección global `agenda`
- Usa batches para operaciones eficientes

**Cómo ejecutar:**
```bash
cd scripts
npm run cleanup
```

**⚠️ ADVERTENCIA:** Esta operación es IRREVERSIBLE. Asegúrate de que todo funciona antes de ejecutarla.

## Flujo Recomendado

1. **Backup de Firestore**
   - Ve a Firebase Console → Firestore → Backups
   - Crea un backup completo

2. **Ejecutar migración**
   ```bash
   cd scripts
   npm install
   npm run migrate
   ```

3. **Verificar migración**
   - Revisa Firebase Console
   - Verifica que existen las subcolecciones `events/{eventId}/agenda`
   - Verifica que los documentos NO tienen campo `eventId`

4. **Deploy código actualizado**
   ```bash
   git add .
   git commit -m "Migrate agenda from global collection to subcollection"
   git push
   npm run build
   # Deploy a producción
   ```

5. **Monitoreo (24-48 horas)**
   - Verifica logs de errores
   - Prueba funcionalidades críticas (aceptar reuniones, ver matriz, etc.)
   - Confirma que NO se crean documentos en colección antigua

6. **Limpieza (opcional)**
   ```bash
   cd scripts
   npm run cleanup
   ```

## Troubleshooting

### Error: "Cannot find module './serviceAccountKey.json'"
- Descarga el Service Account Key desde Firebase Console
- Guárdalo como `serviceAccountKey.json` en la carpeta `scripts/`

### Error: "Permission denied"
- Verifica que el Service Account tenga rol "Cloud Datastore User" o "Editor"
- Ve a Firebase Console → IAM & Admin → Service Accounts

### Error: "Slot sin eventId"
- Algunos slots no tienen `eventId` y no serán migrados
- Revisa manualmente estos slots en Firebase Console
- Decide si deben asignarse a un evento o eliminarse

## Archivos

- `migrate-agenda.js` - Script de migración
- `cleanup-old-agenda.js` - Script de limpieza
- `package.json` - Dependencias
- `serviceAccountKey.json` - Credenciales (NO incluir en git)
- `README.md` - Esta documentación

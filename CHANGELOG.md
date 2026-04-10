# Changelog — Magnetic Meetings Platform 10-4-2026

### Check-in de asistentes
- Botón de check-in en `DashboardHeader` junto a notificaciones
- Tab "Check-in" en `AttendeesList` con buscador, lista en tiempo real, badges de presentes/pendientes
- Auto check-in al hacer login (opcional)

### Standby por check-in
- Política `standbyCheckInRequired` en `EventPoliciesModal`
- Reuniones aceptadas quedan en `standby` si algún participante no ha hecho check-in
- Al hacer check-in se promueven a `accepted`; al desmarcarlo vuelven a `standby`
- Slots de standby disponibles como fallback cuando no hay slots libres
- Sección "En espera de check-in" en `MeetingsTab` y badge en `CalendarTab`

### Confirmación de reuniones realizadas
- Política `meetingConfirmationEnabled` en `EventAdmin` (botón toggle en tab Operación)
- `MeetingConfirmationGuard` bloquea la UI y obliga al usuario a confirmar si la reunión se realizó
- Polling configurable (`POLL_INTERVAL_MS`), una sola confirmación por reunión (cualquier participante)

### Reunión externa
- Modal `ExternalMeetingModal` — registra reuniones ocurridas fuera del sistema
- No ocupa slots de agenda, guarda `isExternal: true`, `completed: true`
- Botón "Registrar Reunión Externa" en tab Operación de `EventAdmin`

### Transferencia de reuniones (admin)
- `TransferMeetingsModal` — transfiere reuniones entre asistentes del mismo rol
- Detección de conflictos de horario, selección individual o masiva

### Política de cancelación
- `cancelMeetingDisabled` — deshabilita el botón cancelar para asistentes

### Agenda del usuario (CalendarTab)
- Botones Contacto, WhatsApp y Cancelar en el modal de detalle de reunión aceptada
- Reuniones standby visibles con badge naranja y mensaje de check-in pendiente
- Loading skeletons mientras cargan los slots







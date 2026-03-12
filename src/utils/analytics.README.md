# Sistema de Analytics Centralizado

Este proyecto usa un sistema centralizado de analytics con Google Analytics 4 (GA4) para trackear eventos de manera consistente y tipada.

## Características

- ✅ Tracking automático de vistas de página
- ✅ Funciones tipadas para eventos personalizados
- ✅ Componentes wrapper para tracking de clicks
- ✅ Helpers organizados por categoría (meetings, profile, admin)
- ✅ Configuración de propiedades de usuario
- ✅ Logs en consola para debugging

## Uso Básico

### 1. Tracking Automático de Páginas

El tracking de páginas se hace automáticamente en `App.jsx` usando el hook `usePageTracking()`. No necesitas hacer nada adicional.

```tsx
// Ya está configurado en App.jsx
import { usePageTracking } from "./hooks/usePageTracking";

function App() {
  usePageTracking(); // Trackea automáticamente cada cambio de ruta
  return <Routes>...</Routes>;
}
```

### 2. Tracking de Eventos Personalizados

```tsx
import { trackEvent, trackButtonClick, trackSearch } from '../utils/analytics';

// Evento genérico
trackEvent({
  name: 'button_click',
  params: { button_name: 'send_meeting', location: 'dashboard' }
});

// Helpers específicos
trackButtonClick('send_meeting', 'dashboard');
trackSearch('muebles', 'products');
```

### 3. Tracking de Reuniones

```tsx
import { meetingAnalytics } from '../utils/analytics';

// Enviar solicitud de reunión
meetingAnalytics.requestSent(receiverId, hasContext);

// Aceptar reunión
meetingAnalytics.accepted(meetingId);

// Rechazar reunión
meetingAnalytics.rejected(meetingId);

// Cancelar reunión
meetingAnalytics.cancelled(meetingId, 'Usuario canceló');

// Seleccionar slot
meetingAnalytics.slotSelected(meetingId, '10:00 - 10:30');
```

### 4. Tracking de Perfil

```tsx
import { profileAnalytics } from '../utils/analytics';

// Actualizar perfil
profileAnalytics.updated(['nombre', 'empresa', 'descripcion']);

// Cambiar avatar
profileAnalytics.avatarChanged();

// Agregar producto
profileAnalytics.productAdded('Sillas de oficina');

// Eliminar producto
profileAnalytics.productDeleted(productId);
```

### 5. Tracking de Admin

```tsx
import { adminAnalytics } from '../utils/analytics';

// Crear evento
adminAnalytics.eventCreated('Networking 2024');

// Importar asistentes
adminAnalytics.attendeeImported(150, 'excel');

// Crear reunión manual
adminAnalytics.meetingManuallyCreated(meetingId);

// Generar matriz
adminAnalytics.matrixGenerated(200);
```

### 6. Componente TrackedButton

Para botones que necesitan tracking automático:

```tsx
import { TrackedButton } from '../components/TrackedButton';

<TrackedButton
  trackingName="send_meeting_request"
  trackingLocation="dashboard_requests_tab"
  onClick={handleSendMeeting}
  color="blue"
>
  Enviar Solicitud
</TrackedButton>
```

### 7. Configurar Propiedades de Usuario

```tsx
import { setUserProperties } from '../utils/analytics';

// Al hacer login
setUserProperties({
  user_id: userId,
  user_role: 'attendee',
  event_id: eventId,
  company_name: companyName,
});
```

### 8. Tracking de Errores

```tsx
import { trackError } from '../utils/analytics';

try {
  // código que puede fallar
} catch (error) {
  trackError(error.message, 'useDashboardData.sendMeetingRequest');
}
```

## Ejemplos de Implementación

### En useDashboardData.ts

```tsx
import { meetingAnalytics, trackError } from '../utils/analytics';

const sendMeetingRequest = async (receiverId, phone, groupId, context) => {
  try {
    // ... lógica de envío ...
    
    // Trackear evento
    meetingAnalytics.requestSent(receiverId, !!context?.contextNote);
    
    showNotification({
      title: "Solicitud enviada",
      message: "La solicitud de reunión ha sido enviada",
      color: "green",
    });
  } catch (error) {
    trackError(error.message, 'sendMeetingRequest');
    showNotification({
      title: "Error",
      message: "No se pudo enviar la solicitud",
      color: "red",
    });
  }
};

const updateMeetingStatus = async (meetingId, status) => {
  try {
    // ... lógica de actualización ...
    
    // Trackear según el status
    if (status === 'accepted') {
      meetingAnalytics.accepted(meetingId);
    } else if (status === 'rejected') {
      meetingAnalytics.rejected(meetingId);
    }
  } catch (error) {
    trackError(error.message, 'updateMeetingStatus');
  }
};
```

### En TabsPanel.tsx

```tsx
import { trackTabChange } from '../utils/analytics';

const TabsPanel = ({ activeTab, setActiveTab }) => {
  const handleTabChange = (newTab) => {
    trackTabChange(newTab, activeTab);
    setActiveTab(newTab);
  };

  return (
    <Tabs value={activeTab} onChange={handleTabChange}>
      {/* tabs */}
    </Tabs>
  );
};
```

### En ChatbotTab.tsx

```tsx
import { trackEvent } from '../utils/analytics';

const handleSendMessage = async (message) => {
  try {
    const response = await sendAIMessage(message);
    
    // Trackear mensaje de AI
    trackEvent({
      name: 'ai_chat_message',
      params: {
        message_length: message.length,
        has_results: response.results.assistants.length > 0 ||
                     response.results.products.length > 0 ||
                     response.results.companies.length > 0,
      },
    });
  } catch (error) {
    trackError(error.message, 'ChatbotTab.handleSendMessage');
  }
};
```

## Eventos Disponibles

### Autenticación
- `login` - Usuario inicia sesión
- `sign_up` - Usuario se registra
- `logout` - Usuario cierra sesión

### Navegación
- `page_view` - Vista de página (automático)
- `tab_change` - Cambio de tab

### Reuniones
- `meeting_request_sent` - Solicitud enviada
- `meeting_accepted` - Reunión aceptada
- `meeting_rejected` - Reunión rechazada
- `meeting_cancelled` - Reunión cancelada
- `slot_selected` - Slot seleccionado

### Búsqueda
- `search` - Búsqueda realizada
- `ai_chat_message` - Mensaje de chat AI
- `view_profile` - Ver perfil
- `view_product` - Ver producto

### Interacción
- `button_click` - Click en botón
- `whatsapp_sent` - WhatsApp enviado
- `download_vcard` - Descargar vCard
- `share` - Compartir contenido

### Perfil
- `profile_updated` - Perfil actualizado
- `avatar_changed` - Avatar cambiado
- `product_added` - Producto agregado
- `product_deleted` - Producto eliminado

### Admin
- `event_created` - Evento creado
- `attendee_imported` - Asistentes importados
- `meeting_manually_created` - Reunión creada manualmente
- `matrix_generated` - Matriz generada

### Notificaciones
- `notification_clicked` - Notificación clickeada
- `notification_dismissed` - Notificación descartada

### Errores
- `error` - Error capturado

## Ver Eventos en Google Analytics

1. Ve a Google Analytics 4
2. Navega a **Reports** > **Engagement** > **Events**
3. Verás todos los eventos personalizados listados
4. Click en cualquier evento para ver detalles y parámetros

## Debugging

Los eventos se loguean en la consola del navegador con el prefijo `📊 Analytics event:` para facilitar el debugging en desarrollo.

Para desactivar los logs en producción, modifica `analytics.ts`:

```tsx
const isDevelopment = import.meta.env.DEV;

if (isDevelopment) {
  console.log('📊 Analytics event:', event.name, event.params);
}
```

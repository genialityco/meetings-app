/**
 * Sistema centralizado de Analytics para Google Analytics 4
 * Proporciona funciones tipadas para trackear eventos en toda la aplicación
 */

// Tipos de eventos personalizados
export type AnalyticsEvent =
  // Eventos de autenticación
  | { name: 'login'; params: { method: string } }
  | { name: 'sign_up'; params: { method: string } }
  | { name: 'logout'; params?: Record<string, any> }
  
  // Eventos de navegación
  | { name: 'page_view'; params: { page_title: string; page_path: string } }
  | { name: 'tab_change'; params: { tab_name: string; previous_tab?: string } }
  
  // Eventos de reuniones
  | { name: 'meeting_request_sent'; params: { receiver_id: string; has_context?: boolean } }
  | { name: 'meeting_accepted'; params: { meeting_id: string } }
  | { name: 'meeting_rejected'; params: { meeting_id: string } }
  | { name: 'meeting_cancelled'; params: { meeting_id: string; reason?: string } }
  | { name: 'slot_selected'; params: { meeting_id: string; slot_time: string } }
  
  // Eventos de búsqueda y exploración
  | { name: 'search'; params: { search_term: string; search_type?: string } }
  | { name: 'ai_chat_message'; params: { message_length: number; has_results: boolean } }
  | { name: 'view_profile'; params: { profile_type: 'assistant' | 'company'; profile_id: string } }
  | { name: 'view_product'; params: { product_id: string; product_title: string } }
  
  // Eventos de interacción
  | { name: 'button_click'; params: { button_name: string; location: string } }
  | { name: 'whatsapp_sent'; params: { recipient_type: string } }
  | { name: 'download_vcard'; params: { contact_name: string } }
  | { name: 'share'; params: { content_type: string; item_id?: string } }
  
  // Eventos de perfil
  | { name: 'profile_updated'; params: { fields_updated: string[] } }
  | { name: 'avatar_changed'; params?: Record<string, any> }
  | { name: 'product_added'; params: { product_title: string } }
  | { name: 'product_deleted'; params: { product_id: string } }
  
  // Eventos de admin
  | { name: 'event_created'; params: { event_name: string } }
  | { name: 'attendee_imported'; params: { count: number; method: string } }
  | { name: 'meeting_manually_created'; params: { meeting_id: string } }
  | { name: 'matrix_generated'; params: { attendee_count: number } }
  
  // Eventos de notificaciones
  | { name: 'notification_clicked'; params: { notification_type: string } }
  | { name: 'notification_dismissed'; params: { notification_type: string } }
  
  // Eventos de error
  | { name: 'error'; params: { error_message: string; error_location: string } };

declare global {
  interface Window {
    gtag?: (
      command: 'config' | 'event' | 'js' | 'set',
      targetId: string | Date | any,
      config?: Record<string, any>
    ) => void;
    dataLayer?: any[];
  }
}

/**
 * Verifica si Google Analytics está disponible
 */
function isAnalyticsAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  
  // Verificar si gtag existe
  if (typeof window.gtag === 'function') return true;
  
  // Si no existe, intentar crearlo desde dataLayer
  if (window.dataLayer) {
    window.gtag = function() {
      window.dataLayer!.push(arguments);
    };
    return true;
  }
  
  return false;
}

/**
 * Trackea un evento personalizado en Google Analytics
 */
export function trackEvent(event: AnalyticsEvent): void {
  if (!isAnalyticsAvailable()) {
    console.warn('⚠️ Google Analytics no está disponible');
    console.log('Debug info:', {
      hasWindow: typeof window !== 'undefined',
      hasGtag: typeof window !== 'undefined' && typeof window.gtag === 'function',
      hasDataLayer: typeof window !== 'undefined' && Array.isArray(window.dataLayer),
      dataLayerLength: typeof window !== 'undefined' && window.dataLayer ? window.dataLayer.length : 0,
    });
    return;
  }

  try {
    // Enviar evento
    window.gtag!('event', event.name, event.params || {});
    
    // Log en desarrollo y producción para debugging
    console.log('📊 Analytics event tracked:', event.name, event.params);
    
    // Verificar que se agregó al dataLayer
    if (window.dataLayer) {
      const lastEvent = window.dataLayer[window.dataLayer.length - 1];
      console.log('📊 Last dataLayer entry:', lastEvent);
    }
  } catch (error) {
    console.error('❌ Error tracking analytics event:', error);
  }
}

/**
 * Trackea una vista de página
 */
export function trackPageView(pageTitle: string, pagePath: string): void {
  trackEvent({
    name: 'page_view',
    params: {
      page_title: pageTitle,
      page_path: pagePath,
    },
  });
}

/**
 * Trackea un cambio de tab
 */
export function trackTabChange(tabName: string, previousTab?: string): void {
  trackEvent({
    name: 'tab_change',
    params: {
      tab_name: tabName,
      previous_tab: previousTab,
    },
  });
}

/**
 * Trackea un click de botón
 */
export function trackButtonClick(buttonName: string, location: string): void {
  trackEvent({
    name: 'button_click',
    params: {
      button_name: buttonName,
      location: location,
    },
  });
}

/**
 * Trackea una búsqueda
 */
export function trackSearch(searchTerm: string, searchType?: string): void {
  trackEvent({
    name: 'search',
    params: {
      search_term: searchTerm,
      search_type: searchType,
    },
  });
}

/**
 * Trackea eventos de reuniones
 */
export const meetingAnalytics = {
  requestSent: (receiverId: string, hasContext: boolean = false) => {
    trackEvent({
      name: 'meeting_request_sent',
      params: { receiver_id: receiverId, has_context: hasContext },
    });
  },
  
  accepted: (meetingId: string) => {
    trackEvent({
      name: 'meeting_accepted',
      params: { meeting_id: meetingId },
    });
  },
  
  rejected: (meetingId: string) => {
    trackEvent({
      name: 'meeting_rejected',
      params: { meeting_id: meetingId },
    });
  },
  
  cancelled: (meetingId: string, reason?: string) => {
    trackEvent({
      name: 'meeting_cancelled',
      params: { meeting_id: meetingId, reason },
    });
  },
  
  slotSelected: (meetingId: string, slotTime: string) => {
    trackEvent({
      name: 'slot_selected',
      params: { meeting_id: meetingId, slot_time: slotTime },
    });
  },
};

/**
 * Trackea eventos de perfil
 */
export const profileAnalytics = {
  updated: (fieldsUpdated: string[]) => {
    trackEvent({
      name: 'profile_updated',
      params: { fields_updated: fieldsUpdated },
    });
  },
  
  avatarChanged: () => {
    trackEvent({
      name: 'avatar_changed',
      params: {},
    });
  },
  
  productAdded: (productTitle: string) => {
    trackEvent({
      name: 'product_added',
      params: { product_title: productTitle },
    });
  },
  
  productDeleted: (productId: string) => {
    trackEvent({
      name: 'product_deleted',
      params: { product_id: productId },
    });
  },
};

/**
 * Trackea eventos de admin
 */
export const adminAnalytics = {
  eventCreated: (eventName: string) => {
    trackEvent({
      name: 'event_created',
      params: { event_name: eventName },
    });
  },
  
  attendeeImported: (count: number, method: string) => {
    trackEvent({
      name: 'attendee_imported',
      params: { count, method },
    });
  },
  
  meetingManuallyCreated: (meetingId: string) => {
    trackEvent({
      name: 'meeting_manually_created',
      params: { meeting_id: meetingId },
    });
  },
  
  matrixGenerated: (attendeeCount: number) => {
    trackEvent({
      name: 'matrix_generated',
      params: { attendee_count: attendeeCount },
    });
  },
};

/**
 * Trackea errores
 */
export function trackError(errorMessage: string, errorLocation: string): void {
  trackEvent({
    name: 'error',
    params: {
      error_message: errorMessage,
      error_location: errorLocation,
    },
  });
}

/**
 * Configura propiedades de usuario (para segmentación)
 */
export function setUserProperties(properties: {
  user_id?: string;
  user_role?: string;
  event_id?: string;
  company_name?: string;
  [key: string]: any;
}): void {
  if (!isAnalyticsAvailable()) return;

  try {
    window.gtag!('set', 'user_properties', properties);
    console.log('📊 User properties set:', properties);
  } catch (error) {
    console.error('Error setting user properties:', error);
  }
}

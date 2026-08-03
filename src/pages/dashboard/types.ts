// Dashboard/types.ts

export interface Contacto {
  correo?: string;
  telefono?: string;
}

export interface Assistant {
  id: string;
  nombre: string;
  empresa?: string;
  cargo?: string;
  photoURL?: string;
  contacto?: {
    correo?: string;
    telefono?: string;
  };
  correo?: string;
  telefono?: string;
  descripcion?: string;
  interesPrincipal?: string;
  necesidad?: string;
  lastConnectionDateTime?: string;
  connectedToday?: boolean;
  /** NIT normalizado de la empresa (mismo id que el doc events/{eventId}/companies/{companyId}) */
  companyId?: string | null;
  company_razonSocial?: string;
  tipoAsistente?: string;
  /** Mesa fija asignada directamente al asistente (o heredada de su empresa) */
  fixedTable?: string | null;
  /** Puntos/tickets acumulados para el sorteo del evento (política raffleEnabled) */
  raffleTickets?: number;
  [key: string]: any;
}

export interface Meeting {
  id: string;
  requesterId: string;
  /** null = solicitud dirigida a empresa (companyId), aún no reclamada por un asesor específico */
  receiverId: string | null;
  timeSlot?: string;
  tableAssigned?: string;
  meetingDate?: string; // Fecha específica de la reunión "YYYY-MM-DD"
  status?: string;
  productId?: string | null;
  companyId?: string | null;
  contextNote?: string;
  [key: string]: any; // Permite campos adicionales de Firestore
}

export interface MeetingContext {
  productId?: string | null;
  companyId?: string | null;
  contextNote?: string;
}

export interface ParticipantInfo extends Assistant {}

export type NotificationType =
  | "meeting_request"
  | "meeting_accepted"
  | "meeting_rejected"
  | "meeting_cancelled"
  | "meeting_modified"
  | "high_affinity";

export interface Notification {
  id: string;
  title: string;
  message: string;
  read: boolean;
  timestamp: any;
  type?: NotificationType;
  entityType?: "assistant" | "product" | "company"; // Tipo de entidad relacionada
  entityId?: string; // ID de la entidad relacionada
  affinityScore?: number; // Score de afinidad (para notificaciones de alta afinidad)
  eventId?: string;
}

export interface AgendaSlot {
  id: string;
  date: string; // NUEVO: fecha del slot en formato "YYYY-MM-DD"
  startTime: string;
  endTime: string;
  tableNumber: number | string;
  available?: boolean;
  eventId?: string;
  meetingId?: string;
  isBreak?: boolean;
  blockedBy?: string; // UID del usuario que bloqueó el slot
}

/** Políticas de evento configurables por admin */
export interface EventPolicies {
  roleMode: "buyer_seller" | "open";
  tableMode: "pool" | "fixed";
  discoveryMode: "all" | "by_role";
  schedulingMode: "manual" | "requester_picks";
  /** Redirige vendedores a "Mis productos" en su primer ingreso y oculta ese tab a compradores */
  sellerRedirectToProducts?: boolean;
  /** Oculta el selector "Tipo de asistente" en el formulario público y fuerza todo registro como "Comprador" (los vendedores se asignan manualmente desde el panel admin) */
  forceBuyerRoleOnRegistration?: boolean;
  /** Campos visibles en las tarjetas del dashboard (configuración independiente por vista) */
  cardFieldsConfig?: {
    attendeeCard: string[];
    companyCard: string[];
  };
  uiViewsEnabled: {
    chatbot: boolean;
    matches: boolean;
    attendees: boolean;
    companies: boolean;
    products: boolean;
  };
  /**
   * Orden de las pestañas principales del dashboard del asistente.
   * Claves válidas: "chatbot" | "matches" | "attendees" | "companies" | "products" | "activity" | "survey".
   * Las vistas habilitadas que no aparezcan aquí se muestran al final.
   */
  viewsOrder?: string[];
  /** Versión de la API de WhatsApp a usar */
  whatsappApiVersion?: "v1" | "v2";
  /** Reasignar automáticamente el slot cuando se cancela una reunión */
  autoReassignOnCancel?: boolean;
  /** Bloquear encuesta para ciertos roles: "none" | "compradores" | "vendedores" | "ambos" */
  surveyBlockedFor?: "none" | "compradores" | "vendedores" | "ambos";
  /** Modo de encuesta: "default" usa los campos originales, "custom" usa surveyConfig por rol */
  surveyMode?: "default" | "custom";
  /** Forzar confirmación de reuniones pasadas antes de continuar */
  meetingConfirmationEnabled?: boolean;
  /** Reuniones pasan a standby hasta que ambos participantes hagan check-in */
  standbyCheckInRequired?: boolean;
  /** Asignar número de identificación al registrarse (ej: 1C, 2V) */
  attendeeIdEnabled?: boolean;
  /** Habilitar envío de notificaciones por WhatsApp */
  whatsappNotificationsEnabled?: boolean;
  /** Enviar correo si falla el envío de la notificación de WhatsApp */
  fallbackEmailOnWaFailure?: boolean;
  /** Habilitar notificaciones internas en el dashboard */
  dashboardNotificationsEnabled?: boolean;
  /** Habilitar el popup y mensaje de bienvenida de WhatsApp (por defecto falso) */
  welcomeMessageEnabled?: boolean;
  /** Agrupar empresas por nombre (company_razonSocial) en lugar de por NIT */
  groupByRazonSocial?: boolean;
  /** Permitir subir imagenes en los productos */
  allowProductImageUpload?: boolean;
  /** Máximo de reuniones (pendientes o aceptadas) que un mismo par persona/empresa puede tener entre sí. null/0 = sin límite */
  maxMeetingsPerContact?: number | null;
  /** Máximo de reuniones que un asistente puede SOLICITAR según su rol (solo aplica si roleMode es "buyer_seller"). Cada rol es independiente; null/0/vacío = sin límite para ese rol. Los receptores nunca se cuentan ni se limitan por esta política. */
  maxMeetingsPerRole?: { comprador?: number | null; vendedor?: number | null } | null;
  /** Alcance de "maxMeetingsPerRole": "total" = acumulado en todo el evento, "day" = el conteo se reinicia cada día del evento (según la fecha del slot elegido) */
  maxMeetingsPerRoleScope?: "total" | "day";
  /** Habilita el sorteo por reuniones: el vendedor muestra un QR por reunión, el comprador lo escanea y gana un punto */
  raffleEnabled?: boolean;
  /** Si el comprador ve su propio conteo de puntos para el sorteo (solo aplica si raffleEnabled) */
  raffleShowPointsToAttendee?: boolean;
  /** Habilita el registro de visitas a stands: el stand muestra un QR fijo, el asistente lo escanea y queda como visitante */
  standVisitsEnabled?: boolean;
  /** Además del QR fijo del stand, permite que el vendedor escanee la credencial del comprador para registrar la visita (solo aplica si standVisitsEnabled) */
  standVisitAllowSellerScan?: boolean;
}

/** Campo de un formulario de encuesta (reutiliza el modelo de ConfigureSurveyModal) */
export interface EventSurveyField {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "rating";
  required: boolean;
  options?: string[];
  isDefault?: boolean;
}

/** Encuesta de satisfacción global del evento (event.config.eventSurvey) */
export interface EventSurveyConfig {
  /** Mostrar u ocultar la sección de encuesta en el dashboard del asistente */
  enabled: boolean;
  title?: string;
  description?: string;
  fields: EventSurveyField[];
}

/** Empresa (events/{eventId}/companies/{nitNorm}) */
export interface Company {
  nitNorm: string;
  razonSocial: string;
  descripcion?: string;
  logoUrl?: string | null;
  fixedTable?: string | null;
  createdAt?: any;
  updatedAt?: any;
}

/** Visita a un stand (events/{eventId}/companies/{nitNorm}/visits/{attendeeUid}) */
export interface StandVisit {
  id: string; // == attendeeId (el uid del asistente visitante es el ID del doc)
  attendeeId: string;
  attendeeName?: string;
  attendeeEmpresa?: string;
  visitedAt?: any;
}

/** Producto (events/{eventId}/products/{productId}) */
export interface Product {
  id: string;
  eventId: string;
  ownerUserId: string;
  ownerName?: string;
  ownerCompany?: string;
  ownerPhone?: string | null;
  companyId?: string | null;
  title: string;
  description: string;
  category?: string;
  imageUrl?: string | null;
  createdAt?: any;
  updatedAt?: any;
}

export const DEFAULT_POLICIES: EventPolicies = {
  roleMode: "open",
  tableMode: "pool",
  discoveryMode: "all",
  schedulingMode: "manual",
  sellerRedirectToProducts: false,
  forceBuyerRoleOnRegistration: false,
  cardFieldsConfig: {
    attendeeCard: ["empresa", "cargo", "correo", "descripcion", "interesPrincipal", "necesidad"],
    companyCard: ["cargo", "correo", "interesPrincipal", "necesidad"],
  },
  uiViewsEnabled: {
    chatbot: false,
    matches: true,
    attendees: true,
    companies: true,
    products: true
  },
  viewsOrder: ["chatbot", "matches", "attendees", "companies", "products", "activity", "survey"],
  whatsappApiVersion: "v1",
  autoReassignOnCancel: false,
  surveyBlockedFor: "none",
  surveyMode: "default",
  meetingConfirmationEnabled: false,
  standbyCheckInRequired: false,
  attendeeIdEnabled: false,
  whatsappNotificationsEnabled: true,
  fallbackEmailOnWaFailure: false,
  dashboardNotificationsEnabled: true,
  welcomeMessageEnabled: false,
  groupByRazonSocial: false,
  allowProductImageUpload: true,
  maxMeetingsPerContact: null,
  maxMeetingsPerRole: null,
  maxMeetingsPerRoleScope: "total",
  raffleEnabled: false,
  raffleShowPointsToAttendee: false,
  standVisitsEnabled: false,
  standVisitAllowSellerScan: false,
};

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
  companyId?: string | null;
  company_nit?: string;
  company_razonSocial?: string;
  tipoAsistente?: string;
  [key: string]: any;
}

export interface Meeting {
  id: string;
  requesterId: string;
  receiverId: string;
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
  schedulingMode: "manual" | "auto";
  /** Redirige vendedores a "Mis productos" en su primer ingreso y oculta ese tab a compradores */
  sellerRedirectToProducts?: boolean;
  /** Campos visibles en las tarjetas del dashboard (configuración independiente por vista) */
  cardFieldsConfig?: {
    attendeeCard: string[];
    companyCard: string[];
  };
  uiViewsEnabled: {
    chatbot: boolean;
    attendees: boolean;
    companies: boolean;
    products: boolean;
  };
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
  cardFieldsConfig: {
    attendeeCard: ["empresa", "cargo", "correo", "descripcion", "interesPrincipal", "necesidad"],
    companyCard: ["cargo", "correo", "interesPrincipal", "necesidad"],
  },
  uiViewsEnabled: { chatbot: true, attendees: true, companies: true, products: true },
};

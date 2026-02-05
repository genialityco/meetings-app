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

export interface Notification {
  id: string;
  title: string;
  message: string;
  read: boolean;
  timestamp: any;
}

export interface AgendaSlot {
  id: string;
  startTime: string;
  endTime: string;
  tableNumber: number | string;
  available?: boolean;
  eventId?: string;
  meetingId?: string;
}

/** Políticas de evento configurables por admin */
export interface EventPolicies {
  roleMode: "buyer_seller" | "open";
  tableMode: "pool" | "fixed";
  discoveryMode: "all" | "by_role";
  schedulingMode: "manual" | "auto";
  /** Redirige vendedores a "Mis productos" en su primer ingreso y oculta ese tab a compradores */
  sellerRedirectToProducts?: boolean;
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
  uiViewsEnabled: { chatbot: true, attendees: true, companies: true, products: true },
};

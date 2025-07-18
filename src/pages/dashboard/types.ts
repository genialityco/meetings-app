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
  [key: string]: any;
}

export interface Meeting {
  id: string;
  requesterId: string;
  receiverId: string;
  timeSlot?: string;
  tableAssigned?: string;
  status?: string;
  [key: string]: any; // Permite campos adicionales de Firestore
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

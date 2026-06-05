/**
 * Servicio para enviar mensajes de WhatsApp usando la API configurada
 */

interface WhatsAppV1Payload {
  clientId: string;
  phone: string;
  message: string;
}

interface WhatsAppV2Payload {
  accountId: string;
  to: string;
  eventName: string;
  requesterName: string;
  requesterCompany: string;
  requesterPosition?: string;
  requesterEmail?: string;
  requesterPhone?: string;
  message: string;
  acceptUrl?: string;
  cancelUrl?: string;
  fallbackEmail?: string;
  fallbackSubject?: string;
  fallbackHtml?: string;
}

interface WhatsAppV2ConfirmationPayload {
  accountId: string;
  to: string;
  eventName: string;
  acceptedBy: string;
  meetingWith: string;
  company: string;
  schedule: string;
  table: string;
  fallbackEmail?: string;
  fallbackSubject?: string;
  fallbackHtml?: string;
}

interface WhatsAppV2CancellationPayload {
  accountId: string;
  to: string;
  eventName: string;
  meetingWith: string;
  company: string;
  day: string;
  schedule: string;
  table: string;
  fallbackEmail?: string;
  fallbackSubject?: string;
  fallbackHtml?: string;
}

interface WhatsAppV2RejectionPayload {
  accountId: string;
  to: string;
  eventName: string;
  rejectedByName: string;
  rejectedByCompany: string;
  fallbackEmail?: string;
  fallbackSubject?: string;
  fallbackHtml?: string;
}

interface WhatsAppV2NotificationPayload {
  accountId: string;
  userId: string;
  message: string;
}

interface WhatsAppV2TemplatePayload {
  accountId: string;
  to: string;
  templateName: string;
  language: string;
  parameters: string[];
}

interface SendWhatsAppOptions {
  apiVersion: "v1" | "v2";
  phone: string;
  message: string;
  fallbackInfo?: {
    enabled: boolean;
    email: string;
    subject: string;
  };
  metadata?: {
    eventName?: string;
    requesterName?: string;
    requesterCompany?: string;
    requesterPosition?: string;
    requesterEmail?: string;
    requesterPhone?: string;
    acceptUrl?: string;
    cancelUrl?: string;
    contextNote?: string;
  };
}

const API_V1_URL = import.meta.env.VITE_WHATSAPP_API_V1 as string || "https://apiwhatsapp.geniality.com.co/api/send";
const API_V2_URL = import.meta.env.VITE_WHATSAPP_API_V2 as string || "https://apiwhatsapp.geniality.com.co";
const ACCOUNT_ID = import.meta.env.VITE_WHATSAPP_ACCOUNT_ID as string || "geniality";
const CLIENT_ID = "genialitybussinesstest1";

/**
 * Envía un mensaje de WhatsApp usando la API configurada
 */
export async function sendWhatsAppMessage(options: SendWhatsAppOptions): Promise<boolean> {
  const { apiVersion, phone, message, metadata = {} } = options;

  // Limpiar número de teléfono (ya viene con prefijo)
  const fullPhone = phone.replace(/[^\d]/g, "");

  // Variables for fallback content
  const cleanAcceptUrl = metadata.acceptUrl 
    ? metadata.acceptUrl.replace(/^\//, '') 
    : "dashboard";
  const cleanCancelUrl = metadata.cancelUrl 
    ? metadata.cancelUrl.replace(/^\//, '') 
    : "dashboard";
  const requesterName = metadata.requesterName?.trim() || "Asistente";
  const requesterCompany = metadata.requesterCompany?.trim() || "Compañia";

  try {
    let isSuccess = false;

    if (apiVersion === "v2") {
      // Limpiar el mensaje para evitar errores con newlines/tabs en la plantilla V2
      const cleanMessage = (message || "Sin mensaje adicional")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();

      const payload: WhatsAppV2Payload = {
        accountId: ACCOUNT_ID,
        to: fullPhone,
        eventName: metadata.eventName || "Evento",
        requesterName,
        requesterCompany,
        requesterPosition: metadata.requesterPosition || "Cargo",
        requesterEmail: metadata.requesterEmail || "Email",
        requesterPhone: metadata.requesterPhone || "Telefono",
        message: cleanMessage || " ", // Mensaje limpio sin saltos de línea ni excesos de espacios
        acceptUrl: cleanAcceptUrl,
        cancelUrl: cleanCancelUrl,
      };

      if (options.fallbackInfo?.enabled && options.fallbackInfo.email) {
        const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
        const emailAcceptUrl = `${baseUrl}/${cleanAcceptUrl}`;
        const emailCancelUrl = `${baseUrl}/${cleanCancelUrl}`;
        const btnStyle = "display: inline-block; padding: 12px 24px; margin: 10px; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; text-align: center; font-size: 14px;";

        const contentHtml = `
          <p>Hola,</p>
          <p>Te informamos que recibiste una solicitud de reunión por WhatsApp, pero no pudimos entregarla a tu número registrado.</p>
          
          <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin-top: 0; margin-bottom: 10px;"><strong>De:</strong> ${requesterName} (${requesterCompany})</p>
            <p style="margin: 0; font-style: italic;">"${message.replace(/\n/g, '<br>')}"</p>
          </div>
          
          <p style="text-align: center; margin-top: 25px;"><strong>¿Qué deseas hacer con esta solicitud?</strong></p>
          <div style="text-align: center; margin-bottom: 20px;">
            <a href="${emailAcceptUrl}" style="${btnStyle} background-color: #10b981;">Aceptar reunión</a>
            <a href="${emailCancelUrl}" style="${btnStyle} background-color: #ef4444;">Rechazar reunión</a>
          </div>
        `;

        payload.fallbackEmail = options.fallbackInfo.email;
        payload.fallbackSubject = options.fallbackInfo.subject;
        payload.fallbackHtml = buildEmailHtml(options.fallbackInfo.subject, contentHtml, options.fallbackInfo.logoUrl);
      }

      const response = await fetch(`${API_V2_URL}/api/send-meeting-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      isSuccess = response.ok;
      try {
        const responseData = await response.clone().json();
        if (responseData && (responseData.success === false || responseData.error)) {
          isSuccess = false;
        }
      } catch (e) {
        // Ignorar error de parsing
      }
    } else {
      // API V1: Simple (default)
      const payload: WhatsAppV1Payload = {
        clientId: CLIENT_ID,
        phone: fullPhone,
        message: message,
      };

      const response = await fetch(API_V1_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      isSuccess = response.ok;
      try {
        const responseData = await response.clone().json();
        if (responseData && (responseData.success === false || responseData.error)) {
          isSuccess = false;
        }
      } catch (e) {
        // Ignorar
      }
    }

    if (!isSuccess) {
      console.error("Error sending WhatsApp message, fallback handled by backend if V2");
    }

    return isSuccess;
  } catch (error) {
    console.error("Error sending WhatsApp message:", error);
    return false;
  }
}

/**
 * Formatea un número de teléfono para WhatsApp
 */
export function formatPhoneForWhatsApp(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  
  if (digits.length === 10 && digits.startsWith("3")) {
    return "57" + digits;
  }
  if (digits.length === 12 && digits.startsWith("57")) {
    return digits;
  }
  if (digits.length === 11 && digits.startsWith("03")) {
    return "57" + digits.slice(1);
  }
  
  return digits;
}

/**
 * Envía un mensaje de confirmación de reunión usando WhatsApp API V2
 */
export async function sendMeetingConfirmation(options: {
  phone: string;
  eventName: string;
  acceptedBy: string;
  meetingWith: string;
  company: string;
  schedule: string;
  table: string;
  fallbackInfo?: {
    enabled: boolean;
    email: string;
    subject: string;
    logoUrl?: string;
  };
}): Promise<boolean> {
  const { phone, eventName, acceptedBy, meetingWith, company, schedule, table, fallbackInfo } = options;

  // Limpiar número de teléfono (ya viene con prefijo)
  const fullPhone = phone.replace(/[^\d]/g, "");

  try {
    const payload: WhatsAppV2ConfirmationPayload = {
      accountId: ACCOUNT_ID,
      to: fullPhone,
      eventName,
      acceptedBy,
      meetingWith,
      company,
      schedule,
      table,
    };

    if (fallbackInfo?.enabled && fallbackInfo.email) {
      const contentHtml = `
        <p>Hola,</p>
        <p>Se intentó enviar una confirmación de reunión por WhatsApp pero el número no existe o no está registrado.</p>
        
        <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #111827; font-size: 16px;">Detalles de tu reunión:</h3>
          <ul style="margin-bottom: 0; padding-left: 20px;">
            <li style="margin-bottom: 8px;"><strong>Reunión aceptada por:</strong> ${acceptedBy}</li>
            <li style="margin-bottom: 8px;"><strong>Empresa:</strong> ${company}</li>
            <li style="margin-bottom: 8px;"><strong>Horario:</strong> ${schedule}</li>
            <li><strong>Mesa:</strong> ${table}</li>
          </ul>
        </div>
      `;

      payload.fallbackEmail = fallbackInfo.email;
      payload.fallbackSubject = fallbackInfo.subject;
      payload.fallbackHtml = buildEmailHtml(fallbackInfo.subject, contentHtml, fallbackInfo.logoUrl);
    }

    const response = await fetch(`${API_V2_URL}/api/send-meeting-confirmation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let isSuccess = response.ok;
    try {
      const responseData = await response.clone().json();
      if (responseData && (responseData.success === false || responseData.error)) {
        isSuccess = false;
      }
    } catch (e) {
      // Ignorar
    }

    if (!isSuccess) {
      console.error("Error sending meeting confirmation");
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending meeting confirmation:", error);
    return false;
  }
}

/**
 * Envía un mensaje de cancelación de reunión usando WhatsApp API V2
 */
export async function sendMeetingCancellation(options: {
  phone: string;
  eventName: string;
  meetingWith: string;
  company: string;
  day: string;
  schedule: string;
  table: string;
  fallbackInfo?: {
    enabled: boolean;
    email: string;
    subject: string;
    logoUrl?: string;
  };
}): Promise<boolean> {
  const { phone, eventName, meetingWith, company, day, schedule, table, fallbackInfo } = options;

  // Limpiar número de teléfono (ya viene con prefijo)
  const fullPhone = phone.replace(/[^\d]/g, "");

  try {
    const payload: WhatsAppV2CancellationPayload = {
      accountId: ACCOUNT_ID,
      to: fullPhone,
      eventName,
      meetingWith,
      company,
      day,
      schedule,
      table,
    };

    if (fallbackInfo?.enabled && fallbackInfo.email) {
      const contentHtml = `
        <p>Hola,</p>
        <p>Se intentó enviar una cancelación de reunión por WhatsApp pero el número no existe o no está registrado.</p>
        
        <div style="background-color: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #fee2e2;">
          <h3 style="margin-top: 0; color: #b91c1c; font-size: 16px;">Detalles de la reunión cancelada:</h3>
          <ul style="margin-bottom: 0; padding-left: 20px; color: #991b1b;">
            <li style="margin-bottom: 8px;"><strong>Reunión cancelada con:</strong> ${meetingWith}</li>
            <li style="margin-bottom: 8px;"><strong>Empresa:</strong> ${company}</li>
            <li style="margin-bottom: 8px;"><strong>Día:</strong> ${day}</li>
            <li style="margin-bottom: 8px;"><strong>Horario:</strong> ${schedule}</li>
            <li><strong>Mesa:</strong> ${table}</li>
          </ul>
        </div>
      `;

      payload.fallbackEmail = fallbackInfo.email;
      payload.fallbackSubject = fallbackInfo.subject;
      payload.fallbackHtml = buildEmailHtml(fallbackInfo.subject, contentHtml, fallbackInfo.logoUrl);
    }

    const response = await fetch(`${API_V2_URL}/api/send-meeting-cancelled`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let isSuccess = response.ok;
    try {
      const responseData = await response.clone().json();
      if (responseData && (responseData.success === false || responseData.error)) {
        isSuccess = false;
      }
    } catch (e) {
      // Ignorar
    }

    if (!isSuccess) {
      console.error("Error sending meeting cancellation");
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending meeting cancellation:", error);
    return false;
  }
}

/**
 * Envía un mensaje de rechazo de reunión usando WhatsApp API V2
 */
export async function sendMeetingRejection(options: {
  phone: string;
  eventName: string;
  rejectedByName: string;
  rejectedByCompany: string;
  fallbackInfo?: {
    enabled: boolean;
    email: string;
    subject: string;
    logoUrl?: string;
  };
}): Promise<boolean> {
  const { phone, eventName, rejectedByName, rejectedByCompany, fallbackInfo } = options;

  // Limpiar número de teléfono (ya viene con prefijo)
  const fullPhone = phone.replace(/[^\d]/g, "");

  try {
    const payload: WhatsAppV2RejectionPayload = {
      accountId: ACCOUNT_ID,
      to: fullPhone,
      eventName,
      rejectedByName,
      rejectedByCompany,
    };

    if (fallbackInfo?.enabled && fallbackInfo.email) {
      const contentHtml = `
        <p>Hola,</p>
        <p>Se intentó enviar un rechazo de reunión por WhatsApp pero el número no existe o no está registrado.</p>
        
        <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #111827; font-size: 16px;">Detalles:</h3>
          <ul style="margin-bottom: 0; padding-left: 20px;">
            <li style="margin-bottom: 8px;"><strong>Rechazada por:</strong> ${rejectedByName}</li>
            <li><strong>Empresa:</strong> ${rejectedByCompany}</li>
          </ul>
        </div>
      `;

      payload.fallbackEmail = fallbackInfo.email;
      payload.fallbackSubject = fallbackInfo.subject;
      payload.fallbackHtml = buildEmailHtml(fallbackInfo.subject, contentHtml, fallbackInfo.logoUrl);
    }

    const response = await fetch(`${API_V2_URL}/api/send-meeting-rejection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let isSuccess = response.ok;
    try {
      const responseData = await response.clone().json();
      if (responseData && (responseData.success === false || responseData.error)) {
        isSuccess = false;
      }
    } catch (e) {
      // Ignorar
    }

    if (!isSuccess) {
      console.error("Error sending meeting rejection");
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending meeting rejection:", error);
    return false;
  }
}

/**
 * Envía una notificación genérica de bienvenida o información usando WhatsApp API V2
 */
export async function sendWelcomeNotification(options: {
  phone: string;
  name: string;
  eventName: string;
  badgeUrl?: string;
  headerImageUrl?: string;
  date?: string;
  time?: string;
  fallbackInfo?: {
    enabled: boolean;
    email: string;
    subject: string;
    logoUrl?: string;
  };
}): Promise<boolean> {
  const { phone, name, eventName, badgeUrl, headerImageUrl, date, time, fallbackInfo } = options;

  // Limpiar número de teléfono (ya viene con prefijo)
  const fullPhone = phone.replace(/[^\d]/g, "");

  try {
    const payload: any = {
      accountId: ACCOUNT_ID,
      to: fullPhone,
      userName: name,
      eventName: eventName,
      badgeUrl: badgeUrl,
      headerImageUrl: headerImageUrl,
      date: date || "Por definir",
      time: time || "Por definir",
    };

    if (fallbackInfo?.enabled && fallbackInfo.email) {
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
      const btnStyle = "display: inline-block; padding: 12px 24px; margin: 15px 0; color: white; background-color: #3b82f6; text-decoration: none; border-radius: 6px; font-weight: bold; text-align: center; font-size: 14px;";
      
      const contentHtml = `
        <p>Hola <strong>${name}</strong>,</p>
        <p>¡Bienvenido/a al evento <strong>${eventName}</strong>!</p>
        <p>Tu número de WhatsApp no pudo recibir nuestro mensaje de bienvenida porque no existe o no está registrado.</p>
        
        <div style="background-color: #eff6ff; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #bfdbfe;">
          <h3 style="margin-top: 0; color: #1e3a8a; font-size: 16px;">Detalles del evento:</h3>
          <ul style="margin-bottom: 0; padding-left: 20px; color: #1e40af;">
            <li style="margin-bottom: 8px;"><strong>Fecha:</strong> ${date || "Por definir"}</li>
            <li><strong>Hora:</strong> ${time || "Por definir"}</li>
          </ul>
        </div>

        <p>Puedes acceder al dashboard para ver tu acreditación y más detalles.</p>
        
        <div style="text-align: center; margin-top: 25px;">
          <a href="${baseUrl}/dashboard" style="${btnStyle}">Ir al Dashboard del Evento</a>
        </div>
      `;

      payload.fallbackEmail = fallbackInfo.email;
      payload.fallbackSubject = fallbackInfo.subject;
      payload.fallbackHtml = buildEmailHtml(fallbackInfo.subject, contentHtml, fallbackInfo.logoUrl);
    }

    const response = await fetch(`${API_V2_URL}/api/send-welcome`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let isSuccess = response.ok;
    try {
      const responseData = await response.clone().json();
      if (responseData && (responseData.success === false || responseData.error)) {
        isSuccess = false;
      }
    } catch (e) {
      // Ignorar
    }

    if (!isSuccess) {
      console.error("Error sending welcome notification");
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending welcome notification:", error);
    return false;
  }
}

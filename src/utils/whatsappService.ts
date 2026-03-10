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
}

interface SendWhatsAppOptions {
  apiVersion: "v1" | "v2";
  phone: string;
  message: string;
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
const CLIENT_ID = "genialitybussinesstest";

/**
 * Envía un mensaje de WhatsApp usando la API configurada
 */
export async function sendWhatsAppMessage(options: SendWhatsAppOptions): Promise<boolean> {
  const { apiVersion, phone, message, metadata = {} } = options;

  // Limpiar número de teléfono
  const cleanPhone = phone.replace(/[^\d]/g, "");
  const fullPhone = `57${cleanPhone}`;

  try {
    if (apiVersion === "v2") {
      // Limpiar las URLs quitando el primer slash
      const cleanAcceptUrl = metadata.acceptUrl 
        ? metadata.acceptUrl.replace(/^\//, '') 
        : " ";
      const cleanCancelUrl = metadata.cancelUrl 
        ? metadata.cancelUrl.replace(/^\//, '') 
        : " ";

      // API V2: Meeting Request
      const payload: WhatsAppV2Payload = {
        accountId: ACCOUNT_ID,
        to: fullPhone,
        eventName: metadata.eventName || "Evento",
        requesterName: metadata.requesterName || "Asistente",
        requesterCompany: metadata.requesterCompany || "Compañia",
        requesterPosition: metadata.requesterPosition || "Cargo",
        requesterEmail: metadata.requesterEmail || "Email",
        requesterPhone: metadata.requesterPhone || "Telefono",
        message: metadata.contextNote || message,
        acceptUrl: cleanAcceptUrl,
        cancelUrl: cleanCancelUrl,
      };

      const response = await fetch(`${API_V2_URL}/api/send-meeting-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      return response.ok;
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

      return response.ok;
    }
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

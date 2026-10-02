import { Button } from "@mantine/core";
import { IconBrandWhatsapp } from "@tabler/icons-react";

// WhatsApp de soporte (formato internacional, sin "+" ni espacios)
const SUPPORT_WHATSAPP = "573224387523";

interface SupportButtonProps {
  eventName?: string;
  userName?: string;
  userEmail?: string;
}

/** Botón flotante que abre un chat de WhatsApp con soporte, con el contexto ya escrito. */
export default function SupportButton({ eventName, userName, userEmail }: SupportButtonProps) {
  const lines = [
    `Hola, necesito soporte${eventName ? ` en el evento "${eventName}"` : ""}.`,
    userName ? `Nombre: ${userName}` : "",
    userEmail ? `Correo: ${userEmail}` : "",
  ].filter(Boolean);
  const href = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(lines.join("\n"))}`;

  return (
    <Button
      component="a"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      color="green"
      radius="xl"
      size="sm"
      leftSection={<IconBrandWhatsapp size={18} />}
      style={{ position: "fixed", right: 16, bottom: 16, zIndex: 150 }}
      aria-label="Contactar a soporte por WhatsApp"
    >
      Soporte
    </Button>
  );
}

import { Modal, Stack, Text, Group, Button, Textarea } from "@mantine/core";
import { useState } from "react";

interface MeetingRequestModalProps {
  opened: boolean;
  recipientName: string;
  recipientType: "asistente" | "empresa" | "producto";
  contextInfo?: string; // Info adicional como nombre de producto o empresa
  onCancel: () => void;
  onConfirm: (message: string) => void;
  loading?: boolean;
}

const MAX_MESSAGE_LENGTH = 200;

export default function MeetingRequestModal({
  opened,
  recipientName,
  recipientType,
  contextInfo,
  onCancel,
  onConfirm,
  loading = false,
}: MeetingRequestModalProps) {
  const [message, setMessage] = useState("");

  const handleConfirm = () => {
    onConfirm(message.trim());
    setMessage(""); // Limpiar después de enviar
  };

  const handleCancel = () => {
    setMessage(""); // Limpiar al cancelar
    onCancel();
  };

  const getTitle = () => {
    switch (recipientType) {
      case "producto":
        return "Solicitar reunión por producto";
      case "empresa":
        return "Solicitar reunión con empresa";
      default:
        return "Solicitar reunión";
    }
  };

  const getDescription = () => {
    if (recipientType === "producto" && contextInfo) {
      return `Vas a solicitar una reunión con ${recipientName} por el producto "${contextInfo}".`;
    }
    if (recipientType === "empresa" && contextInfo) {
      return `Vas a solicitar una reunión con ${recipientName} de ${contextInfo}.`;
    }
    return `Vas a solicitar una reunión con ${recipientName}.`;
  };

  return (
    <Modal
      opened={opened}
      onClose={handleCancel}
      title={getTitle()}
      centered
      size="md"
    >
      <Stack gap="md">
        <Text size="sm">{getDescription()}</Text>

        <Textarea
          label="Mensaje personalizado (opcional)"
          placeholder="Ej: Me interesa conocer más sobre sus productos..."
          description={`${message.length}/${MAX_MESSAGE_LENGTH} caracteres`}
          value={message}
          onChange={(e) => {
            const value = e.currentTarget.value;
            if (value.length <= MAX_MESSAGE_LENGTH) {
              setMessage(value);
            }
          }}
          minRows={3}
          maxRows={5}
          autosize
        />

        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={handleCancel} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} loading={loading}>
            Enviar solicitud
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

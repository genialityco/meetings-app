import { Badge, Button, Group, Modal, Stack } from "@mantine/core";
import { IconEdit } from "@tabler/icons-react";
import AttendeeInfoCard from "./AttendeeInfoCard";

interface AttendeeScanReviewModalProps {
  opened: boolean;
  attendee: any | null;
  formFields?: any[];
  title?: string;
  alreadyDoneMessage?: string;
  actionLabel: string;
  actionColor?: string;
  confirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Si se pasa, muestra "Editar datos" para corregir la información del
   * asistente antes de confirmar (p. ej. check-in en puerta). */
  onEdit?: () => void;
}

export default function AttendeeScanReviewModal({
  opened,
  attendee,
  formFields = [],
  title = "Asistente escaneado",
  alreadyDoneMessage,
  actionLabel,
  actionColor = "teal",
  confirming = false,
  onConfirm,
  onCancel,
  onEdit,
}: AttendeeScanReviewModalProps) {
  return (
    <Modal opened={opened} onClose={onCancel} title={title} centered size="md">
      {attendee && (
        <Stack gap="md">
          <AttendeeInfoCard attendee={attendee} formFields={formFields} />
          {alreadyDoneMessage && (
            <Badge color="yellow" variant="light" size="lg">
              {alreadyDoneMessage}
            </Badge>
          )}
          <Group justify={onEdit ? "space-between" : "flex-end"}>
            {onEdit && (
              <Button variant="light" leftSection={<IconEdit size={16} />} onClick={onEdit}>
                Editar datos
              </Button>
            )}
            <Group gap="xs">
              <Button variant="default" onClick={onCancel}>
                Cancelar
              </Button>
              <Button color={actionColor} loading={confirming} disabled={!!alreadyDoneMessage} onClick={onConfirm}>
                {actionLabel}
              </Button>
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

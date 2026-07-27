import { Badge, Button, Group, Modal, Stack } from "@mantine/core";
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
          <Group justify="flex-end">
            <Button variant="default" onClick={onCancel}>
              Cancelar
            </Button>
            <Button color={actionColor} loading={confirming} disabled={!!alreadyDoneMessage} onClick={onConfirm}>
              {actionLabel}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

import { Modal, Stack, Text, Group, Button } from "@mantine/core";

export default function ConfirmModal({
  opened, currentRequesterName, chosenSlot, onCancel, onAccept
}) {
  return (
    <Modal opened={opened} onClose={onCancel} title="Confirmar reunión" centered>
      <Stack p="lg">
        <Text>
          Vas a agendar una reunión con <b>{currentRequesterName}</b> a las{" "}
          <b>
            {chosenSlot?.startTime} – {chosenSlot?.endTime} (Mesa {chosenSlot?.tableNumber})
          </b>
          .
        </Text>
        <Group justify="flex-start" p="sm">
          <Button variant="default" onClick={onCancel}>Cancelar</Button>
          <Button onClick={onAccept}>Aceptar</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

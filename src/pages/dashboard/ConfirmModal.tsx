import { Modal, Stack, Text, Group, Button } from "@mantine/core";

// "2026-10-15" -> "jueves 15 de octubre" (en eventos de varios días la hora
// sola no dice en qué día queda la reunión)
const formatSlotDate = (dateStr?: string) => {
  if (!dateStr) return "";
  const date = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
};

export default function ConfirmModal({
  opened, currentRequesterName, chosenSlot, tableLabel, onCancel, onAccept
}) {
  const dateLabel = formatSlotDate(chosenSlot?.date);
  return (
    <Modal opened={opened} onClose={onCancel} title="Confirmar reunión" centered>
      <Stack p="lg">
        <Text>
          Vas a agendar una reunión con <b>{currentRequesterName}</b>
          {dateLabel && (
            <>
              {" "}el <b>{dateLabel}</b>
            </>
          )}{" "}
          a las{" "}
          <b>
            {chosenSlot?.startTime} – {chosenSlot?.endTime} ({tableLabel || `Mesa ${chosenSlot?.tableNumber}`})
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

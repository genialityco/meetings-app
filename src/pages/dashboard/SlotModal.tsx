import { Modal, LoadingOverlay, Stack, Select, Button, Text } from "@mantine/core";

export default function SlotModal({
  opened, availableSlots, confirmLoading, groupedSlots,
  selectedRange, setSelectedRange, tableOptions, selectedSlotId, setSelectedSlotId,
  chosenSlot, setConfirmModalOpened, onClose
}) {
  // El mismo cuerpo del modal de slots, pero usando props
  return (
    <Modal opened={opened} onClose={onClose} title="Selecciona un horario de reunión" size="lg" overlayProps={{ opacity: 0.3 }}>
      <LoadingOverlay visible={confirmLoading} />
      {availableSlots.length === 0 ? (
        <Text ta="center">No hay horarios disponibles.</Text>
      ) : (
        <Stack p="md">
          <Select
            label="Hora"
            data={groupedSlots.map(g => ({ value: g.id, label: `${g.startTime} – ${g.endTime}` }))}
            value={selectedRange}
            onChange={setSelectedRange}
            disabled={confirmLoading}
            required
          />
          <Select
            label="Mesa"
            data={tableOptions}
            value={selectedSlotId}
            onChange={setSelectedSlotId}
            disabled={!selectedRange || confirmLoading}
            required
          />
          <Button
            fullWidth
            mt="md"
            disabled={!chosenSlot}
            loading={confirmLoading}
            onClick={() => setConfirmModalOpened(true)}
          >
            Confirmar datos
          </Button>
        </Stack>
      )}
    </Modal>
  );
}

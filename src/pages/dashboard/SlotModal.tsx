import { Modal, LoadingOverlay, Stack, Select, Button, Text, Tabs, Badge, Group } from "@mantine/core";
import { IconCalendar } from "@tabler/icons-react";
import { useMemo } from "react";

interface SlotModalProps {
  opened: boolean;
  availableSlots: any[];
  confirmLoading: boolean;
  groupedSlots: any[];
  selectedRange: string | null;
  setSelectedRange: (value: string | null) => void;
  tableOptions: any[];
  selectedSlotId: string | null;
  setSelectedSlotId: (value: string | null) => void;
  chosenSlot: any;
  setConfirmModalOpened: (value: boolean) => void;
  onClose: () => void;
  eventDates?: string[]; // Array de fechas del evento
  selectedDate?: string | null;
  onDateChange?: (date: string) => void;
}

export default function SlotModal({
  opened,
  availableSlots,
  confirmLoading,
  groupedSlots,
  selectedRange,
  setSelectedRange,
  tableOptions,
  selectedSlotId,
  setSelectedSlotId,
  chosenSlot,
  setConfirmModalOpened,
  onClose,
  eventDates = [],
  selectedDate,
  onDateChange,
}: SlotModalProps) {
  // Formatear fechas para mostrar
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  };

  // Contar slots disponibles por fecha
  const slotCountByDate = useMemo(() => {
    const counts: Record<string, number> = {};
    availableSlots.forEach((slot) => {
      const date = slot.date || eventDates[0] || "";
      counts[date] = (counts[date] || 0) + 1;
    });
    return counts;
  }, [availableSlots, eventDates]);

  const hasMultipleDays = eventDates.length > 1;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Selecciona un horario de reunión"
      size="lg"
      overlayProps={{ opacity: 0.3 }}
    >
      <LoadingOverlay visible={confirmLoading} />
      {availableSlots.length === 0 ? (
        <Text ta="center">No hay horarios disponibles.</Text>
      ) : (
        <Stack p="md">
          {/* Selector de día (solo si hay múltiples días) */}
          {hasMultipleDays && (
            <Tabs
              value={selectedDate || eventDates[0]}
              onChange={(value) => onDateChange?.(value || eventDates[0])}
            >
              <Tabs.List>
                {eventDates.map((date) => (
                  <Tabs.Tab
                    key={date}
                    value={date}
                    leftSection={<IconCalendar size={16} />}
                  >
                    <Group gap="xs">
                      <Text size="sm">{formatDate(date)}</Text>
                      <Badge size="sm" variant="light">
                        {slotCountByDate[date] || 0} slots
                      </Badge>
                    </Group>
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs>
          )}

          <Select
            label="Hora"
            data={groupedSlots.map((g) => ({
              value: g.id,
              label: `${g.startTime} – ${g.endTime}`,
            }))}
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

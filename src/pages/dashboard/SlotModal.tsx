import { Modal, LoadingOverlay, Stack, Select, Button, Text, Textarea } from "@mantine/core";
import { useMemo, useEffect } from "react";

const MAX_MESSAGE_LENGTH = 200;

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
  onConfirmClick: () => void;
  onClose: () => void;
  eventDates?: string[]; // Array de fechas del evento
  selectedDate?: string | null;
  onDateChange?: (date: string) => void;
  /** Texto describiendo con quién/qué se va a agendar (ej. "Vas a solicitar una
   *  reunión con Juan de Geniality."). Si se pasa, este modal actúa como el
   *  único paso de la solicitud (horario + mesa + mensaje opcional). */
  description?: string;
  message?: string;
  onMessageChange?: (value: string) => void;
  confirmLabel?: string;
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
  onConfirmClick,
  onClose,
  eventDates = [],
  selectedDate,
  onDateChange,
  description,
  message,
  onMessageChange,
  confirmLabel,
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

  // Si para el horario elegido solo hay una mesa posible (mesa fija de la
  // empresa/asistente, o único cupo libre), se asigna automáticamente y no
  // se le pide al usuario que escoja mesa. Se agrupa por label (no por
  // cantidad de slots) porque puede haber más de un slot para la misma mesa
  // a la misma hora (p. ej. agenda regenerada) sin que eso implique que hay
  // varias mesas entre las que elegir.
  const singleTableOption = useMemo(() => {
    if (tableOptions.length === 0) return null;
    const uniqueLabels = new Set(tableOptions.map((o: any) => o.label));
    return uniqueLabels.size === 1 ? tableOptions[0] : null;
  }, [tableOptions]);

  useEffect(() => {
    if (singleTableOption && selectedSlotId !== singleTableOption.value) {
      setSelectedSlotId(singleTableOption.value);
    }
  }, [singleTableOption?.value]);

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
          {description && <Text size="sm">{description}</Text>}

          {/* Selector de día (solo si hay múltiples días) */}
          {hasMultipleDays && (
            <Select
              label="Día"
              data={eventDates.map((date) => ({
                value: date,
                label: `${formatDate(date)} (${slotCountByDate[date] || 0} slots)`,
              }))}
              value={selectedDate || eventDates[0]}
              onChange={(value) => onDateChange?.(value || eventDates[0])}
              disabled={confirmLoading}
            />
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
          {singleTableOption ? (
            selectedRange && (
              <Text size="sm">
                <Text span fw={600}>
                  Mesa asignada:
                </Text>{" "}
                {singleTableOption.label}
              </Text>
            )
          ) : (
            <Select
              label="Mesa"
              data={tableOptions}
              value={selectedSlotId}
              onChange={setSelectedSlotId}
              disabled={!selectedRange || confirmLoading}
              required
            />
          )}

          {onMessageChange && (
            <Textarea
              label="Mensaje personalizado (opcional)"
              placeholder="Ej: Me interesa conocer más sobre sus productos..."
              description={`${(message || "").length}/${MAX_MESSAGE_LENGTH} caracteres`}
              value={message || ""}
              onChange={(e) => {
                const value = e.currentTarget.value;
                if (value.length <= MAX_MESSAGE_LENGTH) onMessageChange(value);
              }}
              minRows={3}
              maxRows={5}
              autosize
            />
          )}

          <Button
            fullWidth
            mt="md"
            disabled={!chosenSlot}
            loading={confirmLoading}
            onClick={onConfirmClick}
          >
            {confirmLabel || "Confirmar datos"}
          </Button>
        </Stack>
      )}
    </Modal>
  );
}

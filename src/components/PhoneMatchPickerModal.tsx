import { Group, Modal, Paper, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import type { PhoneLoginMatch } from "../utils/phoneLogin";

interface PhoneMatchPickerModalProps {
  /** null = cerrado */
  matches: PhoneLoginMatch[] | null;
  onPick: (match: PhoneLoginMatch) => void;
  onClose: () => void;
}

/**
 * Ingreso con el celular cuando el número está registrado a nombre de varias
 * personas del evento (datos viejos: hoy checkPhoneAvailability impide repetirlo).
 */
export default function PhoneMatchPickerModal({ matches, onPick, onClose }: PhoneMatchPickerModalProps) {
  return (
    <Modal opened={!!matches} onClose={onClose} title="¿Quién eres?" centered radius="md">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Este celular está registrado a nombre de varias personas. Selecciona tu nombre:
        </Text>
        {(matches || []).map((m) => (
          <UnstyledButton key={m.uid} onClick={() => onPick(m)}>
            <Paper withBorder radius="md" p="sm">
              <Group justify="space-between" wrap="nowrap">
                <div>
                  <Text fw={600}>{m.nombre}</Text>
                  {m.empresa && (
                    <Text size="xs" c="dimmed">
                      {m.empresa}
                    </Text>
                  )}
                </div>
                <IconChevronRight size={18} />
              </Group>
            </Paper>
          </UnstyledButton>
        ))}
      </Stack>
    </Modal>
  );
}

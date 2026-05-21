import { Modal, Stack, TextInput, Textarea, Select, Checkbox, Button, Group, Box, Text } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import {
  COUNTRY_CODES,
  detectDefaultIso2,
  getDialCodeForIso2,
  parsePhoneValue,
  isPhoneField,
} from "../../utils/phoneUtils";

const ModalEditAttendee = ({
  opened,
  onClose,
  attendee,
  fields,
  onSave,
}) => {
  const [values, setValues] = useState(attendee || {});
  const [saving, setSaving] = useState(false);
  const defaultIso2 = useMemo(() => detectDefaultIso2(), []);

  // Sincroniza cuando cambia el asistente
  useEffect(() => {
    setValues(attendee || {});
  }, [attendee]);

  const handleChange = (field, value) => {
    setValues((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmit = async () => {
    setSaving(true);
    await onSave(values);
    setSaving(false);
    onClose();
  };

  if (!attendee) return null;

  return (
    <Modal opened={opened} onClose={onClose} title="Editar asistente" size="md">
      <Stack>
        {fields.map((f) => {
          // Omitimos consentimiento, foto y campos especiales si quieres
          if (["aceptaTratamiento", "photo"].includes(f.name)) return null;
          if (f.type === "select") {
            return (
              <Select
                key={f.name}
                label={f.label}
                data={f.options || []}
                value={values[f.name] || ""}
                onChange={(v) => handleChange(f.name, v)}
                required={f.required}
              />
            );
          }
          if (f.type === "checkbox") {
            return (
              <Checkbox
                key={f.name}
                label={f.label}
                checked={!!values[f.name]}
                onChange={(e) => handleChange(f.name, e.currentTarget.checked)}
              />
            );
          }
          // Usar Textarea para descripcion o richtext
          if (f.name === "descripcion" || f.type === "richtext") {
            return (
              <Textarea
                key={f.name}
                label={f.label}
                value={values[f.name] || ""}
                onChange={(e) => handleChange(f.name, e.currentTarget.value)}
                required={f.required}
                minRows={4}
                maxRows={8}
                autosize
              />
            );
          }
          if (isPhoneField(f)) {
            const { iso2, dialCode, number: phoneNumber } = parsePhoneValue(
              values[f.name] || "",
              defaultIso2,
            );
            return (
              <Box key={f.name}>
                <Text size="sm" fw={500} mb={4}>
                  {f.label}
                  {f.required && (
                    <Text component="span" c="red" ml={2}>*</Text>
                  )}
                </Text>
                <Group gap={6} align="flex-start" wrap="nowrap">
                  <Select
                    data={COUNTRY_CODES}
                    value={iso2}
                    onChange={(newIso2) => {
                      if (!newIso2) return;
                      const dc = getDialCodeForIso2(newIso2);
                      handleChange(
                        f.name,
                        phoneNumber ? `${dc} ${phoneNumber}` : dc,
                      );
                    }}
                    style={{ width: 104 }}
                    searchable
                    radius="md"
                    comboboxProps={{ width: 300 }}
                    allowDeselect={false}
                  />
                  <TextInput
                    placeholder="Número"
                    value={phoneNumber}
                    onChange={(e) => {
                      const num = e.target.value.replace(/\D/g, "");
                      handleChange(f.name, `${dialCode} ${num}`.trim());
                    }}
                    required={f.required}
                    style={{ flex: 1 }}
                    radius="md"
                  />
                </Group>
              </Box>
            );
          }

          // text por defecto
          return (
            <TextInput
              key={f.name}
              label={f.label}
              value={values[f.name] || ""}
              onChange={(e) => handleChange(f.name, e.currentTarget.value)}
              required={f.required}
            />
          );
        })}
        <Button loading={saving} onClick={handleSubmit}>
          Guardar cambios
        </Button>
      </Stack>
    </Modal>
  );
};

export default ModalEditAttendee;

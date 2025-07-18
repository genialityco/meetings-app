import { Modal, Stack, TextInput, Select, Checkbox, Button } from "@mantine/core";
import { useEffect, useState } from "react";

const ModalEditAttendee = ({
  opened,
  onClose,
  attendee,
  fields,
  onSave,
}) => {
  const [values, setValues] = useState(attendee || {});
  const [saving, setSaving] = useState(false);

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
          // text/richtext por defecto
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

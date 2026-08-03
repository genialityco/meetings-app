import { Modal, Stack, TextInput, Textarea, Select, Checkbox, Button, Group, Box, Text, Image, FileButton } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../../firebase/firebaseConfig";
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
  eventId,
}) => {
  const [values, setValues] = useState(attendee || {});
  const [saving, setSaving] = useState(false);
  const [uploadingField, setUploadingField] = useState(null);
  const [dragOverField, setDragOverField] = useState(null);
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

  const handleImageUpload = async (fieldName, file) => {
    if (!file) return;
    setUploadingField(fieldName);
    try {
      const ext = file.name.split(".").pop() || "png";
      const entityId = attendee?.id || "sin-id";
      const storageRef = ref(
        storage,
        `uploads/${eventId || "misc"}/${entityId}/${fieldName}-${Date.now()}.${ext}`,
      );
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      handleChange(fieldName, url);
    } catch (err) {
      console.error("Error al subir la imagen:", err);
    } finally {
      setUploadingField(null);
    }
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
          if (f.type === "image") {
            const isUploading = uploadingField === f.name;
            const isDragOver = dragOverField === f.name;
            const handleDragOver = (e) => {
              e.preventDefault();
              setDragOverField(f.name);
            };
            const handleDragLeave = () => setDragOverField(null);
            const handleDrop = (e) => {
              e.preventDefault();
              setDragOverField(null);
              const file = e.dataTransfer.files?.[0];
              if (file) handleImageUpload(f.name, file);
            };
            return (
              <Box key={f.name}>
                <Text size="sm" fw={500} mb={4}>
                  {f.label}
                </Text>
                <Group gap="sm" align="center">
                  <FileButton
                    onChange={(file) => handleImageUpload(f.name, file)}
                    accept="image/png,image/jpeg,image/webp"
                  >
                    {(fileButtonProps) =>
                      values[f.name] ? (
                        <Box
                          {...fileButtonProps}
                          onDragOver={handleDragOver}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDrop}
                          style={{
                            position: "relative",
                            cursor: "pointer",
                            outline: isDragOver ? "2px solid var(--mantine-color-blue-5)" : "none",
                            outlineOffset: 2,
                            borderRadius: 8,
                            opacity: isUploading ? 0.5 : 1,
                          }}
                        >
                          <Image
                            src={values[f.name]}
                            alt={f.label}
                            w={80}
                            h={80}
                            fit="cover"
                            radius="md"
                          />
                        </Box>
                      ) : (
                        <Box
                          {...fileButtonProps}
                          w={80}
                          h={80}
                          onDragOver={handleDragOver}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDrop}
                          style={{
                            border: `1px dashed ${isDragOver ? "var(--mantine-color-blue-5)" : "#ced4da"}`,
                            backgroundColor: isDragOver ? "var(--mantine-color-blue-0)" : undefined,
                            borderRadius: 8,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            opacity: isUploading ? 0.5 : 1,
                          }}
                        >
                          <Text size="xs" c="dimmed" ta="center" px={4}>
                            {isDragOver ? "Soltar aquí" : "Arrastra o haz clic"}
                          </Text>
                        </Box>
                      )
                    }
                  </FileButton>
                  <Stack gap={4}>
                    <FileButton
                      onChange={(file) => handleImageUpload(f.name, file)}
                      accept="image/png,image/jpeg,image/webp"
                    >
                      {(props) => (
                        <Button {...props} variant="light" size="xs" loading={isUploading}>
                          {values[f.name] ? "Cambiar imagen" : "Subir imagen"}
                        </Button>
                      )}
                    </FileButton>
                    {values[f.name] && (
                      <Button
                        variant="subtle"
                        color="red"
                        size="xs"
                        onClick={() => handleChange(f.name, "")}
                      >
                        Quitar
                      </Button>
                    )}
                    <Text size="xs" c="dimmed">Recomendado: formato cuadrado</Text>
                  </Stack>
                </Group>
              </Box>
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

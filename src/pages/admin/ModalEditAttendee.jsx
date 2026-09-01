import { Modal, Stack, TextInput, Textarea, Select, Checkbox, Button, Group, Box, Text, Image, FileButton, Divider, Loader } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { doc, getDoc } from "firebase/firestore";
import { storage, db } from "../../firebase/firebaseConfig";
import {
  COUNTRY_CODES,
  detectDefaultIso2,
  getDialCodeForIso2,
  parsePhoneValue,
  isPhoneField,
} from "../../utils/phoneUtils";

const normalizeNit = (v = "") => String(v || "").replace(/\D/g, "");

// Definiciones por defecto para el identificador de empresa y la razón
// social, usadas cuando el evento no los tiene configurados explícitamente
// en `formFields` — así la sección "Empresa" siempre puede mostrarlos (igual
// que el bloque fijo que existía antes), y si el evento sí los configuró
// (ej. relabeled a "NIF") se usa esa definición real en su lugar.
const COMPANY_FIELD_DEFAULTS = {
  company_nit: { name: "company_nit", label: "NIT de la empresa", type: "text", placeholder: "Ej: 900123456" },
  company_razonSocial: { name: "company_razonSocial", label: "Razón social", type: "text" },
};

const ModalEditAttendee = ({
  opened,
  onClose,
  attendee,
  fields,
  onSave,
  eventId,
  // Nombres de los campos del paso "empresa" del formulario de registro del
  // evento (ej. ["company_nit", "company_razonSocial", "descripcion"]).
  // Cuando se pasa (solo al crear un asistente nuevo), esos campos se agrupan
  // en una única sección "Empresa" con autocompletado por identificador, en
  // vez de aparecer sueltos entre los campos del asistente. Vacío por defecto
  // para no afectar otros usos de este modal (ej. edición de empresas).
  companyStepFields = [],
}) => {
  const [values, setValues] = useState(attendee || {});
  const [saving, setSaving] = useState(false);
  const [uploadingField, setUploadingField] = useState(null);
  const [dragOverField, setDragOverField] = useState(null);
  const [companyLookupStatus, setCompanyLookupStatus] = useState("idle"); // idle | loading | found | notfound
  const [existingCompany, setExistingCompany] = useState(null);
  const [companyLogoFile, setCompanyLogoFile] = useState(null);
  const [companyLogoPreviewUrl, setCompanyLogoPreviewUrl] = useState(null);
  const defaultIso2 = useMemo(() => detectDefaultIso2(), []);

  // Sincroniza cuando cambia el asistente
  useEffect(() => {
    setValues(attendee || {});
    setCompanyLookupStatus("idle");
    setExistingCompany(null);
    setCompanyLogoFile(null);
    setCompanyLogoPreviewUrl(null);
  }, [attendee]);

  const isNew = !attendee?.id;
  // Solo se agrupan los campos de empresa cuando el caller los pasó Y estamos
  // creando (para no cambiar el comportamiento de edición ni de otros usos
  // del modal, como la edición de empresas en AttendeesList).
  const groupCompanyFields = isNew && companyStepFields.length > 0;
  const companyFieldDefs = groupCompanyFields
    ? companyStepFields
        .map((name) => fields.find((f) => f.name === name) || COMPANY_FIELD_DEFAULTS[name])
        .filter(Boolean)
    : [];
  const companyFieldNames = new Set(companyFieldDefs.map((f) => f.name));

  const handleChange = (field, value) => {
    setValues((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmit = async () => {
    setSaving(true);
    const result = await onSave(values);
    setSaving(false);
    // onSave puede devolver `false` explícitamente para mantener el modal
    // abierto (p.ej. validación de duplicados al registrar un nuevo asistente).
    if (result !== false) {
      onClose();
    }
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

  // Busca la empresa por identificador (NIT/NIF u otro nombre configurado
  // para el evento) y, si existe, autocompleta el resto de campos del paso
  // "empresa" (razón social, descripción, etc.) igual que hace Landing.jsx
  // para el registro público.
  const handleCompanyNitBlur = async () => {
    const nitNorm = normalizeNit(values.company_nit || "");
    if (!nitNorm) {
      setCompanyLookupStatus("idle");
      setExistingCompany(null);
      setValues((prev) => ({ ...prev, companyId: "" }));
      return;
    }
    if (!eventId) {
      setCompanyLookupStatus("idle");
      setExistingCompany(null);
      return;
    }
    setCompanyLookupStatus("loading");
    try {
      const snap = await getDoc(doc(db, "events", eventId, "companies", nitNorm));
      if (snap.exists()) {
        const data = snap.data();
        setExistingCompany(data);
        setCompanyLookupStatus("found");
        setValues((prev) => {
          const updated = { ...prev, company_nit: nitNorm, companyId: nitNorm };
          companyStepFields.forEach((fieldName) => {
            if (fieldName === "company_nit") return;
            if (data[fieldName] !== undefined && data[fieldName] !== null) {
              updated[fieldName] = data[fieldName];
            }
          });
          if (data.razonSocial && !updated.company_razonSocial) {
            updated.company_razonSocial = data.razonSocial;
          }
          return updated;
        });
      } else {
        setExistingCompany(null);
        setCompanyLookupStatus("notfound");
        setValues((prev) => ({ ...prev, company_nit: nitNorm, companyId: nitNorm }));
      }
    } catch (err) {
      console.error("Error al buscar la empresa:", err);
      setCompanyLookupStatus("idle");
    }
  };

  const handleCompanyLogoSelect = (file) => {
    if (!file) return;
    setCompanyLogoFile(file);
    setCompanyLogoPreviewUrl(URL.createObjectURL(file));
    handleChange("_companyLogoFile", file);
  };

  const companyLogoPreview = companyLogoFile
    ? companyLogoPreviewUrl
    : existingCompany?.logoUrl || null;

  if (!attendee) return null;

  const renderField = (f) => {
    // Omitimos consentimiento, foto y campos especiales si quieres
    if (["aceptaTratamiento", "photo"].includes(f.name)) return null;

    // Identificador de una EMPRESA existente (edición desde la pestaña
    // Empresas, no el paso de creación de asistente): el NIT real es el id
    // del documento (`companies/{nitNorm}`), no un campo editable — mostrarlo
    // como texto plano editable permitiría guardar un valor que no coincide
    // con el id real del doc, el mismo tipo de desalineación que causó los
    // bugs de empresa duplicada que corregimos antes. Se muestra de solo
    // lectura, tomado del id real del documento.
    if ((f.name === "nitNorm" || f.name === "nit") && !isNew && attendee?.id) {
      return (
        <TextInput
          key={f.name}
          label={f.label}
          value={attendee.id}
          disabled
          description="El NIT real es el identificador del documento; no se puede editar aquí."
        />
      );
    }

    // Identificador de empresa (NIT/NIF/etc, según cómo lo haya etiquetado
    // el evento): normaliza a solo números y dispara el autocompletado.
    // Solo al crear (agrupado en la sección Empresa) — al editar un asistente
    // existente se deja como campo de texto plano, para no sobreescribir sus
    // datos de empresa ya guardados con los de otra empresa por accidente.
    if (f.name === "company_nit" && groupCompanyFields) {
      return (
        <TextInput
          key={f.name}
          label={f.label}
          placeholder={f.placeholder || "Solo números"}
          value={values.company_nit || ""}
          onChange={(e) => handleChange("company_nit", normalizeNit(e.target.value))}
          onBlur={handleCompanyNitBlur}
          rightSection={companyLookupStatus === "loading" ? <Loader size="xs" /> : null}
          required={f.required}
          description={
            companyLookupStatus === "found"
              ? `Empresa existente encontrada (${existingCompany?.razonSocial || existingCompany?.company_razonSocial || "sin razón social"}): se vinculará a ella.`
              : companyLookupStatus === "notfound"
                ? "No existe una empresa con ese identificador; se creará una nueva."
                : undefined
          }
        />
      );
    }

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
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isNew ? "Registrar asistente" : "Editar asistente"}
      size="md"
    >
      <Stack>
        {fields
          .filter((f) => !(groupCompanyFields && companyFieldNames.has(f.name)))
          .map(renderField)}

        {groupCompanyFields && (
          <>
            <Divider label="Empresa" labelPosition="left" mt="sm" />
            {companyFieldDefs.map(renderField)}
            <Box>
              <Text size="sm" fw={500} mb={4}>
                Logo de la empresa (opcional)
              </Text>
              <Group gap="sm" align="center">
                <FileButton onChange={handleCompanyLogoSelect} accept="image/png,image/jpeg,image/webp">
                  {(fileButtonProps) =>
                    companyLogoPreview ? (
                      <Box {...fileButtonProps} style={{ cursor: "pointer" }}>
                        <Image
                          src={companyLogoPreview}
                          alt="Logo empresa"
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
                        style={{
                          border: "1px dashed #ced4da",
                          borderRadius: 8,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                        }}
                      >
                        <Text size="xs" c="dimmed" ta="center" px={4}>
                          Sin logo
                        </Text>
                      </Box>
                    )
                  }
                </FileButton>
                <Stack gap={4}>
                  <FileButton onChange={handleCompanyLogoSelect} accept="image/png,image/jpeg,image/webp">
                    {(props) => (
                      <Button {...props} variant="light" size="xs">
                        {companyLogoPreview ? "Cambiar logo" : "Subir logo"}
                      </Button>
                    )}
                  </FileButton>
                  <Text size="xs" c="dimmed">
                    Si no subes uno, se usará el ícono por defecto (inicial de la empresa).
                  </Text>
                </Stack>
              </Group>
            </Box>
          </>
        )}

        <Button loading={saving} onClick={handleSubmit}>
          {isNew ? "Registrar asistente" : "Guardar cambios"}
        </Button>
      </Stack>
    </Modal>
  );
};

export default ModalEditAttendee;

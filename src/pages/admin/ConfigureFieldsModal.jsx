import { useState, useEffect } from "react";
import {
  Modal,
  Stack,
  Checkbox,
  TextInput,
  Group,
  Button,
  Switch,
  Text,
  Paper,
  ActionIcon,
  Divider,
  Textarea,
  Select,
} from "@mantine/core";
import { updateDoc, doc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { IconGripVertical, IconTrash, IconPlus } from "@tabler/icons-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const AVAILABLE_FIELDS = [
  { name: "nombre", label: "Nombre completo", type: "text" },
  { name: "cedula", label: "Cédula", type: "text" },
  { name: "empresa", label: "Empresa", type: "text" },
  { name: "cargo", label: "Cargo", type: "text" },
  { name: "descripcion", label: "Descripción breve", type: "richtext" },
  {
    name: "tipoAsistente",
    label: "Tipo de asistente",
    type: "select",
    options: [
      { value: "comprador", label: "Comprador" },
      { value: "vendedor", label: "Vendedor" },
      { value: "otro", label: "Otro" },
    ],
  },
  {
    name: "interesPrincipal",
    label: "Interés principal",
    type: "select",
    options: [
      { value: "proveedores", label: "Conocer proveedores" },
      { value: "clientes", label: "Conocer clientes" },
      { value: "abierto", label: "Abierto" },
    ],
  },
  { name: "necesidad", label: "Necesidad para networking", type: "text" },
  { name: "correo", label: "Correo", type: "text" },
  { name: "telefono", label: "Teléfono", type: "text" },
];

const CONSENTIMIENTO_FIELD = {
  name: "aceptaTratamiento",
  label: "Consentimiento de tratamiento de datos",
  type: "checkbox",
  required: true,
  legalText:
    "Al utilizar este aplicativo, autorizo a GEN.IALITY SAS identificada con NIT 901555490, para el tratamiento de mis datos personales conforme a la Ley 1581 de 2012 y su política de privacidad...",
};

function isCustomField(field) {
  return (
    !AVAILABLE_FIELDS.some((f) => f.name === field.name) &&
    field.name !== CONSENTIMIENTO_FIELD.name
  );
}

const getDefaultFields = (formFields) => {
  return AVAILABLE_FIELDS.map((field) => ({
    ...field,
    required: true,
    ...(formFields?.find((f) => f.name === field.name) || {}),
  }));
};

// --------- DND-kit item -------------
function SortableFieldItem({
  field,
  idx,
  handleDeleteCustomField,
  handleLabelChange,
  handleToggleRequired,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.name });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    boxShadow: isDragging ? "0 2px 8px rgba(56,78,183,0.13)" : undefined,
    background: "#f8fafb",
    borderRadius: 4,
    border: "1px solid #e2e8f0",
    zIndex: isDragging ? 2 : 1,
  };

  return (
    <Group
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      spacing={4}
      p={4}
      style={style}
    >
      <IconGripVertical size={16} style={{ cursor: "grab" }} />
      <TextInput
        value={field.label}
        onChange={(e) => handleLabelChange(field.name, e.currentTarget.value)}
        size="xs"
        style={{ width: 150 }}
        placeholder="Etiqueta"
      />
      <Switch
        size="sm"
        label="Obligatorio"
        checked={field.required}
        onChange={(e) =>
          handleToggleRequired(field.name, e.currentTarget.checked)
        }
      />
      <Text size="xs" color="dimmed">
        {field.type === "checkbox"
          ? "Checkbox"
          : field.type === "select"
          ? `Opciones: ${(field.options || [])
              .map((op) => op.label)
              .join(", ")}`
          : "Texto"}
      </Text>
      {isCustomField(field) && (
        <ActionIcon
          color="red"
          onClick={() => handleDeleteCustomField(field.name)}
          title="Eliminar campo"
          variant="light"
        >
          <IconTrash size={18} />
        </ActionIcon>
      )}
      {field.required && (
        <Text size="xs" color="red">
          (Obligatorio)
        </Text>
      )}
    </Group>
  );
}

export default function ConfigureFieldsModal({
  opened,
  onClose,
  event,
  refreshEvents,
  setGlobalMessage,
}) {
  const [fields, setFields] = useState(
    event?.config?.formFields || getDefaultFields([])
  );
  const [tratamientoText, setTratamientoText] = useState(
    event?.config?.tratamientoDatosText || CONSENTIMIENTO_FIELD.legalText
  );
  const [consentimientoLabel, setConsentimientoLabel] = useState(
    event?.config?.tratamientoDatosLabel || CONSENTIMIENTO_FIELD.label
  );
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState("text");
  const [newSelectOptions, setNewSelectOptions] =
    useState("Opción 1, Opción 2");

  useEffect(() => {
    if (opened) {
      setFields(event?.config?.formFields || getDefaultFields([]));
      setTratamientoText(
        event?.config?.tratamientoDatosText || CONSENTIMIENTO_FIELD.legalText
      );
      setConsentimientoLabel(
        event?.config?.tratamientoDatosLabel || CONSENTIMIENTO_FIELD.label
      );
    }
    // eslint-disable-next-line
  }, [opened]);

  const handleToggleField = (fieldName, checked) => {
    if (checked) {
      const fieldConfig = AVAILABLE_FIELDS.find((f) => f.name === fieldName);
      setFields([...fields, { ...fieldConfig, required: true }]);
    } else {
      setFields(fields.filter((f) => f.name !== fieldName));
    }
  };

  const handleToggleRequired = (fieldName, checked) => {
    setFields(
      fields.map((f) =>
        f.name === fieldName ? { ...f, required: checked } : f
      )
    );
  };

  const handleLabelChange = (fieldName, value) => {
    setFields(
      fields.map((f) => (f.name === fieldName ? { ...f, label: value } : f))
    );
  };

  const handleAddCustomField = () => {
    if (!newFieldLabel.trim()) return;
    const name =
      "custom_" +
      newFieldLabel
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9_]/g, "")
        .substring(0, 25) +
      "_" +
      Math.floor(Math.random() * 10000);
    let newField = {
      name,
      label: newFieldLabel,
      type: newFieldType,
      required: false,
      isCustom: true,
    };
    if (newFieldType === "select") {
      newField.options = newSelectOptions
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s, i) => ({
          value: "op" + i,
          label: s,
        }));
    }
    setFields([...fields, newField]);
    setNewFieldLabel("");
    setNewFieldType("text");
    setNewSelectOptions("Opción 1, Opción 2");
  };

  const handleDeleteCustomField = (fieldName) => {
    setFields(fields.filter((f) => f.name !== fieldName));
  };

  // --- dnd-kit drag ---
  const sensors = useSensors(useSensor(PointerSensor));
  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = fields.findIndex((f) => f.name === active.id);
    const newIndex = fields.findIndex((f) => f.name === over.id);
    setFields((fields) => arrayMove(fields, oldIndex, newIndex));
  };

  const handleSave = async () => {
    try {
      await updateDoc(doc(db, "events", event.id), {
        "config.formFields": fields,
        "config.tratamientoDatosText": tratamientoText,
        "config.tratamientoDatosLabel": consentimientoLabel,
      });
      setGlobalMessage("Campos del formulario actualizados correctamente.");
      refreshEvents();
      onClose();
    } catch (error) {
      setGlobalMessage("Error al guardar configuración.");
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Configurar campos del formulario"
      size="xl"
      centered
      padding="lg"
    >
      <Paper shadow="xs" p="md" mb="md">
        <Text mb={6}>Selecciona los campos a mostrar y su configuración:</Text>
        <Stack spacing={4}>
          {AVAILABLE_FIELDS.map((field) => (
            <Group key={field.name} position="apart" align="center">
              <Checkbox
                label={field.label}
                checked={fields.some((f) => f.name === field.name)}
                onChange={(e) =>
                  handleToggleField(field.name, e.currentTarget.checked)
                }
              />
              <Switch
                size="sm"
                label="Obligatorio"
                checked={fields.find((f) => f.name === field.name)?.required}
                disabled={!fields.some((f) => f.name === field.name)}
                onChange={(e) =>
                  handleToggleRequired(field.name, e.currentTarget.checked)
                }
              />
              <TextInput
                value={
                  fields.find((f) => f.name === field.name)?.label ||
                  field.label
                }
                disabled={!fields.some((f) => f.name === field.name)}
                onChange={(e) =>
                  handleLabelChange(field.name, e.currentTarget.value)
                }
                size="xs"
                style={{ width: 150 }}
                placeholder="Etiqueta"
              />
            </Group>
          ))}
        </Stack>
      </Paper>

      <Divider label="Campos personalizados" my="xs" />

      <Paper shadow="xs" p="md" mb="md">
        <Group spacing="xs" mb="xs">
          <TextInput
            placeholder="Nombre del campo"
            value={newFieldLabel}
            onChange={(e) => setNewFieldLabel(e.currentTarget.value)}
            size="xs"
            style={{ width: 180 }}
          />
          <Select
            value={newFieldType}
            onChange={setNewFieldType}
            data={[
              { value: "text", label: "Texto" },
              { value: "select", label: "Select" },
              { value: "checkbox", label: "Checkbox" },
            ]}
            style={{ width: 100 }}
            size="xs"
          />
          {newFieldType === "select" && (
            <TextInput
              placeholder="Opciones separadas por coma"
              value={newSelectOptions}
              onChange={(e) => setNewSelectOptions(e.currentTarget.value)}
              size="xs"
              style={{ width: 200 }}
            />
          )}
          <ActionIcon
            color="blue"
            onClick={handleAddCustomField}
            variant="filled"
            title="Agregar campo"
          >
            <IconPlus size={18} />
          </ActionIcon>
        </Group>
      </Paper>

      {/* Consentimiento: siempre al final, no editable ni eliminable */}
      <Divider label="Consentimiento de tratamiento de datos" my="xs" />
      <Paper shadow="xs" p="md" mb="md">
        <TextInput
          label="Etiqueta"
          value={consentimientoLabel}
          onChange={(e) => setConsentimientoLabel(e.currentTarget.value)}
          mb={8}
        />
        <Textarea
          label="Texto legal"
          value={tratamientoText}
          onChange={(e) => setTratamientoText(e.currentTarget.value)}
          autosize
          minRows={2}
          maxRows={6}
        />
        <Text size="xs" color="dimmed" mt={4}>
          Este campo aparecerá siempre como obligatorio al final del formulario.
        </Text>
      </Paper>

      {/* Ordenar campos con dnd-kit */}
      <Paper shadow="xs" p="md" mb="md">
        <Text mb={6}>
          Ordena los campos arrastrando (consentimiento siempre último):
        </Text>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={fields.map((f) => f.name)}
            strategy={verticalListSortingStrategy}
          >
            <Stack spacing={4}>
              {fields.map((field, idx) => (
                <SortableFieldItem
                  key={field.name}
                  field={field}
                  idx={idx}
                  handleDeleteCustomField={handleDeleteCustomField}
                  handleLabelChange={handleLabelChange}
                  handleToggleRequired={handleToggleRequired}
                />
              ))}
              {/* Consentimiento no es draggable ni eliminable */}
              <Group
                spacing={4}
                p={4}
                style={{
                  background: "#f8fafb",
                  borderRadius: 4,
                  border: "1px solid #e2e8f0",
                }}
              >
                <IconGripVertical size={16} color="#e2e8f0" />
                <Text size="sm">
                  {consentimientoLabel}
                  <Text color="teal" size="xs" component="span" ml={5}>
                    (Checkbox fijo)
                  </Text>
                </Text>
                <Text size="xs" color="red">
                  (Obligatorio)
                </Text>
              </Group>
            </Stack>
          </SortableContext>
        </DndContext>
      </Paper>
      <Group mt="md" position="right">
        <Button onClick={handleSave}>Guardar</Button>
        <Button variant="default" onClick={onClose}>
          Cancelar
        </Button>
      </Group>
    </Modal>
  );
}

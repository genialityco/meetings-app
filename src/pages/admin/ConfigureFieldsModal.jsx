import { useEffect, useMemo, useState } from "react";
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
  SegmentedControl,
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

/**
 * ✅ Ajustes incluidos:
 * - Añade campos de empresa: company_nit + company_razonSocial
 * - Guarda config.registrationForm para modo "plano" o "stepper"
 * - Mantiene tu sistema actual de formFields + consentimiento
 *
 * Nota: La UI de Stepper aquí es MVP (selector modo + editor simple por pasos).
 * La Landing consumirá event.config.registrationForm para renderizar por pasos.
 */

const AVAILABLE_FIELDS = [
  {
    name: "nombre",
    label: "Nombre completo",
    type: "text",
    validation: {
      minLength: 3,
      maxLength: 100,
      pattern: /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/,
      errorMessage: "Debe contener solo letras y espacios",
    },
  },
  {
    name: "cedula",
    label: "Cédula",
    type: "text",
    validation: {
      pattern: /^[0-9]{6,10}$/,
      errorMessage: "Debe contener entre 6 y 10 dígitos",
    },
  },

  // ⚠️ "empresa" se mantiene por compatibilidad, pero ahora tendrás también empresa paso a paso
  {
    name: "empresa",
    label: "Empresa",
    type: "text",
    validation: {
      minLength: 2,
      maxLength: 100,
    },
  },

  // ✅ NUEVOS CAMPOS EMPRESA (para autocompletar por NIT en la landing)
  {
    name: "company_nit",
    label: "NIT (solo números)",
    type: "text",
    validation: {
      pattern: /^[0-9]{5,15}$/,
      errorMessage: "El NIT debe contener solo números (5 a 15 dígitos)",
    },
  },
  {
    name: "company_razonSocial",
    label: "Razón social",
    type: "text",
    validation: {
      minLength: 2,
      maxLength: 120,
    },
  },

  {
    name: "cargo",
    label: "Cargo",
    type: "text",
    validation: {
      maxLength: 100,
    },
  },
  {
    name: "descripcion",
    label: "Descripción breve",
    type: "richtext",
    validation: {
      maxLength: 500,
    },
  },
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
  {
    name: "necesidad",
    label: "Necesidad para networking",
    type: "text",
    validation: {
      maxLength: 200,
    },
  },
  {
    name: "correo",
    label: "Correo",
    type: "text",
    validation: {
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      errorMessage: "Debe ser un correo electrónico válido",
    },
  },
  {
    name: "telefono",
    label: "Teléfono",
    type: "text",
    validation: {
      pattern: /^[0-9]{7,10}$/,
      errorMessage: "Debe contener entre 7 y 10 dígitos",
    },
  },
];

const CONSENTIMIENTO_FIELD = {
  name: "aceptaTratamiento",
  label: "Consentimiento de tratamiento de datos",
  type: "checkbox",
  required: true,
  legalText:
    "Al utilizar este aplicativo, autorizo a GEN.IALITY SAS identificada con NIT 901555490, para el tratamiento de mis datos personales conforme a la Ley 1581 de 2012 y su política de privacidad...",
};

function isCustomField(field: any) {
  return (
    !AVAILABLE_FIELDS.some((f) => f.name === field.name) &&
    field.name !== CONSENTIMIENTO_FIELD.name
  );
}

const getDefaultFields = (formFields: any[] | undefined) => {
  return AVAILABLE_FIELDS.map((field) => ({
    ...field,
    required: true,
    ...(formFields?.find((f) => f.name === field.name) || {}),
  }));
};

const DEFAULT_REGISTRATION_FORM = {
  mode: "stepper" as "flat" | "stepper",
  steps: [
    {
      id: "personal",
      title: "Datos personales",
      fields: ["nombre", "cedula", "cargo", "correo", "telefono"],
    },
    {
      id: "company",
      title: "Empresa",
      fields: ["company_nit", "company_razonSocial"],
    },
    {
      id: "networking",
      title: "Networking",
      fields: ["tipoAsistente", "interesPrincipal", "necesidad", "descripcion"],
    },
  ],
  companyLookup: {
    enabled: true,
    nitField: "company_nit",
    razonField: "company_razonSocial",
  },
};

// --------- DND-kit item -------------
function SortableFieldItem({
  field,
  handleDeleteCustomField,
  handleLabelChange,
  handleToggleRequired,
}: {
  field: any;
  handleDeleteCustomField: (name: string) => void;
  handleLabelChange: (name: string, value: string) => void;
  handleToggleRequired: (name: string, value: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.name });

  const style: React.CSSProperties = {
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
      gap={4}
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
        checked={!!field.required}
        onChange={(e) => handleToggleRequired(field.name, e.currentTarget.checked)}
      />
      <Text size="xs" c="dimmed">
        {field.type === "checkbox"
          ? "Checkbox"
          : field.type === "select"
          ? `Opciones: ${(field.options || []).map((op: any) => op.label).join(", ")}`
          : field.type === "richtext"
          ? "RichText"
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
        <Text size="xs" c="red">
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
}: {
  opened: boolean;
  onClose: () => void;
  event: any;
  refreshEvents: () => void;
  setGlobalMessage: (msg: string) => void;
}) {
  const [fields, setFields] = useState<any[]>(
    event?.config?.formFields || getDefaultFields([])
  );
  const [tratamientoText, setTratamientoText] = useState(
    event?.config?.tratamientoDatosText || CONSENTIMIENTO_FIELD.legalText
  );
  const [consentimientoLabel, setConsentimientoLabel] = useState(
    event?.config?.tratamientoDatosLabel || CONSENTIMIENTO_FIELD.label
  );

  // ✅ Nuevo: config para modo "plano" o "stepper"
  const [registrationForm, setRegistrationForm] = useState<any>(
    event?.config?.registrationForm || DEFAULT_REGISTRATION_FORM
  );

  // Custom field UI
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<"text" | "select" | "checkbox">(
    "text"
  );
  const [newSelectOptions, setNewSelectOptions] = useState("Opción 1, Opción 2");

  // Stepper editor UI (simple)
  const [selectedStepId, setSelectedStepId] = useState<string>("personal");

  useEffect(() => {
    if (!opened) return;

    setFields(event?.config?.formFields || getDefaultFields([]));
    setTratamientoText(
      event?.config?.tratamientoDatosText || CONSENTIMIENTO_FIELD.legalText
    );
    setConsentimientoLabel(
      event?.config?.tratamientoDatosLabel || CONSENTIMIENTO_FIELD.label
    );
    setRegistrationForm(event?.config?.registrationForm || DEFAULT_REGISTRATION_FORM);

    const firstStepId =
      (event?.config?.registrationForm?.steps || DEFAULT_REGISTRATION_FORM.steps)?.[0]
        ?.id || "personal";
    setSelectedStepId(firstStepId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const fieldsByName = useMemo(() => {
    const map = new Map<string, any>();
    fields.forEach((f) => map.set(f.name, f));
    return map;
  }, [fields]);

  const handleToggleField = (fieldName: string, checked: boolean) => {
    if (checked) {
      const fieldConfig = AVAILABLE_FIELDS.find((f) => f.name === fieldName);
      if (!fieldConfig) return;
      // evita duplicados
      if (fields.some((f) => f.name === fieldName)) return;
      setFields([...fields, { ...fieldConfig, required: true }]);
    } else {
      setFields(fields.filter((f) => f.name !== fieldName));
    }
  };

  const handleToggleRequired = (fieldName: string, checked: boolean) => {
    setFields(
      fields.map((f) => {
        if (f.name !== fieldName) return f;
        const base = AVAILABLE_FIELDS.find((a) => a.name === f.name);
        return {
          ...f,
          required: checked,
          validation: f.validation || base?.validation,
        };
      })
    );
  };

  const handleLabelChange = (fieldName: string, value: string) => {
    setFields(
      fields.map((f) => {
        if (f.name !== fieldName) return f;
        const base = AVAILABLE_FIELDS.find((a) => a.name === f.name);
        return {
          ...f,
          label: value,
          validation: f.validation || base?.validation,
        };
      })
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

    const newField: any = {
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

  const handleDeleteCustomField = (fieldName: string) => {
    setFields(fields.filter((f) => f.name !== fieldName));

    // si estaba en algún step, también quitarlo
    setRegistrationForm((prev: any) => ({
      ...prev,
      steps: (prev.steps || []).map((s: any) => ({
        ...s,
        fields: (s.fields || []).filter((n: string) => n !== fieldName),
      })),
    }));
  };

  // --- dnd-kit drag para ORDEN GLOBAL (formFields) ---
  const sensors = useSensors(useSensor(PointerSensor));
  const handleDragEnd = (ev: any) => {
    const { active, over } = ev;
    if (!over || active.id === over.id) return;
    const oldIndex = fields.findIndex((f) => f.name === active.id);
    const newIndex = fields.findIndex((f) => f.name === over.id);
    setFields((cur) => arrayMove(cur, oldIndex, newIndex));
  };

  // --- Stepper editor (simple) ---
  const stepOptions = useMemo(
    () =>
      (registrationForm?.steps || []).map((s: any) => ({
        value: s.id,
        label: s.title,
      })),
    [registrationForm?.steps]
  );

  const selectedStep = useMemo(() => {
    const list = registrationForm?.steps || [];
    return list.find((s: any) => s.id === selectedStepId) || list[0] || null;
  }, [registrationForm?.steps, selectedStepId]);

  const updateStepTitle = (id: string, title: string) => {
    setRegistrationForm((prev: any) => ({
      ...prev,
      steps: (prev.steps || []).map((s: any) => (s.id === id ? { ...s, title } : s)),
    }));
  };

  const addStep = () => {
    const id = `step_${Date.now()}`;
    const step = { id, title: "Nuevo paso", fields: [] as string[] };
    setRegistrationForm((prev: any) => ({
      ...prev,
      steps: [...(prev.steps || []), step],
    }));
    setSelectedStepId(id);
  };

  const deleteStep = (id: string) => {
    setRegistrationForm((prev: any) => {
      const nextSteps = (prev.steps || []).filter((s: any) => s.id !== id);
      return { ...prev, steps: nextSteps.length ? nextSteps : DEFAULT_REGISTRATION_FORM.steps };
    });
    setSelectedStepId("personal");
  };

  const assignFieldsToStep = (id: string, fieldNames: string[]) => {
    setRegistrationForm((prev: any) => ({
      ...prev,
      steps: (prev.steps || []).map((s: any) =>
        s.id === id ? { ...s, fields: fieldNames } : s
      ),
    }));
  };

  const handleSave = async () => {
    try {
      const sanitizedFields = fields.map((f) => {
        const base = AVAILABLE_FIELDS.find((a) => a.name === f.name);
        let validation = f.validation || base?.validation;

        // 🔄 Si hay un pattern tipo RegExp, conviértelo a string
        if (validation && validation.pattern instanceof RegExp) {
          validation = {
            ...validation,
            pattern: validation.pattern.toString(), // /regex/ -> string
          };
        }

        return base && base.validation ? { ...f, validation } : f;
      });

      // Limpieza: steps solo pueden referenciar campos existentes (evita campos borrados)
      const allowedNames = new Set(sanitizedFields.map((f) => f.name));
      const sanitizedRegistrationForm = {
        ...(registrationForm || DEFAULT_REGISTRATION_FORM),
        steps: (registrationForm?.steps || DEFAULT_REGISTRATION_FORM.steps).map((s: any) => ({
          ...s,
          fields: (s.fields || []).filter((n: string) => allowedNames.has(n)),
        })),
        companyLookup: {
          enabled: true,
          nitField: "company_nit",
          razonField: "company_razonSocial",
          ...(registrationForm?.companyLookup || {}),
        },
      };

      await updateDoc(doc(db, "events", event.id), {
        "config.formFields": sanitizedFields,
        "config.tratamientoDatosText": tratamientoText,
        "config.tratamientoDatosLabel": consentimientoLabel,
        "config.registrationForm": sanitizedRegistrationForm, // ✅ nuevo
      });

      setGlobalMessage("Configuración del formulario actualizada correctamente.");
      refreshEvents();
      onClose();
    } catch (error) {
      console.error("Error al guardar configuración:", error);
      setGlobalMessage("Error al guardar configuración.");
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Configurar formulario"
      size="xl"
      centered
      padding="lg"
    >
      {/* -------- MODO FORMULARIO -------- */}
      <Paper shadow="xs" p="md" mb="md">
        <Text fw={600} mb="xs">
          Modo de formulario en la landing
        </Text>
        <SegmentedControl
          value={registrationForm?.mode || "stepper"}
          onChange={(value) =>
            setRegistrationForm((prev: any) => ({ ...prev, mode: value }))
          }
          data={[
            { value: "flat", label: "Plano" },
            { value: "stepper", label: "Paso a paso" },
          ]}
        />
        <Text size="xs" c="dimmed" mt="xs">
          “Paso a paso” permite separar Datos personales / Empresa / Networking.
        </Text>
      </Paper>

      {/* -------- CAMPOS DISPONIBLES -------- */}
      <Paper shadow="xs" p="md" mb="md">
        <Text mb={6}>Selecciona los campos a mostrar y su configuración:</Text>
        <Stack gap={4}>
          {AVAILABLE_FIELDS.map((field) => (
            <Group key={field.name} justify="space-between" align="center">
              <Checkbox
                label={field.label}
                checked={fields.some((f) => f.name === field.name)}
                onChange={(e) => handleToggleField(field.name, e.currentTarget.checked)}
              />
              <Switch
                size="sm"
                label="Obligatorio"
                checked={!!fields.find((f) => f.name === field.name)?.required}
                disabled={!fields.some((f) => f.name === field.name)}
                onChange={(e) => handleToggleRequired(field.name, e.currentTarget.checked)}
              />
              <TextInput
                value={fields.find((f) => f.name === field.name)?.label || field.label}
                disabled={!fields.some((f) => f.name === field.name)}
                onChange={(e) => handleLabelChange(field.name, e.currentTarget.value)}
                size="xs"
                style={{ width: 180 }}
                placeholder="Etiqueta"
              />
            </Group>
          ))}
        </Stack>
      </Paper>

      {/* -------- CONFIG STEPPER (MVP) -------- */}
      {registrationForm?.mode === "stepper" && (
        <>
          <Divider label="Formulario paso a paso" my="xs" />
          <Paper shadow="xs" p="md" mb="md">
            <Group justify="space-between" align="center" mb="xs">
              <Text fw={600}>Pasos</Text>
              <Button size="xs" variant="light" onClick={addStep} leftSection={<IconPlus size={16} />}>
                Agregar paso
              </Button>
            </Group>

            <Group grow align="flex-end">
              <Select
                label="Selecciona un paso"
                data={stepOptions}
                value={selectedStepId}
                onChange={(v) => v && setSelectedStepId(v)}
                searchable
              />

              <TextInput
                label="Título del paso"
                value={selectedStep?.title || ""}
                onChange={(e) => selectedStep && updateStepTitle(selectedStep.id, e.currentTarget.value)}
              />

              <ActionIcon
                color="red"
                variant="light"
                title="Eliminar paso"
                onClick={() => selectedStep && deleteStep(selectedStep.id)}
                disabled={(registrationForm?.steps || []).length <= 1}
                style={{ marginTop: 24 }}
              >
                <IconTrash size={18} />
              </ActionIcon>
            </Group>

            <Select
              mt="md"
              label="Campos de este paso"
              placeholder="Selecciona campos"
              data={Array.from(fieldsByName.values()).map((f: any) => ({
                value: f.name,
                label: f.label || f.name,
              }))}
              value={(selectedStep?.fields || []) as string[]}
              onChange={(vals) => selectedStep && assignFieldsToStep(selectedStep.id, vals as any)}
              searchable
              clearable
              multiple
              description="Recomendado: Paso Empresa incluya company_nit y company_razonSocial."
            />

            <Divider my="md" />

            <Group justify="space-between" align="center">
              <Text fw={600}>Autocompletar empresa por NIT</Text>
              <Switch
                checked={!!registrationForm?.companyLookup?.enabled}
                onChange={(e) =>
                  setRegistrationForm((prev: any) => ({
                    ...prev,
                    companyLookup: {
                      ...(prev.companyLookup || {}),
                      enabled: e.currentTarget.checked,
                      nitField: "company_nit",
                      razonField: "company_razonSocial",
                    },
                  }))
                }
              />
            </Group>

            <Text size="xs" c="dimmed" mt="xs">
              La landing buscará en <b>events/{`{eventId}`}/companies/{`{nitNorm}`}</b> y
              autocompletará la razón social.
            </Text>
          </Paper>
        </>
      )}

      <Divider label="Campos personalizados" my="xs" />

      <Paper shadow="xs" p="md" mb="md">
        <Group gap="xs" mb="xs">
          <TextInput
            placeholder="Nombre del campo"
            value={newFieldLabel}
            onChange={(e) => setNewFieldLabel(e.currentTarget.value)}
            size="xs"
            style={{ width: 200 }}
          />
          <Select
            value={newFieldType}
            onChange={(v) => setNewFieldType((v as any) || "text")}
            data={[
              { value: "text", label: "Texto" },
              { value: "select", label: "Select" },
              { value: "checkbox", label: "Checkbox" },
            ]}
            style={{ width: 120 }}
            size="xs"
          />
          {newFieldType === "select" && (
            <TextInput
              placeholder="Opciones separadas por coma"
              value={newSelectOptions}
              onChange={(e) => setNewSelectOptions(e.currentTarget.value)}
              size="xs"
              style={{ width: 240 }}
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
        <Text size="xs" c="dimmed">
          Los campos personalizados se pueden agregar al paso deseado (si usas modo paso a paso).
        </Text>
      </Paper>

      {/* Consentimiento */}
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
        <Text size="xs" c="dimmed" mt={4}>
          Este campo aparecerá siempre como obligatorio al final del formulario.
        </Text>
      </Paper>

      {/* Orden global de formFields (para modo plano, o para consistencia) */}
      <Paper shadow="xs" p="md" mb="md">
        <Text mb={6}>
          Orden global de campos (consentimiento siempre último):
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
            <Stack gap={4}>
              {fields.map((field) => (
                <SortableFieldItem
                  key={field.name}
                  field={field}
                  handleDeleteCustomField={handleDeleteCustomField}
                  handleLabelChange={handleLabelChange}
                  handleToggleRequired={handleToggleRequired}
                />
              ))}

              <Group
                gap={4}
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
                  <Text c="teal" size="xs" component="span" ml={5}>
                    (Checkbox fijo)
                  </Text>
                </Text>
                <Text size="xs" c="red">
                  (Obligatorio)
                </Text>
              </Group>
            </Stack>
          </SortableContext>
        </DndContext>
      </Paper>

      <Group mt="md" justify="flex-end">
        <Button onClick={handleSave}>Guardar</Button>
        <Button variant="default" onClick={onClose}>
          Cancelar
        </Button>
      </Group>
    </Modal>
  );
}

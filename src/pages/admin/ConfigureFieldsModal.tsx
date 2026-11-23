import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Drawer,
  Group,
  Menu,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { updateDoc, doc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowUp,
  IconGitBranch,
  IconGripVertical,
  IconLock,
  IconPlus,
  IconSettings,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";
import {
  DndContext,
  closestCenter,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { CollisionDetection, DragEndEvent } from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  DEFAULT_CONSENT_LABEL,
  DEFAULT_REGISTRATION_WELCOME,
  WELCOME_VARIANT_LABELS,
  resolveConsentLabel,
  type RegistrationWelcomeConfig,
  type WelcomeMessage,
  type WelcomeVariant,
} from "../../utils/registrationWelcome";

/**
 * Editor del formulario de registro (pestaña "Campos" de la configuración del evento).
 *
 * Guarda:
 * - config.formFields: campos activos (su orden es el del modo "plano")
 * - config.registrationForm: modo "flat" | "stepper" y, en "stepper", los pasos
 *   con sus campos (el orden dentro de cada paso es el que usa la Landing)
 * - config.tratamientoDatosText / tratamientoDatosLabel: consentimiento (siempre al final)
 *
 * Un campo activo que no está en ningún paso NO se muestra en modo paso a paso;
 * el editor lo lista aparte como "Campos sin paso".
 */

const AVAILABLE_FIELDS = [
  {
    name: "photoURL",
    label: "Foto de perfil",
    type: "photo",
    required: false,
  },
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

  // CAMPOS EMPRESA (para autocompletar por NIT en la landing)
  {
    name: "company_nit",
    label: "NIT/NIF (letras y números)",
    type: "text",
    validation: {
      pattern: /^[A-Z0-9]{5,15}$/,
      errorMessage: "El NIT debe contener solo letras y números, sin guiones (5 a 15 caracteres)",
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
    name: "company_logo",
    label: "Logo de empresa",
    type: "file",
    required: false,
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
      maxLength: 2000,
    },
  },
  {
    name: "tipoAsistente",
    label: "Tipo de asistente",
    type: "select",
    options: [
      { value: "comprador", label: "Comprador" },
      { value: "vendedor", label: "Vendedor" },
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
    name: "diasAsistencia",
    label: "Días a los que asistirá",
    type: "eventDays",
    required: false,
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
    type: "phone",
  },
  {
    name: "brochure",
    label: "Brochure (PDF)",
    type: "pdf",
    required: false,
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

// Presets de validación seleccionables para campos de texto (ej. dejar "Cédula" en alfanumérico)
const TEXT_VALIDATION_PRESETS: Record<
  string,
  { label: string; pattern?: string; errorMessage?: string }
> = {
  numeric: {
    label: "Solo números",
    pattern: "^[0-9]+$",
    errorMessage: "Debe contener solo números",
  },
  alphanumeric: {
    label: "Alfanumérico",
    pattern: "^[A-Za-z0-9]+$",
    errorMessage: "Debe contener solo letras y números",
  },
  letters: {
    label: "Solo letras",
    pattern: "^[a-zA-ZáéíóúÁÉÍÓÚñÑ\\s]+$",
    errorMessage: "Debe contener solo letras y espacios",
  },
  any: {
    label: "Sin restricción",
  },
};

function detectValidationPresetKey(field: any): string {
  const pattern = field?.validation?.pattern;
  if (!pattern) return "any";
  const patternStr =
    pattern instanceof RegExp
      ? pattern.source
      : String(pattern).replace(/^\/|\/$/g, "");
  const found = Object.entries(TEXT_VALIDATION_PRESETS).find(
    ([key, preset]) => key !== "any" && preset.pattern === patternStr,
  );
  return found ? found[0] : "custom";
}

// Campos donde tiene sentido editar el límite de caracteres (los que ya nacen con maxLength)
function hasEditableMaxLength(field: any): boolean {
  if (field.type !== "text" && field.type !== "richtext") return false;
  const base = AVAILABLE_FIELDS.find((f) => f.name === field.name);
  return (
    field.validation?.maxLength !== undefined ||
    base?.validation?.maxLength !== undefined
  );
}

const getDefaultFields = (formFields: any[] | undefined, eventType?: string) => {
  return AVAILABLE_FIELDS.filter((f) => !(eventType === "Networking" && f.name === "tipoAsistente")).map((field) => ({
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
      fields: ["company_nit", "company_razonSocial", "company_logo"],
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

// Contenedores de arrastre: un paso, la lista plana o los campos sin paso
const CONTAINER_PREFIX = "container:";
const FLAT_CONTAINER = "__flat";
const UNASSIGNED_CONTAINER = "__unassigned";

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: "Texto",
  select: "Selección",
  multiselect: "Selección múltiple",
  checkbox: "Casilla",
  pdf: "Documento PDF",
  photo: "Foto",
  file: "Archivo",
  phone: "Teléfono",
  richtext: "Texto largo",
  eventDays: "Días del evento",
};

const fieldTypeLabel = (type: string) => FIELD_TYPE_LABELS[type] || "Texto";

const fieldDisplayLabel = (field: any) =>
  field?.label ||
  AVAILABLE_FIELDS.find((af) => af.name === field?.name)?.label ||
  field?.name ||
  "";

type NewFieldType = "text" | "date" | "select" | "multiselect" | "checkbox" | "pdf";

// --------- Fila de un campo (arrastrable) -------------
function FieldRow({
  field,
  onOpen,
  onToggleRequired,
  onRemove,
}: {
  field: any;
  onOpen: () => void;
  onToggleRequired: (value: boolean) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.name });

  const custom = isCustomField(field);
  const optionsCount =
    field.type === "select" || field.type === "multiselect"
      ? (field.options || []).length
      : null;

  return (
    <Paper
      ref={setNodeRef}
      withBorder
      radius="sm"
      px={6}
      py={6}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        position: "relative",
        zIndex: isDragging ? 2 : undefined,
        boxShadow: isDragging ? "var(--mantine-shadow-md)" : undefined,
      }}
    >
      <Group gap={6} wrap="nowrap">
        <ActionIcon
          ref={setActivatorNodeRef}
          variant="subtle"
          color="gray"
          aria-label="Arrastrar para reordenar"
          style={{ cursor: "grab", touchAction: "none" }}
          {...attributes}
          {...listeners}
        >
          <IconGripVertical size={16} />
        </ActionIcon>

        <UnstyledButton onClick={onOpen} style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={500} truncate>
            {fieldDisplayLabel(field)}
          </Text>
          <Group gap={4} mt={2} wrap="wrap">
            <Text size="xs" c="dimmed">
              {fieldTypeLabel(field.type)}
              {optionsCount !== null && ` · ${optionsCount} opciones`}
            </Text>
            {custom && (
              <Badge size="xs" variant="light" color="grape">
                Personalizado
              </Badge>
            )}
            {field.showWhen && (
              <Badge
                size="xs"
                variant="light"
                color="orange"
                leftSection={<IconGitBranch size={10} />}
              >
                Condicional
              </Badge>
            )}
            {field.labelByRole && (
              <Badge
                size="xs"
                variant="light"
                color="cyan"
                leftSection={<IconUsers size={10} />}
              >
                Por rol
              </Badge>
            )}
          </Group>
        </UnstyledButton>

        <Switch
          size="xs"
          aria-label="Obligatorio"
          label={
            <Box component="span" visibleFrom="sm">
              Obligatorio
            </Box>
          }
          checked={!!field.required}
          onChange={(e) => onToggleRequired(e.currentTarget.checked)}
        />
        <Tooltip label="Configurar" withArrow>
          <ActionIcon variant="subtle" color="gray" onClick={onOpen} aria-label="Configurar campo">
            <IconSettings size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Quitar del formulario" withArrow>
          <ActionIcon variant="subtle" color="red" onClick={onRemove} aria-label="Quitar del formulario">
            <IconTrash size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Paper>
  );
}

// --------- Zona donde se sueltan campos (paso / lista) -------------
function DropZone({
  containerId,
  isEmpty,
  emptyText,
  children,
}: {
  containerId: string;
  isEmpty: boolean;
  emptyText: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: CONTAINER_PREFIX + containerId,
  });
  return (
    <Stack
      ref={setNodeRef}
      gap={6}
      style={{
        minHeight: isEmpty ? 56 : undefined,
        justifyContent: "center",
        borderRadius: "var(--mantine-radius-sm)",
        border: isEmpty
          ? `1px dashed var(--mantine-color-${isOver ? "blue-5" : "gray-4"})`
          : undefined,
        background: isOver ? "var(--mantine-color-blue-light)" : undefined,
        padding: isEmpty ? 8 : 0,
        transition: "background 120ms",
      }}
    >
      {isEmpty ? (
        <Text size="xs" c="dimmed" ta="center">
          {emptyText}
        </Text>
      ) : (
        children
      )}
    </Stack>
  );
}

// --------- Menú "Agregar campo" -------------
function AddFieldMenu({
  predefined,
  unassigned,
  onPickPredefined,
  onPickUnassigned,
  onCreateCustom,
}: {
  predefined: any[];
  unassigned: any[];
  onPickPredefined: (name: string) => void;
  onPickUnassigned?: (name: string) => void;
  onCreateCustom: () => void;
}) {
  return (
    <Menu position="bottom-start" shadow="md" width={260} withinPortal>
      <Menu.Target>
        <Button
          variant="subtle"
          size="xs"
          leftSection={<IconPlus size={14} />}
          style={{ alignSelf: "flex-start" }}
        >
          Agregar campo
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <ScrollArea.Autosize mah={320} type="auto">
          {onPickUnassigned && unassigned.length > 0 && (
            <>
              <Menu.Label>Campos sin paso</Menu.Label>
              {unassigned.map((f) => (
                <Menu.Item key={f.name} onClick={() => onPickUnassigned(f.name)}>
                  {fieldDisplayLabel(f)}
                </Menu.Item>
              ))}
              <Menu.Divider />
            </>
          )}
          <Menu.Label>Campos predefinidos</Menu.Label>
          {predefined.length === 0 ? (
            <Menu.Item disabled>Todos están en uso</Menu.Item>
          ) : (
            predefined.map((f) => (
              <Menu.Item key={f.name} onClick={() => onPickPredefined(f.name)}>
                <Text size="sm">{f.label}</Text>
                <Text size="xs" c="dimmed">
                  {fieldTypeLabel(f.type)}
                </Text>
              </Menu.Item>
            ))
          )}
        </ScrollArea.Autosize>
        <Menu.Divider />
        <Menu.Item leftSection={<IconPlus size={14} />} onClick={onCreateCustom}>
          Crear campo personalizado…
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

// --------- Opciones de un select/multiselect -------------
// Texto crudo aparte de field.options (que ya viene trim/filtrado) para no
// perder líneas en blanco mientras se escribe una opción nueva. Una opción por
// línea (no por coma: "Banca, finanzas y seguros" es una sola opción).
function OptionsEditor({
  field,
  onChange,
}: {
  field: any;
  onChange: (rawText: string) => void;
}) {
  const [text, setText] = useState(
    (field.options || []).map((op: any) => op.label).join("\n"),
  );
  return (
    <Textarea
      label="Opciones"
      description="Una opción por línea"
      placeholder={"Opción 1\nOpción 2"}
      autosize
      minRows={3}
      maxRows={10}
      value={text}
      onChange={(e) => {
        const raw = e.currentTarget.value;
        setText(raw);
        onChange(raw);
      }}
    />
  );
}

export default function ConfigureFieldsModal({
  opened,
  onClose,
  event,
  refreshEvents,
  setGlobalMessage,
  inline = false,
}: {
  opened: boolean;
  onClose: () => void;
  event: any;
  refreshEvents: () => void;
  setGlobalMessage: (msg: string) => void;
  inline?: boolean;
}) {
  const isNetworking = event?.eventType === "Networking";
  const showRoleLabels = !isNetworking;

  const [fields, setFields] = useState<any[]>(
    event?.config?.formFields || getDefaultFields([], event?.eventType),
  );
  const [tratamientoText, setTratamientoText] = useState(
    event?.config?.tratamientoDatosText || CONSENTIMIENTO_FIELD.legalText,
  );
  const [consentimientoLabel, setConsentimientoLabel] = useState(
    resolveConsentLabel(event?.config?.tratamientoDatosLabel),
  );
  const [consentimientos, setConsentimientos] = useState<any[]>([
    {
      name: CONSENTIMIENTO_FIELD.name,
      label: resolveConsentLabel(event?.config?.tratamientoDatosLabel),
      text: event?.config?.tratamientoDatosText || CONSENTIMIENTO_FIELD.legalText,
      required: true,
    },
  ]);
  const [registrationForm, setRegistrationForm] = useState<any>(
    event?.config?.registrationForm || DEFAULT_REGISTRATION_FORM,
  );
  const [welcome, setWelcome] = useState<RegistrationWelcomeConfig>(
    event?.config?.registrationWelcome || {},
  );
  const [welcomeVariant, setWelcomeVariant] = useState<WelcomeVariant>("general");

  // Panel lateral de configuración del campo
  const [editingName, setEditingName] = useState<string | null>(null);

  // Modal de campo personalizado (target = contenedor donde se agrega)
  const [customTarget, setCustomTarget] = useState<string | null>(null);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<NewFieldType>("text");
  const [newSelectOptions, setNewSelectOptions] = useState("Opción 1\nOpción 2");
  const [newIncludeOtro, setNewIncludeOtro] = useState(false);
  const [newRequired, setNewRequired] = useState(false);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setFields(event?.config?.formFields || getDefaultFields([], event?.eventType));
    setTratamientoText(
      event?.config?.tratamientoDatosText || CONSENTIMIENTO_FIELD.legalText,
    );
    setConsentimientoLabel(resolveConsentLabel(event?.config?.tratamientoDatosLabel));
    const configuredConsents = event?.config?.consentimientos;
    setConsentimientos(
      Array.isArray(configuredConsents) && configuredConsents.length > 0
        ? configuredConsents.map((consent: any, index: number) => ({
            name: consent.name || (index === 0 ? CONSENTIMIENTO_FIELD.name : `consentimiento_${index + 1}`),
            label: String(consent.label || "").trim(),
            text: String(consent.text || "").trim(),
            required: consent.required !== false,
          }))
        : [{
            name: CONSENTIMIENTO_FIELD.name,
            label: resolveConsentLabel(event?.config?.tratamientoDatosLabel),
            text: event?.config?.tratamientoDatosText || CONSENTIMIENTO_FIELD.legalText,
            required: true,
          }],
    );
    setRegistrationForm(event?.config?.registrationForm || DEFAULT_REGISTRATION_FORM);
    setWelcome(event?.config?.registrationWelcome || {});
    setEditingName(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const mode: "flat" | "stepper" =
    registrationForm?.mode === "flat" ? "flat" : "stepper";
  const steps: any[] = useMemo(
    () => registrationForm?.steps || [],
    [registrationForm?.steps],
  );

  const fieldsByName = useMemo(() => {
    const map = new Map<string, any>();
    fields.forEach((f) => map.set(f.name, f));
    return map;
  }, [fields]);

  // "Tipo de asistente" no aplica en eventos Networking (la Landing lo oculta)
  const isHidden = useCallback(
    (name: string) => isNetworking && name === "tipoAsistente",
    [isNetworking],
  );

  // Nombres visibles por contenedor (paso / plano / sin paso), en su orden real
  const itemsByContainer = useMemo(() => {
    const map: Record<string, string[]> = {};
    if (mode === "flat") {
      map[FLAT_CONTAINER] = fields.map((f) => f.name).filter((n) => !isHidden(n));
      return map;
    }
    const assigned = new Set<string>();
    steps.forEach((s) => {
      const names = (s.fields || []).filter(
        (n: string) => fieldsByName.has(n) && !isHidden(n) && !assigned.has(n),
      );
      names.forEach((n: string) => assigned.add(n));
      map[s.id] = names;
    });
    map[UNASSIGNED_CONTAINER] = fields
      .map((f) => f.name)
      .filter((n) => !assigned.has(n) && !isHidden(n));
    return map;
  }, [mode, fields, steps, fieldsByName, isHidden]);

  const unassignedFields = useMemo(
    () =>
      mode === "stepper"
        ? (itemsByContainer[UNASSIGNED_CONTAINER] || []).map((n) => fieldsByName.get(n))
        : [],
    [mode, itemsByContainer, fieldsByName],
  );

  const availablePredefined = useMemo(
    () =>
      AVAILABLE_FIELDS.filter(
        (f) => !fieldsByName.has(f.name) && !isHidden(f.name),
      ),
    [fieldsByName, isHidden],
  );

  const containerOf = useCallback(
    (name: string): string | null => {
      for (const [cid, names] of Object.entries(itemsByContainer)) {
        if (names.includes(name)) return cid;
      }
      return null;
    },
    [itemsByContainer],
  );

  // ---------------- Mutaciones de campos ----------------

  const updateField = (name: string, updater: (f: any) => any) => {
    setFields((prev) => prev.map((f) => (f.name === name ? updater(f) : f)));
  };

  // Al editar un campo predefinido conserva su validación base
  const withBaseValidation = (f: any) => {
    const base = AVAILABLE_FIELDS.find((a) => a.name === f.name);
    return { ...f, validation: f.validation || base?.validation };
  };

  const handleToggleRequired = (name: string, checked: boolean) =>
    updateField(name, (f) => ({ ...withBaseValidation(f), required: checked }));

  const handleLabelChange = (name: string, value: string) =>
    updateField(name, (f) => ({ ...withBaseValidation(f), label: value }));

  const handlePlaceholderChange = (name: string, value: string) =>
    updateField(name, (f) => ({ ...f, placeholder: value }));

  const removeKey = (obj: any, key: string) => {
    const { [key]: _removed, ...rest } = obj; // eslint-disable-line @typescript-eslint/no-unused-vars
    return rest;
  };

  const handleUpdateShowWhen = (name: string, showWhen: any) =>
    updateField(name, (f) => (showWhen === null ? removeKey(f, "showWhen") : { ...f, showWhen }));

  const handleUpdateLabelByRole = (
    name: string,
    labelByRole: { comprador?: string; vendedor?: string } | null,
  ) =>
    updateField(name, (f) =>
      labelByRole === null ? removeKey(f, "labelByRole") : { ...f, labelByRole },
    );

  const handleUpdateValidationType = (name: string, presetKey: string) => {
    if (presetKey === "custom") return;
    const preset = TEXT_VALIDATION_PRESETS[presetKey];
    if (!preset) return;
    updateField(name, (f) => {
      if (!preset.pattern) {
        // Objeto (posiblemente vacío) para no caer al validation.pattern
        // por defecto del campo base (ej. cedula) al guardar.
        const { pattern, errorMessage, ...restValidation } = f.validation || {}; // eslint-disable-line @typescript-eslint/no-unused-vars
        return { ...f, validation: restValidation };
      }
      return {
        ...f,
        validation: {
          ...(f.validation || {}),
          pattern: preset.pattern,
          errorMessage: preset.errorMessage,
        },
      };
    });
  };

  const handleUpdateMaxLength = (name: string, value: number | null) =>
    updateField(name, (f) => {
      if (value === null) {
        const { maxLength, ...restValidation } = f.validation || {}; // eslint-disable-line @typescript-eslint/no-unused-vars
        return { ...f, validation: restValidation };
      }
      return { ...f, validation: { ...(f.validation || {}), maxLength: value } };
    });

  const handleUpdateOptions = (name: string, rawText: string) => {
    const options = rawText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => ({ value: s, label: s }));
    updateField(name, (f) => ({ ...f, options }));
  };

  // Mueve un campo al paso indicado (al final); null = sin paso
  const assignToStep = (name: string, stepId: string | null) => {
    setRegistrationForm((prev: any) => ({
      ...prev,
      steps: (prev.steps || []).map((s: any) => {
        const without = (s.fields || []).filter((n: string) => n !== name);
        return { ...s, fields: s.id === stepId ? [...without, name] : without };
      }),
    }));
  };

  // Agrega un campo nuevo a la lista y, en modo pasos, al paso destino
  const addFieldTo = (field: any, target: string) => {
    setFields((prev) => (prev.some((f) => f.name === field.name) ? prev : [...prev, field]));
    if (mode === "stepper" && target !== UNASSIGNED_CONTAINER && target !== FLAT_CONTAINER) {
      assignToStep(field.name, target);
    }
  };

  const addPredefined = (name: string, target: string) => {
    const base = AVAILABLE_FIELDS.find((f) => f.name === name);
    if (!base) return;
    addFieldTo({ ...base, required: true }, target);
  };

  const openCustomModal = (target: string) => {
    setNewFieldLabel("");
    setNewFieldType("text");
    setNewSelectOptions("Opción 1\nOpción 2");
    setNewIncludeOtro(false);
    setNewRequired(false);
    setCustomTarget(target);
  };

  const newOptionsList = newSelectOptions
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const newNeedsOptions = newFieldType === "select" || newFieldType === "multiselect";
  const canCreateCustom =
    !!newFieldLabel.trim() && (!newNeedsOptions || newOptionsList.length > 0);

  const handleCreateCustomField = () => {
    if (!customTarget || !canCreateCustom) return;
    const label = newFieldLabel.trim();
    const name =
      "custom_" +
      label
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9_]/g, "")
        .substring(0, 25) +
      "_" +
      Math.floor(Math.random() * 10000);

    const newField: any = {
      name,
      label,
      placeholder: label,
      type: newFieldType,
      required: newRequired,
      isCustom: true,
    };
    if (newNeedsOptions) {
      newField.options = newOptionsList.map((s) => ({ value: s, label: s }));
    }
    if (newFieldType === "multiselect") newField.includeOtro = newIncludeOtro;

    addFieldTo(newField, customTarget);
    setCustomTarget(null);
  };

  // Quita el campo del formulario (los predefinidos se pueden volver a agregar)
  const removeField = (name: string) => {
    setFields((prev) =>
      prev
        .filter((f) => f.name !== name)
        .map((f) => (f.showWhen?.field === name ? removeKey(f, "showWhen") : f)),
    );
    setRegistrationForm((prev: any) => ({
      ...prev,
      steps: (prev.steps || []).map((s: any) => ({
        ...s,
        fields: (s.fields || []).filter((n: string) => n !== name),
      })),
    }));
    if (editingName === name) setEditingName(null);
  };

  // ---------------- Pasos ----------------

  const updateStepTitle = (id: string, title: string) =>
    setRegistrationForm((prev: any) => ({
      ...prev,
      steps: (prev.steps || []).map((s: any) => (s.id === id ? { ...s, title } : s)),
    }));

  const addStep = () =>
    setRegistrationForm((prev: any) => ({
      ...prev,
      steps: [
        ...(prev.steps || []),
        { id: `step_${Date.now()}`, title: "Nuevo paso", fields: [] as string[] },
      ],
    }));

  // Sus campos quedan "sin paso" (visibles en el aviso), no se borran
  const deleteStep = (id: string) =>
    setRegistrationForm((prev: any) => {
      const next = (prev.steps || []).filter((s: any) => s.id !== id);
      return { ...prev, steps: next.length ? next : prev.steps };
    });

  const moveStep = (index: number, delta: number) =>
    setRegistrationForm((prev: any) => {
      const list = prev.steps || [];
      const to = index + delta;
      if (to < 0 || to >= list.length) return prev;
      return { ...prev, steps: arrayMove(list, index, to) };
    });

  // ---------------- Arrastrar y soltar ----------------

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Prioriza el campo bajo el puntero; si el puntero está en un hueco de un
  // contenedor, usa el campo más cercano de ESE contenedor (o el contenedor vacío)
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const hits = pointerWithin(args);
      const itemHit = hits.find((h) => !String(h.id).startsWith(CONTAINER_PREFIX));
      if (itemHit) return [itemHit];
      const containerHit = hits.find((h) => String(h.id).startsWith(CONTAINER_PREFIX));
      if (containerHit) {
        const cid = String(containerHit.id).slice(CONTAINER_PREFIX.length);
        const items = itemsByContainer[cid] || [];
        if (items.length) {
          const near = closestCenter({
            ...args,
            droppableContainers: args.droppableContainers.filter((c) =>
              items.includes(String(c.id)),
            ),
          });
          if (near.length) return near;
        }
        return [containerHit];
      }
      return closestCenter(args);
    },
    [itemsByContainer],
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const overIsContainer = overId.startsWith(CONTAINER_PREFIX);
    const from = containerOf(activeId);
    const to = overIsContainer ? overId.slice(CONTAINER_PREFIX.length) : containerOf(overId);
    if (!from || !to) return;

    // Modo plano: el orden es el de formFields
    if (mode === "flat") {
      if (overIsContainer) return;
      setFields((cur) => {
        const oldIndex = cur.findIndex((f) => f.name === activeId);
        const newIndex = cur.findIndex((f) => f.name === overId);
        return oldIndex < 0 || newIndex < 0 ? cur : arrayMove(cur, oldIndex, newIndex);
      });
      return;
    }

    if (from === to) {
      if (to === UNASSIGNED_CONTAINER || overIsContainer) return;
      setRegistrationForm((prev: any) => ({
        ...prev,
        steps: (prev.steps || []).map((s: any) => {
          if (s.id !== to) return s;
          const list = s.fields || [];
          const oldIndex = list.indexOf(activeId);
          const newIndex = list.indexOf(overId);
          return oldIndex < 0 || newIndex < 0
            ? s
            : { ...s, fields: arrayMove(list, oldIndex, newIndex) };
        }),
      }));
      return;
    }

    // Cambio de contenedor: sale de todos los pasos y entra en el destino
    setRegistrationForm((prev: any) => ({
      ...prev,
      steps: (prev.steps || []).map((s: any) => {
        const without = (s.fields || []).filter((n: string) => n !== activeId);
        if (s.id !== to) return { ...s, fields: without };
        const idx = overIsContainer ? -1 : without.indexOf(overId);
        const next = [...without];
        if (idx < 0) next.push(activeId);
        else next.splice(idx, 0, activeId);
        return { ...s, fields: next };
      }),
    }));
  };

  // ---------------- Guardar ----------------

  const handleSave = async () => {
    setSaving(true);
    try {
      // Elimina propiedades con valor undefined (Firestore no las acepta)
      const stripUndefined = (obj: any): any =>
        Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

      // En modo pasos, formFields sigue el orden de los pasos (y luego los sin
      // paso) para que al cambiar a modo plano se conserve el orden armado.
      let ordered = fields;
      if (mode === "stepper") {
        const seen = new Set<string>();
        const out: any[] = [];
        steps.forEach((s) =>
          (s.fields || []).forEach((n: string) => {
            const f = fieldsByName.get(n);
            if (f && !seen.has(n)) {
              seen.add(n);
              out.push(f);
            }
          }),
        );
        fields.forEach((f) => {
          if (!seen.has(f.name)) out.push(f);
        });
        ordered = out;
      }

      // Mapa de normalización: value viejo → label (para corregir showWhen references)
      const optionValueMap = new Map<string, string>();

      const sanitizedFields = ordered.map((f) => {
        const base = AVAILABLE_FIELDS.find((a) => a.name === f.name);
        let validation = f.validation || base?.validation;

        // Si hay un pattern tipo RegExp, conviértelo a string
        if (validation && validation.pattern instanceof RegExp) {
          validation = { ...validation, pattern: validation.pattern.toString() };
        }

        const field: any = base && base.validation ? { ...f, validation } : { ...f };

        // Etiquetas por rol: guardar solo las que tengan texto
        if (field.labelByRole) {
          const cleaned = Object.fromEntries(
            Object.entries(field.labelByRole)
              .map(([k, v]) => [k, String(v ?? "").trim()])
              .filter(([, v]) => v),
          );
          if (Object.keys(cleaned).length) field.labelByRole = cleaned;
          else delete field.labelByRole;
        }

        // Normalizar opciones: value debe ser igual a label
        if (field.options && Array.isArray(field.options)) {
          field.options = field.options.map((op: any) => {
            if (op.value !== op.label) {
              optionValueMap.set(`${field.name}::${op.value}`, op.label);
            }
            return { value: op.label || op.value, label: op.label || op.value };
          });
        }

        return stripUndefined(field);
      });

      // Corregir showWhen.value que referencien valores viejos (ej. "op0" → "Grande")
      sanitizedFields.forEach((f: any) => {
        if (f.showWhen?.value && Array.isArray(f.showWhen.value)) {
          f.showWhen.value = f.showWhen.value.map((v: string) => {
            const mapped = optionValueMap.get(`${f.showWhen.field}::${v}`);
            return mapped || v;
          });
        }
      });

      // Los pasos solo pueden referenciar campos existentes (evita campos borrados)
      const allowedNames = new Set(sanitizedFields.map((f: any) => f.name));
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

      const normalizedConsentimientos = consentimientos
        .map((consent, index) => ({
          name: consent.name || (index === 0 ? CONSENTIMIENTO_FIELD.name : `consentimiento_${index + 1}`),
          label: String(consent.label || "").trim(),
          text: String(consent.text || "").trim(),
          required: consent.required !== false,
        }))
        .filter((consent) => consent.label);
      const primaryConsent = normalizedConsentimientos[0];

      await updateDoc(doc(db, "events", event.id), {
        "config.formFields": sanitizedFields,
        "config.tratamientoDatosText": primaryConsent?.text || tratamientoText,
        "config.tratamientoDatosLabel": primaryConsent?.label || consentimientoLabel.trim() || DEFAULT_CONSENT_LABEL,
        "config.consentimientos": normalizedConsentimientos,
        "config.registrationForm": sanitizedRegistrationForm,
        // Solo los textos escritos; lo vacío usa el texto por defecto
        "config.registrationWelcome": Object.fromEntries(
          (Object.keys(DEFAULT_REGISTRATION_WELCOME) as WelcomeVariant[])
            .map((v) => {
              const title = welcome[v]?.title?.trim() || "";
              const text = welcome[v]?.text?.trim() || "";
              const msg: WelcomeMessage = {};
              if (title) msg.title = title;
              if (text) msg.text = text;
              return [v, msg] as const;
            })
            .filter(([, msg]) => Object.keys(msg).length > 0),
        ),
      });

      setGlobalMessage("Configuración del formulario actualizada correctamente.");
      refreshEvents();
      if (!inline) onClose();
    } catch (error) {
      console.error("Error al guardar configuración:", error);
      setGlobalMessage("Error al guardar configuración.");
    } finally {
      setSaving(false);
    }
  };

  // ---------------- Render ----------------

  const renderRows = (names: string[]) =>
    names.map((name) => {
      const field = fieldsByName.get(name);
      if (!field) return null;
      return (
        <FieldRow
          key={name}
          field={field}
          onOpen={() => setEditingName(name)}
          onToggleRequired={(v) => handleToggleRequired(name, v)}
          onRemove={() => removeField(name)}
        />
      );
    });

  const renderAddMenu = (target: string) => (
    <AddFieldMenu
      predefined={availablePredefined}
      unassigned={unassignedFields}
      onPickPredefined={(name) => addPredefined(name, target)}
      onPickUnassigned={
        mode === "stepper" && target !== UNASSIGNED_CONTAINER
          ? (name) => assignToStep(name, target)
          : undefined
      }
      onCreateCustom={() => openCustomModal(target)}
    />
  );

  const editing = editingName ? fieldsByName.get(editingName) : null;
  const editingStepId = editingName ? containerOf(editingName) : null;
  const conditionParents = editing
    ? fields.filter(
        (f) =>
          (f.type === "select" || f.type === "multiselect") && f.name !== editing.name,
      )
    : [];
  const conditionParent = editing?.showWhen
    ? fields.find((f) => f.name === editing.showWhen.field)
    : null;

  const welcomeDefault = DEFAULT_REGISTRATION_WELCOME[welcomeVariant];
  const welcomeCurrent = welcome[welcomeVariant] || {};
  const updateWelcome = (patch: WelcomeMessage) =>
    setWelcome((prev) => ({
      ...prev,
      [welcomeVariant]: { ...(prev[welcomeVariant] || {}), ...patch },
    }));

  const content = (
    <Stack gap="md">
      {/* -------- Mensaje de bienvenida -------- */}
      <Paper withBorder radius="md" p="md">
        <Text fw={600}>Mensaje de bienvenida</Text>
        <Text size="xs" c="dimmed" mb="sm">
          Aparece sobre el formulario de registro. La versión de vendedores o
          compradores se usa cuando el registro fuerza ese rol (políticas o enlace
          con ?rol=…). Si dejas un campo vacío se usa el texto por defecto.
        </Text>
        <SegmentedControl
          fullWidth
          size="xs"
          mb="sm"
          value={welcomeVariant}
          onChange={(v) => setWelcomeVariant(v as WelcomeVariant)}
          data={(Object.keys(WELCOME_VARIANT_LABELS) as WelcomeVariant[]).map((v) => ({
            value: v,
            label: WELCOME_VARIANT_LABELS[v],
          }))}
        />
        <Stack gap="xs">
          <TextInput
            label="Título"
            placeholder={welcomeDefault.title || "Sin título"}
            value={welcomeCurrent.title || ""}
            onChange={(e) => updateWelcome({ title: e.currentTarget.value })}
          />
          <Textarea
            label="Texto"
            description="Separa los párrafos con una línea en blanco. Escribe **así** para negrita."
            placeholder={welcomeDefault.text}
            value={welcomeCurrent.text || ""}
            onChange={(e) => updateWelcome({ text: e.currentTarget.value })}
            autosize
            minRows={3}
            maxRows={10}
          />
          <Group gap="xs">
            <Button
              size="xs"
              variant="subtle"
              onClick={() =>
                updateWelcome({ title: welcomeDefault.title, text: welcomeDefault.text })
              }
            >
              Partir del texto por defecto
            </Button>
            {(welcomeCurrent.title || welcomeCurrent.text) && (
              <Button
                size="xs"
                variant="subtle"
                color="gray"
                onClick={() => updateWelcome({ title: "", text: "" })}
              >
                Volver al texto por defecto
              </Button>
            )}
          </Group>
        </Stack>
      </Paper>

      {/* -------- Modo -------- */}
      <Paper withBorder radius="md" p="md">
        <Group justify="space-between" align="center" wrap="wrap" gap="sm">
          <div>
            <Text fw={600}>Formato del registro</Text>
            <Text size="xs" c="dimmed">
              {mode === "stepper"
                ? "El registro se divide en pasos. Arrastra los campos para ordenarlos o moverlos entre pasos."
                : "Todos los campos en una sola página. Arrastra para cambiar el orden."}
            </Text>
          </div>
          <SegmentedControl
            value={mode}
            onChange={(value) =>
              setRegistrationForm((prev: any) => ({ ...prev, mode: value }))
            }
            data={[
              { value: "stepper", label: "Paso a paso" },
              { value: "flat", label: "Una página" },
            ]}
          />
        </Group>
      </Paper>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragEnd={handleDragEnd}
      >
        {mode === "stepper" ? (
          <Stack gap="sm">
            {steps.map((step, index) => {
              const names = itemsByContainer[step.id] || [];
              return (
                <Paper key={step.id} withBorder radius="md" p="sm">
                  <Group justify="space-between" wrap="nowrap" mb="xs" gap="xs">
                    <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                      <Badge variant="filled" radius="sm" style={{ flexShrink: 0 }}>
                        Paso {index + 1}
                      </Badge>
                      <TextInput
                        aria-label="Título del paso"
                        placeholder="Título del paso"
                        value={step.title || ""}
                        onChange={(e) => updateStepTitle(step.id, e.currentTarget.value)}
                        variant="filled"
                        size="xs"
                        style={{ flex: 1, minWidth: 0 }}
                        styles={{ input: { fontWeight: 600, fontSize: 14 } }}
                      />
                    </Group>
                    <Group gap={2} wrap="nowrap">
                      <Tooltip label="Subir paso" withArrow>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          disabled={index === 0}
                          onClick={() => moveStep(index, -1)}
                          aria-label="Subir paso"
                        >
                          <IconArrowUp size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Bajar paso" withArrow>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          disabled={index === steps.length - 1}
                          onClick={() => moveStep(index, 1)}
                          aria-label="Bajar paso"
                        >
                          <IconArrowDown size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip
                        label={
                          names.length
                            ? "Eliminar paso (sus campos quedan sin paso)"
                            : "Eliminar paso"
                        }
                        withArrow
                      >
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          disabled={steps.length <= 1}
                          onClick={() => deleteStep(step.id)}
                          aria-label="Eliminar paso"
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Group>

                  <SortableContext items={names} strategy={verticalListSortingStrategy}>
                    <DropZone
                      containerId={step.id}
                      isEmpty={names.length === 0}
                      emptyText="Paso vacío: arrastra campos aquí o agrégalos abajo"
                    >
                      {renderRows(names)}
                    </DropZone>
                  </SortableContext>
                  <Box mt={6}>{renderAddMenu(step.id)}</Box>
                </Paper>
              );
            })}

            <Button
              variant="default"
              leftSection={<IconPlus size={16} />}
              onClick={addStep}
              style={{ alignSelf: "flex-start" }}
            >
              Agregar paso
            </Button>

            {unassignedFields.length > 0 && (
              <Alert
                color="yellow"
                variant="light"
                radius="md"
                icon={<IconAlertTriangle size={18} />}
                title={`Campos sin paso (${unassignedFields.length}): no se muestran en el registro`}
              >
                <Text size="xs" mb="xs">
                  Arrástralos a un paso, elígelos desde "Agregar campo" de un paso, o
                  quítalos si no los necesitas.
                </Text>
                <SortableContext
                  items={itemsByContainer[UNASSIGNED_CONTAINER] || []}
                  strategy={verticalListSortingStrategy}
                >
                  <DropZone
                    containerId={UNASSIGNED_CONTAINER}
                    isEmpty={false}
                    emptyText=""
                  >
                    {renderRows(itemsByContainer[UNASSIGNED_CONTAINER] || [])}
                  </DropZone>
                </SortableContext>
              </Alert>
            )}
          </Stack>
        ) : (
          <Paper withBorder radius="md" p="sm">
            <Text fw={600} mb="xs">
              Campos del formulario
            </Text>
            <SortableContext
              items={itemsByContainer[FLAT_CONTAINER] || []}
              strategy={verticalListSortingStrategy}
            >
              <DropZone
                containerId={FLAT_CONTAINER}
                isEmpty={(itemsByContainer[FLAT_CONTAINER] || []).length === 0}
                emptyText="Sin campos: agrégalos abajo"
              >
                {renderRows(itemsByContainer[FLAT_CONTAINER] || [])}
              </DropZone>
            </SortableContext>
            <Box mt={6}>{renderAddMenu(FLAT_CONTAINER)}</Box>
          </Paper>
        )}
      </DndContext>

      {/* -------- Consentimiento (fijo al final) -------- */}
      <Paper withBorder radius="md" p="sm">
        <Group gap="xs" mb="xs" wrap="nowrap">
          <IconLock size={16} color="var(--mantine-color-dimmed)" />
          <Text fw={600} size="sm">
            Consentimientos
          </Text>
          <Badge size="xs" variant="light" color="gray">
            Siempre al final
          </Badge>
        </Group>
        <Stack gap="md">
          {consentimientos.map((consent, index) => (
            <Paper key={consent.name} withBorder radius="md" p="xs" bg="gray.0">
              <Stack gap="xs">
                <TextInput
                  label={`Consentimiento ${index + 1} - texto de la casilla`}
                  description="Lo que acepta el asistente al marcarla"
                  placeholder={index === 0 ? DEFAULT_CONSENT_LABEL : "Ej: Acepto recibir comunicaciones"}
                  value={consent.label}
                  onChange={(e) =>
                    setConsentimientos((items) =>
                      items.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, label: e.currentTarget.value } : item,
                      ),
                    )
                  }
                />
                <Textarea
                  label="Texto legal o explicación"
                  description="Se muestra debajo de la casilla"
                  value={consent.text}
                  onChange={(e) =>
                    setConsentimientos((items) =>
                      items.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, text: e.currentTarget.value } : item,
                      ),
                    )
                  }
                  autosize
                  minRows={2}
                  maxRows={6}
                />
                <Group justify="space-between">
                  <Switch
                    label="Obligatorio"
                    checked={consent.required !== false}
                    onChange={(e) =>
                      setConsentimientos((items) =>
                        items.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, required: e.currentTarget.checked }
                            : item,
                        ),
                      )
                    }
                  />
                  {index > 0 && (
                    <Button
                      variant="subtle"
                      color="red"
                      size="xs"
                      leftSection={<IconTrash size={14} />}
                      onClick={() =>
                        setConsentimientos((items) =>
                          items.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      Eliminar
                    </Button>
                  )}
                </Group>
              </Stack>
            </Paper>
          ))}
          <Button
            variant="light"
            leftSection={<IconPlus size={16} />}
            onClick={() =>
              setConsentimientos((items) => [
                ...items,
                {
                  name: `consentimiento_${Date.now()}`,
                  label: "",
                  text: "",
                  required: true,
                },
              ])
            }
          >
            Agregar consentimiento
          </Button>
        </Stack>
      </Paper>

      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={handleSave} loading={saving}>
          Guardar formulario
        </Button>
      </Group>

      {/* -------- Panel de configuración del campo -------- */}
      <Drawer
        opened={!!editing}
        onClose={() => setEditingName(null)}
        position="right"
        size="md"
        title={<Text fw={600}>Configurar campo</Text>}
      >
        {editing && (
          <Stack gap="md">
            <Group gap={6}>
              <Badge variant="light">{fieldTypeLabel(editing.type)}</Badge>
              <Badge variant="light" color={isCustomField(editing) ? "grape" : "gray"}>
                {isCustomField(editing) ? "Personalizado" : "Predefinido"}
              </Badge>
            </Group>

            <TextInput
              label="Etiqueta"
              description="Texto que ve el asistente sobre el campo"
              value={
                editing.label ??
                AVAILABLE_FIELDS.find((af) => af.name === editing.name)?.label ??
                ""
              }
              onChange={(e) => handleLabelChange(editing.name, e.currentTarget.value)}
            />
            {editing.type !== "checkbox" &&
              editing.type !== "photo" &&
              editing.type !== "eventDays" && (
                <TextInput
                  label="Texto de ejemplo (placeholder)"
                  description="Aparece en gris dentro del campo vacío"
                  value={editing.placeholder || ""}
                  onChange={(e) =>
                    handlePlaceholderChange(editing.name, e.currentTarget.value)
                  }
                />
              )}
            <Switch
              label="Obligatorio"
              checked={!!editing.required}
              onChange={(e) => handleToggleRequired(editing.name, e.currentTarget.checked)}
            />

            {mode === "stepper" && (
              <Select
                label="Paso"
                data={[
                  ...steps.map((s, i) => ({
                    value: s.id,
                    label: `${i + 1}. ${s.title || "Sin título"}`,
                  })),
                  { value: UNASSIGNED_CONTAINER, label: "Sin paso (no se muestra)" },
                ]}
                value={editingStepId || UNASSIGNED_CONTAINER}
                onChange={(v) =>
                  v &&
                  assignToStep(editing.name, v === UNASSIGNED_CONTAINER ? null : v)
                }
                allowDeselect={false}
              />
            )}

            {(editing.type === "select" || editing.type === "multiselect") && (
              <>
                <OptionsEditor
                  key={editing.name}
                  field={editing}
                  onChange={(raw) => handleUpdateOptions(editing.name, raw)}
                />
                {editing.type === "multiselect" && (
                  <Checkbox
                    label='Incluir opción "Otro, ¿cuál?"'
                    checked={!!editing.includeOtro}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked;
                      updateField(editing.name, (f) => ({ ...f, includeOtro: checked }));
                    }}
                  />
                )}
              </>
            )}

            {(editing.type === "text" || hasEditableMaxLength(editing)) && (
              <Group grow align="flex-start">
                {editing.type === "text" && (
                  <Select
                    label="Tipo de valor"
                    data={[
                      ...(detectValidationPresetKey(editing) === "custom"
                        ? [{ value: "custom", label: "Personalizado (actual)" }]
                        : []),
                      ...Object.entries(TEXT_VALIDATION_PRESETS).map(([value, preset]) => ({
                        value,
                        label: preset.label,
                      })),
                    ]}
                    value={detectValidationPresetKey(editing)}
                    onChange={(v) => v && handleUpdateValidationType(editing.name, v)}
                    allowDeselect={false}
                  />
                )}
                {hasEditableMaxLength(editing) && (
                  <NumberInput
                    label="Máx. caracteres"
                    min={1}
                    value={editing.validation?.maxLength ?? ""}
                    onChange={(v) =>
                      handleUpdateMaxLength(editing.name, typeof v === "number" ? v : null)
                    }
                  />
                )}
              </Group>
            )}

            {showRoleLabels && (
              <>
                <Divider label="Etiqueta según el rol" labelPosition="left" />
                <Switch
                  label="Usar una etiqueta distinta para compradores y vendedores"
                  description="Se usa en el registro y en el dashboard. Si dejas una vacía se usa la etiqueta general."
                  checked={!!editing.labelByRole}
                  onChange={(e) =>
                    handleUpdateLabelByRole(
                      editing.name,
                      e.currentTarget.checked ? { comprador: "", vendedor: "" } : null,
                    )
                  }
                />
                {editing.labelByRole && (
                  <Group grow align="flex-start">
                    <TextInput
                      label="Comprador"
                      placeholder={fieldDisplayLabel(editing)}
                      value={editing.labelByRole?.comprador || ""}
                      onChange={(e) =>
                        handleUpdateLabelByRole(editing.name, {
                          ...editing.labelByRole,
                          comprador: e.currentTarget.value,
                        })
                      }
                    />
                    <TextInput
                      label="Vendedor"
                      placeholder={fieldDisplayLabel(editing)}
                      value={editing.labelByRole?.vendedor || ""}
                      onChange={(e) =>
                        handleUpdateLabelByRole(editing.name, {
                          ...editing.labelByRole,
                          vendedor: e.currentTarget.value,
                        })
                      }
                    />
                  </Group>
                )}
              </>
            )}

            <Divider label="Mostrar solo si…" labelPosition="left" />
            {conditionParents.length === 0 ? (
              <Text size="xs" c="dimmed">
                Para mostrar este campo según una respuesta, primero agrega un campo de
                selección al formulario.
              </Text>
            ) : (
              <>
                <Switch
                  label="Mostrar este campo solo según la respuesta de otro"
                  checked={!!editing.showWhen}
                  onChange={(e) =>
                    handleUpdateShowWhen(
                      editing.name,
                      e.currentTarget.checked
                        ? { field: conditionParents[0].name, value: [] }
                        : null,
                    )
                  }
                />
                {editing.showWhen && (
                  <>
                    <Select
                      label="Cuando el campo"
                      data={conditionParents.map((f) => ({
                        value: f.name,
                        label: fieldDisplayLabel(f),
                      }))}
                      value={editing.showWhen?.field || null}
                      onChange={(v) =>
                        v && handleUpdateShowWhen(editing.name, { field: v, value: [] })
                      }
                      allowDeselect={false}
                    />
                    <MultiSelect
                      label="tenga alguno de estos valores"
                      data={(conditionParent?.options || []).map((op: any) => ({
                        value: op.value,
                        label: op.label,
                      }))}
                      value={editing.showWhen?.value || []}
                      onChange={(v) =>
                        handleUpdateShowWhen(editing.name, { ...editing.showWhen, value: v })
                      }
                      placeholder="Selecciona valores"
                      searchable
                      error={
                        (editing.showWhen?.value || []).length === 0
                          ? "Sin valores elegidos el campo nunca se mostrará"
                          : undefined
                      }
                    />
                  </>
                )}
              </>
            )}

            <Divider />
            <Button
              color="red"
              variant="light"
              leftSection={<IconTrash size={16} />}
              onClick={() => removeField(editing.name)}
            >
              Quitar del formulario
            </Button>
            {!isCustomField(editing) && (
              <Text size="xs" c="dimmed" mt={-8}>
                Es un campo predefinido: puedes volver a agregarlo desde "Agregar campo".
              </Text>
            )}
          </Stack>
        )}
      </Drawer>

      {/* -------- Nuevo campo personalizado -------- */}
      <Modal
        opened={!!customTarget}
        onClose={() => setCustomTarget(null)}
        title={<Text fw={600}>Nuevo campo personalizado</Text>}
        centered
      >
        <Stack gap="sm">
          <TextInput
            label="Nombre del campo"
            placeholder="Ej: Sector de la empresa"
            value={newFieldLabel}
            onChange={(e) => setNewFieldLabel(e.currentTarget.value)}
            data-autofocus
          />
          <Select
            label="Tipo"
            value={newFieldType}
            onChange={(v) => setNewFieldType((v as NewFieldType) || "text")}
            data={[
              { value: "text", label: "Texto" },
              { value: "date", label: "Fecha" },
              { value: "select", label: "Selección (una opción)" },
              { value: "multiselect", label: "Selección múltiple" },
              { value: "checkbox", label: "Casilla (sí / no)" },
              { value: "pdf", label: "Documento PDF" },
            ]}
            allowDeselect={false}
          />
          {newNeedsOptions && (
            <Textarea
              label="Opciones"
              description="Una opción por línea"
              placeholder={"Opción 1\nOpción 2"}
              value={newSelectOptions}
              onChange={(e) => setNewSelectOptions(e.currentTarget.value)}
              autosize
              minRows={3}
              maxRows={8}
            />
          )}
          {newFieldType === "multiselect" && (
            <Checkbox
              label='Incluir opción "Otro, ¿cuál?"'
              checked={newIncludeOtro}
              onChange={(e) => setNewIncludeOtro(e.currentTarget.checked)}
            />
          )}
          <Switch
            label="Obligatorio"
            checked={newRequired}
            onChange={(e) => setNewRequired(e.currentTarget.checked)}
          />
          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={() => setCustomTarget(null)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateCustomField} disabled={!canCreateCustom}>
              Crear campo
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );

  if (inline) return content;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Configurar formulario"
      size="xl"
      centered
      padding="lg"
    >
      {content}
    </Modal>
  );
}

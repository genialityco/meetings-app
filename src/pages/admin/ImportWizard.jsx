import {
  Modal,
  Paper,
  Stack,
  Table,
  Group,
  Select,
  Button,
  Text,
  TextInput,
  ActionIcon,
  Tooltip,
  Alert,
  Badge,
} from "@mantine/core";
import { IconInfoCircle, IconCheck, IconPlus, IconX } from "@tabler/icons-react";
import { useState, useEffect } from "react";

const FIELD_TYPE_OPTIONS = [
  { value: "text", label: "Texto" },
  { value: "select", label: "Select" },
  { value: "checkbox", label: "Checkbox" },
];

export default function ImportWizard({
  opened,
  onClose,
  columns,
  existingFields,
  onConfirmMapping,
  onCreateField,
  creatingFieldFor,
  setCreatingFieldFor,
}) {
  // Estados para el mapeo normal
  const [mapping, setMapping] = useState({});
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState("text");

  // --- Estados para campos globales
  const [globalFields, setGlobalFields] = useState([]);
  const [selectedGlobalField, setSelectedGlobalField] = useState("");
  const [globalFieldValue, setGlobalFieldValue] = useState("");

  // Reset on open
  useEffect(() => {
    if (opened) {
      setMapping({});
      setCreatingFieldFor(null);
      setNewFieldLabel("");
      setNewFieldType("text");
      setGlobalFields([]);
      setSelectedGlobalField("");
      setGlobalFieldValue("");
    }
  }, [opened, columns]);

  const handleFieldSelect = (col, value) => {
    if (value === "NEW_FIELD") {
      setCreatingFieldFor(col);
    } else {
      setMapping((prev) => ({ ...prev, [col]: value }));
    }
  };

  const handleCreateField = () => {
    if (!newFieldLabel.trim()) return;
    onCreateField({
      excelCol: creatingFieldFor,
      label: newFieldLabel,
      type: newFieldType,
    });
    setMapping((prev) => ({
      ...prev,
      [creatingFieldFor]:
        "custom_" +
        newFieldLabel.toLowerCase().replace(/\s/g, "_") +
        "_" +
        Math.floor(Math.random() * 10000),
    }));
    setCreatingFieldFor(null);
    setNewFieldLabel("");
    setNewFieldType("text");
  };

  // --- Global fields handlers ---
  const handleAddGlobalField = () => {
    if (!selectedGlobalField || !globalFieldValue) return;
    // Evitar duplicados
    if (globalFields.find((f) => f.name === selectedGlobalField)) return;
    setGlobalFields((prev) => [
      ...prev,
      {
        name: selectedGlobalField,
        label:
          existingFields.find((f) => f.name === selectedGlobalField)?.label ||
          selectedGlobalField,
        value: globalFieldValue,
      },
    ]);
    setSelectedGlobalField("");
    setGlobalFieldValue("");
  };

  const handleRemoveGlobalField = (fieldName) => {
    setGlobalFields((prev) => prev.filter((f) => f.name !== fieldName));
  };

  // Puede importar si hay algún mapeo útil O algún campo global
  const isReady =
    (Object.values(mapping).filter((v) => v && v !== "").length > 0 ||
      globalFields.length > 0) &&
    !creatingFieldFor;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group spacing="xs">
          <IconInfoCircle size={20} />
          <span>Mapear columnas del archivo Excel</span>
        </Group>
      }
      size="lg"
      centered
    >
      <Paper p="sm">
        <Stack>
          {/* --- Campos globales --- */}
          <Paper p="xs" withBorder radius="md" mb={4} bg="gray.1">
            <Text fw={500} size="sm" mb={4}>
              Campos globales para todos los registros (opcional)
            </Text>
            <Group align="flex-end" mb={2}>
              <Select
                placeholder="Selecciona campo"
                value={selectedGlobalField}
                onChange={setSelectedGlobalField}
                data={existingFields.map((f) => ({
                  value: f.name,
                  label: f.label,
                }))}
                style={{ minWidth: 180 }}
                searchable
                nothingFound="Sin opciones"
              />
              <TextInput
                placeholder="Valor"
                value={globalFieldValue}
                onChange={(e) => setGlobalFieldValue(e.currentTarget.value)}
                style={{ minWidth: 170 }}
                disabled={!selectedGlobalField}
              />
              <Button
                leftIcon={<IconPlus size={16} />}
                onClick={handleAddGlobalField}
                disabled={!selectedGlobalField || !globalFieldValue}
                color="teal"
              >
                Añadir
              </Button>
            </Group>
            <Group>
              {globalFields.map((f) => (
                <Badge
                  key={f.name}
                  color="blue"
                  rightSection={
                    <ActionIcon
                      size="xs"
                      color="red"
                      variant="transparent"
                      onClick={() => handleRemoveGlobalField(f.name)}
                    >
                      <IconX size={12} />
                    </ActionIcon>
                  }
                >
                  {f.label}: {f.value}
                </Badge>
              ))}
            </Group>
          </Paper>

          <Alert
            color="blue"
            icon={<IconInfoCircle />}
            mb="xs"
            title="Instrucciones"
          >
            <Text size="sm">
              Asigna cada columna del archivo a un campo del sistema. Si la columna no aplica, selecciona <Badge color="gray">Omitir</Badge>. Si el campo no existe aún, puedes crearlo.
            </Text>
          </Alert>

          <Table withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Columna del archivo</Table.Th>
                <Table.Th>Asignar a campo</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {columns.map((col) => (
                <Table.Tr key={col}>
                  <Table.Td>
                    <Text fw={500}>{col}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Select
                      placeholder="Asignar campo"
                      value={mapping[col] || ""}
                      data={[
                        { value: "", label: "Omitir" },
                        ...existingFields.map((f) => ({
                          value: f.name,
                          label: f.label,
                        })),
                        { value: "NEW_FIELD", label: "+ Crear nuevo campo..." },
                      ]}
                      onChange={(val) => handleFieldSelect(col, val)}
                      searchable
                      nothingFound="No hay campos"
                    />
                  </Table.Td>
                  <Table.Td>
                    {mapping[col] &&
                      mapping[col] !== "" &&
                      mapping[col] !== "NEW_FIELD" && (
                        <Tooltip label="Columna asignada">
                          <IconCheck color="green" size={18} />
                        </Tooltip>
                      )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>

          {creatingFieldFor && (
            <Paper p="xs" my={10} withBorder radius="md" bg="gray.0">
              <Text size="sm" mb={4}>
                <b>
                  Crear nuevo campo para columna:{" "}
                  <Badge color="blue">{creatingFieldFor}</Badge>
                </b>
              </Text>
              <Group align="flex-end">
                <TextInput
                  label="Nombre a mostrar"
                  value={newFieldLabel}
                  onChange={(e) => setNewFieldLabel(e.currentTarget.value)}
                  required
                  style={{ minWidth: 160 }}
                  autoFocus
                />
                <Select
                  label="Tipo"
                  value={newFieldType}
                  onChange={setNewFieldType}
                  data={FIELD_TYPE_OPTIONS}
                  style={{ minWidth: 120 }}
                />
                <Button
                  leftIcon={<IconPlus size={16} />}
                  onClick={handleCreateField}
                  disabled={!newFieldLabel}
                  color="teal"
                >
                  Crear campo
                </Button>
                <ActionIcon
                  color="red"
                  variant="subtle"
                  onClick={() => setCreatingFieldFor(null)}
                  title="Cancelar"
                >
                  <IconX size={20} />
                </ActionIcon>
              </Group>
            </Paper>
          )}

          <Button
            mt="md"
            fullWidth
            onClick={() => onConfirmMapping(mapping, globalFields)}
            disabled={!isReady}
            color="blue"
            size="md"
            leftIcon={<IconCheck size={18} />}
          >
            Confirmar mapeo e importar
          </Button>
        </Stack>
      </Paper>
    </Modal>
  );
}

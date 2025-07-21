import {
  Card,
  Table,
  Button,
  Loader,
  Text,
  Group,
  Title,
  MultiSelect,
  Modal,
} from "@mantine/core";
import {
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
  addDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import * as XLSX from "xlsx";
import ModalEditAttendee from "./ModalEditAttendee";
import ImportWizard from "./ImportWizard";

// Utilidad para obtener campos configurados para el evento (omite foto y consentimiento)
const getEventTableFields = (event) => {
  if (!event?.config?.formFields) return [];
  return event.config.formFields
    .filter((f) => !["photo", "aceptaTratamiento"].includes(f.name))
    .map((f) => ({
      name: f.name,
      label: f.label || f.name,
      type: f.type,
      options: f.options,
    }));
};

const getValue = (a, fieldName) => {
  if (fieldName.startsWith("contacto.")) {
    const key = fieldName.split(".")[1];
    return a.contacto?.[key] || "";
  }
  return a[fieldName] ?? "";
};

// ------ MAIN COMPONENT ------
const AttendeesList = ({ event, setGlobalMessage }) => {
  const fileInputRef = useRef();
  const [attendees, setAttendees] = useState([]);
  const [loading, setLoading] = useState(false);

  // -- IMPORT WIZARD STATE --
  const [importWizardOpened, setImportWizardOpened] = useState(false);
  const [importColumns, setImportColumns] = useState([]);
  const [importRows, setImportRows] = useState([]);
  const [fields, setFields] = useState(getEventTableFields(event)); // campos configurados
  const [shownFields, setShownFields] = useState(fields.map((f) => f.name));
  const [creatingFieldFor, setCreatingFieldFor] = useState(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [attendeeToEdit, setAttendeeToEdit] = useState(null);

  const [deleteAllModal, setDeleteAllModal] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

  useEffect(() => {
    setFields(getEventTableFields(event));
    setShownFields(getEventTableFields(event).map((f) => f.name));
    // eslint-disable-next-line
  }, [event?.config?.formFields]);

  useEffect(() => {
    if (event) fetchAttendees();
    // eslint-disable-next-line
  }, [event]);

  const fetchAttendees = async () => {
    try {
      setLoading(true);
      const q = query(
        collection(db, "users"),
        where("eventId", "==", event.id)
      );
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      }));
      setAttendees(list);
    } catch (error) {
      setGlobalMessage("Error al obtener asistentes.");
    } finally {
      setLoading(false);
    }
  };

  const removeAttendee = async (attendeeId) => {
    try {
      await deleteDoc(doc(db, "users", attendeeId));
      setGlobalMessage("Asistente eliminado correctamente.");
      setAttendees((prev) => prev.filter((a) => a.id !== attendeeId));
    } catch (error) {
      setGlobalMessage("Error al eliminar el asistente.");
    }
  };

  const handleDeleteAllAttendees = async () => {
    setDeletingAll(true);
    try {
      // Solo IDs
      const ids = attendees.map((a) => a.id);
      await Promise.all(ids.map((id) => deleteDoc(doc(db, "users", id))));
      setGlobalMessage("Todos los asistentes fueron eliminados.");
      setAttendees([]); // Limpiar lista local
      setDeleteAllModal(false);
    } catch (err) {
      setGlobalMessage("Error al eliminar todos los asistentes.");
    } finally {
      setDeletingAll(false);
    }
  };

  // Plantilla de Excel siempre TODOS los campos configurados
  const downloadAttendeesTemplate = () => {
    const wsData = [
      fields.map((f) => f.name),
      fields.map((f, idx) => `Ejemplo ${idx + 1}`), // Puedes mejorar ejemplos si gustas
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PlantillaAsistentes");
    XLSX.writeFile(wb, "plantilla_asistentes.xlsx");
  };

  // Paso 1: Leer archivo Excel y mostrar wizard de mapeo
  const handleExcelFileSelected = async (file) => {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const ws = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (rows.length === 0) {
      setGlobalMessage("El archivo está vacío.");
      return;
    }
    setImportColumns(Object.keys(rows[0]));
    setImportRows(rows);
    setImportWizardOpened(true);
  };

  // Paso 2: Cuando se crea un nuevo campo desde el wizard (lo agrega a la config del evento)
  const handleCreateField = async ({ excelCol, label, type }) => {
    const fieldName = `custom_${label
      .toLowerCase()
      .replace(/\s/g, "_")}_${Math.floor(Math.random() * 10000)}`;
    // Añadir a la config en Firestore
    try {
      const currentFields = event.config.formFields || [];
      const newField = {
        name: fieldName,
        label,
        type,
        required: false,
      };
      await updateDoc(doc(db, "events", event.id), {
        "config.formFields": [...currentFields, newField],
      });
      // Localmente refresca los campos
      setFields((prev) => [...prev, newField]);
    } catch (err) {
      setGlobalMessage("Error al agregar campo nuevo en Firestore.");
    }
  };

  // Paso 3: Importar filas con el mapeo
  const handleConfirmMapping = async (mapping, globalFields = []) => {
    let imported = 0,
      failed = 0;

    for (const row of importRows) {
      const docData = {};
      for (const col in mapping) {
        const fieldName = mapping[col];
        if (!fieldName || fieldName === "") continue;
        let value = row[col];

        // Detecta si es select y mapea el value si aplica
        const fieldConfig = fields.find((f) => f.name === fieldName);
        if (fieldConfig?.type === "select" && value) {
          const option = fieldConfig.options?.find(
            (op) =>
              String(op.label).toLowerCase().trim() ===
              String(value).toLowerCase().trim()
          );
          value = option?.value || value;
        }

        if (fieldName === "cedula") {
          docData.cedula = String(value).trim();
          continue;
        }
        docData[fieldName] = value;
      }

      // Maneja campos globales igual
      globalFields.forEach((f) => {
        const fieldConfig = fields.find((field) => field.name === f.name);
        let value = f.value;
        if (fieldConfig?.type === "select" && value) {
          const option = fieldConfig.options?.find(
            (op) =>
              String(op.label).toLowerCase().trim() ===
              String(value).toLowerCase().trim()
          );
          value = option?.value || value;
        }
        docData[f.name] = value;
      });

      docData.eventId = event.id;
      docData.aceptaTratamiento = true;
      try {
        await addDoc(collection(db, "users"), docData);
        imported++;
      } catch (err) {
        failed++;
      }
    }
    setGlobalMessage(`Importados: ${imported}. Fallidos: ${failed}.`);
    setImportWizardOpened(false);
    fetchAttendees();
  };

  // Exporta SOLO los campos visibles
  const handleExportCurrentToExcel = () => {
    const visibleFields = fields.filter((f) => shownFields.includes(f.name));
    const wsData = [
      visibleFields.map((f) => f.label),
      ...attendees.map((a) => visibleFields.map((f) => getValue(a, f.name))),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Asistentes");
    XLSX.writeFile(wb, `asistentes_${event?.eventName || event.id}.xlsx`);
  };

  const exportCompradoresToExcel = () => {
    // Puedes ajustar estos campos según tu modelo
    const compradores = attendees.filter(
      (a) => a.tipoAsistente === "comprador"
    );
    if (compradores.length === 0)
      return setGlobalMessage("No hay compradores.");
    const fieldsComprador = [
      "id",
      "nombre",
      "empresa",
      "necesidad",
      // agrega aquí más campos si los tienes configurados
    ];
    const wsData = [
      fieldsComprador, // header
      ...compradores.map((c) => fieldsComprador.map((f) => c[f] || "")),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Compradores");
    XLSX.writeFile(wb, "compradores_evento_matchs.xlsx");
  };

  // 2. Función para exportar vendedores
  const exportVendedoresToExcel = () => {
    const vendedores = attendees.filter((a) => a.tipoAsistente === "vendedor");
    if (vendedores.length === 0) return setGlobalMessage("No hay vendedores.");
    const fieldsVendedor = [
      "id",
      "nombre",
      "empresa",
      "descripcion",
      "necesidad"
      // agrega aquí más campos si los tienes configurados
    ];
    const wsData = [
      fieldsVendedor, // header
      ...vendedores.map((v) => fieldsVendedor.map((f) => v[f] || "")),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Vendedores");
    XLSX.writeFile(wb, "vendedores_evento_matchs.xlsx");
  };

  return (
    <Card shadow="sm" p="lg" withBorder mt="md">
      <Group position="apart" mb="md">
        <Title order={5}>Asistentes del evento</Title>
        <Group>
          <Button variant="outline" onClick={downloadAttendeesTemplate}>
            Descargar Plantilla Excel
          </Button>
          <Button component="label" variant="outline">
            Importar Excel
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: "none" }}
              onChange={async (e) => {
                if (e.target.files[0]) {
                  await handleExcelFileSelected(e.target.files[0]);
                }
              }}
            />
          </Button>
          <Button onClick={handleExportCurrentToExcel}>
            Exportar a Excel (solo columnas visibles)
          </Button>
          <Button
            variant="outline"
            color="indigo"
            onClick={exportCompradoresToExcel}
          >
            Exportar compradores (Excel)
          </Button>
          <Button
            variant="outline"
            color="orange"
            onClick={exportVendedoresToExcel}
          >
            Exportar vendedores (Excel)
          </Button>
          {attendees.length > 0 && (
            <Button
              color="red"
              variant="outline"
              onClick={() => setDeleteAllModal(true)}
              loading={deletingAll}
            >
              Eliminar TODOS
            </Button>
          )}
          {/* Selección de columnas */}
          <MultiSelect
            data={fields.map((f) => ({
              value: f.name,
              label: f.label,
            }))}
            value={shownFields}
            onChange={setShownFields}
            clearable={false}
            searchable
            placeholder="Columnas a mostrar"
            style={{ minWidth: 220 }}
            nothingFound="Sin campos"
          />
        </Group>
      </Group>

      <ImportWizard
        opened={importWizardOpened}
        onClose={() => setImportWizardOpened(false)}
        columns={importColumns}
        existingFields={fields}
        onConfirmMapping={handleConfirmMapping}
        onCreateField={handleCreateField}
        creatingFieldFor={creatingFieldFor}
        setCreatingFieldFor={setCreatingFieldFor}
      />

      {loading ? (
        <Loader />
      ) : attendees.length === 0 ? (
        <Text>No hay asistentes registrados para este evento.</Text>
      ) : (
        <Table.ScrollContainer>
          <Table>
            <Table.Thead>
              <Table.Tr>
                {fields
                  .filter((f) => shownFields.includes(f.name))
                  .map((f) => (
                    <Table.Th key={f.name}>{f.label}</Table.Th>
                  ))}
                <Table.Th>Acciones</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {attendees.map((a) => (
                <Table.Tr key={a.id}>
                  {fields
                    .filter((f) => shownFields.includes(f.name))
                    .map((f) => (
                      <Table.Td key={f.name}>
                        {f.type === "select"
                          ? f.options?.find((op) => op.value === a[f.name])
                              ?.label ||
                            a[f.name] ||
                            getValue(a, f.name)
                          : getValue(a, f.name)}
                      </Table.Td>
                    ))}
                  <Table.Td>
                    <Button
                      size="xs"
                      variant="outline"
                      color="blue"
                      onClick={() => {
                        setAttendeeToEdit(a);
                        setEditModalOpen(true);
                      }}
                      style={{ marginRight: 8 }}
                    >
                      Editar
                    </Button>
                    <Button
                      color="red"
                      size="xs"
                      onClick={() => {
                        if (
                          window.confirm(
                            "¿Estás seguro que deseas eliminar este asistente?"
                          )
                        ) {
                          removeAttendee(a.id);
                        }
                      }}
                    >
                      Eliminar
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <ModalEditAttendee
        opened={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        attendee={attendeeToEdit}
        fields={fields}
        onSave={async (updated) => {
          // Guarda en Firestore
          const id = updated.id;
          const { id: _id, ...toSave } = updated;
          try {
            await updateDoc(doc(db, "users", id), toSave);
            setGlobalMessage("Asistente actualizado correctamente.");
            fetchAttendees();
          } catch (err) {
            setGlobalMessage("Error al actualizar el asistente.");
          }
        }}
      />
      <Modal
        opened={deleteAllModal}
        onClose={() => setDeleteAllModal(false)}
        title="Eliminar todos los asistentes"
        centered
      >
        <Text>
          ¿Estás seguro que deseas eliminar <b>todos los asistentes</b> del
          evento? Esta acción es irreversible.
        </Text>
        <Group mt="md" position="apart">
          <Button
            variant="default"
            onClick={() => setDeleteAllModal(false)}
            disabled={deletingAll}
          >
            Cancelar
          </Button>
          <Button
            color="red"
            onClick={handleDeleteAllAttendees}
            loading={deletingAll}
          >
            Eliminar todos
          </Button>
        </Group>
      </Modal>
    </Card>
  );
};

AttendeesList.propTypes = {
  event: PropTypes.object.isRequired,
  setGlobalMessage: PropTypes.func.isRequired,
};

export default AttendeesList;

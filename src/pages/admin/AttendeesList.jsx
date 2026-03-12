import { Card, Table, Button, Loader, Text, Group, Title, MultiSelect, Modal, Image, Tabs, Stack } from "@mantine/core";
import { collection, query, where, getDocs, deleteDoc, doc, addDoc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import * as XLSX from "xlsx";
import ModalEditAttendee from "./ModalEditAttendee";
import ImportWizard from "./ImportWizard";

// Utilidad para obtener campos configurados para el evento (omite foto y consentimiento)
const getEventTableFields = (event, entityType = "users") => {
  let configKey = "formFields";
  let defaultFields = [];
  
  if (entityType === "companies") {
    configKey = "companyFields";
    // Campos por defecto para empresas si no están configurados
    defaultFields = [
      { name: "logoUrl", label: "Logo", type: "image" },
      { name: "nit", label: "NIT", type: "text" },
      { name: "razonSocial", label: "Razón Social", type: "text" },
      { name: "descripcion", label: "Descripción", type: "richtext" },
      { name: "custom_por_favor_indique_el_tama_2641", label: "Tamaño empresa", type: "text" },
      { name: "custom_instagram_508", label: "Instagram", type: "text" },
      { name: "custom_facebook_6790", label: "Facebook", type: "text" },
      { name: "custom_pgina_web_4455", label: "Página web", type: "text" },
    ];
  } else if (entityType === "products") {
    configKey = "productFields";
    // Campos por defecto para productos si no están configurados
    defaultFields = [
      { name: "imageUrl", label: "Imagen", type: "image" },
      { name: "title", label: "Título", type: "text" },
      { name: "description", label: "Descripción", type: "richtext" },
      { name: "category", label: "Categoría", type: "text" },
      { name: "ownerCompany", label: "Empresa", type: "text" },
      { name: "ownerName", label: "Propietario", type: "text" },
      { name: "ownerPhone", label: "Teléfono", type: "text" },
    ];
  }
  
  // Si hay campos específicos configurados, usarlos
  if (event?.config?.[configKey] && event.config[configKey].length > 0) {
    return event.config[configKey]
      .filter((f) => !["photo", "aceptaTratamiento"].includes(f.name))
      .map((f) => ({
        name: f.name,
        label: f.label || f.name,
        type: f.type,
        options: f.options,
      }));
  }
  
  // Para empresas, extraer campos relevantes de formFields si existen
  if (entityType === "companies" && event?.config?.formFields) {
    const companyRelatedFields = event.config.formFields.filter(f => 
      f.name.startsWith("company_") || 
      f.name === "descripcion" ||
      f.name === "logoUrl" ||
      f.name === "nitNorm" ||
      f.name === "razonSocial" ||
      f.name.includes("instagram") ||
      f.name.includes("facebook") ||
      f.name.includes("web") ||
      f.name.includes("tama")
    ).map((f) => {
      let fieldName = f.name.replace("company_", "");
      // Mapear company_nit a nit para que getValue lo encuentre
      if (fieldName === "nit") {
        fieldName = "nit";
      }
      return {
        name: fieldName,
        label: f.label || f.name,
        type: f.type === "file" ? "image" : f.type,
        options: f.options,
      };
    });
    
    if (companyRelatedFields.length > 0) {
      // Agregar campos adicionales que están en el documento de empresa
      const additionalFields = [
        { name: "logoUrl", label: "Logo", type: "image" },
        { name: "nit", label: "NIT", type: "text" },
        { name: "razonSocial", label: "Razón Social", type: "text" },
      ];
      
      // Combinar y eliminar duplicados
      const allFields = [...additionalFields, ...companyRelatedFields];
      const uniqueFields = allFields.filter((field, index, self) =>
        index === self.findIndex((f) => f.name === field.name)
      );
      
      return uniqueFields;
    }
  }
  
  return defaultFields;
};

const getValue = (a, fieldName) => {
  if (fieldName.startsWith("contacto.")) {
    const key = fieldName.split(".")[1];
    return a.contacto?.[key] || "";
  }
  // Caso especial para imágenes de productos (puede ser array o string)
  if (fieldName === "images" && Array.isArray(a.images)) {
    return a.images[0] || "";
  }
  // Caso especial para imageUrl de productos
  if (fieldName === "imageUrl") {
    return a.imageUrl || (Array.isArray(a.images) ? a.images[0] : "") || "";
  }
  // Caso especial para NIT de empresa (puede estar como nit, nitNorm o id)
  if (fieldName === "nit") {
    return a.nit || a.nitNorm || a.id || "";
  }
  return a[fieldName] ?? "";
};

// ------ MAIN COMPONENT ------
const AttendeesList = ({ event, setGlobalMessage }) => {
  const fileInputRef = useRef();
  const [activeTab, setActiveTab] = useState("asistentes");
  const [attendees, setAttendees] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [products, setProducts] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(false);

  // -- IMPORT WIZARD STATE --
  const [importWizardOpened, setImportWizardOpened] = useState(false);
  const [importColumns, setImportColumns] = useState([]);
  const [importRows, setImportRows] = useState([]);
  const [fields, setFields] = useState(getEventTableFields(event, "users"));
  const [companyFields, setCompanyFields] = useState(getEventTableFields(event, "companies"));
  const [productFields, setProductFields] = useState(getEventTableFields(event, "products"));
  const [shownFields, setShownFields] = useState(fields.map((f) => f.name));
  const [shownCompanyFields, setShownCompanyFields] = useState(companyFields.map((f) => f.name));
  const [shownProductFields, setShownProductFields] = useState(productFields.map((f) => f.name));
  const [creatingFieldFor, setCreatingFieldFor] = useState(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [attendeeToEdit, setAttendeeToEdit] = useState(null);
  const [editCompanyModalOpen, setEditCompanyModalOpen] = useState(false);
  const [companyToEdit, setCompanyToEdit] = useState(null);
  const [editProductModalOpen, setEditProductModalOpen] = useState(false);
  const [productToEdit, setProductToEdit] = useState(null);

  // Estado para edición inline
  const [editingCell, setEditingCell] = useState(null); // { id, fieldName, value }
  const [savingCell, setSavingCell] = useState(false);

  // Estado para actualización masiva
  const [updateWizardOpened, setUpdateWizardOpened] = useState(false);
  const [updateColumns, setUpdateColumns] = useState([]);
  const [updateRows, setUpdateRows] = useState([]);
  const [updatingAttendees, setUpdatingAttendees] = useState(false);

  const [deleteAllModal, setDeleteAllModal] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [deletingOne, setDeletingOne] = useState(false);
  const [deleteConfirmModal, setDeleteConfirmModal] = useState({
    opened: false,
    attendeeId: null,
    attendeeName: "",
    meetingCount: 0,
    checking: false,
  });

function parseFirestoreTimestamp(input) {
  if (!input) return null;

  // Case 1: Firestore Timestamp object (has .toDate)
  if (typeof input.toDate === 'function') {
    return input.toDate().toLocaleString();
  }

  // Case 2: Plain object with seconds & nanoseconds
  if (typeof input.seconds === 'number' && typeof input.nanoseconds === 'number') {
    return new Date(input.seconds * 1000 + input.nanoseconds / 1e6).toLocaleString();
  }

  return null; // fallback if not recognized
}


  useEffect(() => {
    setFields(getEventTableFields(event, "users"));
    setShownFields(getEventTableFields(event, "users").map((f) => f.name));
    setCompanyFields(getEventTableFields(event, "companies"));
    setShownCompanyFields(getEventTableFields(event, "companies").map((f) => f.name));
    setProductFields(getEventTableFields(event, "products"));
    setShownProductFields(getEventTableFields(event, "products").map((f) => f.name));
    // eslint-disable-next-line
  }, [event?.config?.formFields, event?.config?.companyFields, event?.config?.productFields]);

  useEffect(() => {
    if (event) {
      fetchAttendees();
      fetchCompaniesCount();
      fetchProductsCount();
      fetchMeetings();
    }
    // eslint-disable-next-line
  }, [event]);

  useEffect(() => {
    if (event && activeTab === "empresas" && companies.length === 0) {
      fetchCompanies();
    } else if (event && activeTab === "productos" && products.length === 0) {
      fetchProducts();
    }
    // eslint-disable-next-line
  }, [activeTab]);

  const fetchAttendees = async () => {
    try {
      setLoading(true);
      const q = query(collection(db, "users"), where("eventId", "==", event.id));
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map((docItem) => {
        const lastConnectedTimestamp = docItem.data().lastConnection;
        const formatted = parseFirestoreTimestamp(lastConnectedTimestamp);
        return {
          id: docItem.id,
          ...docItem.data(),
          lastConnectionFormatted: formatted,
        };
      });
      setAttendees(list);
      console.log("Asistentes bjt:", list);
    } catch (error) {
      setGlobalMessage("Error al obtener asistentes.");
      console.log("Error al obtener asistentes.:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCompanies = async () => {
    try {
      setLoading(true);
      const snapshot = await getDocs(collection(db, "events", event.id, "companies"));
      const list = snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      }));
      setCompanies(list);
      console.log("Empresas:", list);
    } catch (error) {
      setGlobalMessage("Error al obtener empresas.");
      console.log("Error al obtener empresas:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCompaniesCount = async () => {
    try {
      const snapshot = await getDocs(collection(db, "events", event.id, "companies"));
      setCompanies(snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      })));
    } catch (error) {
      console.log("Error al obtener conteo de empresas:", error);
    }
  };

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const snapshot = await getDocs(collection(db, "events", event.id, "products"));
      const list = snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      }));
      setProducts(list);
      console.log("Productos:", list);
    } catch (error) {
      setGlobalMessage("Error al obtener productos.");
      console.log("Error al obtener productos:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchProductsCount = async () => {
    try {
      const snapshot = await getDocs(collection(db, "events", event.id, "products"));
      setProducts(snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      })));
    } catch (error) {
      console.log("Error al obtener conteo de productos:", error);
    }
  };

  const fetchMeetings = async () => {
    try {
      const snapshot = await getDocs(collection(db, "events", event.id, "meetings"));
      const list = snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      }));
      setMeetings(list);
      console.log("Reuniones cargadas:", list.length);
    } catch (error) {
      console.log("Error al obtener reuniones:", error);
    }
  };

  // Función para guardar edición inline
  const handleSaveInlineEdit = async (itemId, fieldName, newValue, entityType) => {
    setSavingCell(true);
    try {
      let docRef;
      if (entityType === "users") {
        docRef = doc(db, "users", itemId);
      } else if (entityType === "companies") {
        docRef = doc(db, "events", event.id, "companies", itemId);
      } else if (entityType === "products") {
        docRef = doc(db, "events", event.id, "products", itemId);
      }

      await updateDoc(docRef, { [fieldName]: newValue });
      
      // Actualizar estado local
      if (entityType === "users") {
        setAttendees(prev => prev.map(a => 
          a.id === itemId ? { ...a, [fieldName]: newValue } : a
        ));
      } else if (entityType === "companies") {
        setCompanies(prev => prev.map(c => 
          c.id === itemId ? { ...c, [fieldName]: newValue } : c
        ));
      } else if (entityType === "products") {
        setProducts(prev => prev.map(p => 
          p.id === itemId ? { ...p, [fieldName]: newValue } : p
        ));
      }

      setGlobalMessage("Campo actualizado correctamente.");
      setEditingCell(null);
    } catch (error) {
      setGlobalMessage("Error al actualizar el campo.");
      console.error("Error updating field:", error);
    } finally {
      setSavingCell(false);
    }
  };

  // Componente de celda editable
  const EditableCell = ({ item, field, entityType }) => {
    const value = getValue(item, field.name);
    const isEditing = editingCell?.id === item.id && editingCell?.fieldName === field.name;
    
    // No permitir edición de imágenes inline
    if (field.type === "image" || field.type === "photo") {
      return value ? (
        <Image
          src={value}
          alt={field.label}
          width={60}
          height={60}
          fit="cover"
          radius="md"
        />
      ) : (
        <Text size="sm" c="dimmed">Sin imagen</Text>
      );
    }

    if (isEditing) {
      return (
        <Group gap="xs">
          {field.type === "select" ? (
            <select
              value={editingCell.value}
              onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
              style={{ padding: "4px 8px", borderRadius: "4px", border: "1px solid #ced4da" }}
              autoFocus
            >
              {field.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : field.type === "richtext" ? (
            <textarea
              value={editingCell.value}
              onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
              style={{ 
                padding: "4px 8px", 
                borderRadius: "4px", 
                border: "1px solid #ced4da",
                minWidth: "200px",
                minHeight: "60px"
              }}
              autoFocus
            />
          ) : (
            <input
              type="text"
              value={editingCell.value}
              onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
              style={{ padding: "4px 8px", borderRadius: "4px", border: "1px solid #ced4da", minWidth: "150px" }}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSaveInlineEdit(item.id, field.name, editingCell.value, entityType);
                } else if (e.key === "Escape") {
                  setEditingCell(null);
                }
              }}
            />
          )}
          <Button
            size="xs"
            onClick={() => handleSaveInlineEdit(item.id, field.name, editingCell.value, entityType)}
            loading={savingCell}
            color="green"
          >
            ✓
          </Button>
          <Button
            size="xs"
            variant="subtle"
            onClick={() => setEditingCell(null)}
            disabled={savingCell}
            color="red"
          >
            ✕
          </Button>
        </Group>
      );
    }

    return (
      <div
        onClick={() => setEditingCell({ id: item.id, fieldName: field.name, value: value || "" })}
        style={{ 
          cursor: "pointer", 
          padding: "4px 8px",
          borderRadius: "4px",
          minHeight: "24px",
          transition: "background-color 0.2s"
        }}
        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#f1f3f5"}
        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
        title="Click para editar"
      >
        {field.type === "select" ? (
          field.options?.find((op) => op.value === value)?.label || value || "-"
        ) : field.type === "richtext" ? (
          value ? (
            <Text size="sm" lineClamp={2}>{value}</Text>
          ) : (
            <Text size="sm" c="dimmed">-</Text>
          )
        ) : (
          value || "-"
        )}
      </div>
    );
  };

  const removeAttendee = async (attendeeId) => {
    try {
      await deleteDoc(doc(db, "users", attendeeId));
      setGlobalMessage("Asistente eliminado correctamente.");
      setAttendees((prev) => prev.filter((a) => a.id !== attendeeId));
      setDeleteConfirmModal({ opened: false, attendeeId: null, attendeeName: "", meetingCount: 0, checking: false });
    } catch {
      setGlobalMessage("Error al eliminar el asistente.");
    }
  };

  const removeCompany = async (companyId) => {
    try {
      await deleteDoc(doc(db, "events", event.id, "companies", companyId));
      setGlobalMessage("Empresa eliminada correctamente.");
      setCompanies((prev) => prev.filter((c) => c.id !== companyId));
    } catch (error) {
      setGlobalMessage("Error al eliminar la empresa.");
    }
  };

  const removeProduct = async (productId) => {
    try {
      await deleteDoc(doc(db, "events", event.id, "products", productId));
      setGlobalMessage("Producto eliminado correctamente.");
      setProducts((prev) => prev.filter((p) => p.id !== productId));
    } catch (error) {
      setGlobalMessage("Error al eliminar el producto.");
    }
  };

  const handleDeleteAllAttendees = async () => {
    setDeletingAll(true);
    try {
      const ids = attendees.map((a) => a.id);
      // Gather all active meetings across all users (deduplicated)
      const allMeetingArrays = await Promise.all(ids.map((id) => getActiveMeetingsForUser(id)));
      const meetingMap = new Map();
      allMeetingArrays.flat().forEach((m) => meetingMap.set(m.id, m));
      const uniqueMeetings = [...meetingMap.values()];

      // Build all ops: cancel meetings + delete users
      const allOps = [
        ...uniqueMeetings.map((m) => ({ type: "update", ref: m.ref, data: { status: "cancelled" } })),
        ...ids.map((id) => ({ type: "delete", ref: doc(db, "users", id) })),
      ];

      // Firestore writeBatch limit is 500 ops; chunk to be safe
      const CHUNK = 400;
      for (let i = 0; i < allOps.length; i += CHUNK) {
        const batch = writeBatch(db);
        allOps.slice(i, i + CHUNK).forEach((op) => {
          if (op.type === "update") batch.update(op.ref, op.data);
          else batch.delete(op.ref);
        });
        await batch.commit();
      }

      setGlobalMessage(`Todos los asistentes eliminados. ${uniqueMeetings.length} reunión(es) cancelada(s).`);
      setAttendees([]);
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

  // Plantilla de Excel para actualización (incluye email como identificador)
  const downloadUpdateTemplate = () => {
    // Incluir email como primer campo obligatorio
    const updateFields = [
      { name: "correo", label: "Correo (Identificador)" },
      ...fields.filter(f => f.name !== "correo")
    ];
    
    const wsData = [
      updateFields.map((f) => f.name),
      updateFields.map((f, idx) => idx === 0 ? "usuario@ejemplo.com" : `Ejemplo ${idx}`),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ActualizarAsistentes");
    XLSX.writeFile(wb, "plantilla_actualizacion_asistentes.xlsx");
  };

  // Función para actualizar asistentes desde Excel
  const handleUpdateFromExcel = async (file) => {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const ws = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    
    if (rows.length === 0) {
      setGlobalMessage("El archivo está vacío.");
      return;
    }

    // Verificar que tenga columna de correo
    if (!rows[0].correo && !rows[0].email) {
      setGlobalMessage("El archivo debe contener una columna 'correo' o 'email' para identificar usuarios.");
      return;
    }

    setUpdateColumns(Object.keys(rows[0]));
    setUpdateRows(rows);
    setUpdateWizardOpened(true);
  };

  // Confirmar actualización masiva
  const handleConfirmUpdate = async () => {
    setUpdatingAttendees(true);
    let updated = 0;
    let notFound = 0;
    let errors = 0;

    try {
      for (const row of updateRows) {
        const email = row.correo || row.email;
        if (!email) {
          notFound++;
          continue;
        }

        // Buscar usuario por email
        const userQuery = query(
          collection(db, "users"),
          where("eventId", "==", event.id),
          where("correo", "==", email)
        );
        const userSnapshot = await getDocs(userQuery);

        if (userSnapshot.empty) {
          console.log(`Usuario no encontrado: ${email}`);
          notFound++;
          continue;
        }

        // Preparar datos a actualizar (solo campos con valor)
        const userId = userSnapshot.docs[0].id;
        const updateData = {};
        
        for (const [key, value] of Object.entries(row)) {
          // Saltar el email (identificador) y valores vacíos
          if (key === "correo" || key === "email" || !value || String(value).trim() === "") {
            continue;
          }

          // Detectar si es select y mapear el value
          const fieldConfig = fields.find((f) => f.name === key);
          if (fieldConfig?.type === "select" && value) {
            const option = fieldConfig.options?.find(
              (op) => String(op.label).toLowerCase().trim() === String(value).toLowerCase().trim()
            );
            updateData[key] = option?.value || value;
          } else {
            updateData[key] = value;
          }
        }

        // Solo actualizar si hay campos para actualizar
        if (Object.keys(updateData).length > 0) {
          await updateDoc(doc(db, "users", userId), updateData);
          updated++;
        }
      }

      setGlobalMessage(`Actualización completada: ${updated} actualizados, ${notFound} no encontrados, ${errors} errores.`);
      setUpdateWizardOpened(false);
      fetchAttendees();
    } catch (error) {
      console.error("Error en actualización masiva:", error);
      setGlobalMessage("Error durante la actualización masiva.");
    } finally {
      setUpdatingAttendees(false);
    }
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
    const fieldName = `custom_${label.toLowerCase().replace(/\s/g, "_")}_${Math.floor(Math.random() * 10000)}`;
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
            (op) => String(op.label).toLowerCase().trim() === String(value).toLowerCase().trim()
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
            (op) => String(op.label).toLowerCase().trim() === String(value).toLowerCase().trim()
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
    const allFields = [
      { name: "id", label: "ID" }, 
      ...visibleFields,
      { name: "citasPendientes", label: "Citas Pendientes" },
      { name: "citasAceptadas", label: "Citas Aceptadas" },
      { name: "citasRechazadas", label: "Citas Rechazadas" },
      { name: "citasTotales", label: "Total Citas" },
    ];

    // Calcular conteos de citas por usuario
    const getMeetingCounts = (userId) => {
      const userMeetings = meetings.filter(m => 
        m.participants?.includes(userId)
      );
      
      const pending = userMeetings.filter(m => m.status === "pending").length;
      const accepted = userMeetings.filter(m => m.status === "accepted").length;
      const rejected = userMeetings.filter(m => m.status === "rejected").length;
      const total = userMeetings.length;
      
      return { pending, accepted, rejected, total };
    };

    const wsData = [
      allFields.map((f) => f.label),
      ...attendees.map((a) => {
        const counts = getMeetingCounts(a.id);
        return [
          ...allFields.slice(0, -4).map((f) => getValue(a, f.name)),
          counts.pending,
          counts.accepted,
          counts.rejected,
          counts.total,
        ];
      }),
    ];

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Asistentes");

    XLSX.writeFile(wb, `asistentes_${event?.eventName || event.id}.xlsx`);
  };
  const exportCompradoresToExcel = () => {
    // Puedes ajustar estos campos según tu modelo
    const compradores = attendees.filter((a) => a.tipoAsistente === "comprador");
    if (compradores.length === 0) return setGlobalMessage("No hay compradores.");
    const fieldsComprador = [
      "id",
      "nombre",
      "empresa",
      "necesidad",
      "lastConnectionFormatted",
      // agrega aquí más campos si los tienes configurados
    ];
    const wsData = [
      fieldsComprador, // header
      ...compradores.map((c) => fieldsComprador.map((f) => c[f] || "")),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Compradores");
    XLSX.writeFile(wb, "compradores_evento_final.xlsx");
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
      "necesidad",
      "lastConnectionFormatted",
      // agrega aquí más campos si los tienes configurados
    ];
    const wsData = [
      fieldsVendedor, // header
      ...vendedores.map((v) => fieldsVendedor.map((f) => v[f] || "")),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Vendedores");
    XLSX.writeFile(wb, "vendedores_evento_final.xlsx");
  };

  // Exportar empresas a Excel
  const exportCompaniesToExcel = () => {
    if (companies.length === 0) return setGlobalMessage("No hay empresas.");
    const visibleFields = companyFields.filter((f) => shownCompanyFields.includes(f.name));
    const allFields = [
      { name: "id", label: "ID" }, 
      ...visibleFields,
      { name: "citasPendientes", label: "Citas Pendientes" },
      { name: "citasAceptadas", label: "Citas Aceptadas" },
      { name: "citasRechazadas", label: "Citas Rechazadas" },
      { name: "citasTotales", label: "Total Citas" },
    ];
    
    // Calcular conteos de citas por empresa (suma de todos sus usuarios)
    const getCompanyMeetingCounts = (companyId) => {
      const companyUsers = attendees.filter(a => 
        a.companyId === companyId || a.company_nit === companyId
      );
      const userIds = companyUsers.map(u => u.id);
      
      const companyMeetings = meetings.filter(m => 
        m.participants?.some(p => userIds.includes(p))
      );
      
      const pending = companyMeetings.filter(m => m.status === "pending").length;
      const accepted = companyMeetings.filter(m => m.status === "accepted").length;
      const rejected = companyMeetings.filter(m => m.status === "rejected").length;
      const total = companyMeetings.length;
      
      return { pending, accepted, rejected, total };
    };
    
    const wsData = [
      allFields.map((f) => f.label),
      ...companies.map((c) => {
        const counts = getCompanyMeetingCounts(c.id);
        return [
          ...allFields.slice(0, -4).map((f) => getValue(c, f.name)),
          counts.pending,
          counts.accepted,
          counts.rejected,
          counts.total,
        ];
      }),
    ];
    
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Empresas");
    XLSX.writeFile(wb, `empresas_${event?.eventName || event.id}.xlsx`);
  };

  // Exportar productos a Excel
  const exportProductsToExcel = () => {
    if (products.length === 0) return setGlobalMessage("No hay productos.");
    const visibleFields = productFields.filter((f) => shownProductFields.includes(f.name));
    const allFields = [
      { name: "id", label: "ID" }, 
      ...visibleFields,
      { name: "citasPendientes", label: "Citas Pendientes" },
      { name: "citasAceptadas", label: "Citas Aceptadas" },
      { name: "citasRechazadas", label: "Citas Rechazadas" },
      { name: "citasTotales", label: "Total Citas" },
    ];
    
    // Calcular conteos de citas relacionadas con el producto
    const getProductMeetingCounts = (productId) => {
      const productMeetings = meetings.filter(m => 
        m.productId === productId
      );
      
      const pending = productMeetings.filter(m => m.status === "pending").length;
      const accepted = productMeetings.filter(m => m.status === "accepted").length;
      const rejected = productMeetings.filter(m => m.status === "rejected").length;
      const total = productMeetings.length;
      
      return { pending, accepted, rejected, total };
    };
    
    const wsData = [
      allFields.map((f) => f.label),
      ...products.map((p) => {
        const counts = getProductMeetingCounts(p.id);
        return [
          ...allFields.slice(0, -4).map((f) => getValue(p, f.name)),
          counts.pending,
          counts.accepted,
          counts.rejected,
          counts.total,
        ];
      }),
    ];
    
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Productos");
    XLSX.writeFile(wb, `productos_${event?.eventName || event.id}.xlsx`);
  };

  return (
    <Card shadow="sm" p="lg" withBorder mt="md">
      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List mb="md">
          <Tabs.Tab value="asistentes">
            Asistentes ({attendees.length})
          </Tabs.Tab>
          <Tabs.Tab value="empresas">
            Empresas ({companies.length})
          </Tabs.Tab>
          <Tabs.Tab value="productos">
            Productos ({products.length})
          </Tabs.Tab>
        </Tabs.List>

        {/* TAB ASISTENTES */}
        <Tabs.Panel value="asistentes">
          <Group position="apart" mb="md">
            <Title order={5}>Asistentes del evento</Title>
            <Group>
              <Button variant="outline" onClick={downloadAttendeesTemplate}>
                Descargar Plantilla Excel
              </Button>
              <Button variant="outline" color="cyan" onClick={downloadUpdateTemplate}>
                Plantilla Actualización
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
              <Button component="label" variant="outline" color="orange">
                Actualizar desde Excel
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    if (e.target.files[0]) {
                      await handleUpdateFromExcel(e.target.files[0]);
                    }
                  }}
                />
              </Button>
              <Button onClick={handleExportCurrentToExcel}>Exportar todos a Excel</Button>
              <Button variant="outline" color="indigo" onClick={exportCompradoresToExcel}>
                Exportar compradores
              </Button>
              <Button variant="outline" color="orange" onClick={exportVendedoresToExcel}>
                Exportar vendedores
              </Button>
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
                            <EditableCell item={a} field={f} entityType="users" />
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
                            if (window.confirm("¿Estás seguro que deseas eliminar este asistente?")) {
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
        </Tabs.Panel>

        {/* TAB EMPRESAS */}
        <Tabs.Panel value="empresas">
          <Group position="apart" mb="md">
            <Title order={5}>Empresas del evento</Title>
            <Group>
              <Button onClick={exportCompaniesToExcel}>Exportar a Excel</Button>
              <MultiSelect
                data={companyFields.map((f) => ({
                  value: f.name,
                  label: f.label,
                }))}
                value={shownCompanyFields}
                onChange={setShownCompanyFields}
                clearable={false}
                searchable
                placeholder="Columnas a mostrar"
                style={{ minWidth: 220 }}
                nothingFound="Sin campos"
              />
            </Group>
          </Group>

          {loading ? (
            <Loader />
          ) : companies.length === 0 ? (
            <Text>No hay empresas registradas para este evento.</Text>
          ) : (
            <Table.ScrollContainer>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    {companyFields
                      .filter((f) => shownCompanyFields.includes(f.name))
                      .map((f) => (
                        <Table.Th key={f.name}>{f.label}</Table.Th>
                      ))}
                    <Table.Th>Acciones</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {companies.map((c) => (
                    <Table.Tr key={c.id}>
                      {companyFields
                        .filter((f) => shownCompanyFields.includes(f.name))
                        .map((f) => (
                          <Table.Td key={f.name}>
                            <EditableCell item={c} field={f} entityType="companies" />
                          </Table.Td>
                        ))}
                      <Table.Td>
                        <Button
                          size="xs"
                          variant="outline"
                          color="blue"
                          onClick={() => {
                            setCompanyToEdit(c);
                            setEditCompanyModalOpen(true);
                          }}
                          style={{ marginRight: 8 }}
                        >
                          Editar
                        </Button>
                        <Button
                          color="red"
                          size="xs"
                          onClick={() => {
                            if (window.confirm("¿Estás seguro que deseas eliminar esta empresa?")) {
                              removeCompany(c.id);
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
        </Tabs.Panel>

        {/* TAB PRODUCTOS */}
        <Tabs.Panel value="productos">
          <Group position="apart" mb="md">
            <Title order={5}>Productos del evento</Title>
            <Group>
              <Button onClick={exportProductsToExcel}>Exportar a Excel</Button>
              <MultiSelect
                data={productFields.map((f) => ({
                  value: f.name,
                  label: f.label,
                }))}
                value={shownProductFields}
                onChange={setShownProductFields}
                clearable={false}
                searchable
                placeholder="Columnas a mostrar"
                style={{ minWidth: 220 }}
                nothingFound="Sin campos"
              />
            </Group>
          </Group>

          {loading ? (
            <Loader />
          ) : products.length === 0 ? (
            <Text>No hay productos registrados para este evento.</Text>
          ) : (
            <Table.ScrollContainer>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    {productFields
                      .filter((f) => shownProductFields.includes(f.name))
                      .map((f) => (
                        <Table.Th key={f.name}>{f.label}</Table.Th>
                      ))}
                    <Table.Th>Acciones</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {products.map((p) => (
                    <Table.Tr key={p.id}>
                      {productFields
                        .filter((f) => shownProductFields.includes(f.name))
                        .map((f) => (
                          <Table.Td key={f.name}>
                            <EditableCell item={p} field={f} entityType="products" />
                          </Table.Td>
                        ))}
                      <Table.Td>
                        <Button
                          size="xs"
                          variant="outline"
                          color="blue"
                          onClick={() => {
                            setProductToEdit(p);
                            setEditProductModalOpen(true);
                          }}
                          style={{ marginRight: 8 }}
                        >
                          Editar
                        </Button>
                        <Button
                          color="red"
                          size="xs"
                          onClick={() => {
                            if (window.confirm("¿Estás seguro que deseas eliminar este producto?")) {
                              removeProduct(p.id);
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
        </Tabs.Panel>
      </Tabs>

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

      <ModalEditAttendee
        opened={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        attendee={attendeeToEdit}
        fields={fields}
        onSave={async (updated) => {
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

      <ModalEditAttendee
        opened={editCompanyModalOpen}
        onClose={() => setEditCompanyModalOpen(false)}
        attendee={companyToEdit}
        fields={companyFields}
        onSave={async (updated) => {
          const id = updated.id;
          const { id: _id, ...toSave } = updated;
          try {
            await updateDoc(doc(db, "events", event.id, "companies", id), toSave);
            setGlobalMessage("Empresa actualizada correctamente.");
            fetchCompanies();
          } catch (err) {
            setGlobalMessage("Error al actualizar la empresa.");
          }
        }}
      />

      <ModalEditAttendee
        opened={editProductModalOpen}
        onClose={() => setEditProductModalOpen(false)}
        attendee={productToEdit}
        fields={productFields}
        onSave={async (updated) => {
          const id = updated.id;
          const { id: _id, ...toSave } = updated;
          try {
            await updateDoc(doc(db, "events", event.id, "products", id), toSave);
            setGlobalMessage("Producto actualizado correctamente.");
            fetchProducts();
          } catch (err) {
            setGlobalMessage("Error al actualizar el producto.");
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
          ¿Estás seguro que deseas eliminar <b>todos los asistentes</b> del evento? Esta acción es irreversible.
        </Text>
        <Group mt="md" position="apart">
          <Button variant="default" onClick={() => setDeleteAllModal(false)} disabled={deletingAll}>
            Cancelar
          </Button>
          <Button color="red" onClick={handleDeleteAllAttendees} loading={deletingAll}>
            Eliminar todos
          </Button>
        </Group>
      </Modal>

      {/* Modal de confirmación de actualización masiva */}
      <Modal
        opened={updateWizardOpened}
        onClose={() => !updatingAttendees && setUpdateWizardOpened(false)}
        title="Actualizar asistentes desde Excel"
        size="lg"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Se encontraron <b>{updateRows.length}</b> filas en el archivo Excel.
          </Text>
          <Text size="sm" c="dimmed">
            Los asistentes se identificarán por su correo electrónico. Solo se actualizarán los campos que tengan valores en el Excel.
          </Text>
          
          {updateRows.length > 0 && (
            <div style={{ maxHeight: "300px", overflowY: "auto" }}>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    {updateColumns.slice(0, 5).map((col) => (
                      <Table.Th key={col}>{col}</Table.Th>
                    ))}
                    {updateColumns.length > 5 && <Table.Th>...</Table.Th>}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {updateRows.slice(0, 5).map((row, idx) => (
                    <Table.Tr key={idx}>
                      {updateColumns.slice(0, 5).map((col) => (
                        <Table.Td key={col}>
                          <Text size="xs" lineClamp={1}>
                            {row[col] || "-"}
                          </Text>
                        </Table.Td>
                      ))}
                      {updateColumns.length > 5 && <Table.Td>...</Table.Td>}
                    </Table.Tr>
                  ))}
                  {updateRows.length > 5 && (
                    <Table.Tr>
                      <Table.Td colSpan={updateColumns.length > 5 ? 6 : updateColumns.length}>
                        <Text size="xs" c="dimmed" ta="center">
                          ... y {updateRows.length - 5} filas más
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </div>
          )}

          <Group mt="md" position="apart">
            <Button 
              variant="default" 
              onClick={() => setUpdateWizardOpened(false)} 
              disabled={updatingAttendees}
            >
              Cancelar
            </Button>
            <Button 
              color="orange" 
              onClick={handleConfirmUpdate} 
              loading={updatingAttendees}
            >
              Actualizar {updateRows.length} asistentes
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
};

AttendeesList.propTypes = {
  event: PropTypes.object.isRequired,
  setGlobalMessage: PropTypes.func.isRequired,
};

export default AttendeesList;

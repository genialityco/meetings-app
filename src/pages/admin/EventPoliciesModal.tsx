import { useState, useEffect } from "react";
import {
  Modal,
  Stack,
  Select,
  Switch,
  Button,
  Group,
  Divider,
  Text,
  Paper,
  Loader,
} from "@mantine/core";
import { doc, setDoc, collection, getDocs } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { DEFAULT_POLICIES } from "../dashboard/types";
import type { EventPolicies, Company } from "../dashboard/types";

interface Props {
  opened: boolean;
  onClose: () => void;
  event: any;
  refreshEvents: () => void;
  setGlobalMessage: (msg: string) => void;
}

export default function EventPoliciesModal({
  opened,
  onClose,
  event,
  refreshEvents,
  setGlobalMessage,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [roleMode, setRoleMode] = useState<EventPolicies["roleMode"]>("open");
  const [tableMode, setTableMode] = useState<EventPolicies["tableMode"]>("pool");
  const [discoveryMode, setDiscoveryMode] = useState<EventPolicies["discoveryMode"]>("all");
  const [schedulingMode, setSchedulingMode] = useState<EventPolicies["schedulingMode"]>("manual");
  const [uiViews, setUiViews] = useState(DEFAULT_POLICIES.uiViewsEnabled);

  // Empresas y asignación de mesas fijas
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [tableAssignments, setTableAssignments] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (!event?.config?.policies) return;
    const p = event.config.policies;
    setRoleMode(p.roleMode ?? "open");
    setTableMode(p.tableMode ?? "pool");
    setDiscoveryMode(p.discoveryMode ?? "all");
    setSchedulingMode(p.schedulingMode ?? "manual");
    setUiViews(p.uiViewsEnabled ?? DEFAULT_POLICIES.uiViewsEnabled);
  }, [event]);

  // Cargar empresas cuando se abre el modal y tableMode es "fixed"
  useEffect(() => {
    if (!opened || !event?.id) return;
    const load = async () => {
      setCompaniesLoading(true);
      try {
        const snap = await getDocs(collection(db, "events", event.id, "companies"));
        const list = snap.docs.map((d) => ({
          nitNorm: d.id,
          ...d.data(),
        })) as Company[];
        setCompanies(list);
        const assignments: Record<string, string | null> = {};
        list.forEach((c) => {
          assignments[c.nitNorm] = c.fixedTable || null;
        });
        setTableAssignments(assignments);
      } catch (e) {
        console.error(e);
      } finally {
        setCompaniesLoading(false);
      }
    };
    load();
  }, [opened, event?.id]);

  // Opciones de mesas
  const tableOptions = (() => {
    const numTables = event?.config?.numTables || 0;
    const tableNames = event?.config?.tableNames || [];
    const opts = [];
    for (let i = 1; i <= numTables; i++) {
      const label = tableNames[i - 1] || `Mesa ${i}`;
      opts.push({ value: String(i), label });
    }
    return opts;
  })();

  const handleSave = async () => {
    if (!event?.id) return;
    setSaving(true);
    try {
      // Guardar políticas en evento
      await setDoc(
        doc(db, "events", event.id),
        {
          config: {
            policies: {
              roleMode,
              tableMode,
              discoveryMode,
              schedulingMode,
              uiViewsEnabled: uiViews,
            },
          },
        },
        { merge: true }
      );

      // Si tableMode es "fixed", guardar asignaciones de mesa en cada empresa
      if (tableMode === "fixed") {
        for (const [nitNorm, fixedTable] of Object.entries(tableAssignments)) {
          await setDoc(
            doc(db, "events", event.id, "companies", nitNorm),
            { fixedTable: fixedTable || null },
            { merge: true }
          );
        }
      }

      setGlobalMessage("Políticas actualizadas correctamente.");
      refreshEvents();
      onClose();
    } catch (error) {
      console.error(error);
      setGlobalMessage("Error al actualizar políticas.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Configurar políticas del evento"
      size="lg"
    >
      <Stack>
        <Select
          label="Modo de roles"
          description="Define quién puede reunirse con quién"
          data={[
            { value: "open", label: "Abierto (todos pueden reunirse)" },
            { value: "buyer_seller", label: "Comprador / Vendedor" },
          ]}
          value={roleMode}
          onChange={(v) => setRoleMode((v as EventPolicies["roleMode"]) ?? "open")}
        />

        <Select
          label="Modo de mesas"
          description="Cómo se asignan las mesas al confirmar reuniones"
          data={[
            { value: "pool", label: "Pool (asignación automática de mesa libre)" },
            { value: "fixed", label: "Fija (empresa asignada a una mesa)" },
          ]}
          value={tableMode}
          onChange={(v) => setTableMode((v as EventPolicies["tableMode"]) ?? "pool")}
        />

        {/* Asignación de mesas fijas por empresa */}
        {tableMode === "fixed" && (
          <Paper p="md" withBorder>
            <Text fw={600} mb="sm">
              Asignación de mesas fijas por empresa
            </Text>
            {companiesLoading ? (
              <Loader size="sm" />
            ) : companies.length > 0 ? (
              <Stack gap="xs">
                {companies.map((company) => (
                  <Group key={company.nitNorm} justify="space-between">
                    <Text size="sm" style={{ minWidth: 180 }}>
                      {company.razonSocial || company.nitNorm}
                    </Text>
                    <Select
                      data={tableOptions}
                      value={tableAssignments[company.nitNorm] || null}
                      onChange={(val) =>
                        setTableAssignments((prev) => ({
                          ...prev,
                          [company.nitNorm]: val,
                        }))
                      }
                      placeholder="Sin mesa asignada"
                      clearable
                      size="xs"
                      style={{ minWidth: 150 }}
                    />
                  </Group>
                ))}
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">
                No hay empresas registradas en este evento.
              </Text>
            )}
          </Paper>
        )}

        <Select
          label="Visibilidad del directorio"
          description="Qué asistentes pueden ver otros asistentes"
          data={[
            { value: "all", label: "Todos ven a todos" },
            { value: "by_role", label: "Solo roles opuestos (compradores ven vendedores y viceversa)" },
          ]}
          value={discoveryMode}
          onChange={(v) => setDiscoveryMode((v as EventPolicies["discoveryMode"]) ?? "all")}
        />

        <Select
          label="Modo de agendamiento"
          description="Cómo se asignan los horarios"
          data={[
            { value: "manual", label: "Manual (selección de slot al aceptar)" },
            { value: "auto", label: "Automático (primer slot libre)" },
          ]}
          value={schedulingMode}
          onChange={(v) => setSchedulingMode((v as EventPolicies["schedulingMode"]) ?? "manual")}
        />

        <Divider label="Vistas habilitadas en el dashboard" labelPosition="left" />
        <Text size="sm" c="dimmed">
          Controla qué pestañas de exploración ven los asistentes en su dashboard.
        </Text>

        <Switch
          label="Vista de asistentes (directorio)"
          checked={uiViews.attendees}
          onChange={(e) =>
            setUiViews((prev) => ({ ...prev, attendees: e.currentTarget.checked }))
          }
        />
        <Switch
          label="Vista de empresas"
          checked={uiViews.companies}
          onChange={(e) =>
            setUiViews((prev) => ({ ...prev, companies: e.currentTarget.checked }))
          }
        />
        <Switch
          label="Vista de productos"
          checked={uiViews.products}
          onChange={(e) =>
            setUiViews((prev) => ({ ...prev, products: e.currentTarget.checked }))
          }
        />

        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={saving} onClick={handleSave}>
            Guardar políticas
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

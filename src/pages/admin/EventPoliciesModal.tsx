import { useState, useEffect, useMemo, type ReactNode } from "react";
import {
  Modal,
  Stack,
  Select,
  MultiSelect,
  Switch,
  Button,
  Group,
  Text,
  Paper,
  Loader,
  ActionIcon,
  NumberInput,
  TextInput,
  CopyButton,
  Tooltip,
  Accordion,
  Badge,
  ThemeIcon,
  SimpleGrid,
  SegmentedControl,
} from "@mantine/core";
import {
  IconArrowUp,
  IconArrowDown,
  IconCopy,
  IconCheck,
  IconUsersGroup,
  IconCalendarEvent,
  IconLayoutDashboard,
  IconBell,
  IconGift,
  IconClipboardCheck,
  IconQrcode,
  IconDeviceFloppy,
} from "@tabler/icons-react";
import { doc, setDoc, collection, getDocs, query, where, writeBatch } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { DEFAULT_POLICIES } from "../dashboard/types";
import type { EventPolicies, Company } from "../dashboard/types";
import { normalizeTipoAsistente, DEFAULT_ROLE_URL_PARAM_NAME } from "../../utils/attendeeRole";
import PendingRemindersSettings, { type PendingRemindersConfig } from "./PendingRemindersSettings";

const readPendingReminders = (p: Partial<EventPolicies> = {}): PendingRemindersConfig => ({
  pendingRemindersEnabled: p.pendingRemindersEnabled ?? false,
  pendingRemindersEveryHours: p.pendingRemindersEveryHours ?? DEFAULT_POLICIES.pendingRemindersEveryHours!,
  pendingRemindersMinAgeHours: p.pendingRemindersMinAgeHours ?? DEFAULT_POLICIES.pendingRemindersMinAgeHours!,
  pendingRemindersStartHour: p.pendingRemindersStartHour ?? DEFAULT_POLICIES.pendingRemindersStartHour!,
  pendingRemindersEndHour: p.pendingRemindersEndHour ?? DEFAULT_POLICIES.pendingRemindersEndHour!,
  pendingRemindersWhatsapp: p.pendingRemindersWhatsapp ?? true,
  pendingRemindersTemplate: p.pendingRemindersTemplate ?? null,
  pendingRemindersEmail: p.pendingRemindersEmail ?? true,
});

/** Etiquetas legibles de cada vista del dashboard (para configurar su orden) */
const VIEW_LABELS: Record<string, string> = {
  chatbot: "Chatbot",
  matches: "Matches",
  attendees: "Asistentes",
  companies: "Empresas",
  products: "Productos",
  activity: "Mis reuniones",
  survey: "Encuesta",
};
const ALL_VIEW_KEYS = ["chatbot", "matches", "attendees", "companies", "products", "activity", "survey"];

/** Encabezado de cada sección del acordeón: ícono, título, descripción corta y resumen */
function SectionHeader({
  icon,
  color,
  title,
  description,
  badges = [],
}: {
  icon: ReactNode;
  color: string;
  title: string;
  description: string;
  badges?: { label: string; color?: string }[];
}) {
  return (
    <Group wrap="nowrap" gap="sm">
      <ThemeIcon variant="light" color={color} size={38} radius="md">
        {icon}
      </ThemeIcon>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600}>{title}</Text>
        <Text size="xs" c="dimmed">
          {description}
        </Text>
      </div>
      <Group gap={4} justify="flex-end" visibleFrom="sm" style={{ maxWidth: "45%" }}>
        {badges.map((b) => (
          <Badge key={b.label} size="sm" variant="light" color={b.color || "gray"}>
            {b.label}
          </Badge>
        ))}
      </Group>
    </Group>
  );
}

/** Tarjeta que agrupa controles relacionados dentro de una sección */
function SettingsCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Paper withBorder radius="md" p="md">
      {title && (
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb="sm">
          {title}
        </Text>
      )}
      <Stack gap="md">{children}</Stack>
    </Paper>
  );
}

interface Props {
  opened: boolean;
  onClose: () => void;
  event: any;
  refreshEvents: () => void;
  setGlobalMessage: (msg: string) => void;
  inline?: boolean;
}

export default function EventPoliciesModal({
  opened,
  onClose,
  event,
  refreshEvents,
  setGlobalMessage,
  inline = false,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [roleMode, setRoleMode] = useState<EventPolicies["roleMode"]>("open");
  const [tableMode, setTableMode] = useState<EventPolicies["tableMode"]>("pool");
  const [discoveryMode, setDiscoveryMode] = useState<EventPolicies["discoveryMode"]>("all");
  const [schedulingMode, setSchedulingMode] = useState<EventPolicies["schedulingMode"]>("manual");
  const [sellerRedirectToProducts, setSellerRedirectToProducts] = useState(false);
  const [forceBuyerRoleOnRegistration, setForceBuyerRoleOnRegistration] = useState(false);
  const [forceSellerRoleOnRegistration, setForceSellerRoleOnRegistration] = useState(false);
  const [roleUrlParamEnabled, setRoleUrlParamEnabled] = useState(false);
  const [roleUrlParamName, setRoleUrlParamName] = useState(DEFAULT_ROLE_URL_PARAM_NAME);
  const [roleUrlParamComprador, setRoleUrlParamComprador] = useState("comprador");
  const [roleUrlParamVendedor, setRoleUrlParamVendedor] = useState("vendedor");
  const [uiViews, setUiViews] = useState(DEFAULT_POLICIES.uiViewsEnabled);
  const [viewsOrder, setViewsOrder] = useState<string[]>(DEFAULT_POLICIES.viewsOrder ?? ALL_VIEW_KEYS);
  const [attendeeCardFields, setAttendeeCardFields] = useState<string[]>(
    DEFAULT_POLICIES.cardFieldsConfig!.attendeeCard
  );
  const [companyCardFields, setCompanyCardFields] = useState<string[]>(
    DEFAULT_POLICIES.cardFieldsConfig!.companyCard
  );
  const [whatsappApiVersion, setWhatsappApiVersion] = useState<"v1" | "v2">("v1");
  const [autoReassignOnCancel, setAutoReassignOnCancel] = useState(false);
  const [surveyBlockedFor, setSurveyBlockedFor] = useState<EventPolicies["surveyBlockedFor"]>("none");
  const [surveyMode, setSurveyMode] = useState<EventPolicies["surveyMode"]>("default");
  const [cancelMeetingDisabled, setCancelMeetingDisabled] = useState(false);
  const [standbyCheckInRequired, setStandbyCheckInRequired] = useState(false);
  const [attendeeIdEnabled, setAttendeeIdEnabled] = useState(false);
  const [whatsappNotificationsEnabled, setWhatsappNotificationsEnabled] = useState(true);
  const [fallbackEmailOnWaFailure, setFallbackEmailOnWaFailure] = useState(false);
  const [dashboardNotificationsEnabled, setDashboardNotificationsEnabled] = useState(true);
  const [welcomeMessageEnabled, setWelcomeMessageEnabled] = useState(false);
  const [groupByRazonSocial, setGroupByRazonSocial] = useState(false);
  const [allowProductImageUpload, setAllowProductImageUpload] = useState(true);
  const [maxMeetingsPerContact, setMaxMeetingsPerContact] = useState<number | "">("");
  const [maxMeetingsCompradorPerRole, setMaxMeetingsCompradorPerRole] = useState<number | "">("");
  const [maxMeetingsVendedorPerRole, setMaxMeetingsVendedorPerRole] = useState<number | "">("");
  const [maxMeetingsPerRoleScope, setMaxMeetingsPerRoleScope] = useState<EventPolicies["maxMeetingsPerRoleScope"]>("total");
  const [raffleEnabled, setRaffleEnabled] = useState(false);
  const [raffleShowPointsToAttendee, setRaffleShowPointsToAttendee] = useState(false);
  const [standVisitsEnabled, setStandVisitsEnabled] = useState(false);
  const [standVisitAllowSellerScan, setStandVisitAllowSellerScan] = useState(false);
  const [qrOnlyModeEnabled, setQrOnlyModeEnabled] = useState(false);
  const [advisorNoticeTemplateName, setAdvisorNoticeTemplateName] = useState("");
  const [advisorNoticeTemplateLanguage, setAdvisorNoticeTemplateLanguage] = useState("es");
  const [pendingReminders, setPendingReminders] = useState<PendingRemindersConfig>(readPendingReminders());
  // Evento cuyas políticas ya se volcaron al estado (para detectar cambios sin guardar)
  const [loadedEvent, setLoadedEvent] = useState<any>(null);

  // Empresas y asignación de mesas fijas
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [tableAssignments, setTableAssignments] = useState<Record<string, string | null>>({});
  const [companyRoles, setCompanyRoles] = useState<Record<string, Set<string>>>({});
  const [tableRoleFilter, setTableRoleFilter] = useState<"all" | "vendedor" | "comprador">("all");
  const [usersByCompany, setUsersByCompany] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!event?.config?.policies) {
      setLoadedEvent(event ?? null);
      return;
    }
    const p = event.config.policies;
    setRoleMode(p.roleMode ?? "open");
    setTableMode(p.tableMode ?? "pool");
    setDiscoveryMode(p.discoveryMode ?? "all");
    setSchedulingMode(p.schedulingMode ?? "manual");
    setSellerRedirectToProducts(p.sellerRedirectToProducts ?? false);
    setForceBuyerRoleOnRegistration(p.forceBuyerRoleOnRegistration ?? false);
    // Si por datos antiguos vinieran ambas, prevalece comprador (igual que en el registro)
    setForceSellerRoleOnRegistration(
      !p.forceBuyerRoleOnRegistration && (p.forceSellerRoleOnRegistration ?? false)
    );
    setRoleUrlParamEnabled(p.roleUrlParamEnabled ?? false);
    setRoleUrlParamName(p.roleUrlParamName || DEFAULT_ROLE_URL_PARAM_NAME);
    setRoleUrlParamComprador(p.roleUrlParamValues?.comprador || "comprador");
    setRoleUrlParamVendedor(p.roleUrlParamValues?.vendedor || "vendedor");
    setUiViews(p.uiViewsEnabled ?? DEFAULT_POLICIES.uiViewsEnabled);
    // Normalizar: respetar el orden guardado y anexar vistas nuevas al final
    const savedOrder: string[] = p.viewsOrder ?? DEFAULT_POLICIES.viewsOrder ?? ALL_VIEW_KEYS;
    const normalized = [
      ...savedOrder.filter((k) => ALL_VIEW_KEYS.includes(k)),
      ...ALL_VIEW_KEYS.filter((k) => !savedOrder.includes(k)),
    ];
    setViewsOrder(normalized);
    setAttendeeCardFields(
      p.cardFieldsConfig?.attendeeCard ?? DEFAULT_POLICIES.cardFieldsConfig!.attendeeCard
    );
    setCompanyCardFields(
      p.cardFieldsConfig?.companyCard ?? DEFAULT_POLICIES.cardFieldsConfig!.companyCard
    );
    setWhatsappApiVersion(p.whatsappApiVersion ?? "v1");
    setAutoReassignOnCancel(p.autoReassignOnCancel ?? false);
    setSurveyBlockedFor(p.surveyBlockedFor ?? "none");
    setSurveyMode(p.surveyMode ?? "default");
    setCancelMeetingDisabled(p.cancelMeetingDisabled ?? false);
    setStandbyCheckInRequired(p.standbyCheckInRequired ?? false);
    setAttendeeIdEnabled(p.attendeeIdEnabled ?? false);
    setWhatsappNotificationsEnabled(p.whatsappNotificationsEnabled ?? true);
    setFallbackEmailOnWaFailure(p.fallbackEmailOnWaFailure ?? false);
    setDashboardNotificationsEnabled(p.dashboardNotificationsEnabled ?? true);
    setWelcomeMessageEnabled(p.welcomeMessageEnabled ?? false);
    setGroupByRazonSocial(p.groupByRazonSocial ?? false);
    setAllowProductImageUpload(p.allowProductImageUpload ?? true);
    setMaxMeetingsPerContact(p.maxMeetingsPerContact ? p.maxMeetingsPerContact : "");
    setMaxMeetingsCompradorPerRole(p.maxMeetingsPerRole?.comprador ? p.maxMeetingsPerRole.comprador : "");
    setMaxMeetingsVendedorPerRole(p.maxMeetingsPerRole?.vendedor ? p.maxMeetingsPerRole.vendedor : "");
    setMaxMeetingsPerRoleScope(p.maxMeetingsPerRoleScope ?? "total");
    setRaffleEnabled(p.raffleEnabled ?? false);
    setRaffleShowPointsToAttendee(p.raffleShowPointsToAttendee ?? false);
    setStandVisitsEnabled(p.standVisitsEnabled ?? false);
    setStandVisitAllowSellerScan(p.standVisitAllowSellerScan ?? false);
    setQrOnlyModeEnabled(p.qrOnlyModeEnabled ?? false);
    setAdvisorNoticeTemplateName(p.advisorNoticeTemplate?.name ?? "");
    setAdvisorNoticeTemplateLanguage(p.advisorNoticeTemplate?.language || "es");
    setPendingReminders(readPendingReminders(p));
    setLoadedEvent(event);
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

        // Cargar asistentes del evento para poder filtrar empresas por rol (vendedor/comprador)
        const usersSnap = await getDocs(
          query(collection(db, "users"), where("eventId", "==", event.id))
        );
        const roles: Record<string, Set<string>> = {};
        const usersByNit: Record<string, string[]> = {};
        usersSnap.docs.forEach((d) => {
          const u = d.data() as any;
          const nit = u.companyId;
          if (!nit) return;
          if (!usersByNit[nit]) usersByNit[nit] = [];
          usersByNit[nit].push(d.id);
          const tipo = normalizeTipoAsistente(u.tipoAsistente);
          if (!tipo) return;
          if (!roles[nit]) roles[nit] = new Set();
          roles[nit].add(tipo);
        });
        setCompanyRoles(roles);
        setUsersByCompany(usersByNit);
      } catch (e) {
        console.error(e);
      } finally {
        setCompaniesLoading(false);
      }
    };
    load();
  }, [opened, event?.id]);

  // Campos disponibles para configurar tarjetas (derivados del formulario del evento)
  const availableFieldsForCards = useMemo(() => {
    const fields = event?.config?.formFields || [];
    return fields
      .filter((f: any) => f.name !== "photoURL" && f.name !== "company_logo" && f.name !== "aceptaTratamiento")
      .map((f: any) => ({ value: f.name, label: f.label || f.name }));
  }, [event?.config?.formFields]);

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

  const moveView = (idx: number, dir: -1 | 1) => {
    setViewsOrder((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  // Enlaces de registro por rol (política roleUrlParamEnabled)
  const buildRoleRegistrationUrl = (value: string) => {
    const param = roleUrlParamName.trim() || DEFAULT_ROLE_URL_PARAM_NAME;
    return `${window.location.origin}/event/${event?.id}?${encodeURIComponent(param)}=${encodeURIComponent(value.trim())}`;
  };
  const roleUrlValuesClash =
    roleUrlParamComprador.trim().toLowerCase() === roleUrlParamVendedor.trim().toLowerCase();

  // Objeto de políticas tal como se guarda; también se usa para detectar cambios sin guardar
  const policiesPayload = {
    roleMode,
    tableMode,
    discoveryMode,
    schedulingMode,
    sellerRedirectToProducts,
    forceBuyerRoleOnRegistration,
    forceSellerRoleOnRegistration,
    roleUrlParamEnabled,
    roleUrlParamName: roleUrlParamName.trim() || DEFAULT_ROLE_URL_PARAM_NAME,
    roleUrlParamValues: {
      comprador: roleUrlParamComprador.trim() || "comprador",
      vendedor: roleUrlParamVendedor.trim() || "vendedor",
    },
    cardFieldsConfig: {
      attendeeCard: attendeeCardFields,
      companyCard: companyCardFields,
    },
    uiViewsEnabled: uiViews,
    viewsOrder,
    whatsappApiVersion,
    autoReassignOnCancel,
    surveyBlockedFor,
    surveyMode,
    cancelMeetingDisabled,
    standbyCheckInRequired,
    attendeeIdEnabled,
    whatsappNotificationsEnabled,
    fallbackEmailOnWaFailure,
    dashboardNotificationsEnabled,
    welcomeMessageEnabled,
    groupByRazonSocial,
    allowProductImageUpload,
    maxMeetingsPerContact: maxMeetingsPerContact === "" ? null : maxMeetingsPerContact,
    maxMeetingsPerRole: {
      comprador: maxMeetingsCompradorPerRole === "" ? null : maxMeetingsCompradorPerRole,
      vendedor: maxMeetingsVendedorPerRole === "" ? null : maxMeetingsVendedorPerRole,
    },
    maxMeetingsPerRoleScope,
    raffleEnabled,
    raffleShowPointsToAttendee,
    standVisitsEnabled,
    standVisitAllowSellerScan,
    qrOnlyModeEnabled,
    advisorNoticeTemplate: advisorNoticeTemplateName.trim()
      ? {
          name: advisorNoticeTemplateName.trim(),
          language: advisorNoticeTemplateLanguage.trim() || "es",
        }
      : null,
    ...pendingReminders,
  };
  const payloadJson = JSON.stringify(policiesPayload);
  const assignmentsJson = JSON.stringify(tableAssignments);

  // Línea base = lo último guardado. Se toma en el render siguiente a cargar las
  // políticas del evento (loadedEvent), cuando el estado ya refleja lo guardado.
  const [baseline, setBaseline] = useState<{ event: any; json: string } | null>(null);
  const [assignmentsBaseline, setAssignmentsBaseline] = useState<string | null>(null);
  useEffect(() => {
    if (loadedEvent && baseline?.event !== loadedEvent) setBaseline({ event: loadedEvent, json: payloadJson });
  }, [loadedEvent, baseline, payloadJson]);
  useEffect(() => {
    if (!companiesLoading) setAssignmentsBaseline(assignmentsJson);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companiesLoading]);
  const isDirty =
    (baseline?.event === loadedEvent && baseline?.json !== payloadJson) ||
    (tableMode === "fixed" && assignmentsBaseline !== null && assignmentsBaseline !== assignmentsJson);

  const handleSave = async (): Promise<boolean> => {
    if (!event?.id) return false;
    if (roleUrlParamEnabled && roleUrlValuesClash) {
      setGlobalMessage("Los valores del parámetro de URL para comprador y vendedor deben ser distintos.");
      return false;
    }
    if (
      pendingReminders.pendingRemindersEnabled &&
      pendingReminders.pendingRemindersEndHour <= pendingReminders.pendingRemindersStartHour
    ) {
      setGlobalMessage("Recordatorios: la hora final debe ser mayor que la hora de inicio.");
      return false;
    }
    setSaving(true);
    try {
      // Guardar políticas en evento
      await setDoc(doc(db, "events", event.id), { config: { policies: policiesPayload } }, { merge: true });

      // Si tableMode es "fixed", guardar asignaciones de mesa en cada empresa
      // y también en cada asistente de esa empresa (para que quede disponible
      // sin tener que resolverlo a través de la empresa en cada lugar que lo usa)
      if (tableMode === "fixed") {
        let batch = writeBatch(db);
        let batchCount = 0;
        const commitIfNeeded = async () => {
          if (batchCount >= 450) {
            await batch.commit();
            batch = writeBatch(db);
            batchCount = 0;
          }
        };

        for (const [nitNorm, fixedTable] of Object.entries(tableAssignments)) {
          const companyRef = doc(db, "events", event.id, "companies", nitNorm);
          batch.set(companyRef, { fixedTable: fixedTable || null }, { merge: true });
          batchCount++;
          await commitIfNeeded();

          for (const uid of usersByCompany[nitNorm] || []) {
            const userRef = doc(db, "users", uid);
            batch.set(userRef, { fixedTable: fixedTable || null }, { merge: true });
            batchCount++;
            await commitIfNeeded();
          }
        }

        if (batchCount > 0) {
          await batch.commit();
        }
      }

      setBaseline({ event: loadedEvent, json: payloadJson });
      setAssignmentsBaseline(assignmentsJson);
      setGlobalMessage("Políticas actualizadas correctamente.");
      refreshEvents();
      if (!inline) onClose();
      return true;
    } catch (error) {
      console.error(error);
      setGlobalMessage("Error al actualizar políticas.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const enabledViewsCount = Object.values(uiViews || {}).filter(Boolean).length;
  const isBuyerSeller = roleMode === "buyer_seller";

  const content = (
    <Stack gap="md" pb={inline ? 0 : "md"}>
      <Paper
        withBorder
        radius="md"
        p="md"
        style={{
          borderColor: qrOnlyModeEnabled ? "var(--mantine-color-orange-5)" : undefined,
          background: qrOnlyModeEnabled ? "var(--mantine-color-orange-0)" : undefined,
        }}
      >
        <Group wrap="nowrap" align="flex-start" gap="sm">
          <ThemeIcon variant="light" color={qrOnlyModeEnabled ? "orange" : "gray"} size={38} radius="md">
            <IconQrcode size={20} />
          </ThemeIcon>
          <Switch
            style={{ flex: 1 }}
            label="Modo 'Solo QR' (evento de asistencia/check-in)"
            description="El dashboard del asistente muestra únicamente su código QR de asistencia, sin reuniones, asistentes, empresas ni productos. Úsalo cuando la app solo sirve para control de acceso."
            checked={qrOnlyModeEnabled}
            onChange={(e) => setQrOnlyModeEnabled(e.currentTarget.checked)}
          />
        </Group>
      </Paper>

      <Accordion
        multiple
        variant="separated"
        radius="md"
        defaultValue={["roles"]}
        chevronPosition="right"
        styles={{ content: { paddingTop: 4 } }}
      >
        {/* ------------------------------------------------ Roles y registro */}
        <Accordion.Item value="roles">
          <Accordion.Control>
            <SectionHeader
              icon={<IconUsersGroup size={20} />}
              color="blue"
              title="Roles y registro"
              description="Quién puede reunirse con quién y cómo se asigna el rol al registrarse"
              badges={[
                { label: isBuyerSeller ? "Comprador / Vendedor" : "Abierto", color: "blue" },
                ...(isBuyerSeller && forceBuyerRoleOnRegistration ? [{ label: "Registro → Comprador" }] : []),
                ...(isBuyerSeller && forceSellerRoleOnRegistration ? [{ label: "Registro → Vendedor" }] : []),
                ...(isBuyerSeller && roleUrlParamEnabled ? [{ label: "Rol por URL" }] : []),
              ]}
            />
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <SettingsCard>
                <div>
                  <Text size="sm" fw={500}>
                    Modo de roles
                  </Text>
                  <Text size="xs" c="dimmed" mb={6}>
                    Define quién puede reunirse con quién
                  </Text>
                  <SegmentedControl
                    fullWidth
                    value={roleMode}
                    onChange={(v) => setRoleMode(v as EventPolicies["roleMode"])}
                    data={[
                      { value: "open", label: "Abierto (todos con todos)" },
                      { value: "buyer_seller", label: "Comprador / Vendedor" },
                    ]}
                  />
                </div>
                {isBuyerSeller && (
                  <Switch
                    label="Redirigir vendedores a 'Mis productos' en su primer ingreso"
                    description="Vendedores inician en 'Mi actividad → Mis productos'. Compradores no ven el tab de productos propios."
                    checked={sellerRedirectToProducts}
                    onChange={(e) => setSellerRedirectToProducts(e.currentTarget.checked)}
                  />
                )}
              </SettingsCard>

              {isBuyerSeller && (
                <SettingsCard title="Rol al registrarse">
                  <Switch
                    label="Forzar todo registro público como 'Comprador'"
                    description="Oculta el selector 'Tipo de asistente' y asigna 'Comprador'. Los vendedores se asignan manualmente desde el listado de asistentes."
                    checked={forceBuyerRoleOnRegistration}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked;
                      setForceBuyerRoleOnRegistration(checked);
                      if (checked) setForceSellerRoleOnRegistration(false);
                    }}
                  />
                  <Switch
                    label="Forzar todo registro público como 'Vendedor'"
                    description="Oculta el selector y asigna 'Vendedor'. Los compradores se asignan manualmente. No se puede combinar con 'Comprador'."
                    checked={forceSellerRoleOnRegistration}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked;
                      setForceSellerRoleOnRegistration(checked);
                      if (checked) setForceBuyerRoleOnRegistration(false);
                    }}
                  />
                  <Switch
                    label="Forzar rol del registro con parámetro en la URL"
                    description="Comparte enlaces de registro que asignan el rol automáticamente. Un valor válido en el enlace prevalece sobre los forzados de arriba; sin parámetro aplica el comportamiento normal."
                    checked={roleUrlParamEnabled}
                    onChange={(e) => setRoleUrlParamEnabled(e.currentTarget.checked)}
                  />
                  {roleUrlParamEnabled && (
                    <Stack gap="xs" pl="xl">
                      <SimpleGrid cols={{ base: 1, sm: 3 }}>
                        <TextInput
                          label="Nombre del parámetro"
                          description="Ej: ?rol=vendedor"
                          value={roleUrlParamName}
                          onChange={(e) => setRoleUrlParamName(e.currentTarget.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
                          placeholder={DEFAULT_ROLE_URL_PARAM_NAME}
                        />
                        <TextInput
                          label="Valor para Comprador"
                          description=" "
                          value={roleUrlParamComprador}
                          onChange={(e) => setRoleUrlParamComprador(e.currentTarget.value)}
                          placeholder="comprador"
                        />
                        <TextInput
                          label="Valor para Vendedor"
                          description=" "
                          value={roleUrlParamVendedor}
                          onChange={(e) => setRoleUrlParamVendedor(e.currentTarget.value)}
                          placeholder="vendedor"
                          error={roleUrlValuesClash ? "Debe ser distinto al de comprador" : undefined}
                        />
                      </SimpleGrid>
                      <Paper bg="gray.0" radius="sm" p="xs">
                        {[
                          { label: "Compradores", value: roleUrlParamComprador || "comprador" },
                          { label: "Vendedores", value: roleUrlParamVendedor || "vendedor" },
                        ].map(({ label, value }) => {
                          const url = buildRoleRegistrationUrl(value);
                          return (
                            <Group key={label} gap="xs" wrap="nowrap">
                              <Text size="xs" fw={600} style={{ minWidth: 90 }}>
                                {label}
                              </Text>
                              <Text size="xs" c="dimmed" style={{ wordBreak: "break-all", flex: 1 }}>
                                {url}
                              </Text>
                              <CopyButton value={url}>
                                {({ copied, copy }) => (
                                  <Tooltip label={copied ? "Copiado" : "Copiar"}>
                                    <ActionIcon size="sm" variant="subtle" color={copied ? "teal" : "gray"} onClick={copy}>
                                      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                                    </ActionIcon>
                                  </Tooltip>
                                )}
                              </CopyButton>
                            </Group>
                          );
                        })}
                      </Paper>
                    </Stack>
                  )}
                </SettingsCard>
              )}

              <SettingsCard title="Identificación">
                <Switch
                  label="Identificador de asistente"
                  description="Al registrarse, cada asistente recibe un número visible en el header (ej: 1C para comprador, 1V para vendedor)"
                  checked={attendeeIdEnabled}
                  onChange={(e) => setAttendeeIdEnabled(e.currentTarget.checked)}
                />
              </SettingsCard>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* ------------------------------------------------ Reuniones y agenda */}
        <Accordion.Item value="meetings">
          <Accordion.Control>
            <SectionHeader
              icon={<IconCalendarEvent size={20} />}
              color="teal"
              title="Reuniones y agenda"
              description="Mesas, forma de agendar, límites y reglas de cancelación"
              badges={[
                { label: tableMode === "fixed" ? "Mesas fijas" : "Mesas en pool", color: "teal" },
                { label: schedulingMode === "requester_picks" ? "Solicitante elige" : "Receptor acepta", color: "teal" },
                ...(standbyCheckInRequired ? [{ label: "Standby" }] : []),
              ]}
            />
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <SettingsCard title="Mesas y agendamiento">
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <Select
                    label="Modo de mesas"
                    description="Cómo se asignan las mesas al confirmar reuniones"
                    data={[
                      { value: "pool", label: "Pool (mesa libre automática)" },
                      { value: "fixed", label: "Fija (empresa asignada a una mesa)" },
                    ]}
                    value={tableMode}
                    onChange={(v) => setTableMode((v as EventPolicies["tableMode"]) ?? "pool")}
                    allowDeselect={false}
                  />
                  <Select
                    label="Modo de agendamiento"
                    description="Quién elige el horario"
                    data={[
                      { value: "manual", label: "Manual (el receptor elige al aceptar)" },
                      { value: "requester_picks", label: "El solicitante elige (confirmación instantánea)" },
                    ]}
                    value={schedulingMode}
                    onChange={(v) => setSchedulingMode((v as EventPolicies["schedulingMode"]) ?? "manual")}
                    allowDeselect={false}
                  />
                </SimpleGrid>

                {tableMode === "fixed" && (
                  <Paper withBorder radius="sm" p="sm" bg="gray.0">
                    <Group justify="space-between" mb="sm">
                      <Text fw={600} size="sm">
                        Asignación de mesas fijas por empresa
                      </Text>
                      <Select
                        data={[
                          { value: "all", label: "Todas las empresas" },
                          { value: "vendedor", label: "Solo vendedores" },
                          { value: "comprador", label: "Solo compradores" },
                        ]}
                        value={tableRoleFilter}
                        onChange={(v) => setTableRoleFilter((v as typeof tableRoleFilter) ?? "all")}
                        size="xs"
                        style={{ minWidth: 180 }}
                        allowDeselect={false}
                      />
                    </Group>
                    {companiesLoading ? (
                      <Loader size="sm" />
                    ) : companies.length > 0 ? (
                      <Stack gap={6} mah={320} style={{ overflowY: "auto" }}>
                        {companies
                          .filter((c) => tableRoleFilter === "all" || companyRoles[c.nitNorm]?.has(tableRoleFilter))
                          .map((company) => (
                            <Group key={company.nitNorm} justify="space-between" wrap="nowrap">
                              <Text size="sm" style={{ minWidth: 0 }} truncate>
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
                                style={{ minWidth: 160 }}
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
              </SettingsCard>

              <SettingsCard title="Límites">
                <NumberInput
                  label="Límite de reuniones por contacto"
                  description="Máximo de veces que un asistente puede reunirse con la misma persona o empresa (pendientes + aceptadas). Vacío = sin límite."
                  placeholder="Sin límite"
                  min={1}
                  step={1}
                  allowDecimal={false}
                  allowNegative={false}
                  clampBehavior="strict"
                  value={maxMeetingsPerContact}
                  onChange={(v) => setMaxMeetingsPerContact(v === "" ? "" : Number(v))}
                />
                {isBuyerSeller && (
                  <div>
                    <Text size="sm" fw={500}>
                      Límite de reuniones por rol
                    </Text>
                    <Text size="xs" c="dimmed" mb={6}>
                      Máximo de reuniones que puede SOLICITAR cada rol (quien recibe nunca se limita). Vacío = sin límite.
                    </Text>
                    <SimpleGrid cols={{ base: 1, sm: 3 }}>
                      <NumberInput
                        label="Compradores"
                        placeholder="Sin límite"
                        min={1}
                        step={1}
                        allowDecimal={false}
                        allowNegative={false}
                        clampBehavior="strict"
                        value={maxMeetingsCompradorPerRole}
                        onChange={(v) => setMaxMeetingsCompradorPerRole(v === "" ? "" : Number(v))}
                      />
                      <NumberInput
                        label="Vendedores"
                        placeholder="Sin límite"
                        min={1}
                        step={1}
                        allowDecimal={false}
                        allowNegative={false}
                        clampBehavior="strict"
                        value={maxMeetingsVendedorPerRole}
                        onChange={(v) => setMaxMeetingsVendedorPerRole(v === "" ? "" : Number(v))}
                      />
                      <Select
                        label="Alcance"
                        data={[
                          { value: "total", label: "Por evento (acumulado)" },
                          { value: "day", label: "Por día" },
                        ]}
                        value={maxMeetingsPerRoleScope}
                        onChange={(v) =>
                          setMaxMeetingsPerRoleScope((v as EventPolicies["maxMeetingsPerRoleScope"]) ?? "total")
                        }
                        allowDeselect={false}
                      />
                    </SimpleGrid>
                  </div>
                )}
              </SettingsCard>

              <SettingsCard title="Reglas de la reunión">
                <Switch
                  label="Reuniones en standby hasta check-in"
                  description="Las reuniones aceptadas quedan en standby hasta que ambos participantes hagan check-in. Si no hay slots libres, se usan slots de standby."
                  checked={standbyCheckInRequired}
                  onChange={(e) => setStandbyCheckInRequired(e.currentTarget.checked)}
                />
                <Switch
                  label="Deshabilitar cancelación de reuniones"
                  description="Los asistentes no podrán cancelar sus reuniones desde el dashboard"
                  checked={cancelMeetingDisabled}
                  onChange={(e) => setCancelMeetingDisabled(e.currentTarget.checked)}
                />
                <Switch
                  label="Reasignación automática al cancelar reunión"
                  description="El slot liberado se reasigna automáticamente al mejor candidato disponible"
                  checked={autoReassignOnCancel}
                  onChange={(e) => setAutoReassignOnCancel(e.currentTarget.checked)}
                />
              </SettingsCard>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* ------------------------------------------------ Notificaciones */}
        <Accordion.Item value="notifications">
          <Accordion.Control>
            <SectionHeader
              icon={<IconBell size={20} />}
              color="green"
              title="Notificaciones"
              description="WhatsApp, correo, avisos en el dashboard y recordatorios de pendientes"
              badges={[
                { label: whatsappNotificationsEnabled ? `WhatsApp ${whatsappApiVersion.toUpperCase()}` : "WhatsApp off", color: whatsappNotificationsEnabled ? "green" : "gray" },
                ...(pendingReminders.pendingRemindersEnabled ? [{ label: "Recordatorios", color: "green" }] : []),
              ]}
            />
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <SettingsCard title="WhatsApp">
                <Switch
                  label="Notificaciones por WhatsApp"
                  description="Envía mensajes al solicitar, aceptar, rechazar o cancelar reuniones"
                  checked={whatsappNotificationsEnabled}
                  onChange={(e) => setWhatsappNotificationsEnabled(e.currentTarget.checked)}
                />
                {whatsappNotificationsEnabled && (
                  <Stack gap="md" pl="xl">
                    <Select
                      label="API de WhatsApp"
                      description="Versión de la API usada para las notificaciones"
                      data={[
                        { value: "v1", label: "API V1 (Geniality Simple)" },
                        { value: "v2", label: "API V2 (Meeting Request)" },
                      ]}
                      value={whatsappApiVersion}
                      onChange={(v) => setWhatsappApiVersion((v as "v1" | "v2") ?? "v1")}
                      allowDeselect={false}
                    />
                    <Switch
                      label="Correo alternativo si falla WhatsApp"
                      description="Envía un correo electrónico si falla el envío del mensaje por WhatsApp"
                      checked={fallbackEmailOnWaFailure}
                      onChange={(e) => setFallbackEmailOnWaFailure(e.currentTarget.checked)}
                    />
                    {whatsappApiVersion === "v2" && (
                      <Group grow align="flex-start">
                        <TextInput
                          label="Plantilla de avisos a compañeros de empresa"
                          description="Avisa a los demás asesores cuando un compañero recibe, acepta, rechaza o cancela una reunión. Cuerpo: {{1}} nombre, {{2}} evento, {{3}} aviso. Vacío = solo notificación en el dashboard."
                          placeholder="aviso_companero_empresa"
                          value={advisorNoticeTemplateName}
                          onChange={(e) => setAdvisorNoticeTemplateName(e.currentTarget.value.replace(/\s/g, ""))}
                        />
                        <TextInput
                          label="Idioma"
                          description="Código del idioma"
                          placeholder="es"
                          value={advisorNoticeTemplateLanguage}
                          onChange={(e) => setAdvisorNoticeTemplateLanguage(e.currentTarget.value.trim())}
                          style={{ maxWidth: 120 }}
                        />
                      </Group>
                    )}
                  </Stack>
                )}
              </SettingsCard>

              <SettingsCard title="En la plataforma">
                <Switch
                  label="Notificaciones en el dashboard"
                  description="Genera notificaciones internas visibles en el menú de notificaciones del asistente"
                  checked={dashboardNotificationsEnabled}
                  onChange={(e) => setDashboardNotificationsEnabled(e.currentTarget.checked)}
                />
                <Switch
                  label="Mensaje y popup de bienvenida"
                  description="Muestra el popup de bienvenida en el dashboard y envía el WhatsApp de bienvenida al registrarse por primera vez"
                  checked={welcomeMessageEnabled}
                  onChange={(e) => setWelcomeMessageEnabled(e.currentTarget.checked)}
                />
              </SettingsCard>

              <PendingRemindersSettings
                event={event}
                value={pendingReminders}
                onChange={(patch) => setPendingReminders((prev) => ({ ...prev, ...patch }))}
                hasUnsavedChanges={isDirty}
                onSaveRequest={handleSave}
              />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* ------------------------------------------------ Dashboard */}
        <Accordion.Item value="dashboard">
          <Accordion.Control>
            <SectionHeader
              icon={<IconLayoutDashboard size={20} />}
              color="violet"
              title="Dashboard del asistente"
              description="Pestañas visibles, su orden, directorio y campos de las tarjetas"
              badges={[{ label: `${enabledViewsCount} vistas activas`, color: "violet" }]}
            />
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <SettingsCard title="Directorio">
                <Select
                  label="Visibilidad del directorio"
                  description="Qué asistentes pueden ver otros asistentes"
                  data={[
                    { value: "all", label: "Todos ven a todos" },
                    { value: "by_role", label: "Solo roles opuestos (compradores ven vendedores y viceversa)" },
                    { value: "sellers_see_all", label: "Vendedores ven a todos; compradores solo ven vendedores" },
                  ]}
                  value={discoveryMode}
                  onChange={(v) => setDiscoveryMode((v as EventPolicies["discoveryMode"]) ?? "all")}
                  allowDeselect={false}
                />
                <Switch
                  label="Agrupar empresas por nombre"
                  description="En la vista de empresas agrupa por 'company_razonSocial' en lugar de por NIT"
                  checked={groupByRazonSocial}
                  onChange={(e) => setGroupByRazonSocial(e.currentTarget.checked)}
                />
                <Switch
                  label="Permitir imágenes en productos"
                  description="Los usuarios pueden subir imágenes al crear o editar productos"
                  checked={allowProductImageUpload}
                  onChange={(e) => setAllowProductImageUpload(e.currentTarget.checked)}
                />
              </SettingsCard>

              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <SettingsCard title="Vistas habilitadas">
                  {[
                    { key: "chatbot", label: "Chatbot" },
                    { key: "matches", label: "Matches (alta afinidad)" },
                    { key: "attendees", label: "Asistentes (directorio)" },
                    { key: "companies", label: "Empresas" },
                    { key: "products", label: "Productos" },
                  ].map(({ key, label }) => (
                    <Switch
                      key={key}
                      label={label}
                      checked={!!(uiViews as Record<string, boolean>)[key]}
                      onChange={(e) => {
                        const checked = e.currentTarget.checked;
                        setUiViews((prev) => ({ ...prev, [key]: checked }));
                      }}
                    />
                  ))}
                </SettingsCard>

                <SettingsCard title="Orden de las pestañas">
                  <Text size="xs" c="dimmed" mt={-8}>
                    Solo se muestran las habilitadas; la primera es la vista inicial.
                  </Text>
                  <Stack gap={0}>
                    {viewsOrder.map((key, idx) => (
                      <Group
                        key={key}
                        justify="space-between"
                        wrap="nowrap"
                        py={4}
                        style={{
                          borderBottom: idx < viewsOrder.length - 1 ? "1px solid var(--mantine-color-gray-2)" : undefined,
                        }}
                      >
                        <Text size="sm">
                          <Text span fw={600} c="dimmed" mr={6}>
                            {idx + 1}.
                          </Text>
                          {VIEW_LABELS[key] || key}
                        </Text>
                        <Group gap={2} wrap="nowrap">
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            onClick={() => moveView(idx, -1)}
                            disabled={idx === 0}
                            aria-label="Subir"
                          >
                            <IconArrowUp size={16} />
                          </ActionIcon>
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            onClick={() => moveView(idx, 1)}
                            disabled={idx === viewsOrder.length - 1}
                            aria-label="Bajar"
                          >
                            <IconArrowDown size={16} />
                          </ActionIcon>
                        </Group>
                      </Group>
                    ))}
                  </Stack>
                </SettingsCard>
              </SimpleGrid>

              <SettingsCard title="Campos en tarjetas">
                <MultiSelect
                  label="Tarjetas de asistentes"
                  description="Campos visibles en la vista 'Directorio'"
                  data={availableFieldsForCards}
                  value={attendeeCardFields}
                  onChange={setAttendeeCardFields}
                  placeholder="Selecciona campos"
                  searchable
                  clearable
                />
                <MultiSelect
                  label="Tarjetas de empresas"
                  description="Campos del representante en la vista 'Empresas'"
                  data={availableFieldsForCards}
                  value={companyCardFields}
                  onChange={setCompanyCardFields}
                  placeholder="Selecciona campos"
                  searchable
                  clearable
                />
              </SettingsCard>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* ------------------------------------------------ Dinámicas */}
        <Accordion.Item value="engagement">
          <Accordion.Control>
            <SectionHeader
              icon={<IconGift size={20} />}
              color="orange"
              title="Dinámicas del evento"
              description="Sorteo por reuniones y registro de visitas a stands"
              badges={[
                ...(raffleEnabled ? [{ label: "Sorteo", color: "orange" }] : []),
                ...(standVisitsEnabled ? [{ label: "Visitas a stands", color: "orange" }] : []),
              ]}
            />
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <SettingsCard title="Sorteo">
                <Switch
                  label="Habilitar sorteo por reuniones"
                  description="El vendedor muestra un QR único por reunión aceptada; al escanearlo, el comprador gana un punto para el sorteo"
                  checked={raffleEnabled}
                  onChange={(e) => setRaffleEnabled(e.currentTarget.checked)}
                />
                {raffleEnabled && (
                  <Switch
                    pl="xl"
                    label="Mostrar puntos al comprador"
                    description="El comprador ve su propio conteo de puntos acumulados"
                    checked={raffleShowPointsToAttendee}
                    onChange={(e) => setRaffleShowPointsToAttendee(e.currentTarget.checked)}
                  />
                )}
              </SettingsCard>
              <SettingsCard title="Visitas a stands">
                <Switch
                  label="Habilitar registro de visitas a stands"
                  description="Cada stand muestra un QR fijo; los asistentes con check-in lo escanean y quedan registrados como visitantes"
                  checked={standVisitsEnabled}
                  onChange={(e) => setStandVisitsEnabled(e.currentTarget.checked)}
                />
                {standVisitsEnabled && (
                  <Switch
                    pl="xl"
                    label="Permitir que el vendedor también escanee al comprador"
                    description="El representante del stand puede escanear la credencial del comprador para registrar la misma visita"
                    checked={standVisitAllowSellerScan}
                    onChange={(e) => setStandVisitAllowSellerScan(e.currentTarget.checked)}
                  />
                )}
              </SettingsCard>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* ------------------------------------------------ Encuestas */}
        <Accordion.Item value="surveys">
          <Accordion.Control>
            <SectionHeader
              icon={<IconClipboardCheck size={20} />}
              color="pink"
              title="Encuesta por reunión"
              description="Tipo de encuesta y qué roles pueden responderla"
              badges={[
                { label: surveyMode === "custom" ? "Personalizada" : "Por defecto", color: "pink" },
                ...(surveyBlockedFor && surveyBlockedFor !== "none" ? [{ label: `Bloqueada: ${surveyBlockedFor}` }] : []),
              ]}
            />
          </Accordion.Control>
          <Accordion.Panel>
            <SettingsCard>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <Select
                  label="Modo de encuesta"
                  description="Encuesta original o personalizada por rol"
                  data={[
                    { value: "default", label: "Por defecto (valor estimado + comentarios)" },
                    { value: "custom", label: "Personalizada por rol (pestaña 'Encuesta')" },
                  ]}
                  value={surveyMode}
                  onChange={(v) => setSurveyMode((v as EventPolicies["surveyMode"]) ?? "default")}
                  allowDeselect={false}
                />
                <Select
                  label="Bloquear encuesta para"
                  description="Impide que ciertos roles la vean o respondan"
                  data={[
                    { value: "none", label: "Nadie (todos pueden responder)" },
                    { value: "compradores", label: "Compradores" },
                    { value: "vendedores", label: "Vendedores" },
                    { value: "ambos", label: "Ambos (encuesta deshabilitada)" },
                  ]}
                  value={surveyBlockedFor}
                  onChange={(v) => setSurveyBlockedFor((v as EventPolicies["surveyBlockedFor"]) ?? "none")}
                  allowDeselect={false}
                />
              </SimpleGrid>
            </SettingsCard>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      {/* Barra de guardado fija al fondo del área con scroll */}
      <Paper
        withBorder
        radius="md"
        p="sm"
        shadow={isDirty ? "md" : undefined}
        style={{
          position: "sticky",
          bottom: 0,
          zIndex: 5,
          borderColor: isDirty ? "var(--mantine-color-yellow-5)" : undefined,
        }}
      >
        <Group justify="space-between" wrap="nowrap">
          {isDirty ? (
            <Badge color="yellow" variant="light" size="lg">
              Cambios sin guardar
            </Badge>
          ) : (
            <Text size="sm" c="dimmed">
              Todo guardado
            </Text>
          )}
          <Group gap="xs" wrap="nowrap">
            <Button variant="default" onClick={onClose}>
              Cerrar
            </Button>
            <Button
              loading={saving}
              onClick={handleSave}
              disabled={!isDirty}
              leftSection={<IconDeviceFloppy size={16} />}
            >
              Guardar políticas
            </Button>
          </Group>
        </Group>
      </Paper>
    </Stack>
  );

  if (inline) return content;
  
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Configurar políticas del evento"
      size="lg"
    >
      {content}
    </Modal>
  );
}

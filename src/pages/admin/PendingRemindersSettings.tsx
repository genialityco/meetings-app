import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Table,
  Text,
} from "@mantine/core";
import { auth } from "../../firebase/firebaseConfig";
import { analyzeTemplate, fetchWaTemplates, type WaTemplate } from "../../utils/waCampaigns";

/** Subconjunto de EventPolicies que configura los recordatorios de solicitudes pendientes */
export interface PendingRemindersConfig {
  pendingRemindersEnabled: boolean;
  pendingRemindersEveryHours: number;
  pendingRemindersMinAgeHours: number;
  pendingRemindersStartHour: number;
  pendingRemindersEndHour: number;
  pendingRemindersWhatsapp: boolean;
  pendingRemindersTemplate: { name: string; language: string } | null;
  pendingRemindersEmail: boolean;
}

const RUN_URL =
  (import.meta.env.VITE_PENDING_REMINDERS_URL as string) ||
  `https://us-central1-${import.meta.env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net/runPendingReminders`;

interface RunResult {
  skipped?: string;
  pendingTotal?: number;
  skippedRecent?: number;
  recipientsWithPending?: number;
  due?: number;
  whatsappSent?: number;
  whatsappFailed?: number;
  emailSent?: number;
  emailFailed?: number;
  templateError?: string | null;
  preview?: { userId: string; nombre: string; empresa: string; pendientes: number; whatsapp: string | null; email: string | null }[];
}

async function runReminders(eventId: string, dryRun: boolean): Promise<RunResult> {
  const user = auth.currentUser;
  if (!user) throw new Error("Debes iniciar sesión como administrador");
  const token = await user.getIdToken();
  const res = await fetch(RUN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ eventId, dryRun }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

const templateKey = (t: { name: string; language: string }) => `${t.name}|${t.language}`;

interface Props {
  event: any;
  value: PendingRemindersConfig;
  onChange: (patch: Partial<PendingRemindersConfig>) => void;
}

export default function PendingRemindersSettings({ event, value, onChange }: Props) {
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [running, setRunning] = useState<"dry" | "send" | null>(null);
  const [result, setResult] = useState<{ dryRun: boolean; data: RunResult } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const showWhatsapp = value.pendingRemindersEnabled && value.pendingRemindersWhatsapp;

  useEffect(() => {
    if (!showWhatsapp || !event?.id || templates.length) return;
    setLoadingTemplates(true);
    setTemplatesError(null);
    fetchWaTemplates(event.id)
      .then(setTemplates)
      .catch((e) => setTemplatesError(e.message))
      .finally(() => setLoadingTemplates(false));
  }, [showWhatsapp, event?.id, templates.length]);

  const selected = value.pendingRemindersTemplate
    ? templates.find((t) => templateKey(t) === templateKey(value.pendingRemindersTemplate!))
    : undefined;
  const selectedAnalysis = selected ? analyzeTemplate(selected) : null;
  const bodyText = selected?.components.find((c) => c.type === "BODY")?.text;

  const handleRun = async (dryRun: boolean) => {
    if (!event?.id) return;
    if (!dryRun && !window.confirm("Se enviarán los recordatorios ahora a quienes les corresponda según el intervalo. ¿Continuar?")) return;
    setRunning(dryRun ? "dry" : "send");
    setRunError(null);
    try {
      setResult({ dryRun, data: await runReminders(event.id, dryRun) });
    } catch (e: any) {
      setRunError(e.message);
    } finally {
      setRunning(null);
    }
  };

  const lastRun = event?.pendingRemindersLastRun;
  const lastRunDate = lastRun?.at?.toDate ? lastRun.at.toDate() : null;

  return (
    <Paper p="md" withBorder>
      <Switch
        label="Recordatorio automático de solicitudes pendientes"
        description="Cada N horas envía un resumen a quien tenga solicitudes de reunión por aceptar: al asesor si la solicitud es directa, o a todos los asesores de la empresa si se envió a la empresa."
        checked={value.pendingRemindersEnabled}
        onChange={(e) => onChange({ pendingRemindersEnabled: e.currentTarget.checked })}
      />

      {value.pendingRemindersEnabled && (
        <Stack gap="sm" mt="md">
          <Group grow align="flex-start">
            <NumberInput
              label="Repetir cada (horas)"
              description="Tiempo mínimo entre recordatorios a la misma persona"
              min={1}
              max={168}
              allowDecimal={false}
              allowNegative={false}
              value={value.pendingRemindersEveryHours}
              onChange={(v) => onChange({ pendingRemindersEveryHours: Number(v) || 1 })}
            />
            <NumberInput
              label="Antigüedad mínima (horas)"
              description="Solo cuenta solicitudes creadas hace al menos este tiempo"
              min={0}
              max={168}
              allowDecimal={false}
              allowNegative={false}
              value={value.pendingRemindersMinAgeHours}
              onChange={(v) => onChange({ pendingRemindersMinAgeHours: Number(v) || 0 })}
            />
          </Group>
          <Group grow align="flex-start">
            <NumberInput
              label="Enviar desde (hora Bogotá)"
              min={0}
              max={23}
              allowDecimal={false}
              allowNegative={false}
              value={value.pendingRemindersStartHour}
              onChange={(v) => onChange({ pendingRemindersStartHour: Number(v) || 0 })}
            />
            <NumberInput
              label="Hasta (hora Bogotá)"
              description="No se envía a partir de esta hora"
              min={1}
              max={24}
              allowDecimal={false}
              allowNegative={false}
              value={value.pendingRemindersEndHour}
              onChange={(v) => onChange({ pendingRemindersEndHour: Number(v) || 24 })}
              error={
                value.pendingRemindersEndHour <= value.pendingRemindersStartHour
                  ? "Debe ser mayor que la hora de inicio"
                  : undefined
              }
            />
          </Group>
          <Text size="xs" c="dimmed">
            Se revisa cada 30 minutos y se detiene automáticamente después del último día del evento.
          </Text>

          <Switch
            label="Enviar por WhatsApp"
            checked={value.pendingRemindersWhatsapp}
            onChange={(e) => onChange({ pendingRemindersWhatsapp: e.currentTarget.checked })}
          />
          {value.pendingRemindersWhatsapp && (
            <Stack gap={6} ml="xl">
              <Select
                label="Plantilla de WhatsApp (aprobada en Meta)"
                placeholder={loadingTemplates ? "Cargando plantillas…" : "Selecciona una plantilla"}
                data={templates.map((t) => ({ value: templateKey(t), label: `${t.name} (${t.language})` }))}
                value={value.pendingRemindersTemplate ? templateKey(value.pendingRemindersTemplate) : null}
                onChange={(v) => {
                  const [name, language] = (v || "").split("|");
                  onChange({ pendingRemindersTemplate: v ? { name, language } : null });
                }}
                searchable
                clearable
                error={templatesError}
                nothingFoundMessage="Sin plantillas"
              />
              <Text size="xs" c="dimmed">
                Variables del cuerpo, en orden: {"{{1}}"} nombre del asesor (o la empresa si es un representante
                genérico), {"{{2}}"} evento, {"{{3}}"} cantidad de solicitudes pendientes, {"{{4}}"} empresa. Si la
                plantilla usa nombres, use: nombre, evento, pendientes, empresa. Un botón URL dinámico recibe{" "}
                <code>event/{event?.id}?ingresar=1</code>, así que su URL base debe ser la de la app (ej.{" "}
                <code>https://gen-meetings.netlify.app/{"{{1}}"}</code>).
              </Text>
              {bodyText && (
                <Paper p="xs" bg="gray.0" radius="sm">
                  <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                    {bodyText}
                  </Text>
                </Paper>
              )}
              {selectedAnalysis &&
                (selectedAnalysis.unsupported.length > 0 ||
                  selectedAnalysis.slots.some((s) => s.kind === "header_media" || s.kind === "header_text")) && (
                  <Alert color="orange" p="xs">
                    Esta plantilla tiene elementos que el recordatorio no llena (
                    {[
                      ...selectedAnalysis.unsupported,
                      ...selectedAnalysis.slots
                        .filter((s) => s.kind === "header_media" || s.kind === "header_text")
                        .map((s) => s.label),
                    ].join(", ")}
                    ). Usa una plantilla con solo variables en el cuerpo y, opcionalmente, un botón URL.
                  </Alert>
                )}
            </Stack>
          )}

          <Switch
            label="Enviar por correo"
            description="Incluye el detalle de cada solicitud con botones para aceptar o rechazar"
            checked={value.pendingRemindersEmail}
            onChange={(e) => onChange({ pendingRemindersEmail: e.currentTarget.checked })}
          />
        </Stack>
      )}

      <Group mt="md" gap="xs">
        <Button size="xs" variant="light" loading={running === "dry"} onClick={() => handleRun(true)}>
          Simular (ver destinatarios)
        </Button>
        {value.pendingRemindersEnabled && (
          <Button size="xs" variant="outline" color="green" loading={running === "send"} onClick={() => handleRun(false)}>
            Enviar ahora
          </Button>
        )}
      </Group>
      <Text size="xs" c="dimmed" mt={4}>
        La simulación y el envío manual usan la configuración guardada: guarda las políticas antes de probar.
      </Text>

      {lastRunDate && (
        <Text size="xs" c="dimmed" mt="xs">
          Último envío: {lastRunDate.toLocaleString("es-CO")} — WhatsApp {lastRun.whatsappSent ?? 0} ok /{" "}
          {lastRun.whatsappFailed ?? 0} con error · Correo {lastRun.emailSent ?? 0} ok / {lastRun.emailFailed ?? 0} con
          error
          {lastRun.templateError ? ` · ${lastRun.templateError}` : ""}
        </Text>
      )}

      {runError && (
        <Alert color="red" mt="sm" p="xs">
          {runError}
        </Alert>
      )}

      {result && (
        <Stack gap="xs" mt="sm">
          {result.data.skipped ? (
            <Alert color="gray" p="xs">
              {result.data.skipped}
            </Alert>
          ) : (
            <>
              <Group gap="xs">
                <Badge variant="light">{result.data.pendingTotal} pendientes en el evento</Badge>
                <Badge variant="light" color="gray">
                  {result.data.skippedRecent} más recientes que la antigüedad mínima
                </Badge>
                <Badge variant="light" color="blue">
                  {result.data.recipientsWithPending} asesores con pendientes
                </Badge>
                <Badge variant="light" color="green">
                  {result.data.due} {result.dryRun ? "recibirían recordatorio ahora" : "procesados"}
                </Badge>
              </Group>
              {!result.dryRun && (
                <Text size="sm">
                  WhatsApp: {result.data.whatsappSent} enviados, {result.data.whatsappFailed} con error · Correo:{" "}
                  {result.data.emailSent} enviados, {result.data.emailFailed} con error
                </Text>
              )}
              {result.data.templateError && value.pendingRemindersWhatsapp && (
                <Alert color="orange" p="xs">
                  WhatsApp: {result.data.templateError}
                </Alert>
              )}
              {result.dryRun && !!result.data.preview?.length && (
                <ScrollArea h={220}>
                  <Table striped fz="xs">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Destinatario</Table.Th>
                        <Table.Th>Empresa</Table.Th>
                        <Table.Th>Pend.</Table.Th>
                        <Table.Th>WhatsApp</Table.Th>
                        <Table.Th>Correo</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {result.data.preview.map((p) => (
                        <Table.Tr key={p.userId}>
                          <Table.Td>{p.nombre}</Table.Td>
                          <Table.Td>{p.empresa}</Table.Td>
                          <Table.Td>{p.pendientes}</Table.Td>
                          <Table.Td>{p.whatsapp ?? <Text span c="red" fz="xs">—</Text>}</Table.Td>
                          <Table.Td>{p.email ?? <Text span c="red" fz="xs">—</Text>}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              )}
            </>
          )}
        </Stack>
      )}
    </Paper>
  );
}

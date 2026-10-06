import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Progress,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { doc, onSnapshot } from "firebase/firestore";
import * as XLSX from "xlsx";
import { db } from "../../../firebase/firebaseConfig";
import {
  deleteCampaign,
  isCampaignStale,
  pauseCampaign,
  recipientsCollection,
  resumeCampaign,
  retryFailedRecipients,
  WaCampaign,
  WaCampaignRecipient,
} from "../../../utils/waCampaigns";
import { CAMPAIGN_STATUS, formatTs } from "./campaignUi";

const RECIPIENT_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "gray" },
  sent: { label: "Enviado", color: "teal" },
  error: { label: "Error", color: "red" },
};

const MAX_ROWS = 300;

interface Props {
  eventId: string;
  campaignId: string;
  onClose: () => void;
}

export default function WaCampaignDetailModal({ eventId, campaignId, onClose }: Props) {
  const [campaign, setCampaign] = useState<WaCampaign | null>(null);
  const [recipients, setRecipients] = useState<WaCampaignRecipient[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const unsubCampaign = onSnapshot(doc(db, "events", eventId, "waCampaigns", campaignId), (snap) =>
      setCampaign(snap.exists() ? ({ id: snap.id, ...snap.data() } as WaCampaign) : null)
    );
    const unsubRecipients = onSnapshot(recipientsCollection(eventId, campaignId), (snap) =>
      setRecipients(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WaCampaignRecipient))
    );
    return () => {
      unsubCampaign();
      unsubRecipients();
    };
  }, [eventId, campaignId]);

  const visible = useMemo(() => {
    if (statusFilter === "all") return recipients;
    if (statusFilter === "responded") return recipients.filter((r) => r.response);
    return recipients.filter((r) => r.status === statusFilter);
  }, [recipients, statusFilter]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setActionError(null);
    try {
      await fn();
    } catch (err: any) {
      console.error(err);
      setActionError(err.message || "Error ejecutando la acción");
    } finally {
      setBusy(null);
    }
  };

  const exportExcel = () => {
    const qr = campaign?.quickReplies || [];
    const rows = recipients.map((r) => ({
      Nombre: r.nombre,
      Empresa: r.empresa || "",
      WhatsApp: `+${r.phone}`,
      Estado: RECIPIENT_STATUS[r.status]?.label || r.status,
      "Enviado el": formatTs(r.sentAt),
      Error: r.error || "",
      "Código error": r.errorCode ?? "",
      ...(qr.length
        ? { Respuesta: r.response?.answerText || "", "Respondió el": r.response ? formatTs(r.response.receivedAt) : "" }
        : {}),
      // Campañas importadas: columnas originales del archivo
      ...(r.data || {}),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Destinatarios");
    XLSX.writeFile(wb, `campana_${(campaign?.name || campaignId).replace(/[^\w-]+/g, "_")}.xlsx`);
  };

  const confirmDelete = () =>
    modals.openConfirmModal({
      title: "Eliminar campaña",
      children: <Text size="sm">Se eliminará la campaña y el registro de sus destinatarios y respuestas.</Text>,
      labels: { confirm: "Eliminar", cancel: "Cancelar" },
      confirmProps: { color: "red" },
      onConfirm: () => run("delete", async () => {
        await deleteCampaign(eventId, campaignId);
        onClose();
      }),
    });

  if (!campaign) {
    return (
      <Modal opened onClose={onClose} title="Campaña" size="xl">
        <Loader size="sm" />
      </Modal>
    );
  }

  const total = campaign.counts?.total || 0;
  const sent = campaign.counts?.sent || 0;
  const failed = campaign.counts?.failed || 0;
  const pending = Math.max(0, total - sent - failed);
  const stale = isCampaignStale(campaign);
  const status = CAMPAIGN_STATUS[campaign.status] || { label: campaign.status, color: "gray" };
  const active = (campaign.status === "queued" || campaign.status === "running") && !stale;

  return (
    <Modal opened onClose={onClose} title={campaign.name} size="xl">
      <Stack gap="md">
        <Group gap="xs">
          <Badge color={stale ? "red" : status.color}>{stale ? "Detenida" : status.label}</Badge>
          <Badge variant="light">{campaign.template?.name}</Badge>
          <Badge variant="light">{campaign.template?.category}</Badge>
          {campaign.source === "import" && (
            <Badge variant="light" color="grape">
              Archivo: {campaign.importInfo?.fileName}
            </Badge>
          )}
          <Text size="xs" c="dimmed">
            Creada {formatTs(campaign.createdAt)}
            {campaign.createdBy?.email ? ` por ${campaign.createdBy.email}` : ""}
          </Text>
        </Group>

        {stale && (
          <Alert color="red">
            El envío dejó de avanzar hace más de 10 minutos. Puedes reanudarlo; no se reenviará a quienes ya
            recibieron el mensaje.
          </Alert>
        )}
        {campaign.lastError && <Alert color="red">{campaign.lastError}</Alert>}
        {campaign.status === "draft" && (
          <Alert color="gray">
            La campaña no terminó de crearse (se interrumpió al guardar los destinatarios). Elimínala y créala de nuevo.
          </Alert>
        )}
        {actionError && <Alert color="red">{actionError}</Alert>}

        <div>
          <Progress.Root size="xl">
            <Progress.Section value={total ? (sent / total) * 100 : 0} color="teal" />
            <Progress.Section value={total ? (failed / total) * 100 : 0} color="red" />
          </Progress.Root>
          <SimpleGrid cols={4} mt="xs">
            <Stat label="Total" value={total} />
            <Stat label="Enviados" value={sent} color="teal" />
            <Stat label="Con error" value={failed} color="red" />
            <Stat label="Pendientes" value={pending} />
          </SimpleGrid>
        </div>

        {campaign.quickReplies?.length > 0 && (
          <div>
            <Text size="sm" fw={600} mb={4}>
              Respuestas ({campaign.counts?.responded || 0})
              {campaign.responseField ? ` · se guardan también en el campo "${campaign.responseField}" del asistente` : ""}
            </Text>
            <Group gap="xs">
              {campaign.quickReplies.map((q) => (
                <Badge key={q.index} variant="light" color="teal" size="lg">
                  {q.text}: {campaign.responseCounts?.[q.index] || 0}
                </Badge>
              ))}
            </Group>
          </div>
        )}

        <Group gap="xs">
          {active && (
            <Button color="yellow" variant="light" loading={busy === "pause"} onClick={() => run("pause", () => pauseCampaign(eventId, campaignId))}>
              Pausar
            </Button>
          )}
          {(campaign.status === "paused" || stale) && pending > 0 && (
            <Button color="teal" loading={busy === "resume"} onClick={() => run("resume", () => resumeCampaign(eventId, campaignId))}>
              Reanudar
            </Button>
          )}
          {!active && failed > 0 && campaign.status !== "draft" && (
            <Button
              color="orange"
              variant="light"
              loading={busy === "retry"}
              onClick={() => run("retry", () => retryFailedRecipients(eventId, campaignId))}
            >
              Reintentar con error ({failed})
            </Button>
          )}
          <Button variant="default" onClick={exportExcel} disabled={recipients.length === 0}>
            Exportar Excel
          </Button>
          {!active && (
            <Button color="red" variant="subtle" loading={busy === "delete"} onClick={confirmDelete}>
              Eliminar
            </Button>
          )}
        </Group>

        <SegmentedControl
          value={statusFilter}
          onChange={setStatusFilter}
          data={[
            { value: "all", label: `Todos (${recipients.length})` },
            { value: "pending", label: "Pendientes" },
            { value: "sent", label: "Enviados" },
            { value: "error", label: "Con error" },
            ...(campaign.quickReplies?.length ? [{ value: "responded", label: "Respondieron" }] : []),
          ]}
        />

        <ScrollArea h={320}>
          <Table striped stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nombre</Table.Th>
                <Table.Th>WhatsApp</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th>Detalle</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {visible.slice(0, MAX_ROWS).map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td>
                    {r.nombre}
                    {r.empresa && (
                      <Text size="xs" c="dimmed">
                        {r.empresa}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>+{r.phone}</Table.Td>
                  <Table.Td>
                    <Badge size="sm" color={RECIPIENT_STATUS[r.status]?.color}>
                      {RECIPIENT_STATUS[r.status]?.label || r.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    {r.response ? (
                      <Text size="xs">Respondió: {r.response.answerText}</Text>
                    ) : r.error ? (
                      <Text size="xs" c="red">
                        {r.errorCode ? `[${r.errorCode}] ` : ""}
                        {r.error}
                      </Text>
                    ) : (
                      <Text size="xs" c="dimmed">
                        {formatTs(r.sentAt)}
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {visible.length > MAX_ROWS && (
            <Text size="xs" c="dimmed" ta="center" mt="xs">
              Mostrando {MAX_ROWS} de {visible.length}. Exporta a Excel para ver todos.
            </Text>
          )}
        </ScrollArea>
      </Stack>
    </Modal>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} c={color}>
        {value}
      </Text>
    </div>
  );
}

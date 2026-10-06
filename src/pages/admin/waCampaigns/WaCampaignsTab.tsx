import { useEffect, useState } from "react";
import { Alert, Badge, Button, Group, Loader, Progress, Stack, Table, Text } from "@mantine/core";
import { onSnapshot, orderBy, query } from "firebase/firestore";
import { campaignsCollection, isCampaignStale, WaCampaign } from "../../../utils/waCampaigns";
import NewWaCampaignModal from "./NewWaCampaignModal";
import WaCampaignDetailModal from "./WaCampaignDetailModal";
import { CAMPAIGN_STATUS, formatTs } from "./campaignUi";

export default function WaCampaignsTab({ event }: { event: any }) {
  const [campaigns, setCampaigns] = useState<WaCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newOpened, setNewOpened] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(campaignsCollection(event.id), orderBy("createdAt", "desc"));
    return onSnapshot(
      q,
      (snap) => {
        setCampaigns(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WaCampaign));
        setLoading(false);
      },
      (err) => {
        console.error("Error cargando campañas:", err);
        setError(err.message);
        setLoading(false);
      }
    );
  }, [event.id]);

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Envío masivo de plantillas aprobadas en Meta a los asistentes de este evento. Las plantillas se crean y
          editan en el administrador de plantillas de Meta.
        </Text>
        <Button color="teal" onClick={() => setNewOpened(true)}>
          Nueva campaña
        </Button>
      </Group>

      {error && <Alert color="red">{error}</Alert>}

      {loading ? (
        <Loader size="sm" />
      ) : campaigns.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aún no hay campañas para este evento.
        </Text>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Campaña</Table.Th>
              <Table.Th>Plantilla</Table.Th>
              <Table.Th>Estado</Table.Th>
              <Table.Th w={220}>Progreso</Table.Th>
              <Table.Th>Respuestas</Table.Th>
              <Table.Th>Creada</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {campaigns.map((c) => {
              const total = c.counts?.total || 0;
              const sent = c.counts?.sent || 0;
              const failed = c.counts?.failed || 0;
              const status = CAMPAIGN_STATUS[c.status] || { label: c.status, color: "gray" };
              return (
                <Table.Tr key={c.id} style={{ cursor: "pointer" }} onClick={() => setDetailId(c.id)}>
                  <Table.Td fw={600}>
                    {c.name}
                    {c.source === "import" && (
                      <Badge ml={6} size="xs" variant="light" color="grape">
                        Archivo
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>{c.template?.name}</Table.Td>
                  <Table.Td>
                    <Badge color={isCampaignStale(c) ? "red" : status.color}>
                      {isCampaignStale(c) ? "Detenida" : status.label}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Progress.Root size="lg">
                      <Progress.Section value={total ? (sent / total) * 100 : 0} color="teal" />
                      <Progress.Section value={total ? (failed / total) * 100 : 0} color="red" />
                    </Progress.Root>
                    <Text size="xs" c="dimmed">
                      {sent} enviados · {failed} con error · {total} total
                    </Text>
                  </Table.Td>
                  <Table.Td>{c.quickReplies?.length ? c.counts?.responded || 0 : "-"}</Table.Td>
                  <Table.Td>{formatTs(c.createdAt)}</Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}

      <NewWaCampaignModal
        opened={newOpened}
        onClose={() => setNewOpened(false)}
        event={event}
        onCreated={(id) => setDetailId(id)}
      />
      {detailId && <WaCampaignDetailModal eventId={event.id} campaignId={detailId} onClose={() => setDetailId(null)} />}
    </Stack>
  );
}

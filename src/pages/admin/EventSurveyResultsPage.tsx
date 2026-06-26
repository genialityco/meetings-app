import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  collection, query, where, onSnapshot, doc, getDoc, deleteDoc,
} from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import {
  Table, Loader, Text, Button, Group, Title, Stack, Paper, ActionIcon,
  Badge, ScrollArea, Tooltip,
} from "@mantine/core";
import { IconTrash, IconArrowLeft, IconFileSpreadsheet } from "@tabler/icons-react";
import { modals } from "@mantine/modals";
import { showNotification } from "@mantine/notifications";
import * as XLSX from "xlsx";
import { EventSurveyField } from "../dashboard/types";

interface SurveyResponse {
  id: string;
  userId?: string;
  userName?: string;
  userEmpresa?: string;
  createdAt?: any;
  updatedAt?: any;
  [key: string]: any;
}

const toDate = (v: any): Date | null => {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  return new Date(v);
};

export default function EventSurveyResultsPage() {
  const { eventId } = useParams();
  const [fields, setFields] = useState<EventSurveyField[]>([]);
  const [surveyTitle, setSurveyTitle] = useState("Encuesta del evento");
  const [responses, setResponses] = useState<SurveyResponse[]>([]);
  const [loading, setLoading] = useState(true);

  // Cargar config de la encuesta (campos) del evento
  useEffect(() => {
    if (!eventId) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "events", eventId));
        const cfg = snap.data()?.config?.eventSurvey;
        setFields(cfg?.fields || []);
        if (cfg?.title) setSurveyTitle(cfg.title);
      } catch (err) {
        console.error("Error cargando config de encuesta:", err);
      }
    })();
  }, [eventId]);

  // Suscripción en tiempo real a las respuestas del evento
  useEffect(() => {
    if (!eventId) return;
    const q = query(collection(db, "eventSurveys"), where("eventId", "==", eventId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const data: SurveyResponse[] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => {
          const da = toDate(a.updatedAt || a.createdAt)?.getTime() || 0;
          const dbb = toDate(b.updatedAt || b.createdAt)?.getTime() || 0;
          return dbb - da;
        });
        setResponses(data);
        setLoading(false);
      },
      (err) => {
        console.error("Error cargando respuestas:", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [eventId]);

  const handleDelete = (resp: SurveyResponse) => {
    modals.openConfirmModal({
      title: "Eliminar respuesta",
      children: (
        <Text size="sm">
          ¿Eliminar la respuesta de{" "}
          <b>{resp.userName || "este asistente"}</b>
          {resp.userEmpresa ? ` (${resp.userEmpresa})` : ""}? El asistente podrá
          volver a llenar la encuesta. Esta acción no se puede deshacer.
        </Text>
      ),
      labels: { confirm: "Eliminar", cancel: "Cancelar" },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "eventSurveys", resp.id));
          showNotification({
            title: "Respuesta eliminada",
            message: "El asistente podrá volver a responder la encuesta.",
            color: "teal",
          });
        } catch (err) {
          console.error("Error eliminando respuesta:", err);
          showNotification({
            title: "Error",
            message: "No se pudo eliminar la respuesta.",
            color: "red",
          });
        }
      },
    });
  };

  const handleExportExcel = () => {
    const dataToExport = responses.map((r) => {
      const row: Record<string, any> = {
        Asistente: r.userName || "-",
        Empresa: r.userEmpresa || "-",
      };
      fields.forEach((f) => {
        row[f.label] = r[f.name] ?? "-";
      });
      const d = toDate(r.updatedAt || r.createdAt);
      row["Fecha"] = d ? d.toLocaleString() : "-";
      return row;
    });
    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Encuesta evento");
    XLSX.writeFile(workbook, `encuesta_evento_${eventId}.xlsx`);
  };

  return (
    <Stack p="md">
      <Group justify="space-between" wrap="wrap">
        <div>
          <Group gap="xs">
            <Button
              component={Link}
              to={`/admin/event/${eventId}`}
              variant="light"
              leftSection={<IconArrowLeft size={16} />}
            >
              Volver
            </Button>
            <Title order={3}>{surveyTitle}</Title>
          </Group>
          <Text size="sm" c="dimmed" mt={4}>
            Respuestas de la encuesta de satisfacción del evento.
          </Text>
        </div>
        <Button
          onClick={handleExportExcel}
          color="green"
          leftSection={<IconFileSpreadsheet size={16} />}
          disabled={responses.length === 0}
        >
          Exportar a Excel
        </Button>
      </Group>

      {loading ? (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      ) : responses.length === 0 ? (
        <Paper withBorder radius="md" p="lg">
          <Text c="dimmed" ta="center">
            Aún no hay respuestas para esta encuesta.
          </Text>
        </Paper>
      ) : (
        <>
          <Group>
            <Badge size="lg" variant="light">
              Total: {responses.length}
            </Badge>
          </Group>
          <Paper withBorder radius="md">
            <ScrollArea>
              <Table striped highlightOnHover withTableBorder miw={600}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Asistente</Table.Th>
                    <Table.Th>Empresa</Table.Th>
                    {fields.map((f) => (
                      <Table.Th key={f.name}>{f.label}</Table.Th>
                    ))}
                    <Table.Th>Fecha</Table.Th>
                    <Table.Th style={{ width: 60, textAlign: "center" }}>Acción</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {responses.map((r) => {
                    const d = toDate(r.updatedAt || r.createdAt);
                    return (
                      <Table.Tr key={r.id}>
                        <Table.Td>{r.userName || "-"}</Table.Td>
                        <Table.Td>{r.userEmpresa || "-"}</Table.Td>
                        {fields.map((f) => (
                          <Table.Td key={f.name}>
                            {r[f.name] !== undefined && r[f.name] !== ""
                              ? String(r[f.name])
                              : "-"}
                          </Table.Td>
                        ))}
                        <Table.Td>{d ? d.toLocaleString() : "-"}</Table.Td>
                        <Table.Td style={{ textAlign: "center" }}>
                          <Tooltip label="Eliminar respuesta" withArrow>
                            <ActionIcon
                              color="red"
                              variant="light"
                              onClick={() => handleDelete(r)}
                            >
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Paper>
        </>
      )}
    </Stack>
  );
}

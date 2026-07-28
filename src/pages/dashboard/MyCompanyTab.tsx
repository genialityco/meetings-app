import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  Group,
  Stack,
  Title,
  Text,
  Image,
  Avatar,
  Card,
  Grid,
  Button,
  Badge,
  Divider,
  Loader,
  Paper,
  Box,
  ThemeIcon,
  SimpleGrid,
  ScrollArea,
  UnstyledButton,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import { doc, getDoc } from "firebase/firestore";
import * as XLSX from "xlsx";
import {
  IconBuilding,
  IconBriefcase,
  IconBuildingStore,
  IconMail,
  IconPhone,
  IconUsers,
  IconQrcode,
  IconScan,
  IconDownload,
} from "@tabler/icons-react";
import { db } from "../../firebase/firebaseConfig";
import { useCompanyData } from "./useCompanyData";
import { getTableLabel } from "./meetingSlotEngine";
import StandVisitQrModal from "./StandVisitQrModal";
import QrScannerModal from "../../components/QrScannerModal";
import AttendeeScanReviewModal from "../../components/AttendeeScanReviewModal";
import { useAttendeeScanFlow } from "../../hooks/useAttendeeScanFlow";
import { splitAttendeeFields } from "../../utils/attendeeFields";
import type { Product } from "./types";
import type { CompanyRepresentative } from "./useCompanyData";

export default function MyCompanyTab({ currentUser, requestMeetingWithSlotPicker, sendMeetingRequest: dashboardSendMeetingRequest, eventConfig }: any) {
  const { eventId } = useParams();
  const companyNit = currentUser?.data?.companyId || currentUser?.data?.company_nit;

  const {
    company,
    products,
    representatives,
    visits,
    lookupAttendeeForVisit,
    confirmVisit,
    loading,
    sendMeetingRequest: companySendMeetingRequest,
  } = useCompanyData(eventId, companyNit, { subscribeToVisits: true });

  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [exportingVisits, setExportingVisits] = useState(false);
  const myUid = currentUser?.uid;

  // Label del rol contrario al propio, para el escaneo de visitantes (comprador <-> vendedor).
  // Sin tipoAsistente definido (p. ej. roleMode "open"), se usa un término neutro.
  const myRole = (currentUser?.data?.tipoAsistente || "").toLowerCase().trim();
  const counterpartRoleLabel =
    myRole === "comprador" ? "vendedor" : myRole === "vendedor" ? "comprador" : "asistente";

  // Visitas registradas hoy (para la ficha "Hoy" del panel del stand)
  const visitsToday = visits.filter((v) => {
    const d = (v.visitedAt as any)?.toDate ? (v.visitedAt as any).toDate() : null;
    return d && d.toDateString() === new Date().toDateString();
  }).length;

  // Hora corta si la visita fue hoy; fecha corta + hora si fue otro día
  const formatVisitTime = (visitedAt: any) => {
    const d = visitedAt?.toDate ? visitedAt.toDate() : null;
    if (!d) return "";
    const isToday = d.toDateString() === new Date().toDateString();
    return isToday
      ? d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" })
      : d.toLocaleString("es-CO", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "America/Bogota",
        });
  };

  const attendeeScan = useAttendeeScanFlow({
    lookup: async (userId) => {
      const result = await lookupAttendeeForVisit(userId);
      if (result.kind === "error") return { error: result.message };
      return {
        attendee: result.attendee,
        alreadyDoneMessage: result.kind === "already-visited" ? "Ya registraste su visita" : undefined,
      };
    },
    confirm: async (attendee) => {
      const result = await confirmVisit(attendee);
      if (result.kind === "error") return { error: result.message };
      return { message: `${result.attendeeName} quedó registrado como visitante.` };
    },
  });

  const handleExportVisits = async () => {
    setExportingVisits(true);
    try {
      const { basicFields, additionalFields } = splitAttendeeFields(eventConfig?.formFields || []);
      const allFields = [...basicFields, ...additionalFields];
      const header = ["ID_ASISTENTE", "FECHA_VISITA", ...allFields.map((f: any) => (f.label || f.name).toUpperCase())];
      const rows: any[][] = [header];

      const attendeeSnaps = await Promise.all(
        visits.map((v) => getDoc(doc(db, "users", v.attendeeId))),
      );

      visits.forEach((v, i) => {
        const attendeeData: any = attendeeSnaps[i].exists() ? attendeeSnaps[i].data() : {};
        const visitDate = (v.visitedAt as any)?.toDate
          ? (v.visitedAt as any).toDate().toLocaleString("es-CO", { timeZone: "America/Bogota" })
          : "";
        const row = [
          v.attendeeId,
          visitDate,
          ...allFields.map((f: any) => {
            const val = attendeeData[f.name] ?? (f.name === "nombre" ? v.attendeeName : f.name === "empresa" ? v.attendeeEmpresa : "");
            return Array.isArray(val) ? val.join(", ") : (val ?? "");
          }),
        ];
        rows.push(row);
      });

      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Visitas");
      XLSX.writeFile(wb, `Visitas_${company?.razonSocial || companyNit}.xlsx`);
    } finally {
      setExportingVisits(false);
    }
  };

  const handleSendMeeting = async (
    rep: CompanyRepresentative,
    context?: { productId?: string; contextNote?: string },
  ) => {
    const key = context?.productId
      ? `${context.productId}-${rep.id}`
      : `rep-${rep.id}`;
    setLoadingId(key);
    try {
      // Usa el motor del dashboard (useDashboardData, ya cargado en MyCompanyPage) para
      // soportar el flujo "el solicitante elige horario"; si no está disponible, cae al
      // envío simple de useCompanyData.
      const send = requestMeetingWithSlotPicker || dashboardSendMeetingRequest;
      const result = send
        ? await send(rep.id, rep.telefono || "", null, { companyId: companyNit || null, ...context })
        : await companySendMeetingRequest(rep.id, rep.telefono || "", {
            companyId: companyNit || null,
            ...context,
          });

      if (!(result && (result as any).deferred)) {
        showNotification({
          title: "Solicitud enviada",
          message: `Solicitud enviada a ${rep.nombre}.`,
          color: "teal",
        });
      }
    } catch {
      showNotification({
        title: "Error",
        message: "No se pudo enviar la solicitud.",
        color: "red",
      });
    } finally {
      setLoadingId(null);
    }
  };

  const handleProductMeeting = async (p: Product) => {
    const rep = representatives.find((r) => r.id === p.ownerUserId);
    if (!rep) return;
    await handleSendMeeting(rep, {
      productId: p.id,
      contextNote: `Interesado en: ${p.title}`,
    });
  };

  if (!companyNit) {
    return (
      <Stack align="center" py="xl">
        <IconBuilding size={48} color="gray" />
        <Text c="dimmed" ta="center">
          No tienes una empresa asociada a tu perfil.
        </Text>
      </Stack>
    );
  }

  if (loading) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    );
  }

  if (!company) {
    return (
      <Stack align="center" py="xl">
        <IconBuilding size={48} color="gray" />
        <Text c="dimmed" ta="center">
          No se encontró la información de tu empresa.
        </Text>
      </Stack>
    );
  }

  return (
    <>
      <style>
        {`
          .stand-action-card .mantine-Paper-root {
            transition: box-shadow 150ms ease, transform 150ms ease;
          }
          .stand-action-card:hover .mantine-Paper-root {
            box-shadow: var(--mantine-shadow-md);
            transform: translateY(-2px);
          }
        `}
      </style>
    <Stack gap="lg">
      {/* Company header */}
      <Paper withBorder radius="lg" p="lg">
        <Group gap="md" align="flex-start" wrap="nowrap">
          {company.logoUrl ? (
            <Image
              src={company.logoUrl}
              alt={company.razonSocial}
              w={80}
              h={80}
              radius="md"
              fit="contain"
              style={{ flexShrink: 0 }}
            />
          ) : (
            <Avatar size={80} radius="md" color="blue" style={{ flexShrink: 0 }}>
              {(company.razonSocial || "E")[0]?.toUpperCase()}
            </Avatar>
          )}
          <Stack gap={4} style={{ minWidth: 0 }}>
            <Title order={3}>{company.razonSocial}</Title>
            <Text size="sm" c="dimmed">
              NIT: {company.nitNorm}
            </Text>
            {company.descripcion && (
              <Text size="sm" mt="xs" style={{ whiteSpace: "pre-wrap" }}>
                {company.descripcion}
              </Text>
            )}
            <Group gap="sm" mt="xs">
              <Badge variant="light" size="sm">
                {representatives.length}{" "}
                {representatives.length === 1 ? "representante" : "representantes"}
              </Badge>
              <Badge variant="light" size="sm">
                {products.length}{" "}
                {products.length === 1 ? "producto" : "productos"}
              </Badge>
              {company.fixedTable && (
                <Badge variant="light" size="sm" color="orange">
                  {getTableLabel(company.fixedTable, eventConfig?.tableNames)}
                </Badge>
              )}
            </Group>
          </Stack>
        </Group>
      </Paper>

      {/* Panel del stand: métricas, acciones principales y visitantes */}
      {eventConfig?.policies?.standVisitsEnabled && (
        <Paper withBorder radius="lg" p="lg">
          <Stack gap="md">
            <Group gap={8}>
              <ThemeIcon variant="light" color="grape" radius="xl" size={32}>
                <IconUsers size={18} />
              </ThemeIcon>
              <Title order={4}>Mi stand</Title>
            </Group>

            {/* Métricas del stand */}
            <SimpleGrid cols={3} spacing="sm">
              <Paper radius="md" p="sm" bg="gray.0" ta="center">
                <Text size="xxl" fw={700} lh={1.2}>
                  {visits.length}
                </Text>
                <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                  Visitantes
                </Text>
              </Paper>
              <Paper radius="md" p="sm" bg="gray.0" ta="center">
                <Text size="xxl" fw={700} lh={1.2}>
                  {visitsToday}
                </Text>
                <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                  Hoy
                </Text>
              </Paper>
              <Paper radius="md" p="sm" bg="gray.0" ta="center">
                <Text size="xxl" fw={700} lh={1.2}>
                  {products.length}
                </Text>
                <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                  Productos
                </Text>
              </Paper>
            </SimpleGrid>

            {/* Acciones principales */}
            <Grid gutter="sm">
              <Grid.Col
                span={{ base: 12, xs: eventConfig?.policies?.standVisitAllowSellerScan ? 6 : 12 }}
              >
                <StandVisitQrModal
                  eventId={eventId as string}
                  companyNit={companyNit}
                  renderTrigger={(open) => (
                    <UnstyledButton onClick={open} className="stand-action-card" w="100%">
                      <Paper withBorder radius="lg" p="md" ta="center" h="100%">
                        <ThemeIcon variant="light" color="grape" size={44} radius="xl" mb={6}>
                          <IconQrcode size={24} />
                        </ThemeIcon>
                        <Text fw={600} size="sm">
                          Mostrar QR del stand
                        </Text>
                        <Text size="xs" c="dimmed">
                          El visitante lo escanea y su visita queda registrada
                        </Text>
                      </Paper>
                    </UnstyledButton>
                  )}
                />
              </Grid.Col>
              {eventConfig?.policies?.standVisitAllowSellerScan && (
                <Grid.Col span={{ base: 12, xs: 6 }}>
                  <UnstyledButton
                    onClick={() => attendeeScan.setScannerOpened(true)}
                    className="stand-action-card"
                    w="100%"
                  >
                    <Paper withBorder radius="lg" p="md" ta="center" h="100%">
                      <ThemeIcon variant="light" color="blue" size={44} radius="xl" mb={6}>
                        <IconScan size={24} />
                      </ThemeIcon>
                      <Text fw={600} size="sm">
                        Escanear visitante
                      </Text>
                      <Text size="xs" c="dimmed">
                        Escanea la credencial del {counterpartRoleLabel} para registrar su visita
                      </Text>
                    </Paper>
                  </UnstyledButton>
                </Grid.Col>
              )}
            </Grid>

            {/* Lista de visitantes */}
            <Box>
              <Group justify="space-between" mb="xs">
                <Group gap={6}>
                  <Text fw={600} size="sm">
                    Visitantes registrados
                  </Text>
                  <Badge variant="light" color="grape" size="sm">
                    {visits.length}
                  </Badge>
                </Group>
                {visits.length > 0 && (
                  <Button
                    variant="subtle"
                    color="green"
                    size="compact-sm"
                    leftSection={<IconDownload size={14} />}
                    loading={exportingVisits}
                    onClick={handleExportVisits}
                  >
                    Exportar a Excel
                  </Button>
                )}
              </Group>
              {visits.length === 0 ? (
                <Paper radius="md" p="lg" bg="gray.0" ta="center">
                  <IconUsers size={28} color="var(--mantine-color-gray-5)" />
                  <Text c="dimmed" size="sm" mt={4}>
                    Aún no tienes visitantes. Muestra el QR del stand
                    {eventConfig?.policies?.standVisitAllowSellerScan
                      ? " o escanea credenciales"
                      : ""}{" "}
                    para registrarlos.
                  </Text>
                </Paper>
              ) : (
                <ScrollArea.Autosize mah={340} offsetScrollbars>
                  <Stack gap={0}>
                    {visits.map((v, i) => (
                      <Box key={v.id}>
                        {i > 0 && <Divider />}
                        <Group justify="space-between" wrap="nowrap" py={8}>
                          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                            <Avatar radius="xl" size={32} color="grape">
                              {(v.attendeeName || "A")[0]?.toUpperCase()}
                            </Avatar>
                            <Stack gap={0} style={{ minWidth: 0 }}>
                              <Text size="sm" fw={500} lineClamp={1}>
                                {v.attendeeName || "Asistente"}
                              </Text>
                              {v.attendeeEmpresa && (
                                <Text size="xs" c="dimmed" lineClamp={1}>
                                  {v.attendeeEmpresa}
                                </Text>
                              )}
                            </Stack>
                          </Group>
                          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                            {formatVisitTime(v.visitedAt)}
                          </Text>
                        </Group>
                      </Box>
                    ))}
                  </Stack>
                </ScrollArea.Autosize>
              )}
            </Box>
          </Stack>
        </Paper>
      )}

      {/* Representatives section */}
      {representatives.length > 0 && (
        <>
          <Divider
            label={
              <Group gap={6}>
                <IconBriefcase size={16} />
                <Text fw={600}>Representantes</Text>
              </Group>
            }
          />
          <Grid gutter="sm">
            {representatives.map((rep) => {
              const isSelf = rep.id === myUid;
              return (
                <Grid.Col key={rep.id} span={{ base: 12, sm: 6 }}>
                  <Card withBorder radius="md" p="sm" style={{ height: "100%" }}>
                    <Group gap="sm" wrap="nowrap" align="flex-start">
                      <Avatar
                        src={rep.photoURL}
                        size={50}
                        radius="xl"
                        style={{ flexShrink: 0 }}
                      >
                        {(rep.nombre || "U")[0]?.toUpperCase()}
                      </Avatar>
                      <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                        <Text fw={600} lineClamp={1}>
                          {rep.nombre}
                        </Text>
                        {rep.cargo && (
                          <Group gap={4} wrap="nowrap">
                            <IconBriefcase size={12} color="gray" />
                            <Text size="xs" c="dimmed" lineClamp={1}>
                              {rep.cargo}
                            </Text>
                          </Group>
                        )}
                        {(rep.correo || rep.contacto?.correo) && (
                          <Group gap={4} wrap="nowrap">
                            <IconMail size={12} color="gray" />
                            <Text size="xs" c="dimmed" lineClamp={1}>
                              {rep.correo || rep.contacto?.correo}
                            </Text>
                          </Group>
                        )}
                        {(rep.telefono || rep.contacto?.telefono) && (
                          <Group gap={4} wrap="nowrap">
                            <IconPhone size={12} color="gray" />
                            <Text size="xs" c="dimmed">
                              {rep.telefono || rep.contacto?.telefono}
                            </Text>
                          </Group>
                        )}
                      </Stack>
                    </Group>
                    <Button
                      mt="sm"
                      size="compact-sm"
                      fullWidth
                      variant="light"
                      disabled={isSelf || loadingId === `rep-${rep.id}`}
                      loading={loadingId === `rep-${rep.id}`}
                      onClick={() => handleSendMeeting(rep)}
                    >
                      {isSelf ? "Eres tú" : "Solicitar reunión"}
                    </Button>
                  </Card>
                </Grid.Col>
              );
            })}
          </Grid>
        </>
      )}

      {/* Products section */}
      {products.length > 0 && (
        <>
          <Divider
            label={
              <Group gap={6}>
                <IconBuildingStore size={16} />
                <Text fw={600}>Productos</Text>
              </Group>
            }
          />
          <Grid gutter="sm">
            {products.map((p) => {
              const isMine = !!myUid && p.ownerUserId === myUid;
              const key = `${p.id}-${p.ownerUserId}`;
              return (
                <Grid.Col key={p.id} span={{ base: 6, md: 4, lg: 3 }}>
                  <Card
                    withBorder
                    radius="lg"
                    padding="sm"
                    shadow="sm"
                    style={{ height: "100%", overflow: "hidden" }}
                  >
                    <Card.Section>
                      {p.imageUrl ? (
                        <Box style={{ position: "relative" }}>
                          <Image
                            src={p.imageUrl}
                            alt={p.title}
                            height={140}
                            fit="cover"
                          />
                          {p.category && (
                            <Badge
                              variant="filled"
                              radius="md"
                              size="sm"
                              style={{
                                position: "absolute",
                                top: 10,
                                left: 10,
                                background: "rgba(0,0,0,0.55)",
                                border: "1px solid rgba(255,255,255,0.18)",
                              }}
                            >
                              {p.category}
                            </Badge>
                          )}
                        </Box>
                      ) : (
                        <Box
                          style={{
                            height: 140,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Avatar size={64} radius="md" color="gray">
                            {(p.title || "P")[0]?.toUpperCase()}
                          </Avatar>
                        </Box>
                      )}
                    </Card.Section>

                    <Stack gap={8} mt="sm" style={{ height: "calc(100% - 140px)" }}>
                      <Title order={6} lineClamp={2}>
                        {p.title}
                      </Title>
                      <Text size="xs" c="dimmed" lineClamp={3} style={{ whiteSpace: "pre-wrap" }}>
                        {p.description}
                      </Text>
                      <Divider my={2} />
                      <Button
                        mt="auto"
                        size="compact-sm"
                        radius="md"
                        fullWidth
                        variant={isMine ? "light" : "filled"}
                        disabled={isMine || loadingId === key}
                        loading={loadingId === key}
                        onClick={() => handleProductMeeting(p)}
                      >
                        {isMine ? "Tu producto" : "Solicitar reunión"}
                      </Button>
                    </Stack>
                  </Card>
                </Grid.Col>
              );
            })}
          </Grid>
        </>
      )}

      {/* Empty state */}
      {products.length === 0 && representatives.length === 0 && (
        <Paper withBorder radius="lg" p="lg">
          <Text c="dimmed" ta="center">
            Tu empresa aún no tiene representantes ni productos registrados.
          </Text>
        </Paper>
      )}

      <QrScannerModal
        opened={attendeeScan.scannerOpened}
        onClose={() => attendeeScan.setScannerOpened(false)}
        onDecode={attendeeScan.handleDecode}
        title={`Escanear credencial del ${counterpartRoleLabel}`}
        hint="Apunta la cámara a la credencial del asistente para registrar su visita a tu stand."
      />

      <AttendeeScanReviewModal
        opened={!!attendeeScan.reviewing}
        attendee={attendeeScan.reviewing?.attendee}
        formFields={eventConfig?.formFields}
        title="Asistente escaneado"
        alreadyDoneMessage={attendeeScan.reviewing?.alreadyDoneMessage}
        actionLabel="Registrar visita"
        actionColor="grape"
        confirming={attendeeScan.confirming}
        onConfirm={attendeeScan.handleConfirm}
        onCancel={attendeeScan.closeReview}
      />
    </Stack>
    </>
  );
}

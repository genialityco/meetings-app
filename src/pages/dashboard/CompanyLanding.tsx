import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Container,
  MantineProvider,
  createTheme,
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
  ThemeIcon,
  Box,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import { generateColors } from "@mantine/colors-generator";
import {
  IconArrowLeft,
  IconMail,
  IconPhone,
  IconBriefcase,
  IconBuildingStore,
} from "@tabler/icons-react";
import { useCompanyData } from "./useCompanyData";
import type { Product } from "./types";
import type { CompanyRepresentative } from "./useCompanyData";

export default function CompanyLanding() {
  const { eventId, companyNit } = useParams();
  const navigate = useNavigate();
  const {
    company,
    products,
    representatives,
    eventConfig,
    eventName,
    dashboardLogo,
    eventImage,
    loading,
    currentUser,
    sendMeetingRequest,
  } = useCompanyData(eventId, companyNit);

  const [loadingId, setLoadingId] = useState<string | null>(null);
  const myUid = currentUser?.uid;

  const eventTheme = useMemo(() => {
    const hex = eventConfig?.primaryColor;
    if (!hex) return createTheme({});
    return createTheme({
      colors: { eventPrimary: generateColors(hex) },
      primaryColor: "eventPrimary",
    });
  }, [eventConfig?.primaryColor]);

  const handleSendMeeting = async (
    rep: CompanyRepresentative,
    context?: { productId?: string; contextNote?: string },
  ) => {
    const key = context?.productId
      ? `${context.productId}-${rep.id}`
      : `rep-${rep.id}`;
    setLoadingId(key);
    try {
      await sendMeetingRequest(rep.id, rep.telefono || "", {
        companyId: companyNit || null,
        ...context,
      });
      showNotification({
        title: "Solicitud enviada",
        message: `Solicitud enviada a ${rep.nombre}.`,
        color: "teal",
      });
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

  if (loading) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    );
  }

  if (!company) {
    return (
      <Container py="xl">
        <Stack align="center" gap="md">
          <Title order={3}>Empresa no encontrada</Title>
          <Button
            variant="light"
            leftSection={<IconArrowLeft size={16} />}
            onClick={() => navigate(`/dashboard/${eventId}`)}
          >
            Volver al dashboard
          </Button>
        </Stack>
      </Container>
    );
  }

  return (
    <MantineProvider theme={eventTheme} inherit>
      <Container size="lg" py="md">
        <Stack gap="lg">
          {/* Back button + event branding */}
          <Group justify="space-between" align="center">
            <Button
              variant="subtle"
              leftSection={<IconArrowLeft size={16} />}
              onClick={() => navigate(`/dashboard/${eventId}`)}
            >
              Volver al dashboard
            </Button>
            {(dashboardLogo || eventImage) && (
              <Image
                src={dashboardLogo || eventImage}
                alt={eventName}
                h={36}
                w="auto"
                fit="contain"
              />
            )}
          </Group>

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
                    {representatives.length === 1
                      ? "representante"
                      : "representantes"}
                  </Badge>
                  <Badge variant="light" size="sm">
                    {products.length}{" "}
                    {products.length === 1 ? "producto" : "productos"}
                  </Badge>
                  {company.fixedTable && (
                    <Badge variant="light" size="sm" color="orange">
                      Mesa: {company.fixedTable}
                    </Badge>
                  )}
                </Group>
              </Stack>
            </Group>
          </Paper>

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
                    <Grid.Col key={p.id} span={6}>
                      <Card
                        withBorder
                        radius="lg"
                        padding="sm"
                        shadow="sm"
                        style={{ height: "100%", overflow: "hidden" }}
                      >
                        {/* Image */}
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
                Esta empresa aún no tiene representantes ni productos registrados.
              </Text>
            </Paper>
          )}
        </Stack>
      </Container>
    </MantineProvider>
  );
}

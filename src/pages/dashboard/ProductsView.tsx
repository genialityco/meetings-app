import {
  Grid,
  Card,
  Group,
  Avatar,
  Title,
  Text,
  Button,
  TextInput,
  Select,
  Badge,
  Divider,
  Image,
  Stack,
  SegmentedControl,
  Paper,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import { useState, useMemo } from "react";
import type { Product, Company, Assistant, MeetingContext } from "./types";

interface ProductsViewProps {
  products: Product[];
  companies: Company[];
  filteredAssistants: Assistant[];
  solicitarReunionHabilitado: boolean;
  sendMeetingRequest: (
    id: string,
    phone: string,
    groupId?: string | null,
    context?: MeetingContext,
  ) => Promise<void>;
  currentUser: any;
}

export default function ProductsView({
  products,
  companies,
  filteredAssistants,
  solicitarReunionHabilitado,
  sendMeetingRequest,
  currentUser,
}: ProductsViewProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [companyFilter, setCompanyFilter] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<string>("individual");

  const myUid = currentUser?.uid;

  // Options de empresas para filtro
  const companyOptions = useMemo(() => {
    const set = new Set<string>();
    (products || []).forEach((p) => {
      if (p.ownerCompany) set.add(p.ownerCompany);
    });
    return Array.from(set)
      .sort()
      .map((c) => ({ value: c, label: c }));
  }, [products]);

  // Filtrar productos
  const filteredProducts = useMemo(() => {
    return (products || []).filter((p) => {
      // Filtro por empresa
      if (companyFilter && p.ownerCompany !== companyFilter) return false;
      // Filtro por texto
      const t = searchTerm.toLowerCase().trim();
      if (!t) return true;
      return (
        (p.title || "").toLowerCase().includes(t) ||
        (p.description || "").toLowerCase().includes(t) ||
        (p.ownerCompany || "").toLowerCase().includes(t) ||
        (p.ownerName || "").toLowerCase().includes(t)
      );
    });
  }, [products, searchTerm, companyFilter]);

  // Agrupar productos por empresa
  const groupedByCompany = useMemo(() => {
    const groups = new Map<string, { company: Company | undefined; companyName: string; products: Product[] }>();
    filteredProducts.forEach((p) => {
      const key = p.companyId || p.ownerCompany || "__sin_empresa__";
      if (!groups.has(key)) {
        const companyDoc = companies.find((c) => c.nitNorm === p.companyId);
        groups.set(key, {
          company: companyDoc,
          companyName: p.ownerCompany || "Sin empresa",
          products: [],
        });
      }
      groups.get(key)!.products.push(p);
    });
    // Ordenar por nombre de empresa
    return Array.from(groups.values()).sort((a, b) =>
      a.companyName.localeCompare(b.companyName),
    );
  }, [filteredProducts, companies]);

  // Encontrar representantes de la empresa de un producto
  const getCompanyReps = (product: Product) => {
    if (!product.companyId) return [];
    return filteredAssistants.filter(
      (a) =>
        (a.companyId || a.company_nit) === product.companyId && a.id !== myUid,
    );
  };

  const handleSendMeeting = async (
    assistantId: string,
    assistantPhone: string,
    product: Product,
  ) => {
    setLoadingId(`${product.id}-${assistantId}`);
    try {
      await sendMeetingRequest(assistantId, assistantPhone, null, {
        productId: product.id,
        companyId: product.companyId || null,
        contextNote: `Interesado en: ${product.title}`,
      });
      showNotification({
        title: "Solicitud enviada",
        message: `Solicitud enviada por el producto "${product.title}".`,
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

  const renderProductCard = (p: Product, showCompanyBadge: boolean) => {
    const companyDoc = companies.find((c) => c.nitNorm === p.companyId);
    const reps = getCompanyReps(p);

    return (
      <Grid.Col key={p.id} span={{ xs: 12, sm: 6, md: 4 }}>
        <Card shadow="sm" p="lg" withBorder style={{ height: "100%" }}>
          {/* Header: título + empresa */}
          <Group justify="space-between" mb="xs" wrap="nowrap">
            <Title order={5} lineClamp={1} style={{ minWidth: 0 }}>
              {p.title}
            </Title>
            {showCompanyBadge && (
              <Badge variant="light">{p.ownerCompany || "Empresa"}</Badge>
            )}
          </Group>

          {/* Imagen del producto */}
          {p.imageUrl && (
            <Image
              src={p.imageUrl}
              alt={p.title}
              height={160}
              radius="md"
              fit="cover"
              mb="sm"
            />
          )}

          {/* Descripción */}
          <Text size="sm" c="dimmed" lineClamp={4} style={{ whiteSpace: "pre-wrap" }}>
            {p.description}
          </Text>

          <Divider my="md" />

          {/* Empresa con logo (solo en vista individual) */}
          {showCompanyBadge && (
            <Group gap="sm" mb="sm">
              {companyDoc?.logoUrl ? (
                <Image
                  src={companyDoc.logoUrl}
                  alt={p.ownerCompany || ""}
                  w={28}
                  h={28}
                  radius="sm"
                  fit="contain"
                />
              ) : (
                <Avatar size="sm" radius="sm" color="blue">
                  {(p.ownerCompany || "E")[0]?.toUpperCase()}
                </Avatar>
              )}
              <Text size="sm" fw={500}>
                {p.ownerCompany || "Sin empresa"}
              </Text>
            </Group>
          )}

          {/* Publicado por */}
          <Text size="sm" mb="sm">
            <strong>Publicado por:</strong> {p.ownerName || "—"}
          </Text>

          {/* Representantes */}
          {reps.length > 0 && (
            <Stack gap="xs" mb="sm">
              <Text size="xs" fw={600} c="dimmed">
                Representantes disponibles:
              </Text>
              {reps.slice(0, 3).map((rep) => (
                <Group key={rep.id} justify="space-between" gap="xs">
                  <Group gap="xs">
                    <Avatar src={rep.photoURL} size="xs" radius="xl">
                      {rep.nombre?.[0]}
                    </Avatar>
                    <Text size="xs">{rep.nombre}</Text>
                  </Group>
                  <Button
                    size="compact-xs"
                    variant="light"
                    onClick={() => handleSendMeeting(rep.id, rep.telefono || "", p)}
                    disabled={!solicitarReunionHabilitado || loadingId === `${p.id}-${rep.id}`}
                    loading={loadingId === `${p.id}-${rep.id}`}
                  >
                    Reunión
                  </Button>
                </Group>
              ))}
            </Stack>
          )}

          {/* CTA principal: solicitar reunión al owner */}
          <Button
            mt="auto"
            fullWidth
            onClick={() => handleSendMeeting(p.ownerUserId, p.ownerPhone || "", p)}
            disabled={
              !solicitarReunionHabilitado ||
              !p.ownerUserId ||
              p.ownerUserId === myUid ||
              loadingId === `${p.id}-${p.ownerUserId}`
            }
            loading={loadingId === `${p.id}-${p.ownerUserId}`}
          >
            {!solicitarReunionHabilitado
              ? "Solicitudes deshabilitadas"
              : p.ownerUserId === myUid
                ? "Este producto es tuyo"
                : "Solicitar reunión"}
          </Button>
        </Card>
      </Grid.Col>
    );
  };

  return (
    <>
      <Group grow mb="md">
        <TextInput
          placeholder="Buscar producto, empresa o vendedor..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <Select
          data={companyOptions}
          placeholder="Filtrar por empresa"
          value={companyFilter}
          onChange={setCompanyFilter}
          clearable
          searchable
        />
      </Group>

      <Group mb="md">
        <SegmentedControl
          size="xs"
          value={viewMode}
          onChange={setViewMode}
          data={[
            { value: "individual", label: "Productos" },
            { value: "byCompany", label: "Por empresa" },
          ]}
        />
      </Group>

      {filteredProducts.length === 0 ? (
        <Text c="dimmed">
          {searchTerm || companyFilter
            ? "No se encontraron productos con los filtros aplicados."
            : "Aún no hay productos publicados para este evento."}
        </Text>
      ) : viewMode === "individual" ? (
        <Grid>
          {filteredProducts.map((p) => renderProductCard(p, true))}
        </Grid>
      ) : (
        <Stack gap="lg">
          {groupedByCompany.map((group) => (
            <Paper key={group.companyName} shadow="xs" p="md" withBorder>
              {/* Header de empresa */}
              <Group gap="sm" mb="md">
                {group.company?.logoUrl ? (
                  <Image
                    src={group.company.logoUrl}
                    alt={group.companyName}
                    w={36}
                    h={36}
                    radius="sm"
                    fit="contain"
                  />
                ) : (
                  <Avatar size="md" radius="sm" color="blue">
                    {group.companyName[0]?.toUpperCase()}
                  </Avatar>
                )}
                <div>
                  <Title order={5}>{group.companyName}</Title>
                  <Text size="xs" c="dimmed">
                    {group.products.length}{" "}
                    {group.products.length === 1 ? "producto" : "productos"}
                  </Text>
                </div>
              </Group>

              <Grid>
                {group.products.map((p) => renderProductCard(p, false))}
              </Grid>
            </Paper>
          ))}
        </Stack>
      )}
    </>
  );
}

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
  Image,
  Stack,
  Box,
  ActionIcon,
  Divider,
  Paper,
  ThemeIcon,
  Loader,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import { useState, useMemo, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { IconSearch, IconX, IconFilterOff, IconBuildingStore, IconSparkles } from "@tabler/icons-react";
import type { Product, Company, Assistant, MeetingContext } from "./types";

interface ProductsViewProps {
  products: Product[];
  companies: Company[];
  filteredAssistants: Assistant[]; // (se mantiene por compatibilidad aunque no se use aquí)
  solicitarReunionHabilitado: boolean;
  sendMeetingRequest: (
    id: string,
    phone: string,
    groupId?: string | null,
    context?: MeetingContext,
  ) => Promise<void>;
  currentUser: any;
}

const VECTOR_SEARCH_URL = "https://vectorsearch-6eaymlz5eq-uc.a.run.app";

export default function ProductsView({
  products,
  companies,
  solicitarReunionHabilitado,
  sendMeetingRequest,
  currentUser,
}: ProductsViewProps) {
  const navigate = useNavigate();
  const { eventId } = useParams();

  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [vectorResults, setVectorResults] = useState<Product[]>([]);
  const [isVectorSearching, setIsVectorSearching] = useState(false);
  const [useVectorSearch, setUseVectorSearch] = useState(false);

  const myUid = currentUser?.uid;

  // Mapa para evitar companies.find() por cada card
  const companiesByNit = useMemo(() => {
    const map = new Map<string, Company>();
    (companies || []).forEach((c) => {
      if (c?.nitNorm) map.set(c.nitNorm, c);
    });
    return map;
  }, [companies]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    (products || []).forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((c) => ({ value: c, label: c }));
  }, [products]);

  // Búsqueda por vectores con debounce
  useEffect(() => {
    const trimmed = searchTerm.trim();
    
    // Si no hay texto de búsqueda, resetear
    if (!trimmed) {
      setUseVectorSearch(false);
      setVectorResults([]);
      return;
    }

    // Si el texto es muy corto, no usar vectores
    if (trimmed.length < 3) {
      setUseVectorSearch(false);
      return;
    }

    // Debounce: esperar 500ms después de que el usuario deje de escribir
    const timeoutId = setTimeout(async () => {
      setIsVectorSearching(true);
      
      try {
        const response = await fetch(VECTOR_SEARCH_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: trimmed,
            category: "products",
            eventId: eventId,
            userId: myUid,
            limit: 50,
            threshold: 0.62,
          }),
        });

        if (!response.ok) {
          throw new Error("Vector search failed");
        }

        const data = await response.json();
        
        // Enriquecer resultados con datos completos de products
        const enrichedResults = data.results
          .map((result: any) => {
            const fullProduct = products.find(p => p.id === result.id);
            return fullProduct ? { ...fullProduct, similarity: result.similarity } : null;
          })
          .filter(Boolean) as Product[];

        setVectorResults(enrichedResults);
        setUseVectorSearch(true);
        
        console.log(`Vector search found ${enrichedResults.length} products`);
      } catch (error) {
        console.error("Vector search error:", error);
        // Fallback a búsqueda normal
        setUseVectorSearch(false);
        setVectorResults([]);
      } finally {
        setIsVectorSearching(false);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [searchTerm, eventId, myUid, products]);

  const filteredProducts = useMemo(() => {
    // Si estamos usando búsqueda por vectores
    if (useVectorSearch && searchTerm.trim().length >= 3) {
      // Aplicar solo filtro de categoría si existe
      if (categoryFilter) {
        return vectorResults.filter(p => p.category === categoryFilter);
      }
      return vectorResults;
    }

    // Búsqueda tradicional (keyword-based)
    const t = searchTerm.toLowerCase().trim();
    return (products || []).filter((p) => {
      if (categoryFilter && p.category !== categoryFilter) return false;
      if (!t) return true;

      return (
        (p.title || "").toLowerCase().includes(t) ||
        (p.description || "").toLowerCase().includes(t) ||
        (p.category || "").toLowerCase().includes(t) ||
        (p.ownerCompany || "").toLowerCase().includes(t)
      );
    });
  }, [products, searchTerm, categoryFilter, useVectorSearch, vectorResults]);

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

  const clearFilters = () => {
    setSearchTerm("");
    setCategoryFilter(null);
    setUseVectorSearch(false);
    setVectorResults([]);
  };

  const renderProductCard = (p: Product) => {
    const companyDoc = p.companyId ? companiesByNit.get(p.companyId) : undefined;

    const isMine = !!myUid && p.ownerUserId === myUid;
    const isDisabled =
      !solicitarReunionHabilitado ||
      !p.ownerUserId ||
      isMine ||
      loadingId === `${p.id}-${p.ownerUserId}`;

    const ctaLabel = !solicitarReunionHabilitado
      ? "Deshabilitado"
      : isMine
        ? "Tu producto"
        : "Solicitar reunión";

    return (
      <Grid.Col
        key={p.id}
        // ✅ 2 columnas en mobile: base=6 (12-grid => 2 columnas)
        span={{ base: 6, sm: 4, md: 3, lg: 3 }}
      >
        <Card
          withBorder
          radius="lg"
          padding="sm"
          shadow="sm"
          style={{
            height: "100%",
            overflow: "hidden",
          }}
        >
          {/* Imagen */}
          <Card.Section>
            {p.imageUrl ? (
              <Box style={{ position: "relative" }}>
                <Image
                  src={p.imageUrl}
                  alt={p.title}
                  height={140}
                  fit="cover"
                />
                {/* Overlay sutil para que se vea más “card premium” */}
                <Box
                  style={{
                    position: "absolute",
                    inset: 0,
                    background:
                      "linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.35) 100%)",
                    pointerEvents: "none",
                  }}
                />
                {/* Badge de categoría arriba */}
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
                  justifyContent: "center"}}
              >
                <Avatar size={64} radius="md" color="gray">
                  {(p.title || "P")[0]?.toUpperCase()}
                </Avatar>
              </Box>
            )}
          </Card.Section>

          <Stack gap={8} mt="sm" style={{ height: "calc(100% - 140px)" }}>
            {/* Título */}
            <Title order={6} lineClamp={2} style={{ minWidth: 0 }}>
              {p.title || "Producto"}
            </Title>

            {/* Empresa */}
            <Group
              gap={8}
              wrap="nowrap"
              style={{ cursor: p.companyId ? "pointer" : undefined }}
              onClick={
                p.companyId && eventId
                  ? () => navigate(`/dashboard/${eventId}/company/${p.companyId}`)
                  : undefined
              }
            >
              {companyDoc?.logoUrl ? (
                <Image
                  src={companyDoc.logoUrl}
                  alt={p.ownerCompany || ""}
                  w={22}
                  h={22}
                  radius="sm"
                  fit="contain"
                />
              ) : (
                <ThemeIcon variant="light" radius="md" size={22}>
                  <IconBuildingStore size={14} />
                </ThemeIcon>
              )}
              <Text
                size="xs"
                fw={600}
                lineClamp={1}
                style={{ minWidth: 0 }}
                td={p.companyId ? "underline" : undefined}
              >
                {p.ownerCompany || "Sin empresa"}
              </Text>
            </Group>

            {/* Descripción */}
            <Text
              size="xs"
              c="dimmed"
              lineClamp={3}
              style={{ whiteSpace: "pre-wrap" }}
            >
              {p.description || "Sin descripción."}
            </Text>

            <Divider my={2} />

            {/* CTA */}
            <Button
              mt="auto"
              size="compact-sm"
              radius="md"
              fullWidth
              variant={isDisabled ? "light" : "filled"}
              onClick={() =>
                handleSendMeeting(p.ownerUserId, p.ownerPhone || "", p)
              }
              disabled={isDisabled}
              loading={loadingId === `${p.id}-${p.ownerUserId}`}
            >
              {ctaLabel}
            </Button>
          </Stack>
        </Card>
      </Grid.Col>
    );
  };

  const hasFilters = !!searchTerm.trim() || !!categoryFilter;

  return (
    <Stack gap="md">
      {/* Filtros (responsive) */}
      <Paper withBorder radius="lg" p="sm">
        <Grid gutter="sm" align="center">
          <Grid.Col span={{ base: 12, sm: 7 }}>
            <TextInput
              placeholder="Buscar producto, categoría, empresa..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              leftSection={
                isVectorSearching ? (
                  <Loader size={16} />
                ) : useVectorSearch ? (
                  <IconSparkles size={16} style={{ color: "var(--mantine-color-blue-6)" }} />
                ) : (
                  <IconSearch size={16} />
                )
              }
              rightSection={
                searchTerm ? (
                  <ActionIcon
                    variant="subtle"
                    onClick={() => setSearchTerm("")}
                    aria-label="Limpiar búsqueda"
                  >
                    <IconX size={16} />
                  </ActionIcon>
                ) : null
              }
              radius="md"
            />
          </Grid.Col>

          <Grid.Col span={{ base: 12, sm: 5 }}>
            <Select
              data={categoryOptions}
              placeholder="Filtrar por categoría"
              value={categoryFilter}
              onChange={setCategoryFilter}
              clearable
              searchable
              radius="md"
            />
          </Grid.Col>

          {hasFilters && (
            <Grid.Col span={{ base: 12, sm: 12 }}>
              <Group justify="space-between" wrap="wrap">
                <Group gap="xs">
                  <Text size="xs" c="dimmed">
                    Mostrando {filteredProducts.length} resultado(s)
                  </Text>
                  {useVectorSearch && (
                    <Badge size="xs" variant="light" color="blue" leftSection={<IconSparkles size={10} />}>
                      Búsqueda inteligente
                    </Badge>
                  )}
                </Group>
                <Button
                  size="xs"
                  variant="subtle"
                  leftSection={<IconFilterOff size={14} />}
                  onClick={clearFilters}
                >
                  Limpiar filtros
                </Button>
              </Group>
            </Grid.Col>
          )}
        </Grid>
      </Paper>

      {/* Resultados */}
      {filteredProducts.length === 0 ? (
        <Paper withBorder radius="lg" p="lg">
          <Stack gap={6}>
            <Title order={5}>No hay resultados</Title>
            <Text c="dimmed" size="sm">
              {hasFilters
                ? "No se encontraron productos con los filtros aplicados."
                : "Aún no hay productos publicados para este evento."}
            </Text>
            {hasFilters && (
              <Button
                mt="sm"
                variant="light"
                radius="md"
                onClick={clearFilters}
                style={{ alignSelf: "flex-start" }}
              >
                Quitar filtros
              </Button>
            )}
          </Stack>
        </Paper>
      ) : (
        <Grid gutter="sm">{filteredProducts.map(renderProductCard)}</Grid>
      )}
    </Stack>
  );
}

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
import MeetingRequestModal from "./MeetingRequestModal";

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
  affinityScores: Record<string, number>;
  highlightEntityId?: string;
  policies?: any;
}

const VECTOR_SEARCH_URL = "https://vectorsearch-6eaymlz5eq-uc.a.run.app";

export default function ProductsView({
  products,
  companies,
  solicitarReunionHabilitado,
  sendMeetingRequest,
  currentUser,
  affinityScores,
  highlightEntityId,
  policies,
}: ProductsViewProps) {
  const navigate = useNavigate();
  const { eventId } = useParams();

  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [modalOpened, setModalOpened] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<{ product: Product; assistantId: string; assistantPhone: string } | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const [vectorResults, setVectorResults] = useState<any[]>([]);
  const [isVectorSearching, setIsVectorSearching] = useState(false);
  const [hasSearchedVector, setHasSearchedVector] = useState(false);

  const myUid = currentUser?.uid;

  const allowImageUpload = policies?.allowProductImageUpload !== false;

  // Efecto para hacer scroll y resaltar la card cuando viene de notificación
  useEffect(() => {
    if (highlightEntityId) {
      setHighlightedId(highlightEntityId);
      
      setTimeout(() => {
        const element = document.getElementById(`product-card-${highlightEntityId}`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 300);

      // Remover el resaltado después de 8 segundos
      const timer = setTimeout(() => {
        setHighlightedId(null);
      }, 8000);

      return () => clearTimeout(timer);
    }
  }, [highlightEntityId]);

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
    
    if (!trimmed || trimmed.length < 3) {
      setVectorResults([]);
      setHasSearchedVector(false);
      return;
    }

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
            limit: 30,
            threshold: 0.3,
          }),
        });

        if (!response.ok) {
          throw new Error("Vector search failed");
        }

        const data = await response.json();

        if (data.results && data.results.length > 0) {
          setVectorResults(data.results);
        } else {
          setVectorResults([]);
        }
      } catch (error) {
        console.error("Vector search error:", error);
        setVectorResults([]);
      } finally {
        setIsVectorSearching(false);
        setHasSearchedVector(true);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [searchTerm, eventId]);

  const filteredProducts = useMemo(() => {
    const t = searchTerm.trim().toLowerCase();
    
    let baseProducts = products || [];
    if (categoryFilter) {
      baseProducts = baseProducts.filter(p => p.category === categoryFilter);
    }
    
    if (!t) {
      let results = [...baseProducts];
      results.sort((a, b) => {
        const scoreA = a.ownerUserId ? (affinityScores[a.ownerUserId] || 0) : 0;
        const scoreB = b.ownerUserId ? (affinityScores[b.ownerUserId] || 0) : 0;
        return scoreB - scoreA;
      });
      return results;
    }

    const exactMatches = baseProducts.filter((p) => {
      return (
        (p.title || "").toLowerCase().includes(t) ||
        (p.description || "").toLowerCase().includes(t) ||
        (p.category || "").toLowerCase().includes(t) ||
        (p.ownerCompany || "").toLowerCase().includes(t)
      );
    });

    let semanticMatches: any[] = [];
    if (vectorResults.length > 0) {
      const exactIds = new Set(exactMatches.map((p) => p.id));
      
      semanticMatches = vectorResults
        .map((v) => {
          const found = baseProducts.find((p) => p.id === v.id);
          if (found) {
            return {
              ...found,
              _similarity: v.similarity,
              _isSemantic: true,
            };
          }
          return null;
        })
        .filter(Boolean);
        
      semanticMatches = semanticMatches.filter((p) => !exactIds.has(p.id));
    }

    return [...exactMatches, ...semanticMatches];
  }, [products, searchTerm, categoryFilter, vectorResults, affinityScores]);

  const handleOpenModal = (
    assistantId: string,
    assistantPhone: string,
    product: Product,
  ) => {
    setSelectedProduct({ product, assistantId, assistantPhone });
    setModalOpened(true);
  };

  const handleConfirmMeeting = async (message: string) => {
    if (!selectedProduct) return;
    
    const { product, assistantId, assistantPhone } = selectedProduct;
    setLoadingId(`${product.id}-${assistantId}`);
    
    try {
      await sendMeetingRequest(assistantId, assistantPhone, null, {
        productId: product.id,
        companyId: product.companyId || null,
        contextNote: message || `Interesado en: ${product.title}`,
      });

      showNotification({
        title: "Solicitud enviada",
        message: `Solicitud enviada por el producto "${product.title}"${message ? ' con tu mensaje personalizado' : ''}.`,
        color: "teal",
      });
      
      setModalOpened(false);
      setSelectedProduct(null);
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
    setVectorResults([]);
  };

  const renderProductCard = (p: any) => {
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

    // Verificar si tiene similarity score (viene de búsqueda por vectores)
    const hasSimilarity = p._isSemantic && typeof p._similarity === 'number';
    const similarityScore = hasSimilarity ? Math.round(p._similarity * 100) : null;

    // Verificar si esta card debe ser resaltada (usando el estado temporal)
    const isHighlighted = highlightedId === p.id;

    return (
      <Grid.Col
        key={p.id}
        // ✅ 2 columnas en mobile: base=6 (12-grid => 2 columnas)
        span={{ base: 6, sm: 4, md: 3, lg: 3 }}
      >
        <Card
          id={`product-card-${p.id}`}
          withBorder
          radius="lg"
          padding="sm"
          shadow="sm"
          style={{
            height: "100%",
            overflow: "hidden",
            position: "relative",
            border: isHighlighted ? "3px solid var(--mantine-color-teal-5)" : undefined,
            boxShadow: isHighlighted ? "0 0 20px rgba(20, 184, 166, 0.4)" : undefined,
            animation: isHighlighted ? "pulse 2s ease-in-out 3" : undefined,
          }}
        >
          {/* Badge de concordancia */}
          {hasSimilarity && (
            <Badge
              variant="gradient"
              gradient={{ from: 'blue', to: 'cyan', deg: 90 }}
              size="sm"
              radius="md"
              style={{
                position: "absolute",
                top: 10,
                right: 10,
                zIndex: 2,
              }}
            >
              {similarityScore}% match
            </Badge>
          )}

          {/* Badge de afinidad del dueño */}
          {/* {!hasSimilarity && p.ownerUserId && affinityScores[p.ownerUserId] && affinityScores[p.ownerUserId] > 0 && (
            <Badge
              variant="gradient"
              gradient={{ from: 'teal', to: 'green', deg: 90 }}
              size="xs"
              radius="md"
              style={{
                position: "absolute",
                top: 10,
                right: 10,
                zIndex: 2,
              }}
            >
              {affinityScores[p.ownerUserId]}% afinidad
            </Badge>
          )} */}

          {/* Badge NUEVO cuando está resaltado */}
          {isHighlighted && (
            <Badge
              variant="filled"
              color="teal"
              size="lg"
              radius="md"
              style={{
                position: "absolute",
                top: 10,
                left: 10,
                zIndex: 3,
                fontWeight: 700,
              }}
            >
              ¡NUEVO!
            </Badge>
          )}

          {allowImageUpload && p.imageUrl ? (
            <>
              <Card.Section>
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

                <Divider my={2} mt="auto" />

                {/* CTA */}
                <Button
                  size="compact-sm"
                  radius="md"
                  fullWidth
                  variant={isDisabled ? "light" : "filled"}
                  onClick={() =>
                    handleOpenModal(p.ownerUserId, p.ownerPhone || "", p)
                  }
                  disabled={isDisabled}
                  loading={loadingId === `${p.id}-${p.ownerUserId}`}
                >
                  {ctaLabel}
                </Button>
              </Stack>
            </>
          ) : (
            <Stack gap={8} style={{ height: "100%" }}>
              {p.category && (
                <Badge variant="light" size="xs" color="blue" radius="sm">
                  {p.category}
                </Badge>
              )}
              {/* Título */}
              <Title order={5} lineClamp={2} style={{ minWidth: 0, lineHeight: 1.2 }}>
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
                size="sm"
                c="dimmed"
                lineClamp={4}
                style={{ whiteSpace: "pre-wrap", flex: 1 }}
              >
                {p.description || "Sin descripción."}
              </Text>

              <Divider my={2} mt="auto" />

              {/* CTA */}
              <Button
                size="compact-sm"
                radius="md"
                fullWidth
                variant={isDisabled ? "light" : "filled"}
                onClick={() =>
                  handleOpenModal(p.ownerUserId, p.ownerPhone || "", p)
                }
                disabled={isDisabled}
                loading={loadingId === `${p.id}-${p.ownerUserId}`}
              >
                {ctaLabel}
              </Button>
            </Stack>
          )}
        </Card>
      </Grid.Col>
    );
  };

  const hasFilters = !!searchTerm.trim() || !!categoryFilter;

  return (
    <>
      <style>
        {`
          @keyframes pulse {
            0%, 100% {
              box-shadow: 0 0 20px rgba(20, 184, 166, 0.4);
            }
            50% {
              box-shadow: 0 0 30px rgba(20, 184, 166, 0.7);
            }
          }
          
          @keyframes fadeOut {
            from {
              opacity: 1;
            }
            to {
              opacity: 0;
            }
          }
        `}
      </style>
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
                ) : vectorResults.length > 0 ? (
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
                  {vectorResults.length > 0 && (
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

      {/* Modal de solicitud de reunión */}
      <MeetingRequestModal
        opened={modalOpened}
        recipientName={selectedProduct?.product.ownerCompany || ""}
        recipientType="producto"
        contextInfo={selectedProduct?.product.title}
        onCancel={() => {
          setModalOpened(false);
          setSelectedProduct(null);
        }}
        onConfirm={handleConfirmMeeting}
        loading={loadingId === `${selectedProduct?.product.id}-${selectedProduct?.assistantId}`}
      />
    </Stack>
    </>
  );
}

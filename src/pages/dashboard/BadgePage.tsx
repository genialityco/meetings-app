import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Container, Paper, Title, Text, Center, Loader, Avatar, Stack, Box, Button, Switch, Group, Select, NumberInput, Divider, SimpleGrid } from "@mantine/core";
import { IconArrowRight, IconPrinter, IconAdjustments, IconRuler2, IconFileText } from "@tabler/icons-react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import QRCode from "qrcode";

// Tamaños de página (papel) en milímetros
const PAGE_SIZES: Record<string, { label: string; width: number; height: number }> = {
  carta: { label: "Carta (216 x 279 mm)", width: 216, height: 279 },
  a4: { label: "A4 (210 x 297 mm)", width: 210, height: 297 },
  media_carta: { label: "Media carta (140 x 216 mm)", width: 140, height: 216 },
  custom: { label: "Personalizado", width: 0, height: 0 },
};

// Ancho de la escarapela impresa dentro de la hoja, en milímetros
const BADGE_SIZES: Record<string, { label: string; width: number }> = {
  pequena: { label: "Pequeña (7 cm)", width: 70 },
  mediana: { label: "Mediana (10 cm)", width: 100 },
  grande: { label: "Grande (14 cm)", width: 140 },
  completa: { label: "Completa (ancho de hoja)", width: 0 },
  custom: { label: "Personalizado", width: 0 },
};

// Alto de la escarapela impresa, en milímetros. "auto" = se ajusta al contenido (comportamiento anterior)
const BADGE_HEIGHTS: Record<string, { label: string; height: number }> = {
  auto: { label: "Automático (ajusta al contenido)", height: 0 },
  pequena: { label: "Pequeña (5 cm)", height: 50 },
  mediana: { label: "Mediana (7 cm)", height: 70 },
  grande: { label: "Grande (10 cm)", height: 100 },
  custom: { label: "Personalizado", height: 0 },
};

export default function BadgePage() {
  const { eventId, userId } = useParams();
  const [user, setUser] = useState<any>(null);
  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [showEventHeader, setShowEventHeader] = useState(true);
  const [pageSizeKey, setPageSizeKey] = useState<string>("carta");
  const [customWidth, setCustomWidth] = useState<number>(216);
  const [customHeight, setCustomHeight] = useState<number>(279);
  const [badgeSizeKey, setBadgeSizeKey] = useState<string>("mediana");
  const [customBadgeWidth, setCustomBadgeWidth] = useState<number>(100);
  const [badgeHeightKey, setBadgeHeightKey] = useState<string>("auto");
  const [customBadgeHeight, setCustomBadgeHeight] = useState<number>(50);

  const pageSize = useMemo(() => {
    if (pageSizeKey === "custom") {
      return { width: customWidth || 1, height: customHeight || 1 };
    }
    return PAGE_SIZES[pageSizeKey] || PAGE_SIZES.carta;
  }, [pageSizeKey, customWidth, customHeight]);

  // Ancho de la escarapela en mm; null = ocupa todo el ancho disponible de la hoja
  const badgeWidthMm = useMemo(() => {
    if (badgeSizeKey === "completa") return null;
    if (badgeSizeKey === "custom") return customBadgeWidth || 1;
    return BADGE_SIZES[badgeSizeKey]?.width ?? BADGE_SIZES.mediana.width;
  }, [badgeSizeKey, customBadgeWidth]);

  // Alto de la escarapela en mm; null = se ajusta al contenido
  const badgeHeightMm = useMemo(() => {
    if (badgeHeightKey === "auto") return null;
    if (badgeHeightKey === "custom") return customBadgeHeight || 1;
    return BADGE_HEIGHTS[badgeHeightKey]?.height ?? null;
  }, [badgeHeightKey, customBadgeHeight]);

  // Padding/espaciado interno proporcional al ancho configurado: los valores fijos
  // (pensados para una tarjeta de ~100mm) dejaban muy poco espacio útil al contenido
  // en escarapelas pequeñas, obligando a encogerlo de más para que quepa.
  const effectiveWidthMm = badgeWidthMm ?? 100;
  const paddingMm = Math.min(9, Math.max(2, effectiveWidthMm * 0.08));
  const gapMm = Math.min(5, Math.max(1.2, effectiveWidthMm * 0.025));
  const qrBoxPaddingMm = Math.min(4, Math.max(1.5, effectiveWidthMm * 0.03));

  // Escala aplicada al contenido para que quepa dentro del tamaño configurado
  // (en vez de recortarse con overflow: hidden cuando el contenido natural es más grande).
  const fitRef = useRef<HTMLDivElement>(null);
  const [contentScale, setContentScale] = useState(1);

  useLayoutEffect(() => {
    const el = fitRef.current;
    if (!el) return;

    const recompute = () => {
      const scaleW = el.clientWidth > 0 && el.scrollWidth > 0 ? el.clientWidth / el.scrollWidth : 1;
      const scaleH = badgeHeightMm && el.clientHeight > 0 && el.scrollHeight > 0 ? el.clientHeight / el.scrollHeight : 1;
      const next = Math.max(0.1, Math.min(1, scaleW, scaleH));
      setContentScale((prev) => (Math.abs(prev - next) > 0.005 ? next : prev));
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    window.addEventListener("resize", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [badgeWidthMm, badgeHeightMm, showEventHeader, user, event, qrCodeUrl]);

  useEffect(() => {
    if (!eventId || !userId) return;

    const loadData = async () => {
      try {
        const [userSnap, eventSnap] = await Promise.all([
          getDoc(doc(db, "users", userId)),
          getDoc(doc(db, "events", eventId))
        ]);

        if (userSnap.exists()) setUser(userSnap.data());
        if (eventSnap.exists()) setEvent(eventSnap.data());

        // El QR codifica solo el uid del asistente (no un enlace): así el check-in
        // se hace siempre desde el escáner en el panel de CheckInTab.jsx, en vez
        // de navegar a otra página al abrir la cámara nativa del teléfono.
        const qrUrl = await QRCode.toDataURL(userId, { width: 250, margin: 2 });
        setQrCodeUrl(qrUrl);
      } catch (e) {
        console.error("Error loading badge data", e);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [eventId, userId]);

  if (loading) {
    return (
      <Center style={{ minHeight: "100vh", background: "#f8f9fa" }}>
        <Loader size="xl" type="bars" />
      </Center>
    );
  }

  if (!user) {
    return (
      <Center style={{ minHeight: "100vh", background: "#f8f9fa" }}>
        <Title order={3} c="dimmed">No se encontró la escarapela.</Title>
      </Center>
    );
  }

  return (
    <Box id="badge-print-root" style={{ minHeight: "100vh", background: "#f8f9fa", padding: "20px" }}>
      <style>{`
        #badge-print-area {
          ${badgeWidthMm ? `width: ${badgeWidthMm}mm;` : `width: 100%;`}
          ${badgeHeightMm ? `height: ${badgeHeightMm}mm;` : `height: auto;`}
          box-sizing: border-box;
          overflow: hidden;
        }
        #badge-fit-content {
          transform: scale(${contentScale});
          transform-origin: top center;
        }
        @page {
          size: ${pageSize.width}mm ${pageSize.height}mm;
          margin: 0;
        }
        @media print {
          .no-print { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
          #badge-print-root { min-height: 0 !important; padding: 0 !important; }
          #badge-print-container { padding: 0 !important; margin: 0 !important; max-width: none !important; }
          #badge-print-area {
            margin: 0 auto !important;
            page-break-after: avoid;
            page-break-inside: avoid;
            box-shadow: none !important;
          }
        }
      `}</style>
      <Container id="badge-print-container" size="md" py="md">
        <Paper withBorder radius="lg" p="lg" mb="xl" className="no-print">
          <Group justify="space-between" mb="md" wrap="wrap" gap="sm">
            <Group gap="xs">
              <IconAdjustments size={20} />
              <Title order={4}>Configurar credencial</Title>
            </Group>
            <Switch
              label="Incluir logo y título del evento"
              checked={showEventHeader}
              onChange={(e) => setShowEventHeader(e.currentTarget.checked)}
            />
          </Group>

          <Divider mb="lg" />

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xl" verticalSpacing="lg">
            <Stack gap="xs">
              <Group gap={6} wrap="nowrap">
                <IconRuler2 size={16} />
                <Text fw={600} size="sm">Tamaño de la escarapela</Text>
              </Group>

              <Group gap="xs" grow wrap="nowrap">
                <Select
                  label="Ancho"
                  data={Object.entries(BADGE_SIZES).map(([value, { label }]) => ({ value, label }))}
                  value={badgeSizeKey}
                  onChange={(value) => value && setBadgeSizeKey(value)}
                  allowDeselect={false}
                />
                {badgeSizeKey === "custom" && (
                  <NumberInput
                    label="Ancho (mm)"
                    value={customBadgeWidth}
                    onChange={(value) => setCustomBadgeWidth(Number(value) || 0)}
                    min={30}
                    max={300}
                  />
                )}
              </Group>

              <Group gap="xs" grow wrap="nowrap">
                <Select
                  label="Alto"
                  description="Fijo para stickers, o automático"
                  data={Object.entries(BADGE_HEIGHTS).map(([value, { label }]) => ({ value, label }))}
                  value={badgeHeightKey}
                  onChange={(value) => value && setBadgeHeightKey(value)}
                  allowDeselect={false}
                />
                {badgeHeightKey === "custom" && (
                  <NumberInput
                    label="Alto (mm)"
                    value={customBadgeHeight}
                    onChange={(value) => setCustomBadgeHeight(Number(value) || 0)}
                    min={20}
                    max={300}
                  />
                )}
              </Group>
            </Stack>

            <Stack gap="xs">
              <Group gap={6} wrap="nowrap">
                <IconFileText size={16} />
                <Text fw={600} size="sm">Tamaño de la hoja</Text>
              </Group>

              <Select
                label="Papel"
                data={Object.entries(PAGE_SIZES).map(([value, { label }]) => ({ value, label }))}
                value={pageSizeKey}
                onChange={(value) => value && setPageSizeKey(value)}
                allowDeselect={false}
              />
              {pageSizeKey === "custom" && (
                <Group gap="xs" grow wrap="nowrap">
                  <NumberInput
                    label="Ancho (mm)"
                    value={customWidth}
                    onChange={(value) => setCustomWidth(Number(value) || 0)}
                    min={20}
                    max={500}
                  />
                  <NumberInput
                    label="Alto (mm)"
                    value={customHeight}
                    onChange={(value) => setCustomHeight(Number(value) || 0)}
                    min={20}
                    max={500}
                  />
                </Group>
              )}
            </Stack>
          </SimpleGrid>
        </Paper>

        <Text
          size="xs"
          fw={700}
          tt="uppercase"
          c="dimmed"
          ta="center"
          mb="sm"
          className="no-print"
          style={{ letterSpacing: 1 }}
        >
          Vista previa
        </Text>

        <Center>
        <Paper
          id="badge-print-area"
          shadow="xl"
          radius="lg"
          withBorder
          style={{
            overflow: 'hidden',
            position: 'relative',
            padding: `${paddingMm}mm`,
            borderTop: `8px solid ${event?.config?.primaryColor || '#10b981'}`
          }}
        >
          <div
            ref={fitRef}
            id="badge-fit-content"
            style={{ width: "100%", height: badgeHeightMm ? "100%" : "auto" }}
          >
          <Stack align="center" gap={`${gapMm}mm`}>
            {showEventHeader && (event?.config?.landingTitleImage ? (
              <img
                src={event.config.landingTitleImage}
                alt="Event Logo"
                style={{ maxHeight: 80, maxWidth: "100%", objectFit: "contain" }}
              />
            ) : event?.eventImage ? (
              <img
                src={event.eventImage}
                alt="Event Logo"
                style={{ maxHeight: 80, maxWidth: "100%", objectFit: "contain", borderRadius: 8 }}
              />
            ) : null)}

            {showEventHeader && (
              <Title order={2} ta="center">{event?.eventName || "Evento"}</Title>
            )}

            {user.photoURL && (
              <Avatar
                src={user.photoURL}
                size={120}
                radius={120}
                color="teal"
              />
            )}

            <Title order={3} ta="center">{user.nombre}</Title>
            <Text size="lg" fw={500} c="dimmed" ta="center">{user.empresa}</Text>
            {user.cargo && <Text size="sm" c="dimmed" ta="center">{user.cargo}</Text>}

            <Box style={{ background: "white", borderRadius: "12px", border: "1px solid #eee", maxWidth: "100%", padding: `${qrBoxPaddingMm}mm` }}>
              {qrCodeUrl && (
                <img
                  src={qrCodeUrl}
                  alt="QR Check-in"
                  style={{ display: 'block', margin: '0 auto', maxWidth: '100%', width: 180, height: 'auto' }}
                />
              )}
            </Box>
          </Stack>
          </div>
        </Paper>
        </Center>

        <Stack gap="sm" mt="lg" className="no-print" style={{ maxWidth: 360, marginInline: "auto" }}>
          <Text size="xs" c="dimmed" ta="center">
            Presenta este código QR en la entrada del evento para realizar tu check-in.
          </Text>

          <Group grow>
            <Button
              component={Link}
              to={`/event/${eventId}`}
              variant="outline"
              radius="md"
              color={event?.config?.primaryColor || "teal"}
              rightSection={<IconArrowRight size={16} />}
            >
              Ir al evento
            </Button>

            <Button
              radius="md"
              color={event?.config?.primaryColor || "teal"}
              leftSection={<IconPrinter size={16} />}
              onClick={() => window.print()}
            >
              Imprimir
            </Button>
          </Group>
        </Stack>
      </Container>
    </Box>
  );
}

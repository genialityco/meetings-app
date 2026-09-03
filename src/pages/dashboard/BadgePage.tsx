import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
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

interface BadgePageProps {
  // Props opcionales para uso "embebido" (p. ej. dentro de un Modal en CheckInTab.jsx):
  // cuando se pasan user/event ya cargados, la página se salta el fetch propio y el
  // getDoc de Firestore. Esto evita el costo de montar la app completa (y su init de
  // Firebase Auth/UserContext) que ocurría al cargar esta ruta dentro de un <iframe>
  // -y que además terminaba cerrando la sesión del admin, porque UserContext vuelve a
  // correr su lógica de auth anónima compartiendo el mismo Firebase Auth del dominio.
  eventIdProp?: string;
  userIdProp?: string;
  userProp?: any;
  eventProp?: any;
  printModeProp?: boolean;
  // true cuando se renderiza dentro de otra página (no como su propia ruta): oculta el
  // botón "Ir al evento" (no aplica en ese contexto) y acota la impresión a la tarjeta,
  // aunque el resto del documento (la página que la contiene) siga en el DOM.
  embedded?: boolean;
  onPrintClick?: () => void;
  printButtonLabel?: string;
}

export default function BadgePage({
  eventIdProp,
  userIdProp,
  userProp,
  eventProp,
  printModeProp,
  embedded = false,
  onPrintClick,
  printButtonLabel = "Imprimir",
}: BadgePageProps = {}) {
  const params = useParams();
  const eventId = eventIdProp ?? params.eventId;
  const userId = userIdProp ?? params.userId;
  // La vista de impresión (tamaños de escarapela/hoja, sin logo por defecto) es una
  // herramienta operativa del check-in, no algo que el asistente deba ver desde su
  // dashboard: solo se activa llegando con ?print=1 (ver botón "Ver credencial" en
  // CheckInTab.jsx). Sin ese parámetro, el asistente ve su escarapela completa tal cual.
  const [searchParams] = useSearchParams();
  const printMode = printModeProp ?? searchParams.get("print") === "1";
  const hasPreloadedData = !!(userProp && eventProp);

  const [user, setUser] = useState<any>(userProp ?? null);
  const [event, setEvent] = useState<any>(eventProp ?? null);
  const [loading, setLoading] = useState(!hasPreloadedData);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [showEventHeader, setShowEventHeader] = useState(!printMode);
  const [pageSizeKey, setPageSizeKey] = useState<string>(printMode ? "custom" : "carta");
  const [customWidth, setCustomWidth] = useState<number>(printMode ? 75 : 216);
  const [customHeight, setCustomHeight] = useState<number>(printMode ? 50 : 279);
  const [badgeSizeKey, setBadgeSizeKey] = useState<string>(printMode ? "pequena" : "completa");
  const [customBadgeWidth, setCustomBadgeWidth] = useState<number>(100);
  const [badgeHeightKey, setBadgeHeightKey] = useState<string>(printMode ? "pequena" : "auto");
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

  // Escarapelas de alto fijo y pequeño (stickers de impresora térmica tipo SAT) no
  // dejan espacio para el nombre/empresa/cargo a tamaño normal + un QR grande: si se
  // dejan los tamaños/paddings pensados para una tarjeta grande, el ajuste automático
  // (contentScale más abajo) termina encogiendo TODO -incluido el QR- muy por debajo de
  // lo legible/escaneable, saliendo chico y borroso al imprimir. En modo compacto usamos
  // texto y márgenes más chicos para dejarle al QR el espacio que necesita.
  const effectiveWidthMm = badgeWidthMm ?? 100;
  const isCompactBadge = badgeHeightMm !== null && badgeHeightMm <= 70;

  const paddingMm = isCompactBadge
    ? Math.min(3, Math.max(1, effectiveWidthMm * 0.03))
    : Math.min(9, Math.max(2, effectiveWidthMm * 0.08));
  const gapMm = isCompactBadge
    ? Math.min(1.5, Math.max(0.5, effectiveWidthMm * 0.01))
    : Math.min(5, Math.max(1.2, effectiveWidthMm * 0.025));
  const qrBoxPaddingMm = isCompactBadge
    ? Math.min(1.2, Math.max(0.5, effectiveWidthMm * 0.008))
    : Math.min(4, Math.max(1.5, effectiveWidthMm * 0.03));

  // Tamaños de texto explícitos (en vez de los pasos discretos order/size de Mantine)
  // para poder aplicarles un +10% parejo por igual en ambos modos.
  const TEXT_SIZE_BOOST = 1.1;
  // +10% y luego +15% adicionales (compuestos) solo para empresa y cargo, que se veían chicos.
  const EMPRESA_CARGO_EXTRA_BOOST = 1.1 * 1.15;
  // +15% adicional solo para el nombre.
  const NAME_EXTRA_BOOST = 1.15;
  const nameOrder = isCompactBadge ? 4 : 3;
  const nameFz = (isCompactBadge ? 18 : 22) * TEXT_SIZE_BOOST * NAME_EXTRA_BOOST;
  const empresaFz = (isCompactBadge ? 16 : 18) * TEXT_SIZE_BOOST * EMPRESA_CARGO_EXTRA_BOOST;
  const cargoFz = (isCompactBadge ? 16 : 14) * TEXT_SIZE_BOOST * EMPRESA_CARGO_EXTRA_BOOST;

  // Tamaño del QR proporcional al espacio disponible (en vez de un ancho fijo en px
  // pensado para escarapelas grandes): en escarapelas de alto fijo, que ocupe casi todo
  // el espacio que quede después del nombre/cargo, para aprovechar el papel real
  // (7x5cm) en vez de quedar chico con márgenes grandes sin usar.
  const qrDisplayMm = badgeHeightMm
    ? Math.max(18, Math.min(effectiveWidthMm * 0.92, badgeHeightMm * 0.92))
    : Math.min(60, effectiveWidthMm * 0.6);

  // La escarapela se renderiza a su tamaño físico real (p. ej. 70x50mm ~ 264x189px):
  // dentro del modal grande de CheckInTab.jsx eso se ve perdido/diminuto. Para esa vista
  // (embebida) la agrandamos SOLO visualmente en pantalla -nunca en la impresión real,
  // que debe seguir midiendo lo configurado- reservando además el espacio ya agrandado
  // en el layout para que no se solape con el texto/botones de abajo.
  const PREVIEW_ZOOM = 2;
  const applyPreviewZoom = embedded && !!badgeWidthMm;

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
    if (!userId) return;

    const loadData = async () => {
      try {
        // Cuando ya nos pasaron user/event como props (uso embebido, p. ej. desde el
        // Modal de CheckInTab.jsx) no hace falta volver a leerlos de Firestore: ya son
        // datos frescos (attendees se actualiza en tiempo real ahí), y saltarse el
        // round-trip es justamente lo que hace que el modal cargue rápido.
        let userData = userProp;
        if (!hasPreloadedData) {
          if (!eventId) return;
          const [userSnap, eventSnap] = await Promise.all([
            getDoc(doc(db, "users", userId)),
            getDoc(doc(db, "events", eventId))
          ]);

          if (userSnap.exists()) { userData = userSnap.data(); setUser(userData); }
          if (eventSnap.exists()) setEvent(eventSnap.data());
        }

        // El QR codifica un link de "visita de perfil": a la página pública de la
        // empresa del asistente (o a su propia escarapela si no tiene empresa
        // asociada), con el uid como query param `visitante`. Escaneado con la
        // cámara nativa de un celular (cualquier asistente curioso, o el staff por
        // error) abre esa página; escaneado con el escáner del admin (que lee el
        // texto crudo del QR, no navega) sigue permitiendo la búsqueda/check-in
        // normal -ver parseAttendeeQrUrl en utils/qrScan.ts, que sabe extraer el uid
        // de este patrón. Resolución alta (muy por encima del tamaño en pantalla)
        // para que, al escalar hacia el tamaño físico real de impresión (mm), no se
        // vea borroso/pixelado en impresoras de escarapelas/etiquetas de baja
        // resolución (p. ej. térmicas).
        const companyId = userData?.companyId;
        const qrPayload = eventId
          ? companyId
            ? `${window.location.origin}/dashboard/${eventId}/company/${encodeURIComponent(companyId)}?visitante=${encodeURIComponent(userId)}`
            : `${window.location.origin}/badge/${eventId}/${encodeURIComponent(userId)}`
          : userId;
        const qrUrl = await QRCode.toDataURL(qrPayload, { width: 600, margin: 2 });
        setQrCodeUrl(qrUrl);
      } catch (e) {
        console.error("Error loading badge data", e);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [eventId, userId, hasPreloadedData]);

  if (loading) {
    return (
      <Center style={{ minHeight: embedded ? 200 : "100vh", background: "#f8f9fa" }}>
        <Loader size="xl" type="bars" />
      </Center>
    );
  }

  if (!user) {
    return (
      <Center style={{ minHeight: embedded ? 200 : "100vh", background: "#f8f9fa" }}>
        <Title order={3} c="dimmed">No se encontró la escarapela.</Title>
      </Center>
    );
  }

  return (
    <Box id="badge-print-root" style={{ minHeight: embedded ? "auto" : "100vh", background: "#f8f9fa", padding: "20px" }}>
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
          #badge-print-root { min-height: 0 !important; padding: 0 !important; background: white !important; }
          #badge-print-container { padding: 0 !important; margin: 0 !important; max-width: none !important; }
          #badge-print-area {
            margin: 0 auto !important;
            page-break-after: avoid;
            page-break-inside: avoid;
            background: white !important;
          }
          /* Sin bordes, sombras ni acentos de color al imprimir: solo texto y el QR sobre blanco.
             No basta con border-color: transparent -algunos drivers de impresión (escarapelas
             térmicas, o con "gráficos de fondo" desactivado) no respetan el canal alfa y pintan
             "transparent" como negro sólido en vez de blanco- así que además se pone el ancho
             del borde en 0 para que no haya nada que pintar. */
          #badge-print-area, #badge-print-area * {
            box-shadow: none !important;
            border-color: transparent !important;
            border-width: 0 !important;
          }
          ${embedded ? `
          /* Embebido (p. ej. dentro del Modal de CheckInTab.jsx): el resto de la página
             (la lista de asistentes, potencialmente larga) sigue en el DOM detrás del
             modal. "visibility:hidden" no alcanza -no saca los elementos del flujo del
             documento, así que el navegador igual pagina todo ese alto vacío (decenas de
             páginas en blanco)-, hay que sacar la app del layout con display:none. El
             modal se renderiza en un portal fuera de #root, así que queda intacto. */
          #root { display: none !important; }
          .mantine-Modal-header, .mantine-Modal-close, .mantine-Overlay-root { display: none !important; }
          .mantine-Modal-content { box-shadow: none !important; }
          ` : ""}
          /* El zoom de la vista previa es solo para pantalla: la impresión real siempre
             debe salir al tamaño físico configurado, nunca agrandada. */
          .badge-preview-zoom-wrap { width: auto !important; height: auto !important; display: block !important; }
          .badge-preview-zoom-inner { transform: none !important; display: block !important; }
        }
      `}</style>
      <Container id="badge-print-container" size="md" py="md">
        {printMode && (
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
        )}

        {printMode && (
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
        )}

        <Center>
        <div
          className={applyPreviewZoom ? "badge-preview-zoom-wrap" : undefined}
          style={applyPreviewZoom ? {
            width: `${(badgeWidthMm as number) * PREVIEW_ZOOM}mm`,
            height: badgeHeightMm ? `${badgeHeightMm * PREVIEW_ZOOM}mm` : undefined,
            display: "flex",
            justifyContent: "center",
            alignItems: badgeHeightMm ? "center" : "flex-start",
          } : undefined}
        >
        <div
          className={applyPreviewZoom ? "badge-preview-zoom-inner" : undefined}
          style={applyPreviewZoom ? { transform: `scale(${PREVIEW_ZOOM})`, transformOrigin: "center", display: "inline-block" } : undefined}
        >
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
          <Stack align="center" gap={`${gapMm}mm`} style={{ width: "85%", marginInline: "auto" }}>
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

            <Title order={nameOrder} fz={nameFz} tt="uppercase" ta="center" style={{ whiteSpace: "nowrap" }}>{user.nombre}</Title>
            <Text fz={empresaFz} fw={700} tt="uppercase" c="dimmed" ta="center" style={{ whiteSpace: "nowrap" }}>{user.empresa}</Text>
            {user.cargo && <Text fz={cargoFz} fw={700} tt="uppercase" c="dimmed" ta="center" style={{ whiteSpace: "nowrap" }}>{user.cargo}</Text>}

            <Box style={{ background: "white", borderRadius: "12px", border: "1px solid #eee", maxWidth: "100%", padding: `${qrBoxPaddingMm}mm` }}>
              {qrCodeUrl && (
                <img
                  src={qrCodeUrl}
                  alt="QR Check-in"
                  style={{ display: 'block', margin: '0 auto', maxWidth: '100%', width: `${qrDisplayMm}mm`, height: 'auto' }}
                />
              )}
            </Box>
          </Stack>
          </div>
        </Paper>
        </div>
        </div>
        </Center>

        <Stack gap="sm" mt="lg" className="no-print" style={{ maxWidth: 360, marginInline: "auto" }}>
          {!embedded && (
            <Text size="xs" c="dimmed" ta="center">
              Presenta este código QR en la entrada del evento para realizar tu check-in.
            </Text>
          )}

          <Group grow>
            {!embedded && (
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
            )}

            {printMode && (
              <Button
                radius="md"
                color={event?.config?.primaryColor || "teal"}
                leftSection={<IconPrinter size={16} />}
                onClick={onPrintClick ?? (() => window.print())}
              >
                {printButtonLabel}
              </Button>
            )}
          </Group>
        </Stack>
      </Container>
    </Box>
  );
}

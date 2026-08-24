import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Container, Paper, Title, Text, Center, Loader, Avatar, Stack, Box, Button, Switch, Group, Select, NumberInput } from "@mantine/core";
import { IconArrowRight, IconPrinter } from "@tabler/icons-react";
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

// Ancho de la escarapela impresa dentro de la hoja, en milímetros (el alto se ajusta al contenido)
const BADGE_SIZES: Record<string, { label: string; width: number }> = {
  pequena: { label: "Pequeña (7 cm)", width: 70 },
  mediana: { label: "Mediana (10 cm)", width: 100 },
  grande: { label: "Grande (14 cm)", width: 140 },
  completa: { label: "Completa (ancho de hoja)", width: 0 },
  custom: { label: "Personalizado", width: 0 },
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
            ${badgeWidthMm ? `width: ${badgeWidthMm}mm !important;` : `width: 100% !important;`}
            height: auto !important;
            margin: 0 auto !important;
            box-sizing: border-box;
            page-break-after: avoid;
            page-break-inside: avoid;
            box-shadow: none !important;
          }
        }
      `}</style>
      <Container id="badge-print-container" size="xs">
        <Group justify="center" gap="sm" mb="sm" className="no-print">
          <Switch
            label="Incluir logo y título del evento al imprimir"
            checked={showEventHeader}
            onChange={(e) => setShowEventHeader(e.currentTarget.checked)}
          />
        </Group>

        <Group justify="center" gap="sm" mb="sm" className="no-print" wrap="wrap">
          <Select
            label="Tamaño de la escarapela"
            description="Qué tan grande se imprime dentro de la hoja"
            data={Object.entries(BADGE_SIZES).map(([value, { label }]) => ({ value, label }))}
            value={badgeSizeKey}
            onChange={(value) => value && setBadgeSizeKey(value)}
            allowDeselect={false}
            w={220}
          />
          {badgeSizeKey === "custom" && (
            <NumberInput
              label="Ancho (mm)"
              value={customBadgeWidth}
              onChange={(value) => setCustomBadgeWidth(Number(value) || 0)}
              min={30}
              max={300}
              w={110}
            />
          )}
        </Group>

        <Group justify="center" gap="sm" mb="md" className="no-print" wrap="wrap">
          <Select
            label="Tamaño de la hoja"
            data={Object.entries(PAGE_SIZES).map(([value, { label }]) => ({ value, label }))}
            value={pageSizeKey}
            onChange={(value) => value && setPageSizeKey(value)}
            allowDeselect={false}
            w={220}
          />
          {pageSizeKey === "custom" && (
            <>
              <NumberInput
                label="Ancho (mm)"
                value={customWidth}
                onChange={(value) => setCustomWidth(Number(value) || 0)}
                min={20}
                max={500}
                w={110}
              />
              <NumberInput
                label="Alto (mm)"
                value={customHeight}
                onChange={(value) => setCustomHeight(Number(value) || 0)}
                min={20}
                max={500}
                w={110}
              />
            </>
          )}
        </Group>

        <Paper
          id="badge-print-area"
          shadow="xl"
          radius="lg"
          p="xl"
          withBorder
          style={{
            overflow: 'hidden',
            position: 'relative',
            borderTop: `8px solid ${event?.config?.primaryColor || '#10b981'}`
          }}
        >
          <Stack align="center" gap="md">
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
              <Title order={2} ta="center" mt="sm">{event?.eventName || "Evento"}</Title>
            )}

            {user.photoURL && (
              <Avatar
                src={user.photoURL}
                size={120}
                radius={120}
                color="teal"
                mt="md"
              />
            )}

            <Title order={3} ta="center" mt="sm">{user.nombre}</Title>
            <Text size="lg" fw={500} c="dimmed" ta="center">{user.empresa}</Text>
            {user.cargo && <Text size="sm" c="dimmed" ta="center">{user.cargo}</Text>}
            {user.tipoAsistente && (
              <Text size="md" fw={700} ta="center" mt="xs" tt="uppercase" c={event?.config?.primaryColor || "teal"}>
                {user.tipoAsistente}
              </Text>
            )}

            <Box mt="xl" p="md" style={{ background: "white", borderRadius: "12px", border: "1px solid #eee", maxWidth: "100%" }}>
              {qrCodeUrl && (
                <img
                  src={qrCodeUrl}
                  alt="QR Check-in"
                  style={{ display: 'block', margin: '0 auto', maxWidth: '100%', width: 180, height: 'auto' }}
                />
              )}
            </Box>

            <Text size="xs" c="dimmed" ta="center" mt="sm" className="no-print">
              Presenta este código QR en la entrada del evento para realizar tu check-in.
            </Text>

            <Button
              component={Link}
              to={`/event/${eventId}`}
              fullWidth
              mt="md"
              radius="md"
              color={event?.config?.primaryColor || "teal"}
              rightSection={<IconArrowRight size={16} />}
              className="no-print"
            >
              Ir al evento
            </Button>

            <Button
              variant="outline"
              fullWidth
              radius="md"
              color={event?.config?.primaryColor || "teal"}
              leftSection={<IconPrinter size={16} />}
              className="no-print"
              onClick={() => window.print()}
            >
              Imprimir credencial
            </Button>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}

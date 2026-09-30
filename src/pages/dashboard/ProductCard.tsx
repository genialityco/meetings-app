import { useState } from "react";
import { Card, Box, Image, Stack, Title, Group, Text, ThemeIcon, Badge, Divider } from "@mantine/core";
import { IconBuildingStore } from "@tabler/icons-react";

interface ProductCardCompany {
  logoUrl?: string | null;
  name: string;
  onClick?: () => void;
}

interface ProductCardProps {
  product: any;
  /** Botón(es) de acción abajo de la card (solicitar reunión, editar/eliminar, etc.) — cada vista arma el suyo. */
  footer: React.ReactNode;
  /** Fila con logo + nombre de empresa, con link opcional. Se omite en vistas donde ya se está dentro de esa empresa (Mi empresa / CompanyLanding). */
  company?: ProductCardCompany | null;
  allowImageUpload?: boolean;
  /** Resalte temporal (llegada desde notificación o desde el badge "N productos"). */
  highlighted?: boolean;
  /** % de coincidencia de búsqueda semántica, si aplica. */
  matchScore?: number | null;
  domId?: string;
  className?: string;
}

/** Card de producto compartida entre ProductsView (pestaña "Productos"), MyCompanyTab
 * ("Mi empresa") y CompanyLanding (ficha pública de empresa), para que las tres vistas
 * se vean igual y no haya que replicar estilos en cada una. */
export default function ProductCard({
  product: p,
  footer,
  company,
  allowImageUpload = true,
  highlighted = false,
  matchScore = null,
  domId,
  className,
}: ProductCardProps) {
  const [expanded, setExpanded] = useState(false);
  const description = p.description || "Sin descripción.";
  const toggleExpanded = (e: any) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  const companyRow = company ? (
    <Group
      gap={8}
      wrap="nowrap"
      style={{ cursor: company.onClick ? "pointer" : undefined }}
      onClick={company.onClick}
    >
      {company.logoUrl ? (
        <Image src={company.logoUrl} alt={company.name} w={22} h={22} radius="sm" fit="contain" />
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
        td={company.onClick ? "underline" : undefined}
      >
        {company.name}
      </Text>
    </Group>
  ) : null;

  return (
    <Card
      id={domId}
      className={className}
      withBorder
      radius="lg"
      padding="sm"
      shadow="sm"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
        border: highlighted ? "3px solid var(--mantine-color-teal-5)" : undefined,
        boxShadow: highlighted ? "0 0 20px rgba(20, 184, 166, 0.4)" : undefined,
        animation: highlighted ? "pulse 2s ease-in-out 3" : undefined,
      }}
    >
      {matchScore !== null && (
        <Badge
          variant="gradient"
          gradient={{ from: "blue", to: "cyan", deg: 90 }}
          size="sm"
          radius="md"
          style={{ position: "absolute", top: 10, right: 10, zIndex: 2 }}
        >
          {matchScore}% match
        </Badge>
      )}

      {highlighted && (
        <Badge
          variant="filled"
          color="teal"
          size="lg"
          radius="md"
          style={{ position: "absolute", top: 10, left: 10, zIndex: 3, fontWeight: 700 }}
        >
          ¡NUEVO!
        </Badge>
      )}

      {allowImageUpload && p.imageUrl ? (
        <>
          <Card.Section>
            <Box style={{ position: "relative", aspectRatio: "1 / 1" }}>
              <Image src={p.imageUrl} alt={p.title} style={{ width: "100%", height: "100%" }} fit="cover" />
              <Box
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.35) 100%)",
                  pointerEvents: "none",
                }}
              />
            </Box>
          </Card.Section>

          <Stack gap={8} mt="sm" style={{ flex: 1, minHeight: 0 }}>
            <Title order={6} lineClamp={2} style={{ minWidth: 0 }}>
              {p.title || "Producto"}
            </Title>

            {companyRow}

            <Box>
              <Text size="xs" c="dimmed" lineClamp={expanded ? undefined : 3} style={{ whiteSpace: "pre-wrap" }}>
                {description}
              </Text>
              {description.length > 90 && (
                <Text size="xs" fw={600} c="blue" style={{ cursor: "pointer" }} onClick={toggleExpanded}>
                  {expanded ? "Ver menos" : "Ver más"}
                </Text>
              )}
            </Box>

            <Divider my={2} mt="auto" />

            {footer}
          </Stack>
        </>
      ) : (
        <Stack gap={8} style={{ height: "100%" }}>
          <Title order={5} lineClamp={2} style={{ minWidth: 0, lineHeight: 1.2 }}>
            {p.title || "Producto"}
          </Title>

          {companyRow}

          <Box style={{ flex: 1, minHeight: 0 }}>
            <Text size="sm" c="dimmed" lineClamp={expanded ? undefined : 4} style={{ whiteSpace: "pre-wrap" }}>
              {description}
            </Text>
            {description.length > 120 && (
              <Text size="xs" fw={600} c="blue" style={{ cursor: "pointer" }} onClick={toggleExpanded}>
                {expanded ? "Ver menos" : "Ver más"}
              </Text>
            )}
          </Box>

          <Divider my={2} mt="auto" />

          {footer}
        </Stack>
      )}
    </Card>
  );
}

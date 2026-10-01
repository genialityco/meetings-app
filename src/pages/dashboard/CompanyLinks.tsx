import { ActionIcon, Button, Group, Tooltip } from "@mantine/core";
import {
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandLinkedin,
  IconBrandTiktok,
  IconBrandX,
  IconWorld,
} from "@tabler/icons-react";

type LinkKind = "instagram" | "facebook" | "linkedin" | "tiktok" | "x" | "web";

const KIND_META: Record<LinkKind, { icon: any; color: string; base?: string }> = {
  instagram: { icon: IconBrandInstagram, color: "pink", base: "https://instagram.com/" },
  facebook: { icon: IconBrandFacebook, color: "blue", base: "https://facebook.com/" },
  linkedin: { icon: IconBrandLinkedin, color: "indigo", base: "https://linkedin.com/in/" },
  tiktok: { icon: IconBrandTiktok, color: "dark", base: "https://tiktok.com/@" },
  x: { icon: IconBrandX, color: "dark", base: "https://x.com/" },
  web: { icon: IconWorld, color: "teal" },
};

/** Detecta si un campo del formulario es una red social o sitio web, por su nombre o
 * etiqueta (los campos custom tienen sufijo aleatorio, p. ej. custom_instagram_9598). */
function detectLinkKind(field: any): LinkKind | null {
  const text = `${field?.name || ""} ${field?.label || ""}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (text.includes("instagram")) return "instagram";
  if (text.includes("facebook")) return "facebook";
  if (text.includes("linkedin")) return "linkedin";
  if (text.includes("tiktok")) return "tiktok";
  if (/\btwitter\b|\bx\b/.test(text)) return "x";
  if (/\bweb\b|pagina_web|sitio|website/.test(text)) return "web";
  return null;
}

/** Convierte lo que escribió el asistente (URL completa, dominio o @usuario) en un href. */
function toHref(kind: LinkKind, raw: string): string {
  const value = raw.trim();
  if (/^https?:\/\//i.test(value)) return value;
  const base = KIND_META[kind].base;
  // Un @usuario (o un usuario sin dominio) en una red social va a su perfil.
  if (base && (value.startsWith("@") || !value.includes("."))) {
    return base + value.replace(/^@/, "");
  }
  return `https://${value}`;
}

export interface CompanyLink {
  key: string;
  kind: LinkKind;
  label: string;
  href: string;
}

/** Enlaces (redes sociales / web) de una empresa a partir de sus representantes: por
 * cada campo de enlace del formulario se toma el primer representante que lo tenga. */
export function getCompanyLinks(formFields: any[] | undefined, representatives: any[]): CompanyLink[] {
  const links: CompanyLink[] = [];
  (formFields || []).forEach((field) => {
    const kind = detectLinkKind(field);
    if (!kind) return;
    const rep = representatives.find((r) => typeof r?.[field.name] === "string" && r[field.name].trim());
    if (!rep) return;
    links.push({
      key: field.name,
      kind,
      label: field.label || field.name,
      href: toHref(kind, rep[field.name]),
    });
  });
  return links;
}

/** Fila de enlaces de la empresa. No renderiza nada si ningún representante cargó
 * valores. `compact` muestra solo íconos (cards); si no, botones con etiqueta. */
export default function CompanyLinks({
  formFields,
  representatives,
  compact = false,
}: {
  formFields: any[] | undefined;
  representatives: any[];
  compact?: boolean;
}) {
  const links = getCompanyLinks(formFields, representatives);
  if (links.length === 0) return null;

  return (
    <Group gap={compact ? 6 : "xs"} wrap="wrap">
      {links.map(({ key, kind, label, href }) => {
        const { icon: Icon, color } = KIND_META[kind];
        return compact ? (
          <Tooltip key={key} label={label}>
            <ActionIcon
              component="a"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              variant="light"
              color={color}
              radius="xl"
              aria-label={label}
              onClick={(e) => e.stopPropagation()}
            >
              <Icon size={16} />
            </ActionIcon>
          </Tooltip>
        ) : (
          <Button
            key={key}
            component="a"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            variant="light"
            color={color}
            size="compact-sm"
            radius="xl"
            leftSection={<Icon size={14} />}
          >
            {label}
          </Button>
        );
      })}
    </Group>
  );
}


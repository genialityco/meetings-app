import { useEffect, useMemo, useState, type ReactNode } from "react";
import { collection, getDocs } from "firebase/firestore";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { IconBuilding, IconInfoCircle } from "@tabler/icons-react";
import { db } from "../firebase/firebaseConfig";
import { normalizeSearch } from "../utils/phoneLogin";
import { NIT_VARIANT_MESSAGES, findNitVariants, formatNit, normalizeNit } from "../utils/nit";

export interface CompanySearchOption {
  id: string;
  razonSocial: string;
  logoUrl?: string | null;
  nameNorm: string;
  /** Nombre normalizado sin espacios: el campo guarda el valor ya normalizado como NIT */
  nameCompact: string;
}

const MIN_QUERY = 3;
const MAX_RESULTS = 8;

// Cache por evento: el formulario puede re-montar el campo al cambiar de paso
const cache = new Map<string, Promise<CompanySearchOption[]>>();

export function loadEventCompanies(eventId: string): Promise<CompanySearchOption[]> {
  let p = cache.get(eventId);
  if (!p) {
    p = getDocs(collection(db, "events", eventId, "companies"))
      .then((snap) =>
        snap.docs.map((d) => {
          const data = d.data() as any;
          const razonSocial = String(data.razonSocial || "").trim() || d.id;
          const nameNorm = normalizeSearch(razonSocial);
          return {
            id: d.id,
            razonSocial,
            logoUrl: data.logoUrl || null,
            nameNorm,
            nameCompact: nameNorm.replace(/[^a-z0-9]/g, ""),
          };
        }),
      )
      .catch((e) => {
        cache.delete(eventId);
        throw e;
      });
    cache.set(eventId, p);
  }
  return p;
}

interface Props {
  eventId?: string;
  label?: ReactNode;
  placeholder?: string;
  value: string;
  required?: boolean;
  error?: ReactNode;
  loading?: boolean;
  /** Recibe el NIT ya normalizado */
  onChange: (nit: string) => void;
  /** El usuario eligió una empresa existente (de la lista o de la sugerencia por DV) */
  onSelectCompany: (company: CompanySearchOption) => void;
  onBlur?: () => void;
}

/**
 * Campo de NIT con buscador: mientras se escribe muestra las empresas del evento
 * que coinciden por NIT o por razón social, y si el NIT escrito no existe pero hay
 * uno que solo cambia en el dígito de verificación, sugiere que es la misma empresa.
 */
export default function CompanyNitSearchInput({
  eventId,
  label,
  placeholder,
  value,
  required,
  error,
  loading,
  onChange,
  onSelectCompany,
  onBlur,
}: Props) {
  const [companies, setCompanies] = useState<CompanySearchOption[]>([]);
  const [focused, setFocused] = useState(false);
  // NIT para el que el usuario respondió "No, es otra empresa"
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    loadEventCompanies(eventId)
      .then((list) => !cancelled && setCompanies(list))
      .catch((e) => console.error("[CompanyNitSearchInput] Error cargando empresas:", e));
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const nit = normalizeNit(value);
  const exact = useMemo(() => companies.find((c) => c.id === nit) || null, [companies, nit]);

  const results = useMemo(() => {
    const raw = String(value || "");
    if (raw.length < MIN_QUERY || selectedId === nit) return [];
    const q = normalizeSearch(raw).replace(/[^a-z0-9]/g, "");
    return companies
      .filter((c) => c.id.startsWith(nit) || (q.length >= MIN_QUERY && c.nameCompact.includes(q)))
      .sort((a, b) => Number(b.id === nit) - Number(a.id === nit))
      .slice(0, MAX_RESULTS);
  }, [companies, value, nit, selectedId]);

  const variants = useMemo(() => {
    if (exact || !nit || dismissedFor === nit) return [];
    const byId = new Map(companies.map((c) => [c.id, c]));
    return findNitVariants(nit, [...byId.keys()])
      .slice(0, 2)
      .map((v) => ({ ...v, company: byId.get(v.id)! }));
  }, [companies, nit, exact, dismissedFor]);

  const select = (c: CompanySearchOption) => {
    setSelectedId(c.id);
    onSelectCompany(c);
  };

  const showDropdown = focused && results.length > 0;

  return (
    <Box pos="relative">
      <TextInput
        label={label}
        placeholder={placeholder || "Escribe el NIT o el nombre de tu empresa"}
        value={value}
        onChange={(e) => {
          setSelectedId(null);
          onChange(normalizeNit(e.target.value));
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        rightSection={loading ? <Loader size="xs" /> : null}
        required={required}
        error={error}
        radius="md"
        autoComplete="off"
        description={
          exact ? (
            <Text span size="xs" c="teal.7" fw={500}>
              Empresa encontrada: {exact.razonSocial}
            </Text>
          ) : undefined
        }
      />

      {showDropdown && (
        <Paper
          withBorder
          shadow="md"
          radius="md"
          mt={4}
          p={4}
          pos="absolute"
          left={0}
          right={0}
          style={{ zIndex: 20, maxHeight: 320, overflowY: "auto" }}
        >
          <Text size="xs" c="dimmed" px="xs" py={4}>
            Empresas ya registradas — selecciona la tuya
          </Text>
          {results.map((c) => (
            <UnstyledButton
              key={c.id}
              w="100%"
              px="xs"
              py={6}
              style={{ borderRadius: 6 }}
              // mousedown en vez de click: se adelanta al blur del input
              onMouseDown={(e) => {
                e.preventDefault();
                select(c);
                setFocused(false);
              }}
            >
              <Group gap="sm" wrap="nowrap">
                <Avatar src={c.logoUrl || undefined} size="sm" radius="sm">
                  <IconBuilding size={16} />
                </Avatar>
                <Box style={{ minWidth: 0 }}>
                  <Text size="sm" fw={500} truncate>
                    {c.razonSocial}
                  </Text>
                  <Text size="xs" c="dimmed">
                    NIT {formatNit(c.id)}
                  </Text>
                </Box>
              </Group>
            </UnstyledButton>
          ))}
        </Paper>
      )}

      {!focused && variants.length > 0 && (
        <Stack gap="xs" mt="xs">
          {variants.map((v) => (
            <Alert key={v.id} color="yellow" radius="md" icon={<IconInfoCircle size={18} />} p="sm">
              <Text size="sm">
                ¿Tu empresa es <b>{v.company.razonSocial}</b> (NIT {formatNit(v.id)})?{" "}
                {NIT_VARIANT_MESSAGES[v.kind]}
              </Text>
              <Group gap="xs" mt="xs">
                <Button size="xs" radius="md" onClick={() => select(v.company)}>
                  Sí, es mi empresa
                </Button>
                <Button size="xs" radius="md" variant="subtle" color="gray" onClick={() => setDismissedFor(nit)}>
                  No, es otra empresa
                </Button>
              </Group>
            </Alert>
          ))}
        </Stack>
      )}
    </Box>
  );
}

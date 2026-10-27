import { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import {
  Alert,
  Anchor,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { IconBuilding, IconChevronRight, IconSearch } from "@tabler/icons-react";
import { auth, db } from "../firebase/firebaseConfig";
import { UserContext } from "../context/UserContext";
import { trackEvent } from "../utils/analytics";
import {
  type CompanyLoginCandidate,
  fetchCompanyLoginCandidates,
  normalizeSearch,
  verifyCompanyLogin,
} from "../utils/companyLogin";

const normalizeNit = (v = "") => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const MIN_QUERY = 3;
const MAX_RESULTS = 8;

interface CompanyOption {
  key: string;
  razonSocial: string;
  /** NITs (ids de companies) que agrupa la opción: más de uno con groupByRazonSocial */
  ids: string[];
  nameNorm: string;
}

interface CompanyLoginFlowProps {
  eventId: string;
  groupByRazonSocial?: boolean;
  /** Vuelve al ingreso por correo */
  onCancel: () => void;
}

/**
 * Ingreso para quien no sabe con qué correo lo registraron (policy companyLoginEnabled):
 * empresa (NIT o nombre) → su nombre → teléfono registrado completo. La verificación la
 * hace la Cloud Function companyLoginVerify (functions/companyLogin.js).
 */
export default function CompanyLoginFlow({ eventId, groupByRazonSocial, onCancel }: CompanyLoginFlowProps) {
  const navigate = useNavigate();
  const { loginAsUser } = useContext(UserContext) as any;

  const [companies, setCompanies] = useState<CompanyOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState<CompanyOption | null>(null);
  const [candidates, setCandidates] = useState<CompanyLoginCandidate[] | null>(null);
  const [person, setPerson] = useState<CompanyLoginCandidate | null>(null);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getDocs(collection(db, "events", eventId, "companies"))
      .then((snap) => {
        if (cancelled) return;
        const byKey = new Map<string, CompanyOption>();
        snap.docs.forEach((d) => {
          const razonSocial = String(d.data().razonSocial || "").trim() || d.id;
          const nameNorm = normalizeSearch(razonSocial);
          const key = groupByRazonSocial ? nameNorm : d.id;
          const existing = byKey.get(key);
          if (existing) existing.ids.push(d.id);
          else byKey.set(key, { key, razonSocial, ids: [d.id], nameNorm });
        });
        setCompanies([...byKey.values()]);
      })
      .catch((e) => {
        console.error("[CompanyLoginFlow] Error cargando empresas:", e);
        if (!cancelled) setError("No pudimos cargar las empresas. Intenta de nuevo.");
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, groupByRazonSocial]);

  const results = useMemo(() => {
    const q = normalizeSearch(query);
    if (!companies || q.length < MIN_QUERY) return [];
    const nitQ = normalizeNit(query);
    return companies
      .filter(
        (c) =>
          c.nameNorm.includes(q) ||
          // El NIT puede escribirse con o sin dígito de verificación
          (nitQ.length >= MIN_QUERY + 1 &&
            c.ids.some((id) => id.startsWith(nitQ) || (id.length >= MIN_QUERY + 1 && nitQ.startsWith(id)))),
      )
      .slice(0, MAX_RESULTS);
  }, [companies, query]);

  const selectCompany = async (c: CompanyOption) => {
    setCompany(c);
    setCandidates(null);
    setError("");
    setLoading(true);
    try {
      setCandidates(await fetchCompanyLoginCandidates(eventId, c.ids.slice(0, 10)));
    } catch (e) {
      console.error("[CompanyLoginFlow] Error cargando asistentes:", e);
      setError("No pudimos cargar los asistentes de la empresa. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    if (!person) return;
    setError("");
    if (phone.replace(/\D/g, "").length < 7) {
      setError("Escribe tu número de teléfono completo.");
      return;
    }
    setLoading(true);
    try {
      const result = await verifyCompanyLogin(eventId, person.uid, phone);
      if (result.ok) {
        // Las reglas exigen una sesión de Firebase (igual que en AutoLoginPage)
        if (!auth.currentUser) await signInAnonymously(auth);
        const snap = await getDoc(doc(db, "users", person.uid));
        if (!snap.exists()) throw new Error("user not found");
        trackEvent({ name: "login", params: { method: "company_phone" } });
        loginAsUser(person.uid, snap.data());
        navigate(`/dashboard/${eventId}`);
        return;
      }
      if (result.error === "mismatch") {
        setError(
          `El número no coincide con el registrado. ${
            result.remaining === 1 ? "Te queda 1 intento." : `Te quedan ${result.remaining} intentos.`
          }`,
        );
      } else if (result.error === "locked") {
        setError(
          `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(result.retryAfterSec / 60)} minutos o escríbenos a soporte.`,
        );
      } else {
        setError("No encontramos este registro en el evento.");
      }
    } catch (e) {
      console.error("[CompanyLoginFlow] Error verificando:", e);
      setError("Ocurrió un error al intentar ingresar.");
    } finally {
      setLoading(false);
    }
  };

  const errorAlert = error ? (
    <Alert color="red" variant="light" radius="md">
      {error}
    </Alert>
  ) : null;

  const backToEmail = (
    <Anchor component="button" type="button" size="sm" onClick={onCancel} ta="center">
      Ingresar con mi correo
    </Anchor>
  );

  // Paso 3: teléfono
  if (company && person) {
    return (
      <Stack gap="sm">
        <Paper withBorder radius="md" p="sm">
          <Text fw={700}>{person.nombre}</Text>
          <Text size="sm" c="dimmed">
            {company.razonSocial}
          </Text>
        </Paper>
        <Text size="sm">
          Tu teléfono registrado termina en <strong>{person.phoneMask}</strong>. Escríbelo completo para
          ingresar.
        </Text>
        <TextInput
          label="Teléfono"
          placeholder="300 123 4567"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && verify()}
          inputMode="tel"
          autoComplete="tel"
          radius="md"
          size="md"
          autoFocus
        />
        {errorAlert}
        <Button radius="md" size="md" loading={loading} onClick={verify} style={{ height: 44, fontWeight: 800 }} fullWidth>
          INGRESAR
        </Button>
        <Anchor
          component="button"
          type="button"
          size="sm"
          ta="center"
          onClick={() => {
            setPerson(null);
            setPhone("");
            setError("");
          }}
        >
          No soy yo
        </Anchor>
      </Stack>
    );
  }

  // Paso 2: elegir persona
  if (company) {
    return (
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Text fw={700} lineClamp={2}>
            {company.razonSocial}
          </Text>
          <Anchor
            component="button"
            type="button"
            size="sm"
            onClick={() => {
              setCompany(null);
              setCandidates(null);
              setError("");
            }}
          >
            Cambiar empresa
          </Anchor>
        </Group>
        {loading && (
          <Group justify="center" py="md">
            <Loader size="sm" />
          </Group>
        )}
        {candidates && candidates.length > 0 && (
          <>
            <Text size="sm" c="dimmed">
              Selecciona tu nombre:
            </Text>
            {candidates.map((c) => (
              <UnstyledButton
                key={c.uid}
                disabled={!c.phoneMask}
                onClick={() => {
                  setPerson(c);
                  setError("");
                }}
              >
                <Paper withBorder radius="md" p="sm" style={{ opacity: c.phoneMask ? 1 : 0.55 }}>
                  <Group justify="space-between" wrap="nowrap">
                    <div>
                      <Text fw={600}>{c.nombre}</Text>
                      {c.cargo && (
                        <Text size="xs" c="dimmed">
                          {c.cargo}
                        </Text>
                      )}
                      <Text size="xs" c="dimmed">
                        {c.phoneMask ? `Tel. ${c.phoneMask}` : "Sin teléfono registrado"}
                      </Text>
                    </div>
                    {c.phoneMask && <IconChevronRight size={18} />}
                  </Group>
                </Paper>
              </UnstyledButton>
            ))}
          </>
        )}
        {candidates && candidates.length === 0 && (
          <Text size="sm" c="dimmed" ta="center">
            Esta empresa no tiene asistentes registrados.
          </Text>
        )}
        {errorAlert}
        <Text size="xs" c="dimmed" ta="center">
          ¿No apareces o no reconoces el teléfono? Escríbenos con el botón de Soporte.
        </Text>
        {backToEmail}
      </Stack>
    );
  }

  // Paso 1: buscar empresa
  return (
    <Stack gap="sm">
      <TextInput
        label="Tu empresa"
        description="Escribe el NIT o el nombre de la empresa con la que te registraron"
        placeholder="NIT o razón social"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        leftSection={<IconSearch size={16} />}
        rightSection={!companies && !error ? <Loader size="xs" /> : null}
        radius="md"
        size="md"
        autoFocus
      />
      {results.map((c) => (
        <UnstyledButton key={c.key} onClick={() => selectCompany(c)}>
          <Paper withBorder radius="md" p="sm">
            <Group justify="space-between" wrap="nowrap">
              <Group gap="sm" wrap="nowrap">
                <IconBuilding size={18} />
                <div>
                  <Text fw={600}>{c.razonSocial}</Text>
                  <Text size="xs" c="dimmed">
                    NIT {c.ids.join(", ")}
                  </Text>
                </div>
              </Group>
              <IconChevronRight size={18} />
            </Group>
          </Paper>
        </UnstyledButton>
      ))}
      {companies && normalizeSearch(query).length >= MIN_QUERY && results.length === 0 && (
        <Text size="sm" c="dimmed" ta="center">
          No encontramos empresas con ese NIT o nombre.
        </Text>
      )}
      {errorAlert}
      {backToEmail}
    </Stack>
  );
}

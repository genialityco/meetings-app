import { useMemo, useState } from "react";
import { addDoc, collection, getDocs, query, where } from "firebase/firestore";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CopyButton,
  Group,
  Loader,
  Modal,
  MultiSelect,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconBrandWhatsapp, IconCheck, IconCopy, IconUserPlus } from "@tabler/icons-react";
import { db } from "../../firebase/firebaseConfig";
import { withRoleLabel } from "../../utils/attendeeFields";
import { getEventDayKeys, formatDayLabel } from "../../utils/eventDays";
import {
  COUNTRY_CODES,
  cleanLocalPhoneNumber,
  detectDefaultIso2,
  getDialCodeForIso2,
  isPhoneField,
  parsePhoneValue,
  toWhatsAppNumber,
} from "../../utils/phoneUtils";
import { buildAccessLink } from "../../utils/accessLink";
import { sendWelcomeNotification } from "../../utils/whatsappService";
import { usePhoneAvailability } from "../../hooks/usePhoneAvailability";
import { trackEvent } from "../../utils/analytics";

// Campos que el compañero hereda de quien lo registra (empresa y rol) o que no
// tienen sentido llenar por otra persona (foto, documentos, consentimiento)
const INHERITED_FIELDS = new Set([
  "company_nit",
  "company_razonSocial",
  "company_logo",
  "descripcion",
  "empresa",
  "tipoAsistente",
  "aceptaTratamiento",
  "photoURL",
]);
const SKIPPED_TYPES = new Set(["photo", "pdf", "file", "richtext", "checkbox"]);

const isValidEmail = (v = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());

interface Props {
  opened: boolean;
  onClose: () => void;
  eventId: string;
  eventConfig: any;
  eventName?: string;
  eventImage?: string;
  /** currentUser del UserContext (quien registra) */
  currentUser: any;
  companyName?: string;
}

/**
 * Un representante registra a un compañero de su empresa sin cerrar sesión: crea
 * el asistente con su misma empresa y rol, y le entrega su link de acceso directo
 * (/acceso/:eventId/:uid) para que entre sin saber con qué correo quedó.
 * Policy colleagueRegistrationEnabled.
 */
export default function RegisterColleagueModal({
  opened,
  onClose,
  eventId,
  eventConfig,
  eventName,
  eventImage,
  currentUser,
  companyName,
}: Props) {
  const me = currentUser?.data || {};
  const myRole = me.tipoAsistente;

  const fields = useMemo(() => {
    const companyStepFields = new Set<string>(
      (eventConfig?.registrationForm?.steps || [])
        .filter((s: any) => (s.fields || []).includes("company_nit"))
        .flatMap((s: any) => s.fields || []),
    );
    return (eventConfig?.formFields || [])
      .filter(
        (f: any) =>
          f?.name &&
          !INHERITED_FIELDS.has(f.name) &&
          !companyStepFields.has(f.name) &&
          !SKIPPED_TYPES.has(f.type),
      )
      .map((f: any) => withRoleLabel(f, myRole));
  }, [eventConfig?.formFields, eventConfig?.registrationForm, myRole]);

  const phoneField = useMemo(() => fields.find((f: any) => isPhoneField(f)) || null, [fields]);
  const defaultIso2 = useMemo(() => detectDefaultIso2(), []);

  const [values, setValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [authorized, setAuthorized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [created, setCreated] = useState<{ uid: string; nombre: string; phone: string } | null>(null);

  const { state: phoneCheck, verifyNow } = usePhoneAvailability(
    opened ? eventId : undefined,
    phoneField ? values[phoneField.name] : "",
    null,
  );

  const set = (name: string, value: any) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: null }));
  };

  const reset = () => {
    setValues({});
    setErrors({});
    setAuthorized(false);
    setSubmitError("");
    setCreated(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const isVisible = (f: any) => {
    if (!f?.showWhen) return true;
    const parent = values[f.showWhen.field];
    const allowed = f.showWhen.value || [];
    return Array.isArray(parent) ? parent.some((v) => allowed.includes(v)) : allowed.includes(parent);
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    for (const f of fields) {
      if (!isVisible(f)) continue;
      const v = values[f.name];
      const empty = v == null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === "");
      const isNameOrEmail = f.name === "nombre" || f.name === "correo";
      if ((f.required || isNameOrEmail) && empty) {
        errs[f.name] = "Campo obligatorio";
        continue;
      }
      if (f.name === "correo" && !empty && !isValidEmail(v)) errs[f.name] = "Correo inválido";
      if (isPhoneField(f) && !empty && !toWhatsAppNumber(v)) errs[f.name] = "Número de teléfono inválido";
    }
    return errs;
  };

  const handleSubmit = async () => {
    setSubmitError("");
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      setSubmitError("Revisa los campos marcados.");
      return;
    }
    if (!authorized) {
      setSubmitError("Confirma que tu compañero autorizó el registro y el tratamiento de sus datos.");
      return;
    }

    setSaving(true);
    try {
      const correo = String(values.correo || "").toLowerCase().trim();

      // Correo duplicado en el evento
      if (correo) {
        const snap = await getDocs(query(collection(db, "users"), where("correo", "==", correo)));
        if (snap.docs.some((d) => d.data().eventId === eventId)) {
          setErrors((prev) => ({ ...prev, correo: "Este correo ya está registrado en el evento." }));
          setSubmitError("Ya hay un asistente con ese correo en el evento.");
          return;
        }
      }

      // Teléfono duplicado en el evento
      if (phoneField && values[phoneField.name]) {
        const r = await verifyNow();
        if (r.status === "registered") {
          setErrors((prev) => ({ ...prev, [phoneField.name]: "Este teléfono ya está registrado en el evento." }));
          setSubmitError("Ya hay un asistente con ese teléfono en el evento.");
          return;
        }
      }

      const now = new Date().toISOString();
      const data: Record<string, any> = {
        ...Object.fromEntries(
          Object.entries(values).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)),
        ),
        correo,
        eventId,
        companyId: me.companyId,
        empresa: me.empresa || companyName || me.companyId,
        ...(me.company_razonSocial ? { company_razonSocial: me.company_razonSocial } : {}),
        ...(myRole ? { tipoAsistente: myRole } : {}),
        aceptaTratamiento: true,
        registeredBy: currentUser?.uid,
        registeredByName: me.nombre || "",
        createdAt: now,
        updatedAt: now,
        welcomePopupSeen: false,
      };

      const ref = await addDoc(collection(db, "users"), data);
      trackEvent({ name: "sign_up", params: { method: "colleague" } } as any);

      const phone = phoneField ? String(values[phoneField.name] || "") : "";

      if (eventConfig?.policies?.welcomeMessageEnabled === true && phone) {
        sendWelcomeNotification({
          phone,
          name: data.nombre || "Asistente",
          eventName: eventName || "el evento",
          eventId,
          badgeUrl: `badge/${eventId}/${ref.id}`,
          headerImageUrl: eventImage,
          fallbackInfo: { enabled: false, email: "", subject: "" },
          tracking: { eventId, userId: ref.id },
        }).catch((e) => console.error("[RegisterColleagueModal] Bienvenida no enviada:", e));
      }

      setCreated({ uid: ref.id, nombre: data.nombre || "", phone });
    } catch (e) {
      console.error("[RegisterColleagueModal] Error registrando compañero:", e);
      setSubmitError("No se pudo registrar a tu compañero. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const renderField = (f: any) => {
    if (!isVisible(f)) return null;
    const error = errors[f.name];
    const required = f.required || f.name === "nombre" || f.name === "correo";

    if (isPhoneField(f)) {
      const { iso2, dialCode, number } = parsePhoneValue(values[f.name] || "", defaultIso2);
      const isMain = f.name === phoneField?.name;
      return (
        <Box key={f.name}>
          <Text size="sm" fw={500} mb={4}>
            {f.label}
            {required && (
              <Text component="span" c="red" ml={2}>
                *
              </Text>
            )}
          </Text>
          <Group gap={6} align="flex-start" wrap="nowrap">
            <Select
              data={COUNTRY_CODES}
              value={iso2}
              onChange={(newIso2) => {
                if (!newIso2) return;
                const dc = getDialCodeForIso2(newIso2);
                set(f.name, number ? `${dc} ${number}` : dc);
              }}
              style={{ width: 104 }}
              searchable
              allowDeselect={false}
              comboboxProps={{ width: 300 }}
            />
            <TextInput
              placeholder={f.placeholder || "Número"}
              value={number}
              onChange={(e) => set(f.name, `${dialCode} ${cleanLocalPhoneNumber(e.target.value, dialCode)}`.trim())}
              error={error}
              style={{ flex: 1 }}
              rightSection={isMain && phoneCheck.status === "checking" ? <Loader size="xs" /> : null}
            />
          </Group>
          {isMain && phoneCheck.status === "registered" && (
            <Alert color="orange" mt="xs" p="xs">
              <Text size="sm">
                Este número ya está registrado en el evento
                {phoneCheck.nombreMask ? ` a nombre de ${phoneCheck.nombreMask}` : ""}
                {phoneCheck.empresa ? ` (${phoneCheck.empresa})` : ""}. Tu compañero ya tiene cuenta: puede
                ingresar con ella.
              </Text>
            </Alert>
          )}
        </Box>
      );
    }

    if (f.type === "select") {
      return (
        <Select
          key={f.name}
          label={f.label}
          placeholder={f.placeholder || "Selecciona una opción"}
          data={f.options || []}
          value={values[f.name] ?? null}
          onChange={(v) => set(f.name, v)}
          required={required}
          error={error}
          searchable
          clearable
        />
      );
    }

    if (f.type === "multiselect" || f.type === "eventDays") {
      const data =
        f.type === "eventDays"
          ? getEventDayKeys(eventConfig).map((day, idx) => ({ value: day, label: formatDayLabel(day, idx) }))
          : f.options || [];
      if (!data.length) return null;
      return (
        <MultiSelect
          key={f.name}
          label={f.label}
          placeholder={f.placeholder || "Selecciona una o más opciones"}
          data={data}
          value={values[f.name] || []}
          onChange={(v) => set(f.name, v)}
          required={required}
          error={error}
          searchable
          clearable
        />
      );
    }

    return (
      <TextInput
        key={f.name}
        label={f.label}
        placeholder={f.placeholder || f.label}
        value={values[f.name] || ""}
        onChange={(e) => set(f.name, f.name === "correo" ? e.target.value.toLowerCase() : e.target.value)}
        required={required}
        error={error}
        autoCapitalize={f.name === "correo" ? "none" : undefined}
      />
    );
  };

  const accessLink = created ? buildAccessLink(eventId, created.uid) : "";
  const waNumber = created ? toWhatsAppNumber(created.phone) : "";
  const shareText = created
    ? `Hola ${created.nombre.split(" ")[0] || ""}, te registré en ${eventName || "el evento"} como representante de ${
        companyName || me.empresa || "nuestra empresa"
      }. Entra directo con este link: ${accessLink}`
    : "";

  return (
    <Modal
      opened={opened}
      onClose={close}
      title={
        <Group gap={8}>
          <IconUserPlus size={18} />
          <Text fw={600}>Registrar compañero</Text>
        </Group>
      }
      size="lg"
      radius="md"
    >
      {created ? (
        <Stack>
          <Alert color="teal" icon={<IconCheck size={18} />}>
            <Text size="sm">
              <b>{created.nombre || "Tu compañero"}</b> quedó registrado como representante de{" "}
              {companyName || me.empresa}. Ya puede recibir y tomar solicitudes de reunión de la empresa.
            </Text>
          </Alert>
          <Text size="sm">Envíale su link de acceso directo para que entre sin buscar con qué correo quedó:</Text>
          <TextInput value={accessLink} readOnly />
          <Group>
            <CopyButton value={accessLink}>
              {({ copied, copy }) => (
                <Button
                  variant="light"
                  leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  onClick={copy}
                >
                  {copied ? "Copiado" : "Copiar link"}
                </Button>
              )}
            </CopyButton>
            {waNumber && (
              <Button
                component="a"
                href={`https://wa.me/${waNumber}?text=${encodeURIComponent(shareText)}`}
                target="_blank"
                rel="noreferrer"
                color="green"
                leftSection={<IconBrandWhatsapp size={16} />}
              >
                Enviar por WhatsApp
              </Button>
            )}
          </Group>
          <Group justify="space-between" mt="sm">
            <Button variant="subtle" onClick={reset}>
              Registrar otro compañero
            </Button>
            <Button onClick={close}>Listo</Button>
          </Group>
        </Stack>
      ) : (
        <Stack>
          <Text size="sm" c="dimmed">
            Quedará registrado en {companyName || me.empresa || "tu empresa"}
            {myRole ? ` con tu mismo rol (${myRole})` : ""}. No necesitas cerrar tu sesión.
          </Text>
          {fields.map(renderField)}
          <Checkbox
            checked={authorized}
            onChange={(e) => setAuthorized(e.currentTarget.checked)}
            label="Confirmo que mi compañero autorizó su registro y el tratamiento de sus datos personales para este evento."
          />
          {submitError && (
            <Text size="sm" c="red">
              {submitError}
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} loading={saving} disabled={phoneCheck.status === "registered"}>
              Registrar
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

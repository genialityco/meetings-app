import { useState } from "react";
import { Button, NumberInput, Stack, Text, Title, Alert } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import {
  submitCompanySurvey,
  type CompanySurveyChannel,
  type CompanySurveyConfig,
  type CompanySurveyResponse,
} from "../../utils/companySurvey";

interface Props {
  eventId: string;
  uid: string;
  userData: any;
  config: CompanySurveyConfig;
  channel: CompanySurveyChannel;
  /** Se llama tras guardar (o si otro asistente de la empresa ya había respondido) */
  onDone: (response: CompanySurveyResponse, alreadyAnswered: boolean) => void;
}

/** Formulario de la encuesta de resultados por empresa (modal del dashboard y página de WhatsApp) */
export default function CompanySurveyForm({ eventId, uid, userData, config, channel, onDone }: Props) {
  const [reuniones, setReuniones] = useState<number | "">("");
  const [valorUSD, setValorUSD] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const companyName = String(userData?.company_razonSocial || userData?.empresa || "").trim();
  const canSubmit = reuniones !== "" && valorUSD !== "" && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const { alreadyAnswered, response } = await submitCompanySurvey({
        eventId,
        uid,
        userData,
        reuniones: Number(reuniones),
        valorUSD: Number(valorUSD),
        channel,
      });
      onDone(response, alreadyAnswered);
    } catch (err) {
      console.error("companySurvey submit:", err);
      setError("No pudimos guardar tu respuesta. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="md">
      <Title order={3}>{config.title}</Title>
      {config.intro && (
        <Text size="sm" style={{ whiteSpace: "pre-line" }}>
          {config.intro}
        </Text>
      )}
      {companyName && (
        <Text size="sm" c="dimmed">
          Respondes a nombre de <b>{companyName}</b>. Con una respuesta por empresa es suficiente.
        </Text>
      )}

      <NumberInput
        label={`1. ${config.meetingsQuestion}`}
        placeholder="Ej. 5"
        min={0}
        max={10000}
        allowDecimal={false}
        allowNegative={false}
        thousandSeparator="."
        decimalSeparator=","
        value={reuniones}
        onChange={(v) => setReuniones(v === "" ? "" : Number(v))}
        required
        size="md"
      />
      <NumberInput
        label={`2. ${config.valueQuestion}`}
        placeholder="Ej. 25.000"
        min={0}
        allowNegative={false}
        decimalScale={2}
        thousandSeparator="."
        decimalSeparator=","
        prefix="USD "
        value={valorUSD}
        onChange={(v) => setValorUSD(v === "" ? "" : Number(v))}
        required
        size="md"
      />

      {config.outro && (
        <Text size="sm" style={{ whiteSpace: "pre-line" }}>
          {config.outro}
        </Text>
      )}

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {error}
        </Alert>
      )}

      <Button size="md" onClick={submit} loading={saving} disabled={!canSubmit} fullWidth>
        Enviar respuesta
      </Button>
    </Stack>
  );
}

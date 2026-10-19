import { useEffect, useMemo, useState } from "react";
import { Modal } from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import CompanySurveyForm from "./CompanySurveyForm";
import {
  companySurveyAppliesTo,
  getCompanySurveyConfig,
  getCompanySurveyKey,
  subscribeCompanySurvey,
} from "../../utils/companySurvey";

interface Props {
  eventId: string;
  uid: string;
  userData: any;
  policies: any;
}

/**
 * Modal obligatorio de la encuesta de resultados por empresa (policy
 * companySurveyEnabled): no se puede cerrar hasta que alguien de la empresa la
 * responda. Escucha la respuesta en tiempo real, así que si un compañero la llena
 * (aquí o por WhatsApp) el modal se cierra solo. Si no se puede leer el estado
 * (error de red o de permisos) no bloquea el dashboard.
 */
export default function CompanySurveyGuard({ eventId, uid, userData, policies }: Props) {
  const enabled = policies?.companySurveyEnabled === true;
  const config = useMemo(() => getCompanySurveyConfig(policies), [policies]);
  const applies = enabled && !!userData && userData.eventId === eventId && companySurveyAppliesTo(config, userData);
  const key = applies ? getCompanySurveyKey(userData, uid) : null;
  // undefined = cargando, null = sin responder
  const [answered, setAnswered] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    setAnswered(undefined);
    if (!key) return;
    return subscribeCompanySurvey(
      eventId,
      key,
      (response) => setAnswered(!!response),
      () => setAnswered(true)
    );
  }, [eventId, key]);

  if (!key || answered !== false) return null;

  return (
    <Modal
      opened
      onClose={() => {}}
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      centered
      size="lg"
      radius="md"
      overlayProps={{ blur: 3 }}
      zIndex={400}
    >
      <CompanySurveyForm
        eventId={eventId}
        uid={uid}
        userData={userData}
        config={config}
        channel="web"
        onDone={(response, alreadyAnswered) => {
          setAnswered(true);
          showNotification({
            color: "green",
            title: "¡Gracias!",
            message: alreadyAnswered
              ? `${response.respondedByName || "Un compañero"} ya había respondido por tu empresa.`
              : "Tu respuesta quedó registrada.",
          });
        }}
      />
    </Modal>
  );
}

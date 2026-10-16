import { useEffect, useState } from "react";
import { Button, CopyButton, Group, Modal, Stack, Text, TextInput, Alert, Anchor } from "@mantine/core";
import {
  IconCalendarShare,
  IconBrandGoogle,
  IconBrandWindows,
  IconBrandApple,
  IconCopy,
  IconCheck,
  IconRefresh,
  IconInfoCircle,
} from "@tabler/icons-react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { showNotification } from "@mantine/notifications";

/**
 * "Sincronizar con mi calendario" (policy calendarFeedEnabled): el asistente se
 * suscribe una vez al feed iCalendar de sus reuniones (Cloud Function
 * calendarFeed) y su calendario lo actualiza solo. El link lleva un token
 * aleatorio guardado en users/{uid}.calendarFeedToken; regenerarlo invalida las
 * suscripciones anteriores.
 */
const FEED_URL =
  (import.meta.env.VITE_CALENDAR_FEED_URL as string) ||
  `https://us-central1-${import.meta.env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net/calendarFeed`;

const newToken = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

interface CalendarSyncButtonProps {
  eventId: string;
  uid: string;
  currentUser?: any;
  eventName?: string;
}

export default function CalendarSyncButton({ eventId, uid, currentUser, eventName }: CalendarSyncButtonProps) {
  const [opened, setOpened] = useState(false);
  const [token, setToken] = useState<string>(currentUser?.data?.calendarFeedToken || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const saved = currentUser?.data?.calendarFeedToken;
    if (saved) setToken(saved);
  }, [currentUser?.data?.calendarFeedToken]);

  const saveToken = async (value: string) => {
    setSaving(true);
    try {
      await updateDoc(doc(db, "users", uid), { calendarFeedToken: value });
      setToken(value);
      return true;
    } catch (err) {
      console.error("calendarFeedToken:", err);
      showNotification({ color: "red", title: "Error", message: "No se pudo generar el link del calendario" });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const open = async () => {
    setOpened(true);
    if (!token) await saveToken(newToken());
  };

  const regenerate = async () => {
    if (await saveToken(newToken())) {
      showNotification({
        color: "green",
        title: "Link regenerado",
        message: "Los calendarios suscritos con el link anterior dejarán de actualizarse.",
      });
    }
  };

  const calName = `Agenda · ${eventName || "Evento"}`;
  const httpsUrl = token
    ? `${FEED_URL}?e=${encodeURIComponent(eventId)}&u=${encodeURIComponent(uid)}&t=${encodeURIComponent(token)}`
    : "";
  const webcalUrl = httpsUrl.replace(/^https?:/, "webcal:");
  const googleUrl = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl)}`;
  const outlookUrl = (host: string) =>
    `https://${host}/calendar/0/addfromweb?url=${encodeURIComponent(httpsUrl)}&name=${encodeURIComponent(calName)}`;

  return (
    <>
      <Button size="xs" variant="light" radius="xl" leftSection={<IconCalendarShare size={16} />} onClick={open}>
        Sincronizar con mi calendario
      </Button>

      <Modal opened={opened} onClose={() => setOpened(false)} title="Sincronizar con mi calendario" centered>
        <Stack gap="md">
          <Text size="sm">
            Agrega tu agenda una sola vez y tus reuniones aparecerán en tu calendario. Las nuevas reuniones, los
            cambios de horario o mesa y las cancelaciones se actualizan solos.
          </Text>

          <Stack gap="xs">
            <Button
              component="a"
              href={googleUrl}
              target="_blank"
              rel="noopener noreferrer"
              leftSection={<IconBrandGoogle size={18} />}
              disabled={!httpsUrl}
              fullWidth
            >
              Google Calendar
            </Button>
            <Group grow gap="xs">
              <Button
                component="a"
                href={outlookUrl("outlook.live.com")}
                target="_blank"
                rel="noopener noreferrer"
                variant="light"
                leftSection={<IconBrandWindows size={18} />}
                disabled={!httpsUrl}
              >
                Outlook personal
              </Button>
              <Button
                component="a"
                href={outlookUrl("outlook.office.com")}
                target="_blank"
                rel="noopener noreferrer"
                variant="light"
                leftSection={<IconBrandWindows size={18} />}
                disabled={!httpsUrl}
              >
                Outlook trabajo
              </Button>
            </Group>
            <Button
              component="a"
              href={webcalUrl}
              variant="light"
              color="gray"
              leftSection={<IconBrandApple size={18} />}
              disabled={!httpsUrl}
              fullWidth
            >
              iPhone / Mac (Calendario de Apple)
            </Button>
          </Stack>

          <TextInput
            label="O copia el link en tu calendario (opción “Desde URL” / “Suscribirse”)"
            value={httpsUrl}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            rightSectionWidth={90}
            rightSection={
              <CopyButton value={httpsUrl}>
                {({ copied, copy }) => (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color={copied ? "teal" : "blue"}
                    leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    onClick={copy}
                    disabled={!httpsUrl}
                  >
                    {copied ? "Copiado" : "Copiar"}
                  </Button>
                )}
              </CopyButton>
            }
          />

          <Alert variant="light" color="blue" icon={<IconInfoCircle size={16} />}>
            <Text size="xs">
              Cada calendario decide cada cuánto se actualiza: Google Calendar puede tardar varias horas en mostrar un
              cambio. Para lo de último momento, revisa siempre tu agenda en la plataforma. Este link es personal: no
              lo compartas.
            </Text>
          </Alert>

          <Anchor component="button" type="button" size="xs" c="dimmed" onClick={regenerate} disabled={saving}>
            <Group gap={4} component="span">
              <IconRefresh size={12} />
              Generar un link nuevo (el anterior deja de funcionar)
            </Group>
          </Anchor>
        </Stack>
      </Modal>
    </>
  );
}

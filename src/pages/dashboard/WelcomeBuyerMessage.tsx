import { Stack, Text } from "@mantine/core";

interface Props {
  nombre?: string;
  /** La línea de la pestaña "Empresas" solo aplica si esa vista está habilitada en el evento. */
  companiesTabEnabled: boolean;
}

/** Contenido del pop-up de bienvenida para compradores (el título "¡Bienvenido al evento!" lo pone el Modal). */
export default function WelcomeBuyerMessage({ nombre, companiesTabEnabled }: Props) {
  return (
    <Stack gap="md">
      <Text>
        {nombre ? (
          <>
            ¡Hola, <b>{nombre}</b>! Nos alegra tenerte aquí.
          </>
        ) : (
          "¡Hola! Nos alegra tenerte aquí."
        )}
      </Text>

      <Text fw={700} size="lg">
        ¿Qué puedes hacer ahora?
      </Text>

      <Stack gap="sm">
        {companiesTabEnabled && (
          <div>
            <Text fw={600}>🔎 Encuentra empresas y asistentes</Text>
            <Text size="sm" c="dimmed">
              En la pestaña <b>Empresas</b> puedes explorar los participantes, conocer sus perfiles y
              solicitar reuniones con quienes sean de tu interés.
            </Text>
          </div>
        )}
        <div>
          <Text fw={600}>🤝 Gestiona tus reuniones</Text>
          <Text size="sm" c="dimmed">
            En <b>Mis reuniones</b> podrás consultar tus reuniones agendadas y revisar las
            solicitudes que hayas enviado o recibido.
          </Text>
        </div>
        <div>
          <Text fw={600}>📲 Mantente atento a tus notificaciones</Text>
          <Text size="sm" c="dimmed">
            Revisa tu WhatsApp y correo electrónico para confirmar que recibiste nuestro mensaje de
            bienvenida.
          </Text>
          <Text size="sm" c="dimmed" mt={6}>
            Si no lo recibiste, verifica y actualiza tu número de teléfono y correo electrónico en
            tu perfil.
          </Text>
          <Text size="sm" c="dimmed" mt={6}>
            Así te aseguramos que puedas recibir correctamente las notificaciones y solicitudes de
            reuniones durante el evento.
          </Text>
        </div>
      </Stack>

      <Text fw={600} ta="center">
        ¡Explora, conecta y aprovecha al máximo el evento!
      </Text>
    </Stack>
  );
}

import { Paper, Stack, Text } from "@mantine/core";

const ACCIONES: { titulo: string; texto: string }[] = [
  {
    titulo: "👥 Explora los compradores",
    texto:
      "A medida que las empresas compradoras se registren, podrás consultar su información directamente en la plataforma.",
  },
  {
    titulo: "👤 Revisa tu perfil",
    texto:
      "Puedes ver tu perfil tal como lo encontrarán los compradores, revisarlo y actualizarlo cuando quieras.",
  },
  {
    titulo: "🤝 Prepárate para conectar",
    texto:
      "Mantén tu perfil completo y actualizado para que los compradores conozcan mejor lo que ofreces.",
  },
];

/** Contenido del pop-up de bienvenida para vendedores (el título "¡Tu registro está completo!" lo pone el Modal). */
export default function WelcomeSellerMessage() {
  return (
    <Stack gap="md">
      <Text>
        Ahora las empresas compradoras podrán encontrarte y solicitarte reuniones.
      </Text>
      <Text>
        Cuando recibas una solicitud, te avisaremos por WhatsApp y correo electrónico.
      </Text>

      <Paper radius="md" p="md" bg="var(--mantine-primary-color-light)">
        <Stack gap="xs">
          <Text fw={600}>
            👉 Completa y mejora tu perfil agregando los productos o servicios que ofreces y
            cuéntanos qué te hace diferente.
          </Text>
          <Text size="sm">
            Si tienes ofertas, descuentos o condiciones especiales para este evento, inclúyelos en
            la descripción. Así los compradores podrán conocer mejor tu propuesta antes de
            solicitar una reunión.
          </Text>
        </Stack>
      </Paper>

      <Text fw={700} size="lg">
        ¿Qué puedes hacer ahora?
      </Text>
      <Stack gap="sm">
        {ACCIONES.map((a) => (
          <div key={a.titulo}>
            <Text fw={600}>{a.titulo}</Text>
            <Text size="sm" c="dimmed">
              {a.texto}
            </Text>
          </div>
        ))}
      </Stack>

      <Text fw={600} ta="center">
        ¡Tu perfil es tu mejor carta de presentación!
      </Text>
    </Stack>
  );
}

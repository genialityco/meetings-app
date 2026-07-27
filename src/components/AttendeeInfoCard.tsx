import { Avatar, Box, Divider, SimpleGrid, Stack, Text } from "@mantine/core";
import { splitAttendeeFields } from "../utils/attendeeFields";

interface AttendeeInfoCardProps {
  attendee: any;
  formFields?: any[];
}

function FieldValue({ label, value }: { label: string; value: any }) {
  const display = Array.isArray(value) ? value.join(", ") : (value ?? "—");
  return (
    <Box>
      <Text size="xs" c="dimmed" fw={500}>{label}</Text>
      <Text size="sm" style={{ wordBreak: "break-word" }}>{display}</Text>
    </Box>
  );
}

export default function AttendeeInfoCard({ attendee, formFields = [] }: AttendeeInfoCardProps) {
  const { basicFields, additionalFields } = splitAttendeeFields(formFields);

  return (
    <Stack gap="sm">
      <Box style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Avatar src={attendee?.photoURL} radius="xl" size={56} color="teal">
          {(attendee?.nombre || "?")[0]?.toUpperCase()}
        </Avatar>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text fw={700} size="md" lineClamp={1}>{attendee?.nombre || "Sin nombre"}</Text>
          <Text size="sm" c="dimmed" lineClamp={1}>
            {attendee?.empresa || attendee?.company_razonSocial || ""}
          </Text>
        </Box>
      </Box>

      <Divider />

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
        {basicFields.map((f: any) => (
          <FieldValue key={f.name} label={f.label || f.name} value={attendee?.[f.name]} />
        ))}
      </SimpleGrid>

      {additionalFields.length > 0 && (
        <>
          <Divider
            label={<Text size="xs" fw={700} c="dimmed" tt="uppercase">Datos adicionales</Text>}
            labelPosition="left"
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
            {additionalFields.map((f: any) => (
              <FieldValue key={f.name} label={f.label || f.name} value={attendee?.[f.name]} />
            ))}
          </SimpleGrid>
        </>
      )}
    </Stack>
  );
}

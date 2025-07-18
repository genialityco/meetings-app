import {
  Grid,
  Card,
  Group,
  Avatar,
  Title,
  Text,
  Button,
  TextInput,
  Select,
} from "@mantine/core";

export default function AssistantsTab({
  filteredAssistants,
  searchTerm,
  setSearchTerm,
  showOnlyToday,
  setShowOnlyToday,
  eventConfig,
  solicitarReunionHabilitado,
  sendMeetingRequest,
  setAvatarModalOpened,
  setSelectedImage,
  interestOptions,
  interestFilter,
  setInterestFilter
}) {
  return (
    <>
<Group grow mb="md">
  <TextInput
    placeholder="Buscar por cualquier campo..."
    value={searchTerm}
    onChange={(e) => setSearchTerm(e.target.value)}
  />
  <Select
    data={interestOptions}
    placeholder="Filtrar por interés principal"
    value={interestFilter}
    onChange={setInterestFilter}
    clearable
    searchable
  />
</Group>


      <Group mb="md">
        <Button
          variant={showOnlyToday ? "filled" : "outline"}
          color="blue"
          size="xs"
          onClick={() => setShowOnlyToday((v) => !v)}
        >
          {showOnlyToday
            ? "Mostrar todos los asistentes"
            : "Mostrar solo conectados hoy"}
        </Button>
      </Group>
      <Text>
        Máximo, puedes agendar{" "}
        <strong>{eventConfig?.maxMeetingsPerUser ?? "∞"}</strong> reuniones
      </Text>
      <Grid>
        {filteredAssistants.length > 0 ? (
          filteredAssistants.map((assistant) => (
            <Grid.Col
              span={{ xs: 12, sm: 6, md: 4 }}
              key={assistant.id}
              style={{ height: 400 }} // Alto fijo real aquí
            >
              <Card
                shadow="sm"
                p="lg"
                style={{
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <Group justify="center" mb="md">
                  <Avatar
                    src={assistant.photoURL}
                    alt={`Avatar de ${assistant.nombre}`}
                    radius="50%"
                    size="xl"
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      setSelectedImage(assistant.photoURL);
                      setAvatarModalOpened(true);
                    }}
                  >
                    {!assistant.photoURL &&
                      assistant.nombre &&
                      assistant.nombre[0]}
                  </Avatar>
                </Group>
                <Title order={5} mb={4} style={{ textAlign: "center" }}>
                  📛 {assistant.nombre}
                </Title>
                {/* <--- CONTENIDO SCROLLEABLE --- */}
                <div
                  style={{
                    flex: 1,
                    overflowY: "auto",
                    minHeight: 0,
                    marginBottom: 8,
                  }}
                >
                  {/* ...Todos los <Text> del contenido aquí... */}
                  <Text size="sm">
                    🏢 <strong>Empresa:</strong> {assistant.empresa}
                  </Text>
                  <Text size="sm">
                    🏷 <strong>Cargo:</strong> {assistant.cargo}
                  </Text>
                  <Text size="sm">
                    📧 <strong>Correo:</strong>{" "}
                    {assistant.correo || "No disponible"}
                  </Text>
                  <Text size="sm">
                    📝 <strong>Descripción:</strong>{" "}
                    {assistant.descripcion || "No especificada"}
                  </Text>
                  <Text size="sm">
                    🎯 <strong>Interés Principal:</strong>{" "}
                    {assistant.interesPrincipal || "No especificado"}
                  </Text>
                  <Text size="sm">
                    🔍 <strong>Necesidad:</strong>{" "}
                    {assistant.necesidad || "No especificada"}
                  </Text>
                  <Text size="sm">
                    🕓 <strong>Última conexión:</strong>{" "}
                    {assistant.lastConnectionDateTime || "No registrada"}
                  </Text>
                </div>
                <Group mt="auto">
                  <Button
                    mt="sm"
                    onClick={() =>
                      sendMeetingRequest(
                        assistant.id,
                        assistant.telefono
                      )
                    }
                    disabled={!solicitarReunionHabilitado}
                    fullWidth
                  >
                    {solicitarReunionHabilitado
                      ? "Solicitar reunión"
                      : "Solicitudes deshabilitadas"}
                  </Button>
                </Group>
              </Card>
            </Grid.Col>
          ))
        ) : (
          <Text>No hay asistentes registrados.</Text>
        )}
      </Grid>
    </>
  );
}

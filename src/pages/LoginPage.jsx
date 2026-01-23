import { useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container,
  Paper,
  TextInput,
  PasswordInput,
  Button,
  Title,
  Text,
  Alert,
  Stack,
  Center,
} from "@mantine/core";
import { AuthContext } from "../context/AuthContext";
import { IconAlertCircle } from "@tabler/icons-react";

const LoginPage = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    // Simular pequeño delay para UX
    setTimeout(() => {
      const result = login(email, password);
      if (result.success) {
        navigate("/admin");
      } else {
        setError(result.message || "Error al iniciar sesión");
      }
      setIsLoading(false);
    }, 500);
  };

  return (
    <Container size={420} my={40}>
      <Center>
        <Paper p="lg" radius="md" withBorder style={{ width: "100%" }}>
          <Stack gap="lg">
            <div>
              <Title order={1} size="h2" fw={700} ta="center">
                Admin Login
              </Title>
              <Text c="dimmed" size="sm" ta="center" mt={5}>
                Ingresa tus credenciales para acceder al panel de administración
              </Text>
            </div>

            <form onSubmit={handleSubmit}>
              <Stack gap="md">
                {error && (
                  <Alert
                    icon={<IconAlertCircle size={16} />}
                    title="Error"
                    color="red"
                    closable
                    onClose={() => setError("")}
                  >
                    {error}
                  </Alert>
                )}

                <TextInput
                  label="Email"
                  placeholder="tu@email.com"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                  required
                  disabled={isLoading}
                />

                <PasswordInput
                  label="Contraseña"
                  placeholder="Tu contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                  required
                  disabled={isLoading}
                />

                <Button
                  fullWidth
                  type="submit"
                  loading={isLoading}
                  disabled={!email || !password}
                >
                  Iniciar Sesión
                </Button>
              </Stack>
            </form>
          </Stack>
        </Paper>
      </Center>
    </Container>
  );
};

export default LoginPage;

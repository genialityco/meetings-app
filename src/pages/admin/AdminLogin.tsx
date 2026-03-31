import { useState, useEffect, useContext } from "react";
import {
  Center,
  Paper,
  Title,
  TextInput,
  PasswordInput,
  Button,
  Alert,
  Stack,
  Text,
  Anchor,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useNavigate, Link } from "react-router-dom";
import { AdminAuthContext } from "../../context/AdminAuthContext";

const AdminLogin = () => {
  const { adminUser, adminLoading, loginAdmin } = useContext(AdminAuthContext);
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!adminLoading && adminUser) {
      navigate("/admin", { replace: true });
    }
  }, [adminUser, adminLoading, navigate]);

  const handleLogin = async () => {
    if (!email || !password) {
      setError("Ingresa tu email y contraseña.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      await loginAdmin(email, password);
      // La redirección ocurre en el useEffect cuando adminUser se actualiza
    } catch (err: any) {
      const msg = err?.message || "Error al iniciar sesión.";
      // Si loginAdmin no lanzó un mensaje personalizado, verificar si es por falta de permisos
      if (msg === "Error al iniciar sesión.") {
        setError("No tienes permisos de administrador.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleLogin();
  };

  if (adminLoading) return null;

  return (
    <Center h="100vh" bg="gray.0">
      <Paper shadow="md" p="xl" w={400} radius="md">
        <Stack gap="md">
          <Stack gap={4}>
            <Title order={3} ta="center">
              Panel Administrativo
            </Title>
            <Text size="sm" c="dimmed" ta="center">
              Ingresa con tu cuenta de administrador
            </Text>
          </Stack>

          {error && (
            <Alert
              icon={<IconAlertCircle size={16} />}
              color="red"
              variant="light"
            >
              {error}
            </Alert>
          )}

          <TextInput
            label="Email"
            placeholder="admin@geniality.com.co"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="email"
          />

          <PasswordInput
            label="Contraseña"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="current-password"
          />

          <Button onClick={handleLogin} loading={loading} fullWidth mt="xs">
            Iniciar sesión
          </Button>

          <Text size="sm" ta="center" c="dimmed">
            ¿No tienes acceso aún?{" "}
            <Anchor component={Link} to="/admin/register">
              Solicitar acceso
            </Anchor>
          </Text>
        </Stack>
      </Paper>
    </Center>
  );
};

export default AdminLogin;

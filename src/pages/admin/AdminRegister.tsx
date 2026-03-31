import { useState, useEffect } from "react";
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
  ThemeIcon,
} from "@mantine/core";
import { IconAlertCircle, IconCircleCheck } from "@tabler/icons-react";
import { Link, useNavigate } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
} from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../../firebase/firebaseConfig";

const AdminRegister = () => {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Si ya tiene sesión como admin redirige
  useEffect(() => {
    const session = localStorage.getItem("adminSession");
    if (session) navigate("/admin", { replace: true });
  }, [navigate]);

  const handleRegister = async () => {
    setError("");

    if (!displayName.trim()) {
      setError("Ingresa tu nombre completo.");
      return;
    }
    if (!email.trim()) {
      setError("Ingresa tu email.");
      return;
    }
    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);

    try {
      // 1. Crear usuario en Firebase Auth
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: displayName.trim() });

      // 2. Verificar que no sea ya un admin
      const adminDoc = await getDoc(doc(db, "admins", cred.user.uid));
      if (adminDoc.exists()) {
        // Ya es admin, redirigir
        navigate("/admin", { replace: true });
        return;
      }

      // 3. Crear solicitud pendiente en adminRequests
      await setDoc(doc(db, "adminRequests", cred.user.uid), {
        email: email.trim().toLowerCase(),
        displayName: displayName.trim(),
        status: "pending",
        createdAt: serverTimestamp(),
      });

      // 4. Cerrar sesión (el admin no debe quedar autenticado hasta ser aprobado)
      await signOut(auth);

      setSuccess(true);
    } catch (err: any) {
      const code = err?.code || "";
      if (code === "auth/email-already-in-use") {
        setError("Ese email ya está registrado. Intenta iniciar sesión.");
      } else if (code === "auth/invalid-email") {
        setError("El email no es válido.");
      } else if (code === "auth/weak-password") {
        setError("La contraseña es muy débil.");
      } else {
        setError("Error al crear la solicitud. Intenta de nuevo.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleRegister();
  };

  if (success) {
    return (
      <Center h="100vh" bg="gray.0">
        <Paper shadow="md" p="xl" w={400} radius="md">
          <Stack align="center" gap="md">
            <ThemeIcon size={56} radius="xl" color="green">
              <IconCircleCheck size={32} />
            </ThemeIcon>
            <Title order={3} ta="center">
              Solicitud enviada
            </Title>
            <Text size="sm" c="dimmed" ta="center">
              Tu solicitud de acceso fue enviada correctamente. Un administrador
              revisará tu cuenta y te notificará cuando sea aprobada.
            </Text>
            <Anchor component={Link} to="/admin/login" size="sm">
              Volver al inicio de sesión
            </Anchor>
          </Stack>
        </Paper>
      </Center>
    );
  }

  return (
    <Center h="100vh" bg="gray.0">
      <Paper shadow="md" p="xl" w={420} radius="md">
        <Stack gap="md">
          <Stack gap={4}>
            <Title order={3} ta="center">
              Solicitar acceso admin
            </Title>
            <Text size="sm" c="dimmed" ta="center">
              Completa el formulario. Un super-admin revisará y aprobará tu
              acceso.
            </Text>
          </Stack>

          {error && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
              {error}
            </Alert>
          )}

          <TextInput
            label="Nombre completo"
            placeholder="Tu nombre"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={handleKeyDown}
          />

          <TextInput
            label="Email"
            placeholder="tu@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="email"
          />

          <PasswordInput
            label="Contraseña"
            placeholder="Mínimo 6 caracteres"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="new-password"
          />

          <PasswordInput
            label="Confirmar contraseña"
            placeholder="Repite la contraseña"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="new-password"
          />

          <Button onClick={handleRegister} loading={loading} fullWidth mt="xs">
            Enviar solicitud
          </Button>

          <Text size="sm" ta="center" c="dimmed">
            ¿Ya tienes acceso?{" "}
            <Anchor component={Link} to="/admin/login">
              Iniciar sesión
            </Anchor>
          </Text>
        </Stack>
      </Paper>
    </Center>
  );
};

export default AdminRegister;

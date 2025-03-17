import { useEffect, useState, useContext, useCallback } from "react";
import {
  TextInput,
  Button,
  Paper,
  Title,
  Stack,
  Loader,
  Divider,
  Image,
  Text,
  Select,
} from "@mantine/core";
import { RichTextEditor, Link } from '@mantine/tiptap';
import { useEditor } from '@tiptap/react';
import Highlight from '@tiptap/extension-highlight';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';

import { useNavigate, useParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { UserContext } from "../context/UserContext";

const Landing = () => {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const { userLoading, loginByCedula, currentUser, updateUser } =
    useContext(UserContext);

  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [formValues, setFormValues] = useState({
    nombre: "",
    cedula: "",
    empresa: "",
    cargo: "",
    descripcion: "", // Aquí se almacenará el HTML resultante del editor
    interesPrincipal: "",
    necesidad: "",
    contacto: { correo: "", telefono: "" },
  });

  const [loading, setLoading] = useState(false);
  const [searchCedula, setSearchCedula] = useState("");
  const [searchError, setSearchError] = useState("");
  const [showInfo, setShowInfo] = useState(false);

  // Configuración del editor Tiptap con Mantine
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link,
      Highlight,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: formValues.descripcion || "<p>Escribe aquí la descripción...</p>",
  });

  // Cargar datos del usuario si existe en currentUser
  useEffect(() => {
    if (currentUser?.data) {
      setFormValues((prev) => ({
        ...prev,
        ...currentUser.data,
      }));
    }
  }, [currentUser]);

  // Cargar la configuración del evento para saber si los registros están habilitados
  useEffect(() => {
    if (eventId) {
      const unsubscribe = onSnapshot(
        doc(db, "events", eventId),
        (eventDoc) => {
          if (eventDoc.exists()) {
            const eventData = eventDoc.data();
            setRegistrationEnabled(
              eventData.config?.registrationEnabled ?? true
            );
          }
        },
        (error) => {
          console.error("Error in real-time listener:", error);
        }
      );
      return () => unsubscribe();
    }
  }, [eventId]);

  // Manejar cambios en el formulario
  const handleChange = (field, value) => {
    if (field.startsWith("contacto.")) {
      const key = field.split(".")[1];
      setFormValues((prev) => ({
        ...prev,
        contacto: {
          ...prev.contacto,
          [key]: value,
        },
      }));
    } else {
      setFormValues((prev) => ({
        ...prev,
        [field]: value,
      }));
    }
  };

  // Buscar usuario por cédula
  const handleSearchByCedula = async () => {
    setLoading(true);
    setSearchError("");
    setShowInfo(false);

    const result = await loginByCedula(searchCedula);

    if (result?.success) {
      navigate(eventId ? `/dashboard/${eventId}` : "/dashboard");
    } else {
      setSearchError("No se encuentra registrada esta cédula");
      setShowInfo(true);
    }
    setLoading(false);
  };

  // Enviar formulario (registrar o actualizar usuario)
  const handleSubmit = useCallback(async () => {
    setLoading(true);
    try {
      const uid = currentUser.uid;
      await updateUser(uid, { ...formValues, eventId });
      navigate(eventId ? `/dashboard/${eventId}` : "/dashboard");
    } catch (error) {
      console.error("Error en el registro:", error);
    }
    setLoading(false);
  }, [currentUser, formValues, navigate, updateUser, eventId]);

  const handleGoToDashboard = () => {
    navigate("/dashboard");
  };

  if (userLoading) return <Loader />;

  return (
    <Paper shadow="md" p="xl" style={{ maxWidth: 500, margin: "40px auto" }}>
      <a
        href="https://geniality.com.co/"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Image
          src="/LOGOS_FENALCO_DIRECTORIO.jpg"
          alt="Networking Event"
          mb="md"
          radius="md"
        />
      </a>

      <Title order={2} align="center" mb="md">
        Acceso al Directorio de Networking
      </Title>

      <Text ta="justify" mb="lg">
        Solo los participantes que se registraron de manera presencial en la
        actividad de networking pueden acceder al directorio.
      </Text>

      {/* Sección de búsqueda de usuario */}
      <Stack>
        <TextInput
          label="Ingrese su cédula"
          placeholder="Número de cédula"
          value={searchCedula}
          onChange={(e) => setSearchCedula(e.target.value)}
        />
        {searchError && <Text color="red">{searchError}</Text>}
        <Button onClick={handleSearchByCedula} loading={loading}>
          Ingresar
        </Button>
      </Stack>
      <Divider my="md" />

      {registrationEnabled ? (
        <Stack>
          <TextInput
            label="Nombre"
            placeholder="Tu nombre completo"
            value={formValues.nombre}
            onChange={(e) => handleChange("nombre", e.target.value)}
            required
          />
          <TextInput
            label="Cédula"
            placeholder="Tu número de identificación"
            value={formValues.cedula}
            onChange={(e) => handleChange("cedula", e.target.value)}
            required
          />
          <TextInput
            label="Empresa"
            placeholder="Nombre de la empresa"
            value={formValues.empresa}
            onChange={(e) => handleChange("empresa", e.target.value)}
            required
          />
          <TextInput
            label="Cargo"
            placeholder="Tu cargo"
            value={formValues.cargo}
            onChange={(e) => handleChange("cargo", e.target.value)}
            required
          />
          <Title order={6}>Descripción breve del negocio</Title>
          {/* Integración del editor de Mantine Tiptap */}
          <RichTextEditor editor={editor}>
            <RichTextEditor.Toolbar sticky stickyOffset={60}>
            <RichTextEditor.ControlsGroup>
          <RichTextEditor.Bold />
          <RichTextEditor.Italic />
          <RichTextEditor.Underline />
          <RichTextEditor.Strikethrough />
          <RichTextEditor.ClearFormatting />
          <RichTextEditor.Highlight />
          <RichTextEditor.Code />
        </RichTextEditor.ControlsGroup>

        <RichTextEditor.ControlsGroup>
          <RichTextEditor.H1 />
          <RichTextEditor.H2 />
          <RichTextEditor.H3 />
          <RichTextEditor.H4 />
        </RichTextEditor.ControlsGroup>

        <RichTextEditor.ControlsGroup>
          <RichTextEditor.Blockquote />
          <RichTextEditor.Hr />
          <RichTextEditor.BulletList />
          <RichTextEditor.OrderedList />
        </RichTextEditor.ControlsGroup>

        <RichTextEditor.ControlsGroup>
          <RichTextEditor.Link />
          <RichTextEditor.Unlink />
        </RichTextEditor.ControlsGroup>

        <RichTextEditor.ControlsGroup>
          <RichTextEditor.AlignLeft />
          <RichTextEditor.AlignCenter />
          <RichTextEditor.AlignJustify />
          <RichTextEditor.AlignRight />
        </RichTextEditor.ControlsGroup>

        <RichTextEditor.ControlsGroup>
          <RichTextEditor.Undo />
          <RichTextEditor.Redo />
        </RichTextEditor.ControlsGroup>
      </RichTextEditor.Toolbar>
            <RichTextEditor.Content />
          </RichTextEditor>
          <Select
            label="Interés principal"
            placeholder="Selecciona una opción"
            data={[
              { value: "proveedores", label: "Conocer proveedores" },
              { value: "clientes", label: "Conocer clientes" },
              { value: "abierto", label: "Abierto" },
            ]}
            value={formValues.interesPrincipal}
            onChange={(value) => handleChange("interesPrincipal", value)}
            required
          />
          <TextInput
            label="Necesidad específica para la rueda de negocios"
            placeholder="¿Qué necesitas?"
            value={formValues.necesidad}
            onChange={(e) => handleChange("necesidad", e.target.value)}
            required
          />
          <TextInput
            label="Correo (opcional)"
            placeholder="Tu correo electrónico"
            value={formValues.contacto.correo}
            onChange={(e) => handleChange("contacto.correo", e.target.value)}
          />
          <TextInput
            label="Teléfono (opcional)"
            placeholder="Tu número de teléfono"
            value={formValues.contacto.telefono}
            onChange={(e) => handleChange("contacto.telefono", e.target.value)}
          />
          <Button onClick={handleSubmit} loading={loading}>
            {currentUser?.data ? "Actualizar" : "Registrarse"}
          </Button>
          {currentUser?.data && (
            <Button onClick={handleGoToDashboard}>Ir a la dashboard</Button>
          )}
        </Stack>
      ) : (
        <Text align="center" color="gray" mt="md">
          Los nuevos registros están inhabilitados para este evento.
        </Text>
      )}

      {showInfo && (
        <>
          <Divider my="md" />
          <Text align="center" color="gray">
            Si no se encuentra registrada su cédula, significa que no asistió
            presencialmente al evento y no podrá acceder al directorio.
          </Text>
        </>
      )}
    </Paper>
  );
};

export default Landing;

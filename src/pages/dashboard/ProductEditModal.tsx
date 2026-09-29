import { useEffect, useState } from "react";
import { Modal, Stack, TextInput, Textarea, FileInput, Group, Button } from "@mantine/core";
import { showNotification } from "@mantine/notifications";

interface ProductPayload {
  title: string;
  description: string;
  category: string;
  imageFile: File | null;
}

interface ProductEditModalProps {
  opened: boolean;
  onClose: () => void;
  /** Producto a editar, o null/undefined para crear uno nuevo. */
  editing?: any | null;
  createProduct: (payload: ProductPayload) => Promise<any>;
  updateProduct: (id: string, payload: ProductPayload) => Promise<any>;
  allowImageUpload?: boolean;
}

/** Modal de crear/editar producto, compartido entre MyProductsTab (Mi actividad >
 * Mis productos) y MyCompanyTab (Mi empresa), para que ambas vistas editen los
 * mismos productos sin duplicar el formulario. */
export default function ProductEditModal({
  opened,
  onClose,
  editing,
  createProduct,
  updateProduct,
  allowImageUpload = true,
}: ProductEditModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  // Precargar/limpiar el formulario cada vez que se abre (no al cambiar `editing`
  // con el modal ya abierto, para no pisar lo que se esté escribiendo).
  useEffect(() => {
    if (!opened) return;
    setTitle(editing?.title || "");
    setDescription(editing?.description || "");
    setCategory(editing?.category || "");
    setImageFile(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const onSave = async () => {
    if (!title.trim())
      return showNotification({ title: "Falta título", message: "Escribe un título.", color: "red" });
    if (!description.trim())
      return showNotification({ title: "Falta descripción", message: "Escribe una descripción.", color: "red" });

    setSaving(true);
    try {
      if (editing) {
        await updateProduct(editing.id, { title, description, category, imageFile });
        showNotification({ title: "Actualizado", message: "Producto actualizado.", color: "teal" });
      } else {
        await createProduct({ title, description, category, imageFile });
        showNotification({ title: "Creado", message: "Producto creado.", color: "teal" });
      }
      onClose();
    } catch {
      showNotification({ title: "Error", message: "No se pudo guardar.", color: "red" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={editing ? "Editar producto" : "Crear producto"} radius="lg">
      <Stack>
        <TextInput
          label="Título"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          required
          radius="md"
        />
        <TextInput
          label="Categoría"
          placeholder="Ej: Tecnología, Alimentos, Servicios..."
          value={category}
          onChange={(e) => setCategory(e.currentTarget.value)}
          radius="md"
        />
        <Textarea
          label="Descripción"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          minRows={4}
          required
          radius="md"
        />
        {allowImageUpload && (
          <FileInput
            label="Imagen (opcional)"
            value={imageFile}
            onChange={setImageFile}
            accept="image/png,image/jpeg,image/webp"
            radius="md"
          />
        )}
        <Group grow mt="sm">
          <Button variant="default" radius="md" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={saving} radius="md" onClick={onSave}>
            {editing ? "Guardar" : "Crear"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

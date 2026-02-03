import { useMemo, useState } from "react";
import {
  Card, Group, Title, Text, Button, Stack, Modal,
  TextInput, Textarea, FileInput, Grid, Image, Badge
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";

export default function MyProductsTab({
  products,
  currentUser,
  createProduct,
  updateProduct,
  deleteProduct,
}: any) {
  const uid = currentUser?.uid;

  const myProducts = useMemo(
    () => (products || []).filter((p: any) => p.ownerUserId === uid),
    [products, uid]
  );

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setTitle("");
    setDescription("");
    setCategory("");
    setImageFile(null);
    setOpen(true);
  };

  const openEdit = (p: any) => {
    setEditing(p);
    setTitle(p.title || "");
    setDescription(p.description || "");
    setCategory(p.category || "");
    setImageFile(null);
    setOpen(true);
  };

  const onSave = async () => {
    if (!title.trim()) return showNotification({ title: "Falta título", message: "Escribe un título.", color: "red" });
    if (!description.trim()) return showNotification({ title: "Falta descripción", message: "Escribe una descripción.", color: "red" });

    setSaving(true);
    try {
      if (editing) {
        await updateProduct(editing.id, { title, description, category, imageFile });
        showNotification({ title: "Actualizado", message: "Producto actualizado.", color: "teal" });
      } else {
        await createProduct({ title, description, category, imageFile });
        showNotification({ title: "Creado", message: "Producto creado.", color: "teal" });
      }
      setOpen(false);
    } catch {
      showNotification({ title: "Error", message: "No se pudo guardar.", color: "red" });
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (p: any) => {
    if (!confirm("¿Eliminar este producto?")) return;
    try {
      await deleteProduct(p.id);
      showNotification({ title: "Eliminado", message: "Producto eliminado.", color: "teal" });
    } catch {
      showNotification({ title: "Error", message: "No se pudo eliminar.", color: "red" });
    }
  };

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={3}>Mis productos</Title>
        <Button onClick={openCreate}>Crear producto</Button>
      </Group>

      <Grid>
        {myProducts.map((p: any) => (
          <Grid.Col key={p.id} span={{ xs: 12, sm: 6, md: 4 }}>
            <Card withBorder shadow="sm" p="lg">
              <Group justify="space-between" mb="xs">
                <Title order={5} lineClamp={1}>{p.title}</Title>
                {p.category ? (
                  <Badge variant="light">{p.category}</Badge>
                ) : (
                  <Badge variant="light" color="gray">Sin categoría</Badge>
                )}
              </Group>

              {p.imageUrl ? <Image src={p.imageUrl} height={160} radius="md" mb="sm" /> : null}
              <Text size="sm" c="dimmed">{p.description}</Text>

              <Group mt="md" grow>
                <Button variant="default" onClick={() => openEdit(p)}>Editar</Button>
                <Button color="red" variant="outline" onClick={() => onDelete(p)}>Eliminar</Button>
              </Group>
            </Card>
          </Grid.Col>
        ))}

        {!myProducts.length ? (
          <Grid.Col span={12}>
            <Text c="dimmed">Aún no has creado productos.</Text>
          </Grid.Col>
        ) : null}
      </Grid>

      <Modal opened={open} onClose={() => setOpen(false)} title={editing ? "Editar producto" : "Crear producto"}>
        <Stack>
          <TextInput label="Título" value={title} onChange={(e) => setTitle(e.currentTarget.value)} required />
          <TextInput label="Categoría" placeholder="Ej: Tecnología, Alimentos, Servicios..." value={category} onChange={(e) => setCategory(e.currentTarget.value)} />
          <Textarea label="Descripción" value={description} onChange={(e) => setDescription(e.currentTarget.value)} minRows={4} required />
          <FileInput
            label="Imagen (opcional)"
            value={imageFile}
            onChange={setImageFile}
            accept="image/png,image/jpeg,image/webp"
          />
          <Group grow mt="sm">
            <Button variant="default" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={saving} onClick={onSave}>{editing ? "Guardar" : "Crear"}</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

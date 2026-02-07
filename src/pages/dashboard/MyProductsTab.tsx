import { useMemo, useState } from "react";
import {
  Card, Group, Title, Text, Button, Stack, Modal,
  TextInput, Textarea, FileInput, Grid, Image, Badge,
  Avatar, Box, Divider, Paper, useMantineTheme,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import {
  IconPlus,
  IconEdit,
  IconTrash,
  IconPhoto,
} from "@tabler/icons-react";

export default function MyProductsTab({
  products,
  currentUser,
  createProduct,
  updateProduct,
  deleteProduct,
}: any) {
  const theme = useMantineTheme();
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
        <Title order={4}>Mis productos</Title>
        <Button
          onClick={openCreate}
          radius="md"
          leftSection={<IconPlus size={16} />}
        >
          Crear producto
        </Button>
      </Group>

      <Grid gutter="sm">
        {myProducts.map((p: any) => (
          <Grid.Col key={p.id} span={{ base: 6, sm: 4, md: 3 }}>
            <Card
              withBorder
              radius="lg"
              padding="sm"
              shadow="sm"
              style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}
            >
              <Card.Section>
                {p.imageUrl ? (
                  <Box style={{ position: "relative" }}>
                    <Image
                      src={p.imageUrl}
                      height={140}
                      fit="cover"
                      alt={p.title}
                    />
                    {p.category && (
                      <Badge
                        variant="filled"
                        radius="md"
                        size="sm"
                        style={{
                          position: "absolute",
                          top: 10,
                          left: 10,
                          background: "rgba(0,0,0,0.55)",
                          border: "1px solid rgba(255,255,255,0.18)",
                        }}
                      >
                        {p.category}
                      </Badge>
                    )}
                  </Box>
                ) : (
                  <Box
                    style={{
                      height: 140,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "var(--mantine-color-gray-1)",
                    }}
                  >
                    <Avatar size={64} radius="md" color="gray">
                      <IconPhoto size={32} />
                    </Avatar>
                    {p.category && (
                      <Badge
                        variant="filled"
                        radius="md"
                        size="sm"
                        style={{
                          position: "absolute",
                          top: 10,
                          left: 10,
                          background: "rgba(0,0,0,0.55)",
                          border: "1px solid rgba(255,255,255,0.18)",
                        }}
                      >
                        {p.category}
                      </Badge>
                    )}
                  </Box>
                )}
              </Card.Section>

              <Stack gap={8} mt="sm" style={{ flex: 1 }}>
                <Title order={6} lineClamp={2}>
                  {p.title}
                </Title>
                <Text size="xs" c="dimmed" lineClamp={3} style={{ whiteSpace: "pre-wrap" }}>
                  {p.description}
                </Text>
              </Stack>

              <Divider my="xs" />

              <Group grow gap="xs">
                <Button
                  variant="light"
                  size="compact-sm"
                  radius="md"
                  leftSection={<IconEdit size={14} />}
                  onClick={() => openEdit(p)}
                >
                  Editar
                </Button>
                <Button
                  color="red"
                  variant="light"
                  size="compact-sm"
                  radius="md"
                  leftSection={<IconTrash size={14} />}
                  onClick={() => onDelete(p)}
                >
                  Eliminar
                </Button>
              </Group>
            </Card>
          </Grid.Col>
        ))}

        {!myProducts.length && (
          <Grid.Col span={12}>
            <Paper withBorder radius="lg" p="lg">
              <Text c="dimmed" ta="center">
                Aún no has creado productos.
              </Text>
            </Paper>
          </Grid.Col>
        )}
      </Grid>

      <Modal
        opened={open}
        onClose={() => setOpen(false)}
        title={editing ? "Editar producto" : "Crear producto"}
        radius="lg"
      >
        <Stack>
          <TextInput label="Título" value={title} onChange={(e) => setTitle(e.currentTarget.value)} required radius="md" />
          <TextInput label="Categoría" placeholder="Ej: Tecnología, Alimentos, Servicios..." value={category} onChange={(e) => setCategory(e.currentTarget.value)} radius="md" />
          <Textarea label="Descripción" value={description} onChange={(e) => setDescription(e.currentTarget.value)} minRows={4} required radius="md" />
          <FileInput
            label="Imagen (opcional)"
            value={imageFile}
            onChange={setImageFile}
            accept="image/png,image/jpeg,image/webp"
            radius="md"
          />
          <Group grow mt="sm">
            <Button variant="default" radius="md" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={saving} radius="md" onClick={onSave}>{editing ? "Guardar" : "Crear"}</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

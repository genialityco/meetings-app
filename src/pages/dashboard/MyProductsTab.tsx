import { useMemo, useState } from "react";
import {
  Card, Group, Title, Text, Button, Stack,
  Grid, Image, Badge,
  Box, Divider, Paper,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import {
  IconPlus,
  IconEdit,
  IconTrash,
} from "@tabler/icons-react";
import ProductEditModal from "./ProductEditModal";

export default function MyProductsTab({
  products,
  currentUser,
  createProduct,
  updateProduct,
  deleteProduct,
  policies,
}: any) {
  const uid = currentUser?.uid;

  const allowImageUpload = policies?.allowProductImageUpload !== false;

  const myProducts = useMemo(
    () => (products || []).filter((p: any) => p.ownerUserId === uid),
    [products, uid]
  );

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const openCreate = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (p: any) => {
    setEditing(p);
    setOpen(true);
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
              {allowImageUpload && p.imageUrl ? (
                <>
                  <Card.Section>
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
                  </Card.Section>
                  <Stack gap={8} mt="sm" style={{ flex: 1 }}>
                    <Title order={6} lineClamp={2}>
                      {p.title}
                    </Title>
                    <Text size="xs" c="dimmed" lineClamp={3} style={{ whiteSpace: "pre-wrap" }}>
                      {p.description}
                    </Text>
                  </Stack>
                </>
              ) : (
                <Stack gap={6} style={{ flex: 1 }}>
                  {p.category && (
                    <Badge variant="light" size="xs" color="blue" radius="sm">
                      {p.category}
                    </Badge>
                  )}
                  <Title order={5} lineClamp={2} style={{ lineHeight: 1.2 }}>
                    {p.title}
                  </Title>
                  <Text size="sm" c="dimmed" lineClamp={4} style={{ whiteSpace: "pre-wrap", flex: 1 }}>
                    {p.description}
                  </Text>
                </Stack>
              )}

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

      <ProductEditModal
        opened={open}
        onClose={() => setOpen(false)}
        editing={editing}
        createProduct={createProduct}
        updateProduct={updateProduct}
        allowImageUpload={allowImageUpload}
      />
    </>
  );
}

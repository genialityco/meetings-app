import { Menu, Indicator, ActionIcon, Text } from "@mantine/core";
import { IoNotificationsOutline } from "react-icons/io5";

export default function NotificationsMenu({ notifications }) {
  return (
    <Menu position="bottom-start" width={300}>
      <Menu.Target>
        <Indicator label={notifications.length} size={18} color="red">
          <ActionIcon variant="light">
            <IoNotificationsOutline size={24} />
          </ActionIcon>
        </Indicator>
      </Menu.Target>
      <Menu.Dropdown>
        {notifications.length > 0 ? (
          notifications.map((notif) => (
            <Menu.Item key={notif.id}>
              <strong>{notif.title}</strong>
              <Text size="sm">{notif.message}</Text>
            </Menu.Item>
          ))
        ) : (
          <Text ta="center" size="sm" c="dimmed">
            No tienes notificaciones
          </Text>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

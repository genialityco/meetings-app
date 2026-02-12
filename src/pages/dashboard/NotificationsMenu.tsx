import {
  Menu,
  Indicator,
  ActionIcon,
  Text,
  Group,
  Stack,
  Button,
  ScrollArea,
  Box,
} from "@mantine/core";
import { IoNotificationsOutline } from "react-icons/io5";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/es";
import type { Notification } from "./types";

dayjs.extend(relativeTime);
dayjs.locale("es");

interface NotificationsMenuProps {
  notifications: Notification[];
  onNotificationClick?: (notif: Notification) => void;
  onMarkAllRead?: () => void;
}

export default function NotificationsMenu({
  notifications,
  onNotificationClick,
  onMarkAllRead,
}: NotificationsMenuProps) {
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <Menu position="bottom-start" width={340}>
      <Menu.Target>
        <Indicator
          label={unreadCount}
          size={18}
          color="red"
          disabled={unreadCount === 0}
        >
          <ActionIcon variant="light">
            <IoNotificationsOutline size={24} />
          </ActionIcon>
        </Indicator>
      </Menu.Target>
      <Menu.Dropdown>
        {unreadCount > 0 && onMarkAllRead && (
          <>
            <Group justify="flex-end" px="xs" py={4}>
              <Button
                variant="subtle"
                size="compact-xs"
                onClick={onMarkAllRead}
              >
                Marcar todas como leídas
              </Button>
            </Group>
            <Menu.Divider />
          </>
        )}

        {notifications.length > 0 ? (
          <ScrollArea.Autosize mah={350}>
            {notifications.map((notif) => {
              const ts = notif.timestamp?.toDate
                ? notif.timestamp.toDate()
                : notif.timestamp instanceof Date
                  ? notif.timestamp
                  : null;

              return (
                <Menu.Item
                  key={notif.id}
                  onClick={() => onNotificationClick?.(notif)}
                  bg={notif.read ? undefined : "var(--mantine-color-blue-0)"}
                  style={{
                    borderLeft: notif.read
                      ? "3px solid transparent"
                      : "3px solid var(--mantine-color-blue-5)",
                  }}
                >
                  <Stack gap={2}>
                    <Text size="sm" fw={notif.read ? 400 : 600} lineClamp={1}>
                      {notif.title}
                    </Text>
                    <Text size="xs" c="dimmed" lineClamp={2}>
                      {notif.message}
                    </Text>
                    {ts && (
                      <Text size="xs" c="dimmed" fs="italic">
                        {dayjs(ts).fromNow()}
                      </Text>
                    )}
                  </Stack>
                </Menu.Item>
              );
            })}
          </ScrollArea.Autosize>
        ) : (
          <Box py="md">
            <Text ta="center" size="sm" c="dimmed">
              No tienes notificaciones
            </Text>
          </Box>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

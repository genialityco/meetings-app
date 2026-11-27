/**
 * Destacado en vivo en el dashboard del asistente (ver src/utils/spotlight.ts):
 * - Tarjeta "EN VIVO" arriba de todas las vistas con Solicitar reunión / Me interesa / Ver más
 * - Aviso emergente una sola vez por destacado (no al propio presentador)
 * - "Se presentaron hoy": quienes ya pasaron, para quien llegó tarde o estaba distraído
 * - Para el presentador: la lista de personas que marcaron "Me interesa"
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ActionIcon,
  Anchor,
  Avatar,
  Badge,
  Box,
  Button,
  Collapse,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import {
  IconBrandWhatsapp,
  IconBuilding,
  IconCalendarPlus,
  IconChevronDown,
  IconChevronUp,
  IconHeart,
  IconHeartFilled,
  IconMail,
  IconMicrophone2,
  IconUsers,
} from "@tabler/icons-react";
import { doc, onSnapshot } from "firebase/firestore";
import MeetingRequestModal from "./MeetingRequestModal";
import { normCompanyKey } from "./meetingSlotEngine";
import { canDiscoverAttendee } from "../../utils/attendeeRole";
import { toWhatsAppNumber } from "../../utils/phoneUtils";
import {
  type Spotlight,
  type SpotlightInterest,
  DEFAULT_SPOTLIGHT_HEADLINE,
  addSpotlightInterest,
  interestsCol,
  removeSpotlightInterest,
  trackSpotlightEngagement,
} from "../../utils/spotlight";
import type { SpotlightsState } from "./useSpotlights";

// Rechazos que ya mostraron su propia notificación en useDashboardData
const ALREADY_NOTIFIED = new Set([
  "Meeting limit reached",
  "Role meeting limit reached",
  "No advisors available",
  "No availability",
  "Receiver not found",
  "No user logged in",
  "User data not found",
]);

interface RequestTarget {
  kind: "attendee" | "company";
  targetId: string;
  name: string;
  phone: string;
  spotlightId: string;
  note?: string;
}

const popupKey = (eventId: string, id: string) => `spotlight-popup:${eventId}:${id}`;

export default function SpotlightBar({ dashboard }: { dashboard: any }) {
  const { eventId = "" } = useParams();
  const navigate = useNavigate();
  const spotlights: SpotlightsState | undefined = dashboard.spotlights;
  const uid: string | undefined = dashboard.uid;
  const me = dashboard.currentUser?.data;
  const policies = dashboard.policies || {};
  const myCompanyKey = normCompanyKey(me?.companyId);

  const [requestTarget, setRequestTarget] = useState<RequestTarget | null>(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [popupId, setPopupId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Spotlight | null>(null);
  const [todayOpen, setTodayOpen] = useState(false);

  const assistantsById = useMemo(() => {
    const map = new Map<string, any>();
    (dashboard.assistants || []).forEach((a: any) => map.set(a.id, a));
    return map;
  }, [dashboard.assistants]);

  const companiesById = useMemo(() => {
    const map = new Map<string, any>();
    (dashboard.companies || []).forEach((c: any) => map.set(c.nitNorm, c));
    return map;
  }, [dashboard.companies]);

  const isPresenter = (s: Spotlight) =>
    s.type === "attendee" ? s.targetId === uid : !!myCompanyKey && normCompanyKey(s.targetId) === myCompanyKey;

  // ¿Puedo pedirle reunión? (mismas reglas que el Directorio / Empresas; el envío vuelve a validar)
  const canRequest = (s: Spotlight) => {
    if (!dashboard.solicitarReunionHabilitado || isPresenter(s)) return false;
    const myTipo = me?.tipoAsistente;
    if (s.type === "attendee") {
      const target = assistantsById.get(s.targetId);
      if (target?.companyId && myCompanyKey && normCompanyKey(target.companyId) === myCompanyKey) return false;
      return !target || canDiscoverAttendee(policies.discoveryMode, myTipo, target.tipoAsistente);
    }
    const reps = (dashboard.assistants || []).filter(
      (a: any) => normCompanyKey(a.companyId) === normCompanyKey(s.targetId),
    );
    return !reps.length || reps.some((a: any) => canDiscoverAttendee(policies.discoveryMode, myTipo, a.tipoAsistente));
  };

  // Datos frescos del asistente/empresa, con la copia del destacado como respaldo
  const viewOf = (s: Spotlight) => {
    if (s.type === "attendee") {
      const a = assistantsById.get(s.targetId);
      return {
        name: a?.nombre || s.displayName,
        subtitle:
          [a?.cargo, a?.company_razonSocial || a?.empresa].filter(Boolean).join(" · ") || s.subtitle || "",
        image: a?.photoURL || s.imageUrl || null,
        description: a?.descripcion || s.description || "",
        phone: a?.telefono || a?.contacto?.telefono || "",
        companyId: a?.companyId || null,
      };
    }
    const c = companiesById.get(s.targetId);
    return {
      name: c?.razonSocial || s.displayName,
      subtitle: s.subtitle || "",
      image: c?.logoUrl || s.imageUrl || null,
      description: c?.descripcion || s.description || "",
      phone: "",
      companyId: s.targetId,
    };
  };

  // Aviso emergente: el primer destacado en vivo que este asistente no haya visto
  const live = spotlights?.live || [];
  useEffect(() => {
    if (!eventId || !uid || popupId) return;
    const next = live.find((s) => {
      if (isPresenter(s)) return false;
      try {
        return !localStorage.getItem(popupKey(eventId, s.id));
      } catch {
        return false;
      }
    });
    if (next) setPopupId(next.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, eventId, uid, popupId]);

  // Métrica "lo vio": la tarjeta en vivo quedó en pantalla
  useEffect(() => {
    if (!eventId || !uid) return;
    live.forEach((s) => {
      if (!isPresenter(s)) trackSpotlightEngagement(eventId, s.id, uid, "seenAt");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, eventId, uid]);

  const closePopup = () => {
    if (popupId) {
      try {
        localStorage.setItem(popupKey(eventId, popupId), "1");
      } catch {
        /* noop */
      }
    }
    setPopupId(null);
  };

  // ---------------------------------------------------------------- solicitudes

  const send = async (target: RequestTarget, message?: string) => {
    const context = {
      spotlightId: target.spotlightId,
      ...(message ? { contextNote: message } : {}),
    };
    setRequestLoading(true);
    try {
      const result =
        target.kind === "company"
          ? await dashboard.sendMeetingRequestToCompany(target.targetId, context)
          : await dashboard.requestMeetingWithSlotPicker(target.targetId, target.phone, context);
      if (!(result && (result as any).deferred)) {
        showNotification({
          title: "Solicitud enviada",
          message: `Tu solicitud de reunión le llegó a ${target.name}.`,
          color: "teal",
        });
      }
      setRequestTarget(null);
    } catch (e: any) {
      if (e?.handled || ALREADY_NOTIFIED.has(e?.message)) {
        setRequestTarget(null);
      } else {
        showNotification({ title: "Error", message: "No se pudo enviar la solicitud. Intenta de nuevo.", color: "red" });
      }
    } finally {
      setRequestLoading(false);
    }
  };

  const startRequest = (target: RequestTarget) => {
    if (uid) trackSpotlightEngagement(eventId, target.spotlightId, uid, "requestClickedAt");
    setPopupId(null);
    setDetail(null);
    // Sin aceptación (requester_picks) el mensaje va en el selector de horario
    if (policies.schedulingMode === "requester_picks") {
      send(target);
      return;
    }
    setRequestTarget(target);
  };

  const requestSpotlight = (s: Spotlight) => {
    const v = viewOf(s);
    startRequest({ kind: s.type, targetId: s.targetId, name: v.name, phone: v.phone, spotlightId: s.id });
  };

  const openMore = (s: Spotlight) => {
    if (uid) trackSpotlightEngagement(eventId, s.id, uid, "openedAt");
  };

  if (!spotlights || !uid) return null;

  const today = dedupeByTarget(spotlights.presentedToday).filter(
    (s) => !live.some((l) => l.targetId === s.targetId),
  );
  const popup = popupId ? live.find((s) => s.id === popupId) || null : null;

  return (
    <Stack gap="sm">
      <style>{`
        @keyframes spotlight-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
        @keyframes spotlight-glow {
          0%,100% { box-shadow: 0 0 0 0 rgba(250, 82, 82, .0), var(--mantine-shadow-md) }
          50% { box-shadow: 0 0 0 4px rgba(250, 82, 82, .18), var(--mantine-shadow-md) }
        }
      `}</style>

      <PresenterInterests
        eventId={eventId}
        mine={spotlights.all.filter((s) => s.startedAt && isPresenter(s))}
        canRequest={!!dashboard.solicitarReunionHabilitado}
        onRequest={(i, spotlightId) =>
          startRequest({
            kind: "attendee",
            targetId: i.uid,
            name: i.nombre,
            phone: i.telefono || "",
            spotlightId,
          })
        }
      />

      {live.map((s) => (
        <SpotlightCard
          key={s.id}
          eventId={eventId}
          uid={uid}
          me={dashboard.currentUser}
          spotlight={s}
          view={viewOf(s)}
          live
          presenter={isPresenter(s)}
          canRequest={canRequest(s)}
          onRequest={() => requestSpotlight(s)}
          onOpenMore={() => openMore(s)}
          onOpenCompany={(nit) => navigate(`/dashboard/${eventId}/company/${nit}`)}
        />
      ))}

      {today.length > 0 && (
        <Paper withBorder radius="lg" p="xs" px="sm">
          <UnstyledButton onClick={() => setTodayOpen((o) => !o)} style={{ width: "100%" }}>
            <Group justify="space-between" wrap="nowrap">
              <Group gap={8} wrap="nowrap">
                <IconMicrophone2 size={18} />
                <Text size="sm" fw={600}>
                  Se presentaron hoy ({today.length})
                </Text>
                {!todayOpen && (
                  <Avatar.Group spacing="sm">
                    {today.slice(0, 4).map((s) => (
                      <Avatar key={s.id} src={viewOf(s).image} size={24} radius="xl">
                        {viewOf(s).name?.[0]?.toUpperCase()}
                      </Avatar>
                    ))}
                  </Avatar.Group>
                )}
              </Group>
              {todayOpen ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />}
            </Group>
          </UnstyledButton>
          <Collapse in={todayOpen}>
            <ScrollArea type="auto" mt="xs" offsetScrollbars>
              <Group gap="xs" wrap="nowrap" pb={4}>
                {today.map((s) => {
                  const v = viewOf(s);
                  return (
                    <Paper
                      key={s.id}
                      withBorder
                      radius="md"
                      p="xs"
                      style={{ cursor: "pointer", minWidth: 180, maxWidth: 220, flexShrink: 0 }}
                      onClick={() => {
                        openMore(s);
                        setDetail(s);
                      }}
                    >
                      <Group gap="xs" wrap="nowrap">
                        <Avatar src={v.image} radius="xl" size={36}>
                          {s.type === "company" ? <IconBuilding size={18} /> : v.name?.[0]?.toUpperCase()}
                        </Avatar>
                        <Box style={{ minWidth: 0 }}>
                          <Text size="sm" fw={600} lineClamp={1}>
                            {v.name}
                          </Text>
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {v.subtitle || (s.type === "company" ? "Empresa" : "Asistente")}
                          </Text>
                        </Box>
                      </Group>
                    </Paper>
                  );
                })}
              </Group>
            </ScrollArea>
          </Collapse>
        </Paper>
      )}

      {/* Aviso emergente al activarse */}
      <Modal opened={!!popup} onClose={closePopup} centered radius="lg" size="md" withCloseButton title=" ">
        {popup && (
          <Stack gap="md">
            <SpotlightCard
              eventId={eventId}
              uid={uid}
              me={dashboard.currentUser}
              spotlight={popup}
              view={viewOf(popup)}
              live
              expanded
              flat
              presenter={false}
              canRequest={canRequest(popup)}
              onRequest={() => {
                closePopup();
                requestSpotlight(popup);
              }}
              onOpenMore={() => openMore(popup)}
              onOpenCompany={(nit) => {
                closePopup();
                navigate(`/dashboard/${eventId}/company/${nit}`);
              }}
            />
            <Button variant="subtle" color="gray" onClick={closePopup}>
              Ver más tarde
            </Button>
          </Stack>
        )}
      </Modal>

      {/* Detalle de quien ya se presentó */}
      <Modal opened={!!detail} onClose={() => setDetail(null)} centered radius="lg" size="md" title="Se presentó hoy">
        {detail && (
          <SpotlightCard
            eventId={eventId}
            uid={uid}
            me={dashboard.currentUser}
            spotlight={detail}
            view={viewOf(detail)}
            live={false}
            expanded
            flat
            presenter={isPresenter(detail)}
            canRequest={canRequest(detail)}
            onRequest={() => requestSpotlight(detail)}
            onOpenMore={() => openMore(detail)}
            onOpenCompany={(nit) => {
              setDetail(null);
              navigate(`/dashboard/${eventId}/company/${nit}`);
            }}
          />
        )}
      </Modal>

      <MeetingRequestModal
        opened={!!requestTarget}
        recipientName={requestTarget?.name || ""}
        recipientType={requestTarget?.kind === "company" ? "empresa" : "asistente"}
        onCancel={() => setRequestTarget(null)}
        onConfirm={(message) => requestTarget && send(requestTarget, message)}
        loading={requestLoading}
      />
    </Stack>
  );
}

function dedupeByTarget(list: Spotlight[]) {
  const seen = new Set<string>();
  return list.filter((s) => {
    const k = `${s.type}:${s.targetId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Tarjeta
// ---------------------------------------------------------------------------

function SpotlightCard({
  eventId,
  uid,
  me,
  spotlight: s,
  view,
  live,
  presenter,
  canRequest,
  expanded: startExpanded = false,
  flat = false,
  onRequest,
  onOpenMore,
  onOpenCompany,
}: {
  eventId: string;
  uid: string;
  me: any;
  spotlight: Spotlight;
  view: { name: string; subtitle: string; image: string | null; description: string; companyId: string | null };
  live: boolean;
  presenter: boolean;
  canRequest: boolean;
  expanded?: boolean;
  flat?: boolean;
  onRequest: () => void;
  onOpenMore: () => void;
  onOpenCompany: (nit: string) => void;
}) {
  const [expanded, setExpanded] = useState(startExpanded);
  const [interested, setInterested] = useState(false);
  const [interestLoading, setInterestLoading] = useState(false);

  useEffect(() => {
    if (presenter) return;
    return onSnapshot(
      doc(interestsCol(eventId, s.id), uid),
      (snap) => setInterested(snap.exists()),
      () => undefined,
    );
  }, [eventId, s.id, uid, presenter]);

  const toggleInterest = async () => {
    setInterestLoading(true);
    try {
      if (interested) {
        await removeSpotlightInterest(eventId, s.id, uid);
      } else {
        await addSpotlightInterest(eventId, s.id, { uid, data: me?.data });
        showNotification({
          title: "¡Listo!",
          message: `${view.name} verá que te interesa y podrá contactarte.`,
          color: "pink",
        });
      }
    } catch (err) {
      console.error("Error guardando 'Me interesa':", err);
      showNotification({ title: "Error", message: "No se pudo guardar. Intenta de nuevo.", color: "red" });
    } finally {
      setInterestLoading(false);
    }
  };

  const hasMore = !!(view.description || (s.type === "attendee" && view.companyId) || s.type === "company");

  return (
    <Paper
      withBorder={!flat}
      radius="lg"
      p={flat ? 0 : "md"}
      shadow={flat ? undefined : "md"}
      style={
        live && !flat
          ? {
              borderColor: "var(--mantine-color-red-4)",
              borderWidth: 2,
              animation: "spotlight-glow 2.4s ease-in-out infinite",
              background:
                "linear-gradient(135deg, var(--mantine-color-red-0) 0%, var(--mantine-color-body) 55%)",
            }
          : undefined
      }
    >
      <Stack gap="sm">
        <Group gap={8} wrap="nowrap">
          {live ? (
            <Badge
              color="red"
              variant="filled"
              radius="sm"
              leftSection={
                <Box
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 8,
                    background: "white",
                    animation: "spotlight-pulse 1.2s ease-in-out infinite",
                  }}
                />
              }
            >
              En vivo
            </Badge>
          ) : (
            <Badge color="gray" variant="light" radius="sm" leftSection={<IconMicrophone2 size={12} />}>
              Se presentó
            </Badge>
          )}
          <Text size="sm" fw={600} c={live ? "red.8" : "dimmed"} lineClamp={1}>
            {s.headline || DEFAULT_SPOTLIGHT_HEADLINE}
          </Text>
        </Group>

        <Group wrap="nowrap" align="center" gap="md">
          <Avatar src={view.image} size={64} radius={s.type === "company" ? "md" : "xl"}>
            {s.type === "company" ? <IconBuilding size={30} /> : view.name?.[0]?.toUpperCase()}
          </Avatar>
          <Box style={{ minWidth: 0, flex: 1 }}>
            <Text fw={800} size="lg" lh={1.2} lineClamp={2}>
              {view.name}
            </Text>
            {view.subtitle && (
              <Text size="sm" c="dimmed" lineClamp={2}>
                {view.subtitle}
              </Text>
            )}
          </Box>
        </Group>

        {s.note && (
          <Text size="sm" fs="italic">
            {s.note}
          </Text>
        )}

        {expanded && (
          <Stack gap={6}>
            {view.description && (
              <Text size="sm" style={{ whiteSpace: "pre-line" }}>
                {view.description}
              </Text>
            )}
            {view.companyId && (
              <Anchor size="sm" onClick={() => onOpenCompany(view.companyId!)}>
                {s.type === "company" ? "Ver página de la empresa →" : "Ver su empresa →"}
              </Anchor>
            )}
          </Stack>
        )}

        {presenter ? (
          <Text size="sm" fw={600} c="red.8">
            {s.type === "company" ? "¡Tu empresa" : "¡Tú"} estás en pantalla para todos los asistentes!
            Aquí abajo verás a quienes marquen "Me interesa".
          </Text>
        ) : (
          <Group gap="xs" wrap="wrap">
            {canRequest && (
              <Button
                leftSection={<IconCalendarPlus size={18} />}
                color="red"
                radius="xl"
                onClick={onRequest}
                style={{ flex: "1 1 auto" }}
              >
                Solicitar reunión
              </Button>
            )}
            <Button
              variant={interested ? "filled" : "light"}
              color="pink"
              radius="xl"
              leftSection={interested ? <IconHeartFilled size={18} /> : <IconHeart size={18} />}
              loading={interestLoading}
              onClick={toggleInterest}
              style={{ flex: "1 1 auto" }}
            >
              {interested ? "Te interesa" : "Me interesa"}
            </Button>
            {hasMore && !startExpanded && (
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                radius="xl"
                aria-label={expanded ? "Ver menos" : "Ver más"}
                onClick={() => {
                  if (!expanded) onOpenMore();
                  setExpanded((e) => !e);
                }}
              >
                {expanded ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />}
              </ActionIcon>
            )}
          </Group>
        )}
      </Stack>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Interesados (solo los ve el presentador / su empresa)
// ---------------------------------------------------------------------------

function PresenterInterests({
  eventId,
  mine,
  canRequest,
  onRequest,
}: {
  eventId: string;
  mine: Spotlight[];
  canRequest: boolean;
  onRequest: (interest: SpotlightInterest, spotlightId: string) => void;
}) {
  const [bySpotlight, setBySpotlight] = useState<Record<string, SpotlightInterest[]>>({});
  const [open, setOpen] = useState(false);
  const ids = mine.map((s) => s.id).sort().join(",");

  useEffect(() => {
    if (!ids) return;
    const unsubs = ids.split(",").map((id) =>
      onSnapshot(
        interestsCol(eventId, id),
        (snap) =>
          setBySpotlight((prev) => ({
            ...prev,
            [id]: snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as SpotlightInterest),
          })),
        (err) => console.error("Error cargando interesados:", err),
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [eventId, ids]);

  // Una persona por fila (pudo marcar interés en más de una presentación)
  const rows = useMemo(() => {
    const map = new Map<string, { interest: SpotlightInterest; spotlightId: string }>();
    Object.entries(bySpotlight).forEach(([spotlightId, list]) =>
      list.forEach((i) => {
        if (!map.has(i.uid)) map.set(i.uid, { interest: i, spotlightId });
      }),
    );
    return [...map.values()];
  }, [bySpotlight]);

  if (!mine.length || !rows.length) return null;

  return (
    <Paper withBorder radius="lg" p="sm" style={{ borderColor: "var(--mantine-color-pink-4)" }}>
      <UnstyledButton onClick={() => setOpen((o) => !o)} style={{ width: "100%" }}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap={8} wrap="nowrap">
            <IconUsers size={18} color="var(--mantine-color-pink-6)" />
            <Text size="sm" fw={700}>
              {rows.length} {rows.length === 1 ? "persona marcó" : "personas marcaron"} "Me interesa" en tu presentación
            </Text>
          </Group>
          {open ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />}
        </Group>
      </UnstyledButton>
      <Collapse in={open}>
        <Stack gap="xs" mt="sm">
          {rows.map(({ interest: i, spotlightId }) => {
            const wa = i.telefono ? toWhatsAppNumber(i.telefono) : "";
            return (
              <Paper key={i.uid} withBorder radius="md" p="xs">
                <Group justify="space-between" wrap="wrap" gap="xs">
                  <Box style={{ minWidth: 0 }}>
                    <Text size="sm" fw={600}>
                      {i.nombre || "Asistente"}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {[i.cargo, i.empresa].filter(Boolean).join(" · ")}
                    </Text>
                  </Box>
                  <Group gap={4} wrap="nowrap">
                    {wa && (
                      <ActionIcon
                        component="a"
                        href={`https://wa.me/${wa}`}
                        target="_blank"
                        rel="noreferrer"
                        variant="light"
                        color="green"
                        radius="xl"
                        aria-label="WhatsApp"
                      >
                        <IconBrandWhatsapp size={16} />
                      </ActionIcon>
                    )}
                    {i.correo && (
                      <ActionIcon
                        component="a"
                        href={`mailto:${i.correo}`}
                        variant="light"
                        color="blue"
                        radius="xl"
                        aria-label="Correo"
                      >
                        <IconMail size={16} />
                      </ActionIcon>
                    )}
                    {canRequest && (
                      <Button size="compact-sm" radius="xl" variant="light" onClick={() => onRequest(i, spotlightId)}>
                        Solicitar reunión
                      </Button>
                    )}
                  </Group>
                </Group>
              </Paper>
            );
          })}
        </Stack>
      </Collapse>
    </Paper>
  );
}

/* eslint-disable react/prop-types */
import { useEffect, useState, useContext } from "react";
import {
  Container,
  Title,
  Tabs,
  Card,
  Text,
  Grid,
  Button,
  Stack,
  Group,
  Menu,
  Indicator,
  ActionIcon,
  Flex,
  TextInput,
  Avatar,
  Modal,
  Collapse,
  Box,
  CheckIcon,
} from "@mantine/core";
import {
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  query,
  where,
  getDocs,
  orderBy,
  getDoc,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { UserContext } from "../context/UserContext";
import { useNavigate, useParams } from "react-router-dom";
import { showNotification } from "@mantine/notifications";
import { IoNotificationsOutline } from "react-icons/io5";
import { BiX } from "react-icons/bi";
import { FaWhatsapp } from "react-icons/fa";

const slotOverlapsBreakBlock = (
  slotStart,
  meetingDuration,
  breakBlocks = []
) => {
  const [h, m] = slotStart.split(":").map(Number);
  const slotStartMin = h * 60 + m;
  const slotEndMin = slotStartMin + meetingDuration;

  return breakBlocks.some((block) => {
    const [sh, sm] = block.start.split(":").map(Number);
    const [eh, em] = block.end.split(":").map(Number);
    const blockStartMin = sh * 60 + sm;
    const blockEndMin = eh * 60 + em;
    return (
      (slotStartMin >= blockStartMin && slotStartMin < blockEndMin) ||
      (slotEndMin > blockStartMin && slotEndMin <= blockEndMin) ||
      (slotStartMin <= blockStartMin && slotEndMin >= blockEndMin)
    );
  });
};

const Dashboard = () => {
  const { currentUser } = useContext(UserContext);
  const uid = currentUser?.uid;
  const navigate = useNavigate();
  const { eventId } = useParams(); // ID del evento actual

  const [searchTerm, setSearchTerm] = useState("");

  // Estados para asistentes, reuniones y solicitudes
  const [assistants, setAssistants] = useState([]);
  const [filteredAssistants, setFilteredAssistants] = useState([]);
  const [acceptedMeetings, setAcceptedMeetings] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [acceptedRequests, setAcceptedRequests] = useState([]);
  const [rejectedRequests, setRejectedRequests] = useState([]);
  const [participantsInfo, setParticipantsInfo] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [solicitarReunionHabilitado, setSolicitarReunionHabilitado] =
    useState(true);

  const [eventConfig, setEventConfig] = useState(null);

  // Estados para el modal de imagen
  const [avatarModalOpened, setAvatarModalOpened] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);

  const [pendingVisible, setPendingVisible] = useState(true);

  const [expandedMeetingId, setExpandedMeetingId] = useState(null);

  const [showOnlyToday, setShowOnlyToday] = useState(true);

  // ---------------------------------------------------------------------------
  // 1. Verificar usuario logueado, sino -> '/'
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!currentUser?.data) navigate("/");
  }, [currentUser, navigate]);

  // 2. Carga eventConfig (incluye breakBlocks)
  useEffect(() => {
    if (!eventId) return;
    (async () => {
      const ref = doc(db, "events", eventId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        setEventConfig(snap.data().config || {});
      }
    })();
  }, [eventId]);

  // ---------------------------------------------------------------------------
  // 2. Cargar notificaciones (globales o filtradas por eventId según necesidad)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, "notifications"),
      where("userId", "==", uid),
      orderBy("timestamp", "desc")
    );
    return onSnapshot(q, (snap) => {
      const nots = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      nots.forEach((n) => {
        if (!n.read) {
          showNotification({
            title: n.title,
            message: n.message,
            color: "teal",
            position: "top-right",
          });
          updateDoc(doc(db, "notifications", n.id), { read: true });
        }
      });
      setNotifications(nots);
    });
  }, [uid]);

  // ---------------------------------------------------------------------------
  // 3. Configuración global: ver si está habilitado "solicitarReunionHabilitado"
  // ---------------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      const cfgRef = doc(db, "config", "generalSettings");
      const cfgSnap = await getDoc(cfgRef);
      if (cfgSnap.exists()) {
        setSolicitarReunionHabilitado(
          cfgSnap.data().solicitarReunionHabilitado
        );
      }
    })();
  }, []);

  // ---------------------------------------------------------------------------
  // 4. Cargar lista de asistentes (colección "users") filtrando por eventId
  //    Se excluye el usuario actual (uid).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!eventId) return;
    const q = query(collection(db, "users"), where("eventId", "==", eventId));
    return onSnapshot(q, (snap) => {
      const today = new Date().toISOString().split("T")[0];
      const list = snap.docs
        .filter((d) => d.id !== uid)
        .map((d) => {
          const data = d.data();

          let last;
          if (data.lastConnection?.toDate) {
            last = data.lastConnection.toDate();
          } else if (typeof data.lastConnection === "string") {
            last = new Date(data.lastConnection);
          } else if (data.lastConnection instanceof Date) {
            last = data.lastConnection;
          }

          const lastDateTimeStr = last
            ? last.toLocaleString("es-CO", {
                dateStyle: "short",
                timeStyle: "short",
              })
            : null;

          return {
            id: d.id,
            ...data,
            lastConnectionDateTime: lastDateTimeStr,
            connectedToday: last?.toISOString().split("T")[0] === today,
          };
        });
      setAssistants(list);
      setFilteredAssistants(list);
    });
  }, [uid, eventId]);

  // ---------------------------------------------------------------------------
  // 5. Filtrar asistentes cuando cambia el searchTerm
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const term = searchTerm.toLowerCase();
    const filtered = assistants.filter(
      (a) =>
        a.nombre?.toLowerCase().includes(term) ||
        a.cargo?.toLowerCase().includes(term) ||
        a.empresa?.toLowerCase().includes(term) ||
        a.contacto?.correo?.toLowerCase().includes(term) ||
        a.contacto?.telefono?.toLowerCase().includes(term)
    );

    const filteredFinal = showOnlyToday
      ? filtered.filter((a) => a.connectedToday)
      : filtered;

    setFilteredAssistants(filteredFinal);
  }, [searchTerm, assistants, showOnlyToday]);

  // ---------------------------------------------------------------------------
  // 6. Solicitudes ENVIADAS por el usuario actual (status=pending)
  //    subcolección /events/{eventId}/meetings con field eventId
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!uid || !eventId) return;
    const q = query(
      collection(db, "events", eventId, "meetings"),
      where("requesterId", "==", uid),
      where("status", "==", "pending")
    );
    return onSnapshot(q, (snap) => {
      setSentRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [uid, eventId]);

  // ---------------------------------------------------------------------------
  // 7. Cargar reuniones ACEPTADAS (subcolección /events/{eventId}/meetings)
  //    donde participants incluye uid
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!uid || !eventId) return;
    const q = query(
      collection(db, "events", eventId, "meetings"),
      where("status", "==", "accepted"),
      where("participants", "array-contains", uid)
    );
    return onSnapshot(q, async (snap) => {
      const mts = [];
      const info = {};
      for (const d of snap.docs) {
        const m = { id: d.id, ...d.data() };
        // Si no hay timeSlot, dejarlo como string vacío para evitar errores
        m.timeSlot = typeof m.timeSlot === "string" ? m.timeSlot : "";
        mts.push(m);
        const other = m.requesterId === uid ? m.receiverId : m.requesterId;
        if (other && !info[other]) {
          try {
            const uSnap = await getDoc(doc(db, "users", other));
            if (uSnap.exists()) info[other] = uSnap.data();
          } catch (e) {
            console.log(e);
          }
        }
      }
      setAcceptedMeetings(mts);
      setParticipantsInfo(info);
    });
  }, [uid, eventId]);

  // ---------------------------------------------------------------------------
  // 8. Cargar solicitudes donde el usuario ES receptor (receiverId=uid),
  //    independiente de status -> filtra en subcolección /events/{eventId}/meetings
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!uid || !eventId) return;
    const q = query(
      collection(db, "events", eventId, "meetings"),
      where("receiverId", "==", uid)
    );
    return onSnapshot(q, (snap) => {
      const pend = [],
        acc = [],
        rej = [];
      snap.docs.forEach((d) => {
        const r = { id: d.id, ...d.data() };
        if (r.status === "pending") pend.push(r);
        if (r.status === "accepted") acc.push(r);
        if (r.status === "rejected") rej.push(r);
      });
      setPendingRequests(pend);
      setAcceptedRequests(acc);
      setRejectedRequests(rej);
    });
  }, [uid, eventId]);

  function formatPhoneNumber(phone) {
    const digits = phone.replace(/\D/g, ""); // Elimina todo excepto dígitos

    // Si empieza por 3 y tiene 10 dígitos, es colombiano
    if (digits.length === 10 && digits.startsWith("3")) {
      return "57" + digits;
    }

    // Si ya viene con 57 al inicio y tiene 12 dígitos
    if (digits.length === 12 && digits.startsWith("57")) {
      return digits;
    }

    // Si tiene 11 y empieza con 0, se elimina y se agrega 57
    if (digits.length === 11 && digits.startsWith("03")) {
      return "57" + digits.slice(1);
    }

    // Otro caso: asumir que ya viene bien o retornarlo tal cual
    return digits;
  }

  const url = "https://www.onurix.com/api/v1/sms/send";

  async function sendSms(text, phone) {
    const data = new URLSearchParams();
    data.append("client", "7121");
    data.append("key", "145d2b857deea633450f5af2b42350c52288e309682f7a1904272");
    data.append("phone", formatPhoneNumber(phone));
    data.append("sms", text);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: data,
      });

      const json = await response.json();
      console.log("✅ SMS enviado:", json);
    } catch (err) {
      console.error("❌ Error al enviar SMS:", err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // 9. Enviar solicitud de reunión: crear doc en /events/{eventId}/meetings
  // ---------------------------------------------------------------------------
  const sendMeetingRequest = async (assistantId, assistantPhone) => {
    if (!uid || !eventId) return;
    try {
      // 1. Crear la solicitud en Firestore
      const meetingDoc = await addDoc(
        collection(db, "events", eventId, "meetings"),
        {
          eventId,
          requesterId: uid,
          receiverId: assistantId,
          status: "pending",
          createdAt: new Date(),
          participants: [uid, assistantId],
        }
      );

      // 2. Obtener info del solicitante
      const requester = currentUser?.data;
      const meetingId = meetingDoc.id;
      const baseUrl = window.location.origin;

      // 3. Construir mensaje con info y enlaces
      const acceptUrl = `${baseUrl}/meeting-response/${eventId}/${meetingId}/accept`;
      const rejectUrl = `${baseUrl}/meeting-response/${eventId}/${meetingId}/reject`;
      const landingUrl = `${baseUrl}/event/${eventId}`;

      const message =
        `Has recibido una solicitud de reunión de:\n` +
        `Nombre: ${requester?.nombre || ""}\n` +
        `Empresa: ${requester?.empresa || ""}\n` +
        `Cargo: ${requester?.cargo || ""}\n` +
        `Correo: ${requester?.contacto?.correo || ""}\n` +
        `Teléfono: ${requester?.contacto?.telefono || ""}\n\n` +
        `Opciones:\n` +
        `*1. Aceptar:* ${acceptUrl}\n` +
        `*2. Rechazar:* ${rejectUrl}\n` +
        `3. Ir a la landing: ${landingUrl}`;

      // 4. Enviar mensaje a WhatsApp usando el backend local
      fetch("https://api-whatsapp-ncj5.onrender.com/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: `57${assistantPhone.replace(/[^\d]/g, "")}`,
          message,
        }),
      }).catch((err) => {
        // No bloquear el flujo si falla el backend local
        console.error("Error enviando WhatsApp:", err);
      });

      // 5. Notificación en la app
      await addDoc(collection(db, "notifications"), {
        userId: assistantId,
        title: "Nueva solicitud de reunión",
        message: `${
          requester?.nombre || "Alguien"
        } te ha enviado una solicitud de reunión.`,
        timestamp: new Date(),
        read: false,
      });

      showNotification({
        title: "Solicitud enviada",
        message: "Tu solicitud ha sido enviada.",
        color: "blue",
      });
    } catch (e) {
      console.error(e);
    }
  };

  // ---------------------------------------------------------------------------
  // 10. Aceptar/Rechazar solicitud de reunión (evitando descansos
  //     y respetando límite máximo de citas por usuario)
  // ---------------------------------------------------------------------------
  const updateMeetingStatus = async (meetingId, newStatus) => {
    if (!uid || !eventId || !eventConfig) return;
    try {
      const mtgRef = doc(db, "events", eventId, "meetings", meetingId);
      const mtgSnap = await getDoc(mtgRef);
      if (!mtgSnap.exists()) return;

      const data = mtgSnap.data();
      if (data.status === "accepted") return alert("Ya está aceptada.");

      if (newStatus === "accepted") {
        // 1. Obtener reuniones aceptadas de estos participantes
        const accQ = query(
          collection(db, "events", eventId, "meetings"),
          where("participants", "array-contains-any", [
            data.requesterId,
            data.receiverId,
          ]),
          where("status", "==", "accepted")
        );
        const accSn = await getDocs(accQ);
        const occupied = new Set(accSn.docs.map((d) => d.data().timeSlot));

        // 1.1 Validar límite máximo de citas por usuario
        const limit = eventConfig.maxMeetingsPerUser ?? Infinity;
        const requesterCount = accSn.docs.filter((d) =>
          d.data().participants.includes(data.requesterId)
        ).length;
        const receiverCount = accSn.docs.filter((d) =>
          d.data().participants.includes(data.receiverId)
        ).length;

        if (requesterCount >= limit) {
          return alert(
            `El solicitante ya alcanzó el límite de ${limit} citas.`
          );
        }
        if (receiverCount >= limit) {
          return alert(`El receptor ya alcanzó el límite de ${limit} citas.`);
        }

        // 2. Buscar slot disponible en agenda
        const agQ = query(
          collection(db, "agenda"),
          where("eventId", "==", eventId),
          where("available", "==", true),
          orderBy("startTime")
        );
        const agSn = await getDocs(agQ);

        const now = new Date();
        let chosen = null,
          chosenDoc = null;

        for (const d of agSn.docs) {
          const slot = d.data();
          const slotStr = `${slot.startTime} - ${slot.endTime}`;
          if (occupied.has(slotStr)) continue;

          // Validar que no esté en el pasado
          const [slotHour, slotMin] = slot.startTime.split(":").map(Number);
          const slotStartDate = new Date(now);
          slotStartDate.setHours(slotHour, slotMin, 0, 0);
          if (slotStartDate <= now) continue;

          // Validar que no esté en descanso
          if (
            slotOverlapsBreakBlock(
              slot.startTime,
              eventConfig.meetingDuration,
              eventConfig.breakBlocks
            )
          ) {
            continue;
          }

          chosen = slot;
          chosenDoc = d;
          break;
        }

        if (!chosen) {
          return alert(
            "No hay slots libres fuera de descansos y horarios pasados."
          );
        }

        // 3. Actualizar reunión y agenda
        await updateDoc(mtgRef, {
          status: "accepted",
          tableAssigned: chosen.tableNumber.toString(),
          timeSlot: `${chosen.startTime} - ${chosen.endTime}`,
        });

        await updateDoc(doc(db, "agenda", chosenDoc.id), {
          available: false,
          meetingId,
        });

        // 4. Notificar al solicitante
        await addDoc(collection(db, "notifications"), {
          userId: data.requesterId,
          title: "Reunión aceptada",
          message: "Tu reunión fue aceptada.",
          timestamp: new Date(),
          read: false,
        });

        showNotification({
          title: "Reunión aceptada",
          message: "Asignada correctamente.",
          color: "green",
        });

        // 5. Enviar SMS a ambos participantes
        const requesterSnap = await getDoc(doc(db, "users", data.requesterId));
        const receiverSnap = await getDoc(doc(db, "users", data.receiverId));
        const requester = requesterSnap.exists() ? requesterSnap.data() : null;
        const receiver = receiverSnap.exists() ? receiverSnap.data() : null;

        if (requester?.contacto?.telefono) {
          await sendSms(
            `Tu reunión con ${
              receiver?.nombre || "otro participante"
            } ha sido aceptada para ${chosen.startTime} en la mesa ${
              chosen.tableNumber
            }.`,
            requester.contacto.telefono
          );
        }
        if (receiver?.contacto?.telefono) {
          await sendSms(
            `Tu reunión con ${
              requester?.nombre || "otro participante"
            } ha sido aceptada para ${chosen.startTime} en la mesa ${
              chosen.tableNumber
            }.`,
            receiver.contacto.telefono
          );
        }
      } else {
        // Rechazar
        await updateDoc(mtgRef, { status: newStatus });
        await addDoc(collection(db, "notifications"), {
          userId: data.requesterId,
          title: "Reunión rechazada",
          message: "Tu reunión fue rechazada.",
          timestamp: new Date(),
          read: false,
        });

        showNotification({
          title: "Reunión rechazada",
          message: "Operación completada.",
          color: "red",
        });
      }
    } catch (e) {
      console.error(e);
    }
  };

  // ---------------------------------------------------------------------------
  // 11. Descargar vCard
  // ---------------------------------------------------------------------------
  const downloadVCard = (participant) => {
    const vCard = `BEGIN:VCARD
VERSION:3.0
N:${participant.nombre};;;;
FN:${participant.nombre}
TEL;TYPE=CELL:${participant.contacto.telefono || ""}
EMAIL:${participant.contacto.correo || ""}
END:VCARD`;
    const blob = new Blob([vCard], { type: "text/vcard" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${participant.nombre}.vcf`;
    link.click();
  };

  // ---------------------------------------------------------------------------
  // 12. Enviar WhatsApp
  // ---------------------------------------------------------------------------
  const sendWhatsAppMessage = (participant) => {
    if (!participant.contacto?.telefono) {
      alert("No hay número de teléfono para WhatsApp");
      return;
    }
    const phone = participant.contacto.telefono.replace(/[^\d]/g, "");
    const message = encodeURIComponent(
      "Hola, me gustaría contactarte sobre la reunión."
    );
    window.open(`https://wa.me/57${phone}?text=${message}`, "_blank");
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <Container>
      <Flex gap="md">
        <Title order={2} mb="md">
          Dashboard
        </Title>

        {/* Menú de notificaciones */}
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
              <Text align="center" size="sm" color="dimmed">
                No tienes notificaciones
              </Text>
            )}
          </Menu.Dropdown>
        </Menu>
      </Flex>

      {/* Sección siempre visible de Solicitudes Pendientes */}
      <Card shadow="sm" mb="md">
        <Group position="apart">
          <Text weight={500}>
            Solicitudes Reuniones Pendientes ({pendingRequests.length})
          </Text>
          <Button
            variant="subtle"
            size="xs"
            onClick={() => setPendingVisible((v) => !v)}
          >
            {pendingVisible ? "Ocultar" : "Mostrar"}
          </Button>
        </Group>
        <Collapse in={pendingVisible} mt="sm">
          <Box sx={{ overflowX: "auto" }}>
            <Grid gutter="md">
              {pendingRequests.length > 0 ? (
                pendingRequests.map((req) => {
                  const requester = assistants.find(
                    (a) => a.id === req.requesterId
                  );
                  return (
                    <Grid.Col span={{ base: 12, md: 6, lg: 3 }} key={req.id}>
                      <Card
                        key={req.id}
                        shadow="xs"
                        p="sm"
                        style={{ minWidth: 260, flex: "0 0 auto" }}
                      >
                        <Grid>
                          <Grid.Col span={6}>
                            <Group align="center" spacing="sm" mb="xs">
                              <Avatar src={requester?.photoURL} radius="xl" />
                              <Text weight={500}>{requester?.nombre}</Text>
                            </Group>
                            <Text size="xs">🏢 {requester?.empresa}</Text>
                            <Text size="xs">🏷 {requester?.cargo}</Text>
                            <Text size="xs">
                              ✉️{" "}
                              {requester?.contacto?.correo || "No disponible"}
                            </Text>
                            <Text size="xs">
                              📞{" "}
                              {requester.contacto?.telefono || "No disponible"}
                            </Text>
                            <Text size="xs">
                              📝 {requester?.descripcion || "No especificada"}
                            </Text>
                            <Text size="xs">
                              🎯{" "}
                              {requester?.interesPrincipal || "No especificado"}
                            </Text>
                            <Text size="xs">
                              🔍 {requester?.necesidad || "No especificada"}
                            </Text>
                          </Grid.Col>
                          <Grid.Col span={6}>
                            <Group justify="center" mt="sm">
                              <ActionIcon
                                size="sm"
                                variant="light"
                                color="green"
                                onClick={() =>
                                  updateMeetingStatus(req.id, "accepted")
                                }
                              >
                                <CheckIcon size={18} />
                              </ActionIcon>
                              <ActionIcon
                                size="sm"
                                variant="light"
                                color="red"
                                onClick={() =>
                                  updateMeetingStatus(req.id, "rejected")
                                }
                              >
                                <BiX size={18} />
                              </ActionIcon>
                              <ActionIcon
                                size="sm"
                                variant="light"
                                color="teal"
                                onClick={() => sendWhatsAppMessage(requester)}
                              >
                                <FaWhatsapp size={18} />
                              </ActionIcon>
                            </Group>
                          </Grid.Col>
                        </Grid>
                      </Card>
                    </Grid.Col>
                  );
                })
              ) : (
                <Text c="dimmed" align="center" mt="md">
                  No hay solicitudes pendientes
                </Text>
              )}
            </Grid>
          </Box>
        </Collapse>
      </Card>

      <Text>
        Cuando solicites una reunión, el sistema buscará automáticamente el
        horario disponible más cercano en tu agenda disponible durante el
        networking. El espacio de reunión se asignará de manera automática
        cuando te acepte la otra persona o empresa.
      </Text>

      <Tabs defaultValue="asistentes">
        <Tabs.List>
          <Tabs.Tab value="asistentes">
            Asistentes ({assistants.length})
          </Tabs.Tab>
          <Tabs.Tab value="reuniones">
            Reuniones ({acceptedMeetings.length})
          </Tabs.Tab>
          <Tabs.Tab value="solicitudes">
            Solicitudes (
            {pendingRequests.length +
              acceptedRequests.length +
              rejectedRequests.length}
            )
          </Tabs.Tab>
        </Tabs.List>

        {/* TAB: ASISTENTES */}
        <Tabs.Panel value="asistentes" pt="md">
          <TextInput
            placeholder="Buscar por nombre, cargo, teléfono, correo o empresa..."
            mb="md"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <Group mb="md">
            <Button
              variant={showOnlyToday ? "filled" : "outline"}
              color="blue"
              size="xs"
              onClick={() => setShowOnlyToday((v) => !v)}
            >
              {showOnlyToday
                ? "Mostrar todos los asistentes"
                : "Mostrar solo conectados hoy"}
            </Button>
          </Group>

          <Text>
            Máximo, puedes agendar{" "}
            <strong>{eventConfig?.maxMeetingsPerUser ?? "∞"}</strong> reuniones
          </Text>
          <Grid>
            {filteredAssistants.length > 0 ? (
              filteredAssistants.map((assistant) => (
                <Grid.Col xs={12} sm={6} md={4} key={assistant.id}>
                  <Card shadow="sm" p="lg">
                    <Group position="center" mb="md">
                      <Avatar
                        src={assistant.photoURL}
                        alt={`Avatar de ${assistant.nombre}`}
                        radius="50%"
                        size="xl"
                        style={{ cursor: "pointer" }}
                        onClick={() => {
                          setSelectedImage(assistant.photoURL);
                          setAvatarModalOpened(true);
                        }}
                      >
                        {!assistant.photoURL &&
                          assistant.nombre &&
                          assistant.nombre[0]}
                      </Avatar>
                    </Group>

                    <Title order={5}>📛 {assistant.nombre}</Title>
                    <Text size="sm">
                      🏢 <strong>Empresa:</strong> {assistant.empresa}
                    </Text>
                    <Text size="sm">
                      🏷 <strong>Cargo:</strong> {assistant.cargo}
                    </Text>
                    <Text size="sm">
                      📧 <strong>Correo:</strong>{" "}
                      {assistant.contacto?.correo || "No disponible"}
                    </Text>
                    {/* <Text size="sm">
                      📞 <strong>Teléfono:</strong>{" "}
                      {assistant.contacto?.telefono || "No disponible"}
                    </Text> */}
                    <Text size="sm">
                      📝 <strong>Descripción:</strong>{" "}
                      {assistant.descripcion || "No especificada"}
                    </Text>
                    <Text size="sm">
                      🎯 <strong>Interés Principal:</strong>{" "}
                      {assistant.interesPrincipal || "No especificado"}
                    </Text>
                    <Text size="sm">
                      🔍 <strong>Necesidad:</strong>{" "}
                      {assistant.necesidad || "No especificada"}
                    </Text>
                    <Text size="sm">
                      🕓 <strong>Última conexión:</strong>{" "}
                      {assistant.lastConnectionDateTime || "No registrada"}
                    </Text>

                    <Group mt="sm">
                      <Button
                        mt="sm"
                        onClick={() =>
                          sendMeetingRequest(
                            assistant.id,
                            assistant.contacto.telefono
                          )
                        }
                        disabled={!solicitarReunionHabilitado}
                      >
                        {solicitarReunionHabilitado
                          ? "Solicitar reunión"
                          : "Solicitudes deshabilitadas"}
                      </Button>
                      {/* <Button variant="outline" onClick={() => downloadVCard(assistant)}>
                        Agregar a Contactos
                      </Button>
                      <Button
                        variant="outline"
                        color="green"
                        onClick={() => sendWhatsAppMessage(assistant)}
                      >
                        Enviar WhatsApp
                      </Button> */}
                    </Group>
                  </Card>
                </Grid.Col>
              ))
            ) : (
              <Text>No hay asistentes registrados.</Text>
            )}
          </Grid>
        </Tabs.Panel>

        {/* TAB: REUNIONES ACEPTADAS */}
        <Tabs.Panel value="reuniones" pt="md">
          <Stack>
            {acceptedMeetings.length > 0 ? (
              acceptedMeetings
                .slice()
                .sort((a, b) => {
                  // extraemos la hora de inicio ("HH:MM") de cada timeSlot
                  const [aStart] = (a.timeSlot || "").split(" - ");
                  const [bStart] = (b.timeSlot || "").split(" - ");
                  const [aH, aM] = aStart
                    ? aStart.split(":").map(Number)
                    : [0, 0];
                  const [bH, bM] = bStart
                    ? bStart.split(":").map(Number)
                    : [0, 0];
                  return aH * 60 + aM - (bH * 60 + bM);
                })
                .map((meeting) => {
                  const otherUserId =
                    meeting.requesterId === uid
                      ? meeting.receiverId
                      : meeting.requesterId;
                  const participant = participantsInfo[otherUserId];
                  return (
                    <Card key={meeting.id} shadow="sm" p="lg">
                      <Text>
                        <strong>Reunión con:</strong>{" "}
                        {participant ? participant.nombre : "Cargando..."}
                      </Text>
                      <Text>
                        <strong>Horario:</strong>{" "}
                        {meeting.timeSlot || "Por asignar"}
                      </Text>
                      <Text>
                        <strong>Mesa:</strong>{" "}
                        {meeting.tableAssigned || "Por asignar"}
                      </Text>
                      <Collapse in={expandedMeetingId === meeting.id} mt="sm">
                        {participant && (
                          <>
                            <Text size="sm">
                              🏢 <strong>Empresa:</strong> {participant.empresa}
                            </Text>
                            <Text size="sm">
                              🏷 <strong>Cargo:</strong> {participant.cargo}
                            </Text>
                            <Text size="sm">
                              📧 <strong>Correo:</strong>{" "}
                              {participant.contacto?.correo || "No disponible"}
                            </Text>
                            <Text size="sm">
                              📞 <strong>Teléfono:</strong>{" "}
                              {participant.contacto?.telefono ||
                                "No disponible"}
                            </Text>
                            <Text size="sm">
                              📝 <strong>Descripción:</strong>{" "}
                              {participant.descripcion || "No especificada"}
                            </Text>
                            <Text size="sm">
                              🎯 <strong>Interés Principal:</strong>{" "}
                              {participant.interesPrincipal ||
                                "No especificado"}
                            </Text>
                            <Text size="sm">
                              🔍 <strong>Necesidad:</strong>{" "}
                              {participant.necesidad || "No especificada"}
                            </Text>
                          </>
                        )}
                      </Collapse>
                      {participant && (
                        <Group mt="sm">
                          <Button
                            variant="outline"
                            onClick={() => downloadVCard(participant)}
                          >
                            Agregar a Contactos
                          </Button>
                          <Button
                            variant="outline"
                            color="green"
                            onClick={() => sendWhatsAppMessage(participant)}
                          >
                            Enviar WhatsApp
                          </Button>
                          <Button
                            variant="subtle"
                            onClick={() =>
                              setExpandedMeetingId(
                                expandedMeetingId === meeting.id
                                  ? null
                                  : meeting.id
                              )
                            }
                          >
                            {expandedMeetingId === meeting.id
                              ? "Ocultar info"
                              : "Ver más info"}
                          </Button>
                        </Group>
                      )}
                    </Card>
                  );
                })
            ) : (
              <Text>No tienes reuniones aceptadas.</Text>
            )}
          </Stack>
        </Tabs.Panel>

        {/* TAB: SOLICITUDES */}
        <Tabs.Panel value="solicitudes" pt="md">
          <Tabs defaultValue="pendientes">
            <Tabs.List>
              <Tabs.Tab value="pendientes">
                Pendientes ({pendingRequests.length})
              </Tabs.Tab>
              <Tabs.Tab value="aceptadas">
                Aceptadas ({acceptedRequests.length})
              </Tabs.Tab>
              <Tabs.Tab value="rechazadas">
                Rechazadas ({rejectedRequests.length})
              </Tabs.Tab>
              <Tabs.Tab value="enviadas">
                Enviadas ({sentRequests.length})
              </Tabs.Tab>
            </Tabs.List>

            {/* Pendientes */}
            <Tabs.Panel value="pendientes" pt="md">
              <Stack>
                {pendingRequests.length > 0 ? (
                  pendingRequests.map((request) => {
                    const requester = assistants.find(
                      (user) => user.id === request.requesterId
                    );
                    return (
                      <Card key={request.id} shadow="sm" p="lg">
                        {requester ? (
                          <>
                            <Text>
                              <strong>📛 Nombre:</strong> {requester.nombre}
                            </Text>
                            <Text size="sm">
                              🏢 <strong>Empresa:</strong> {requester.empresa}
                            </Text>
                            <Text size="sm">
                              🏷 <strong>Cargo:</strong> {requester.cargo}
                            </Text>
                            <Text size="sm">
                              📧 <strong>Correo:</strong>{" "}
                              {requester.contacto?.correo || "No disponible"}
                            </Text>
                            <Text size="sm">
                              📞 <strong>Teléfono:</strong>{" "}
                              {requester.contacto?.telefono || "No disponible"}
                            </Text>
                            {/* <Text size="sm">
                              🆔 <strong>Cédula:</strong>{" "}
                              {requester.cedula || "No disponible"}
                            </Text> */}
                            <Text size="sm">
                              📝 <strong>Descripción:</strong>{" "}
                              {requester.descripcion || "No especificada"}
                            </Text>
                            <Text size="sm">
                              🎯 <strong>Interés Principal:</strong>{" "}
                              {requester.interesPrincipal || "No especificado"}
                            </Text>
                            <Text size="sm">
                              🔍 <strong>Necesidad:</strong>{" "}
                              {requester.necesidad || "No especificada"}
                            </Text>
                          </>
                        ) : (
                          <Text>Cargando información del solicitante...</Text>
                        )}
                        <Group mt="sm">
                          <Button
                            color="green"
                            onClick={() =>
                              updateMeetingStatus(request.id, "accepted")
                            }
                          >
                            Aceptar
                          </Button>
                          <Button
                            color="red"
                            onClick={() =>
                              updateMeetingStatus(request.id, "rejected")
                            }
                          >
                            Rechazar
                          </Button>
                          <Button
                            variant="outline"
                            color="green"
                            onClick={() => sendWhatsAppMessage(requester)}
                          >
                            Enviar WhatsApp
                          </Button>
                        </Group>
                      </Card>
                    );
                  })
                ) : (
                  <Text>No tienes solicitudes de reunión pendientes.</Text>
                )}
              </Stack>
            </Tabs.Panel>

            {/* Aceptadas */}
            <Tabs.Panel value="aceptadas" pt="md">
              <Stack>
                {acceptedRequests.length > 0 ? (
                  acceptedRequests.map((request) => {
                    const requester = assistants.find(
                      (user) => user.id === request.requesterId
                    );
                    return (
                      <Card key={request.id} shadow="sm" p="lg">
                        {requester ? (
                          <>
                            <Text>
                              <strong>📛 Nombre:</strong> {requester.nombre}
                            </Text>
                            <Text size="sm">
                              🏢 <strong>Empresa:</strong> {requester.empresa}
                            </Text>
                            <Text size="sm">
                              🏷 <strong>Cargo:</strong> {requester.cargo}
                            </Text>
                            <Text size="sm">
                              📧 <strong>Correo:</strong>{" "}
                              {requester.contacto?.correo || "No disponible"}
                            </Text>
                            <Text size="sm">
                              📞 <strong>Teléfono:</strong>{" "}
                              {requester.contacto?.telefono || "No disponible"}
                            </Text>
                            {/* <Text size="sm">
                              🆔 <strong>Cédula:</strong>{" "}
                              {requester.cedula || "No disponible"}
                            </Text> */}
                            <Text size="sm">
                              📝 <strong>Descripción:</strong>{" "}
                              {requester.descripcion || "No especificada"}
                            </Text>
                            <Text size="sm">
                              🎯 <strong>Interés Principal:</strong>{" "}
                              {requester.interesPrincipal || "No especificado"}
                            </Text>
                            <Text size="sm">
                              🔍 <strong>Necesidad:</strong>{" "}
                              {requester.necesidad || "No especificada"}
                            </Text>
                            <Text size="sm">
                              <strong>Horario:</strong>{" "}
                              {request.timeSlot || "Por asignar"}
                            </Text>
                            <Text size="sm">
                              <strong>Mesa:</strong>{" "}
                              {request.tableAssigned || "Por asignar"}
                            </Text>
                          </>
                        ) : (
                          <Text>Cargando información del solicitante...</Text>
                        )}
                      </Card>
                    );
                  })
                ) : (
                  <Text>No tienes solicitudes aceptadas.</Text>
                )}
              </Stack>
            </Tabs.Panel>

            {/* Rechazadas */}
            <Tabs.Panel value="rechazadas" pt="md">
              <Stack>
                {rejectedRequests.length > 0 ? (
                  rejectedRequests.map((request) => {
                    const requester = assistants.find(
                      (user) => user.id === request.requesterId
                    );
                    return (
                      <Card key={request.id} shadow="sm" p="lg">
                        {requester ? (
                          <>
                            <Text>
                              <strong>📛 Nombre:</strong> {requester.nombre}
                            </Text>
                            <Text size="sm">
                              🏢 <strong>Empresa:</strong> {requester.empresa}
                            </Text>
                            <Text size="sm">
                              🏷 <strong>Cargo:</strong> {requester.cargo}
                            </Text>
                            <Text size="sm">
                              📧 <strong>Correo:</strong>{" "}
                              {requester.contacto?.correo || "No disponible"}
                            </Text>
                            <Text size="sm">
                              📞 <strong>Teléfono:</strong>{" "}
                              {requester.contacto?.telefono || "No disponible"}
                            </Text>
                            {/* <Text size="sm">
                              🆔 <strong>Cédula:</strong>{" "}
                              {requester.cedula || "No disponible"}
                            </Text> */}
                            <Text size="sm">
                              📝 <strong>Descripción:</strong>{" "}
                              {requester.descripcion || "No especificada"}
                            </Text>
                            <Text size="sm">
                              🎯 <strong>Interés Principal:</strong>{" "}
                              {requester.interesPrincipal || "No especificado"}
                            </Text>
                            <Text size="sm">
                              🔍 <strong>Necesidad:</strong>{" "}
                              {requester.necesidad || "No especificada"}
                            </Text>
                            <Text size="sm" color="red">
                              <strong>Esta solicitud fue rechazada.</strong>
                            </Text>
                          </>
                        ) : (
                          <Text>Cargando información del solicitante...</Text>
                        )}
                      </Card>
                    );
                  })
                ) : (
                  <Text>No tienes solicitudes rechazadas.</Text>
                )}
              </Stack>
            </Tabs.Panel>

            {/* Enviadas */}
            <Tabs.Panel value="enviadas" pt="md">
              <Stack>
                {sentRequests.length > 0 ? (
                  sentRequests.map((request) => {
                    const receiver = assistants.find(
                      (user) => user.id === request.receiverId
                    );
                    return (
                      <Card key={request.id} shadow="sm" p="lg">
                        {receiver ? (
                          <>
                            <Text>
                              <strong>📛 Nombre:</strong> {receiver.nombre}
                            </Text>
                            <Text size="sm">
                              🏢 <strong>Empresa:</strong> {receiver.empresa}
                            </Text>
                            <Text size="sm">
                              🏷 <strong>Cargo:</strong> {receiver.cargo}
                            </Text>
                            <Text size="sm">
                              📧 <strong>Correo:</strong>{" "}
                              {receiver.contacto?.correo || "No disponible"}
                            </Text>
                            <Text size="sm">
                              📞 <strong>Teléfono:</strong>{" "}
                              {receiver.contacto?.telefono || "No disponible"}
                            </Text>
                            <Text size="sm" color="blue">
                              <strong>Estado:</strong> Pendiente
                            </Text>
                          </>
                        ) : (
                          <Text>Cargando información del receptor...</Text>
                        )}
                      </Card>
                    );
                  })
                ) : (
                  <Text>No tienes solicitudes enviadas pendientes.</Text>
                )}
              </Stack>
            </Tabs.Panel>
          </Tabs>
        </Tabs.Panel>
      </Tabs>

      {/* Modal para ver la imagen de perfil ampliada */}
      <Modal
        opened={avatarModalOpened}
        onClose={() => setAvatarModalOpened(false)}
        centered
        title="Foto de perfil"
      >
        {selectedImage ? (
          <img
            src={selectedImage}
            alt="Foto de perfil ampliada"
            style={{
              width: "100%",
              maxWidth: "500px",
              display: "block",
              margin: "0 auto",
            }}
          />
        ) : (
          <Text align="center">No hay imagen disponible</Text>
        )}
      </Modal>
    </Container>
  );
};

export default Dashboard;

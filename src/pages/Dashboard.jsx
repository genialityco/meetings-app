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

  // Estados para el modal de imagen
  const [avatarModalOpened, setAvatarModalOpened] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);

  // ---------------------------------------------------------------------------
  // 1. Verificar usuario logueado, sino -> '/'
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!currentUser?.data) navigate("/");
  }, [currentUser, navigate]);

  // ---------------------------------------------------------------------------
  // 2. Cargar notificaciones (globales o filtradas por eventId según necesidad)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!uid) return;

    const notifsRef = collection(db, "notifications");
    const q = query(
      notifsRef,
      where("userId", "==", uid),
      orderBy("timestamp", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newNotifications = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // Mostrar en el frontend y marcarlas como leídas
      newNotifications.forEach((notif) => {
        if (!notif.read) {
          showNotification({
            title: notif.title,
            message: notif.message,
            color: "teal",
            position: "top-right",
          });
          updateDoc(doc(db, "notifications", notif.id), { read: true });
        }
      });

      setNotifications(newNotifications);
    });

    return () => unsubscribe();
  }, [uid]);

  // ---------------------------------------------------------------------------
  // 3. Configuración global: ver si está habilitado "solicitarReunionHabilitado"
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const fetchGlobalSettings = async () => {
      const configRef = doc(db, "config", "generalSettings");
      const configSnap = await getDoc(configRef);
      if (configSnap.exists()) {
        setSolicitarReunionHabilitado(
          configSnap.data().solicitarReunionHabilitado
        );
      }
    };
    fetchGlobalSettings();
  }, []);

  // ---------------------------------------------------------------------------
  // 4. Cargar lista de asistentes (colección "users") filtrando por eventId
  //    Se excluye el usuario actual (uid).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!eventId) return;

    const usersRef = collection(db, "users");
    const qUsers = query(usersRef, where("eventId", "==", eventId));

    const unsubscribe = onSnapshot(qUsers, (snapshot) => {
      const assistantsData = snapshot.docs
        .filter((docItem) => docItem.id !== uid)
        .map((docItem) => ({ id: docItem.id, ...docItem.data() }));

      setAssistants(assistantsData);
      setFilteredAssistants(assistantsData);
    });

    return () => unsubscribe();
  }, [uid, eventId]);

  // ---------------------------------------------------------------------------
  // 5. Filtrar asistentes cuando cambia el searchTerm
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const lowerTerm = searchTerm.toLowerCase();
    const filtered = assistants.filter((assistant) => {
      const { nombre, cargo, empresa, contacto } = assistant;
      return (
        (nombre && nombre.toLowerCase().includes(lowerTerm)) ||
        (cargo && cargo.toLowerCase().includes(lowerTerm)) ||
        (empresa && empresa.toLowerCase().includes(lowerTerm)) ||
        (contacto?.correo &&
          contacto.correo.toLowerCase().includes(lowerTerm)) ||
        (contacto?.telefono &&
          contacto.telefono.toLowerCase().includes(lowerTerm))
      );
    });
    setFilteredAssistants(filtered);
  }, [searchTerm, assistants]);

  // ---------------------------------------------------------------------------
  // 6. Solicitudes ENVIADAS por el usuario actual (status=pending)
  //    subcolección /events/{eventId}/meetings con field eventId
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!uid || !eventId) return;

    const meetingsRef = collection(db, "events", eventId, "meetings");
    const qSent = query(
      meetingsRef,
      where("requesterId", "==", uid),
      where("status", "==", "pending")
    );

    const unsubscribe = onSnapshot(qSent, (snapshot) => {
      const sent = [];
      snapshot.forEach((docItem) => {
        sent.push({ id: docItem.id, ...docItem.data() });
      });
      setSentRequests(sent);
    });

    return () => unsubscribe();
  }, [uid, eventId]);

  // ---------------------------------------------------------------------------
  // 7. Cargar reuniones ACEPTADAS (subcolección /events/{eventId}/meetings)
  //    donde participants incluye uid
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!uid || !eventId) return;

    const meetingsRef = collection(db, "events", eventId, "meetings");
    const qAccepted = query(
      meetingsRef,
      where("status", "==", "accepted"),
      where("participants", "array-contains", uid)
    );

    const unsubscribe = onSnapshot(qAccepted, async (snapshot) => {
      const meetings = [];
      const participantsData = {};

      for (const docItem of snapshot.docs) {
        const meeting = { id: docItem.id, ...docItem.data() };
        meetings.push(meeting);

        // Obtener info del otro participante
        const otherUserId =
          meeting.requesterId === uid
            ? meeting.receiverId
            : meeting.requesterId;

        if (!participantsData[otherUserId]) {
          const userDoc = await getDoc(doc(db, "users", otherUserId));
          if (userDoc.exists()) {
            participantsData[otherUserId] = userDoc.data();
          }
        }
      }
      setAcceptedMeetings(meetings);
      setParticipantsInfo(participantsData);
    });

    return () => unsubscribe();
  }, [uid, eventId]);

  // ---------------------------------------------------------------------------
  // 8. Cargar solicitudes donde el usuario ES receptor (receiverId=uid),
  //    independiente de status -> filtra en subcolección /events/{eventId}/meetings
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!uid || !eventId) return;

    const meetingsRef = collection(db, "events", eventId, "meetings");
    const qReceiver = query(meetingsRef, where("receiverId", "==", uid));

    const unsubscribe = onSnapshot(qReceiver, (snapshot) => {
      const pending = [];
      const accepted = [];
      const rejected = [];

      snapshot.forEach((docItem) => {
        const data = { id: docItem.id, ...docItem.data() };
        if (data.status === "pending") pending.push(data);
        else if (data.status === "accepted") accepted.push(data);
        else if (data.status === "rejected") rejected.push(data);
      });

      setPendingRequests(pending);
      setAcceptedRequests(accepted);
      setRejectedRequests(rejected);
    });

    return () => unsubscribe();
  }, [uid, eventId]);

  // ---------------------------------------------------------------------------
  // 9. Enviar solicitud de reunión: crear doc en /events/{eventId}/meetings
  // ---------------------------------------------------------------------------
  const sendMeetingRequest = async (assistantId) => {
    if (!uid || !eventId) return;

    try {
      const meetingsRef = collection(db, "events", eventId, "meetings");
      await addDoc(meetingsRef, {
        eventId, // campo eventId para mayor consistencia
        requesterId: uid,
        receiverId: assistantId,
        status: "pending",
        createdAt: new Date(),
        participants: [uid, assistantId],
      });

      // Notificación para el assistantId
      await addDoc(collection(db, "notifications"), {
        userId: assistantId,
        title: "Nueva solicitud de reunión",
        message: `${currentUser.data.nombre} te ha enviado una solicitud de reunión.`,
        timestamp: new Date(),
        read: false,
      });

      showNotification({
        title: "Solicitud enviada",
        message: "Tu solicitud de reunión ha sido enviada correctamente.",
        color: "blue",
        position: "top-right",
      });
    } catch (error) {
      console.error("Error al enviar la solicitud de reunión:", error);
    }
  };

  // ---------------------------------------------------------------------------
  // 10. Aceptar/Rechazar solicitud de reunión
  //     - Se asume la agenda en colección global "agenda" con un field eventId
  //     - timeSlot = "09:00 - 09:10" (o lo que uses)
  // ---------------------------------------------------------------------------
  const updateMeetingStatus = async (meetingId, newStatus) => {
    if (!uid || !eventId) return;

    try {
      // Referencia a la subcolección /events/{eventId}/meetings/{meetingId}
      const meetingDocRef = doc(db, "events", eventId, "meetings", meetingId);
      const meetingSnap = await getDoc(meetingDocRef);
      if (!meetingSnap.exists()) return;

      const meetingData = meetingSnap.data();
      const { requesterId, receiverId, status } = meetingData;

      if (status === "accepted") {
        alert("Esta reunión ya fue aceptada.");
        return;
      }

      if (newStatus === "accepted") {
        // 1. Buscar reuniones aceptadas de requesterId O receiverId
        const acceptedQ = query(
          collection(db, "events", eventId, "meetings"),
          where("participants", "array-contains-any", [
            requesterId,
            receiverId,
          ]),
          where("status", "==", "accepted")
        );
        const acceptedSnapshot = await getDocs(acceptedQ);

        // 2. Slots ya ocupados
        const occupiedTimeSlots = new Set();
        acceptedSnapshot.forEach((docItem) => {
          occupiedTimeSlots.add(docItem.data().timeSlot);
        });

        // 3. Buscar en agenda
        const agendaQ = query(
          collection(db, "agenda"),
          where("eventId", "==", eventId),
          where("available", "==", true),
          orderBy("startTime")
        );
        const agendaSnapshot = await getDocs(agendaQ);

        let selectedSlot = null;
        let selectedSlotDoc = null;

        for (const docItem of agendaSnapshot.docs) {
          const agendaData = docItem.data();
          const slotString = `${agendaData.startTime} - ${agendaData.endTime}`;
          if (!occupiedTimeSlots.has(slotString)) {
            selectedSlot = agendaData;
            selectedSlotDoc = docItem;
            break;
          }
        }

        if (!selectedSlot) {
          // Ver si alguno ya llegó al límite (2, 4, etc.)
          const requesterMeetings = acceptedSnapshot.docs.filter((d) =>
            d.data().participants.includes(requesterId)
          ).length;
          const receiverMeetings = acceptedSnapshot.docs.filter((d) =>
            d.data().participants.includes(receiverId)
          ).length;

          if (requesterMeetings >= 2) {
            alert(
              "La persona que solicitó la reunión ya tiene la agenda llena."
            );
          } else if (receiverMeetings >= 2) {
            alert("Ya tienes la agenda llena.");
          } else {
            alert("No hay horarios disponibles para agendar esta reunión.");
          }
          return;
        }

        // 4. Checar conflicto final
        const conflictMeeting = acceptedSnapshot.docs.find(
          (d) =>
            d.data().timeSlot ===
            `${selectedSlot.startTime} - ${selectedSlot.endTime}`
        );
        if (conflictMeeting) {
          alert("Ya existe reunión aceptada en ese horario.");
          return;
        }

        // 5. Aceptar: asignar slot
        await updateDoc(meetingDocRef, {
          status: "accepted",
          tableAssigned: selectedSlot.tableNumber.toString(),
          timeSlot: `${selectedSlot.startTime} - ${selectedSlot.endTime}`,
        });

        // 6. Marcar el slot en agenda
        await updateDoc(doc(db, "agenda", selectedSlotDoc.id), {
          available: false,
          meetingId,
        });

        try {
          console.log("Aumentando contador");

          // Obtener detalles completos de los participantes
          const requesterDoc = await getDoc(doc(db, "users", requesterId));
          const receiverDoc = await getDoc(doc(db, "users", receiverId));
          const requesterData = requesterDoc.exists()
            ? requesterDoc.data()
            : null;
          const receiverData = receiverDoc.exists() ? receiverDoc.data() : null;

          // Construir el objeto meeting con la info extendida de participantes
          const meetingInfo = {
            ...meetingData,
            requester: requesterData, // Información completa del solicitante
            receiver: receiverData, // Información completa del receptor
          };

          const response = await fetch(
            "https://incrementtreecounter-y72vyrlzva-uc.a.run.app",
            {
              method: "POST", // Usamos POST para enviar datos
              headers: {
                "Content-Type": "application/json",
                "x-api-key": "CLAVE_SEGURA_GENFORES", // La clave que configuraste en la Cloud Function
              },
              body: JSON.stringify({
                meeting: meetingInfo, // Se envía la información extendida de la reunión
              }),
            }
          );

          const result = await response.json();
          if (result.success) {
            console.log(
              `🌳 Contador incrementado exitosamente: ${result.currentCount}`
            );
          } else {
            console.error("❌ Error desde Cloud Function:", result.error);
          }
        } catch (error) {
          console.error("❌ Error al hacer la solicitud HTTP:", error);
        }

        // 7. Notificación al solicitante
        await addDoc(collection(db, "notifications"), {
          userId: requesterId,
          title: "Reunión aceptada",
          message: `Tu solicitud de reunión fue aceptada.`,
          timestamp: new Date(),
          read: false,
        });

        showNotification({
          title: "Reunión aceptada",
          message: "Has aceptado la reunión exitosamente.",
          color: "green",
          position: "top-right",
        });
      } else {
        // Rechazar
        await updateDoc(meetingDocRef, { status: newStatus });
        await addDoc(collection(db, "notifications"), {
          userId: requesterId,
          title: "Reunión rechazada",
          message: `Tu solicitud de reunión fue rechazada.`,
          timestamp: new Date(),
          read: false,
        });

        showNotification({
          title: "Reunión rechazada",
          message: "Has rechazado la reunión.",
          color: "red",
          position: "top-right",
        });
      }
    } catch (error) {
      console.error("Error al actualizar la reunión:", error);
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
          <Text>Máximo, puedes agendar 3 reuniones</Text>
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
                    <Group mt="sm">
                      <Button
                        mt="sm"
                        onClick={() => sendMeetingRequest(assistant.id)}
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
              acceptedMeetings.map((meeting) => {
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
                            {/* <Text size="sm">
                              📞 <strong>Teléfono:</strong>{" "}
                              {requester.contacto?.telefono || "No disponible"}
                            </Text> */}
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
                            {/* <Text size="sm">
                              📞 <strong>Teléfono:</strong>{" "}
                              {requester.contacto?.telefono || "No disponible"}
                            </Text> */}
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

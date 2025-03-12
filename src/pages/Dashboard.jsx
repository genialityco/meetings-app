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
import { useNavigate } from "react-router-dom";
import { showNotification } from "@mantine/notifications";
import { IoNotificationsOutline } from "react-icons/io5";

const Dashboard = () => {
  const { currentUser } = useContext(UserContext);
  const uid = currentUser?.uid;
  const navigate = useNavigate();

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

  useEffect(() => {
    if (!uid) return;

    // Escuchar notificaciones en tiempo real para este usuario
    const q = query(
      collection(db, "notifications"),
      where("userId", "==", uid),
      orderBy("timestamp", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newNotifications = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // Mostrar notificación en el frontend
      newNotifications.forEach((notif) => {
        if (!notif.read) {
          showNotification({
            title: notif.title,
            message: notif.message,
            color: "teal",
            position: "top-right",
          });

          // Marcar la notificación como leída en Firestore
          updateDoc(doc(db, "notifications", notif.id), { read: true });
        }
      });

      setNotifications(newNotifications);
    });

    return () => unsubscribe();
  }, [uid]);

  useEffect(() => {
    if (!uid) return;

    const q = query(
      collection(db, "meetings"),
      where("requesterId", "==", uid),
      where("status", "==", "pending")
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sent = [];
      snapshot.forEach((docItem) => {
        sent.push({ id: docItem.id, ...docItem.data() });
      });
      setSentRequests(sent);
    });

    return () => unsubscribe();
  }, [uid]);

  useEffect(() => {
    if (!currentUser?.data) navigate("/");
  }, [currentUser, navigate]);

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

  // Cargar asistentes excluyendo al usuario actual
  useEffect(() => {
    const q = query(collection(db, "users"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const assistantsData = snapshot.docs
        .filter((docItem) => docItem.id !== uid)
        .map((docItem) => ({ id: docItem.id, ...docItem.data() }));

      setAssistants(assistantsData);
      setFilteredAssistants(assistantsData);
    });

    return () => unsubscribe();
  }, [uid]);

  // Filtrar asistentes cuando cambia el searchTerm
  useEffect(() => {
    const filtered = assistants.filter(
      (assistant) =>
        assistant.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
        assistant.empresa.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredAssistants(filtered);
  }, [searchTerm, assistants]);

  // Cargar reuniones aceptadas
  useEffect(() => {
    const q = query(
      collection(db, "meetings"),
      where("status", "==", "accepted"),
      where("participants", "array-contains", uid)
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
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
  }, [uid]);

  // Cargar solicitudes
  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, "meetings"), where("receiverId", "==", uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
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
  }, [uid]);

  // Enviar solicitud de reunión
  const sendMeetingRequest = async (assistantId) => {
    try {
      await addDoc(collection(db, "meetings"), {
        requesterId: uid,
        receiverId: assistantId,
        status: "pending",
        createdAt: new Date(),
        participants: [uid, assistantId],
      });

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

  const updateMeetingStatus = async (meetingId, newStatus) => {
    try {
      const meetingDocRef = doc(db, "meetings", meetingId);
      const meetingSnap = await getDoc(meetingDocRef);
      if (!meetingSnap.exists()) return;

      const meetingData = meetingSnap.data();
      const requesterId = meetingData.requesterId;
      const receiverId = meetingData.receiverId;

      // Si la reunión ya está aceptada, no volver a procesarla
      if (meetingData.status === "accepted") {
        alert("Esta reunión ya fue aceptada.");
        return;
      }

      if (newStatus === "accepted") {
        // 1. Obtener todas las reuniones aceptadas de ambos participantes
        const acceptedMeetingsQuery = query(
          collection(db, "meetings"),
          where("participants", "array-contains-any", [
            requesterId,
            receiverId,
          ]),
          where("status", "==", "accepted")
        );
        const acceptedMeetingsSnapshot = await getDocs(acceptedMeetingsQuery);

        // 2. Obtener los horarios ocupados por cualquiera de los dos participantes
        const occupiedTimeSlots = new Set();
        acceptedMeetingsSnapshot.forEach((meeting) => {
          occupiedTimeSlots.add(meeting.data().timeSlot);
        });

        // 3. Buscar un slot disponible en la agenda
        const agendaQuery = query(
          collection(db, "agenda"),
          where("available", "==", true),
          orderBy("startTime")
        );
        const agendaSnapshot = await getDocs(agendaQuery);

        let selectedSlot = null;
        let selectedSlotDoc = null;

        for (const agendaDoc of agendaSnapshot.docs) {
          const agendaData = agendaDoc.data();
          const timeSlot = `${agendaData.startTime} - ${agendaData.endTime}`;

          // 4. Verificar si el horario ya está ocupado por cualquiera de los dos participantes
          if (!occupiedTimeSlots.has(timeSlot)) {
            selectedSlot = agendaData;
            selectedSlotDoc = agendaDoc;
            break;
          }
        }

        // 5. Si no hay horarios disponibles, mostrar mensaje de error
        if (!selectedSlot) {
          const requesterMeetings = acceptedMeetingsSnapshot.docs.filter(
            (doc) => doc.data().participants.includes(requesterId)
          ).length;
          const receiverMeetings = acceptedMeetingsSnapshot.docs.filter((doc) =>
            doc.data().participants.includes(receiverId)
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

        // 6. Validar si alguno de los dos ya tiene reunión en el horario seleccionado
        const conflictingMeeting = acceptedMeetingsSnapshot.docs.find(
          (doc) =>
            doc.data().timeSlot ===
            `${selectedSlot.startTime} - ${selectedSlot.endTime}`
        );

        if (conflictingMeeting) {
          alert(
            "No puedes aceptar esta reunión porque ya tienes una en el mismo horario."
          );
          return;
        }

        // 7. Asignar el slot encontrado a la reunión
        await updateDoc(meetingDocRef, {
          status: "accepted",
          tableAssigned: selectedSlot.tableNumber.toString(),
          timeSlot: `${selectedSlot.startTime} - ${selectedSlot.endTime}`,
        });

        // 8. Marcar el slot en la agenda como ocupado
        const agendaDocRef = doc(db, "agenda", selectedSlotDoc.id);
        await updateDoc(agendaDocRef, {
          available: false,
          meetingId,
        });

        // 9. Crear una notificación para el solicitante
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
        // Si se rechaza, simplemente actualizar el estado
        await updateDoc(meetingDocRef, { status: newStatus });

        // Enviar notificación al usuario solicitante
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

  return (
    <Container>
      <Flex gap="md">
        <Title order={2} mb="md">
          Dashboard
        </Title>
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

        {/* TAB ASISTENTES */}
        <Tabs.Panel value="asistentes" pt="md">
          <TextInput
            placeholder="Buscar por nombre o empresa..."
            mb="md"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <Text>Máximo, puedes agendar 4 reuniones</Text>
          <Grid>
            {filteredAssistants.length > 0 ? (
              filteredAssistants.map((assistant) => (
                <Grid.Col xs={12} sm={6} md={4} key={assistant.id}>
                  <Grid.Col xs={12} sm={6} md={4} key={assistant.id}>
                    <Card shadow="sm" p="lg">
                      <Title order={5}>📛 {assistant.nombre}</Title>
                      <Text size="sm">
                        🏢 <strong>Empresa:</strong> {assistant.empresa}
                      </Text>
                      <Text size="sm">
                        🏷 <strong>Cargo:</strong> {assistant.cargo}
                      </Text>
                      <Text size="sm">
                        📧 <strong>Correo:</strong>{" "}
                        {assistant.contacto.correo || "No disponible"}
                      </Text>
                      <Text size="sm">
                        📞 <strong>Teléfono:</strong>{" "}
                        {assistant.contacto.telefono || "No disponible"}
                      </Text>
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

                      <Button
                        mt="sm"
                        fullWidth
                        onClick={() => sendMeetingRequest(assistant.id)}
                        disabled={!solicitarReunionHabilitado}
                      >
                        {solicitarReunionHabilitado
                          ? "Solicitar reunión"
                          : "Solicitudes deshabilitadas"}
                      </Button>
                    </Card>
                  </Grid.Col>
                </Grid.Col>
              ))
            ) : (
              <Text>No hay asistentes registrados.</Text>
            )}
          </Grid>
        </Tabs.Panel>

        {/* TAB REUNIONES */}
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
                  </Card>
                );
              })
            ) : (
              <Text>No tienes reuniones aceptadas.</Text>
            )}
          </Stack>
        </Tabs.Panel>

        {/* TAB SOLICITUDES */}
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

            {/* TAB DE SOLICITUDES PENDIENTES */}
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
                              {requester.contacto.correo || "No disponible"}
                            </Text>
                            <Text size="sm">
                              📞 <strong>Teléfono:</strong>{" "}
                              {requester.contacto.telefono || "No disponible"}
                            </Text>
                            <Text size="sm">
                              🆔 <strong>Cédula:</strong>{" "}
                              {requester.cedula || "No disponible"}
                            </Text>
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

            {/* TAB DE SOLICITUDES ACEPTADAS */}
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
                              {requester.contacto.correo || "No disponible"}
                            </Text>
                            <Text size="sm">
                              📞 <strong>Teléfono:</strong>{" "}
                              {requester.contacto.telefono || "No disponible"}
                            </Text>
                            <Text size="sm">
                              🆔 <strong>Cédula:</strong>{" "}
                              {requester.cedula || "No disponible"}
                            </Text>
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

            {/* TAB DE SOLICITUDES RECHAZADAS */}
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
                              {requester.contacto.correo || "No disponible"}
                            </Text>
                            <Text size="sm">
                              📞 <strong>Teléfono:</strong>{" "}
                              {requester.contacto.telefono || "No disponible"}
                            </Text>
                            <Text size="sm">
                              🆔 <strong>Cédula:</strong>{" "}
                              {requester.cedula || "No disponible"}
                            </Text>
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

            {/* TAB DE SOLICITUDES ENVIADAS */}
            <Tabs.Panel value="enviadas" pt="md">
              <Stack>
                {sentRequests.length > 0 ? (
                  sentRequests.map((request) => {
                    // Aquí, el "otro usuario" es el receiverId
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
                            {/* ... cualquier otro dato que quieras mostrar ... */}

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
    </Container>
  );
};

export default Dashboard;

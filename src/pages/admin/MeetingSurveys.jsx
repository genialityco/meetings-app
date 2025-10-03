import { useEffect, useState, useContext } from "react";
import { collection, query, onSnapshot, doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { Table, Loader, Text, Button, Group } from "@mantine/core";
import { UserContext } from "../../context/UserContext";
import * as XLSX from "xlsx";

// Función para obtener datos de usuario
const getUserInfo = async (userId) => {
  if (!userId) return { name: "-", empresa: "-" };
  const userRef = doc(db, "users", userId);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return { name: "-", empresa: "-" };
  const d = userSnap.data();
  return {
    name: d.displayName || d.name || "-",
    empresa: d.empresa || d.company || "-",
  };
};

const fetchSurveyInfo = async (survey) => {
  if (
    survey.userName &&
    survey.userEmpresa &&
    survey.otherUserName &&
    survey.otherUserEmpresa
  ) {
    return survey;
  }
  if (!survey.meetingId) return survey;
  const eventId = "VAqwPf9LAXVnggomWK7t";
  const meetingRef = doc(db, "events", eventId, "meetings", survey.meetingId);
  const meetingSnap = await getDoc(meetingRef);
  if (!meetingSnap.exists()) return survey;
  const meeting = meetingSnap.data();
  const receiverInfo = await getUserInfo(meeting.receiverId);
  const requesterInfo = await getUserInfo(meeting.requesterId);
  return {
    ...survey,
    userName: requesterInfo.name,
    userEmpresa: requesterInfo.empresa,
    otherUserName: receiverInfo.name,
    otherUserEmpresa: receiverInfo.empresa,
  };
};

const MeetingSurveys = () => {
  const { currentUser } = useContext(UserContext);
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(collection(db, "meetingSurveys"));
    const unsubscribe = onSnapshot(
      q,
      async (querySnapshot) => {
        let surveysData = [];
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          surveysData.push({
            id: doc.id,
            value: data.value,
            comments: data.comments,
            createdAt: data.createdAt?.toDate
              ? data.createdAt.toDate()
              : data.createdAt,
            userName: data.userName,
            userEmpresa: data.userEmpresa,
            otherUserName: data.otherUserName,
            otherUserEmpresa: data.otherUserEmpresa,
            meetingId: data.meetingId,
          });
        });

        const completedSurveys = await Promise.all(
          surveysData.map(async (s) => await fetchSurveyInfo(s))
        );
        setSurveys(completedSurveys);
        setLoading(false);
      },
      (error) => {
        console.error("Error al obtener meetingSurveys:", error);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [currentUser]);

  // ---- EXPORTAR A EXCEL ----
  const handleExportExcel = () => {
    // Armar los datos para exportar
    const dataToExport = surveys.map((survey) => ({
      "Valor estimado": survey.value || "-",
      Comentarios: survey.comments || "-",
      "Empresa 1": survey.userEmpresa || "-",
      "Empresa 2": survey.otherUserEmpresa || "-",
      Fecha: survey.createdAt
        ? new Date(survey.createdAt).toLocaleString()
        : "-",
    }));
    // Crear el libro y hoja de Excel
    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Encuestas");
    XLSX.writeFile(workbook, "encuestas_meetings.xlsx");
  };

  if (loading) return <Loader />;

  if (surveys.length === 0)
    return (
      <Text align="center" mt="md">
        No hay encuestas respondidas.
      </Text>
    );

  return (
    <>
      <Group mb="md" justify="space-between">
        <Text>Total: {surveys.length}</Text>
        <Button onClick={handleExportExcel} color="green">
          Exportar a Excel
        </Button>
      </Group>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Valor estimado</Table.Th>
            <Table.Th>Comentarios</Table.Th>
            <Table.Th>Empresa 1</Table.Th>
            <Table.Th>Empresa 2</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {surveys.map((survey) => (
            <Table.Tr key={survey.id}>
              <Table.Td>{survey.value || "-"}</Table.Td>
              <Table.Td>{survey.comments || "-"}</Table.Td>
              <Table.Td>{survey.userEmpresa || "-"}</Table.Td>
              <Table.Td>{survey.otherUserEmpresa || "-"}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </>
  );
};

export default MeetingSurveys;

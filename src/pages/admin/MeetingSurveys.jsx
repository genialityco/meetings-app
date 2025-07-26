import React, { useEffect, useState, useContext } from "react";
import { collection, query, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { Table, Loader, Text } from "@mantine/core";
import { UserContext } from "../../context/UserContext";

const MeetingSurveys = () => {
  const { currentUser } = useContext(UserContext);
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser?.uid) return;

    const q = query(collection(db, "meetingSurveys"));
    // Sin filtro, trae todas. Si quieres solo las de este usuario, añade:
    // where("userId", "==", currentUser.uid)

    const unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        const surveysData = [];
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          surveysData.push({
            id: doc.id,
            meetingId: data.meetingId,
            value: data.value,
            comments: data.comments,
            createdAt: data.createdAt?.toDate
              ? data.createdAt.toDate()
              : data.createdAt,
            userName: data.userName,
            userEmpresa: data.userEmpresa,
            otherUserName: data.otherUserName,
            otherUserEmpresa: data.otherUserEmpresa,
          });
        });
        setSurveys(surveysData);
        setLoading(false);
      },
      (error) => {
        console.error("Error al obtener meetingSurveys:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser]);

  if (loading) return <Loader />;

  if (surveys.length === 0)
    return (
      <Text align="center" mt="md">
        No hay encuestas respondidas.
      </Text>
    );

  return (
    <>
      <Text>Total: {surveys.length}</Text>
      <Table striped highlightOnHover>
        <thead>
          <tr>
            <th>Valor estimado</th>
            <th>Comentarios</th>
            <th>Fecha</th>
            <th>Usuario</th>
            <th>Empresa</th>
            <th>Otro Usuario</th>
            <th>Empresa Otro</th>
          </tr>
        </thead>
        <tbody>
          {surveys.map((survey) => (
            <tr key={survey.id}>
              <td>{survey.value || "-"}</td>
              <td>{survey.comments || "-"}</td>
              <td>
                {survey.createdAt ? survey.createdAt.toLocaleString() : "-"}
              </td>
              <td>{survey.userName || "-"}</td>
              <td>{survey.userEmpresa || "-"}</td>
              <td>{survey.otherUserName || "-"}</td>
              <td>{survey.otherUserEmpresa || "-"}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
};

export default MeetingSurveys;

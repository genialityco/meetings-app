import { useState, useEffect, useRef } from "react";
import { Container, Title, Paper, Text, Flex, ColorPicker, Card ,Loader} from "@mantine/core";
import { db } from "../firebase/firebaseConfig";
import { collection, doc, getDoc, onSnapshot, query, where, orderBy, updateDoc } from "firebase/firestore";
import anime from "animejs";

const PhonesAdminPage = () => {
  const [phones, setPhones] = useState<{ id: string; color: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listen for real-time updates
    const unsubscribe = onSnapshot(collection(db, "phones"), (snapshot) => {
      const phoneData = snapshot.docs
        //.filter((doc) => doc.data().ID) // Only include documents that have an "ID" field
        .map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as { id: string; color: string;name:string }[];

      setPhones(phoneData);
      setLoading(false);
    });

    return () => unsubscribe(); // Cleanup listener on unmount
  }, []);

  // Function to update Firestore when color changes
  const updateColor = async (id: string, newColor: string) => {
    try {
      const phoneRef = doc(db, "phones", id);
      await updateDoc(phoneRef, { color: newColor });
    } catch (error) {
      console.error("Error updating color:", error);
    }
  };

  if (loading) return <Loader />;

  return (
    <Container>
      <Title order={2} mt="md" mb="md">
        Color Picker
      </Title>
      <Paper shadow="sm" p="xl" style={{ margin: "0 auto" }}>
        <Flex mih={50} bg="rgba(0, 0, 0, .3)" gap="md" justify="center" align="center" direction="row" wrap="wrap">
          {phones.map((phone) => (
            <Card key={phone.id} shadow="sm" p="lg" withBorder mb="md">
              <Text size="sm"   fw={300}>
                Phone ID: {phone.id}
              </Text>
              <Text size="xl"  fw={900}>
              Phone Name: {phone.name}
            </Text>
              <ColorPicker label="Choose color" value={phone.color} onChange={(color) => updateColor(phone.id, color)} />
            </Card>
          ))}
        </Flex>
      </Paper>
    </Container>
  );
};

export default PhonesAdminPage;

import { createContext, useState, useEffect } from "react";
import { onAuthStateChanged, signInAnonymously, signOut } from "firebase/auth";
import {
  getDoc,
  doc,
  setDoc,
  query,
  collection,
  where,
  getDocs,
} from "firebase/firestore";
import { auth, db, messaging } from "../firebase/firebaseConfig";
import { getToken, onMessage } from "firebase/messaging";
import { showNotification } from "@mantine/notifications";

export const UserContext = createContext();

export const UserProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(
    JSON.parse(sessionStorage.getItem("currentUser")) || null
  );
  const [userLoading, setUserLoading] = useState(true);
  const [manualLogin, setManualLogin] = useState(
    sessionStorage.getItem("manualLogin") === "true"
  );

  useEffect(() => {
    if (manualLogin) {
      setUserLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const uid = user.uid;
        const userDoc = await getDoc(doc(db, "users", uid));
        const userData = userDoc.exists() ? userDoc.data() : null;

        const newUser = { uid, data: userData };
        setCurrentUser(newUser);
        sessionStorage.setItem("currentUser", JSON.stringify(newUser));

        // Solicitar permiso de notificaciones
        try {
          const token = await getToken(messaging, {
            vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
          });

          if (token) {
            console.log("Token FCM:", token);
            await setDoc(
              doc(db, "users", uid),
              { fcmToken: token },
              { merge: true }
            );
          } else {
            console.log("No se obtuvo token de FCM.");
          }
        } catch (error) {
          console.error("Error al obtener el token de notificación:", error);
        }
      } else {
        try {
          const userCredential = await signInAnonymously(auth);
          const newUser = { uid: userCredential.user.uid, data: null };
          setCurrentUser(newUser);
          sessionStorage.setItem("currentUser", JSON.stringify(newUser));
        } catch (error) {
          console.error("Error initializing user:", error);
        }
      }
      setUserLoading(false);
    });

    return () => unsubscribe();
  }, [manualLogin]);

  useEffect(() => {
    // Escuchar mensajes en primer plano
    onMessage(messaging, (payload) => {
      console.log("Notificación recibida:", payload);
      showNotification({
        title: payload.notification.title,
        message: payload.notification.body,
        color: "blue",
      });
    });
  }, []);

  const updateUser = async (uid, data) => {
    try {
      await setDoc(doc(db, "users", uid), data, { merge: true });
      const updatedUser = {
        ...currentUser,
        data: { ...currentUser.data, ...data },
      };
      setCurrentUser(updatedUser);
      sessionStorage.setItem("currentUser", JSON.stringify(updatedUser));
    } catch (error) {
      console.error("Error updating user:", error);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setCurrentUser(null);
      sessionStorage.removeItem("currentUser");
      sessionStorage.removeItem("manualLogin");
      setManualLogin(false);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const loginByCedula = async (cedula) => {
    try {
      setUserLoading(true);
      const q = query(collection(db, "users"), where("cedula", "==", cedula));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        setUserLoading(false);
        return { error: "No se encontró ningún usuario con esa cédula." };
      }

      const userDoc = querySnapshot.docs[0];
      const userData = userDoc.data();

      // ✅ Establecer usuario en el contexto y evitar que Firebase lo sobrescriba
      const newUser = { uid: userDoc.id, data: userData };
      setCurrentUser(newUser);
      sessionStorage.setItem("currentUser", JSON.stringify(newUser));
      sessionStorage.setItem("manualLogin", "true"); // 🔥 Evita sobrescribir con sesión anónima

      setManualLogin(true);
      setUserLoading(false);

      return { success: true };
    } catch (error) {
      console.error("Error al buscar usuario:", error);
      setUserLoading(false);
      return { error: "Error al buscar usuario. Intente nuevamente." };
    }
  };

  return (
    <UserContext.Provider
      value={{
        currentUser,
        userLoading,
        updateUser,
        logout,
        loginByCedula,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};

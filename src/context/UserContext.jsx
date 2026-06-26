/* eslint-disable react/prop-types */
import { createContext, useState, useEffect, useRef } from "react";
import { onAuthStateChanged, signInAnonymously, signOut } from "firebase/auth";
import {
  updateDoc,
  getDoc,
  doc,
  setDoc,
  query,
  collection,
  where,
  getDocs,
  onSnapshot,
} from "firebase/firestore";
import { auth, db, messaging } from "../firebase/firebaseConfig";
import { onMessage } from "firebase/messaging";
import { showNotification } from "@mantine/notifications";

// eslint-disable-next-line react-refresh/only-export-components
export const UserContext = createContext();

export const UserProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(
    JSON.parse(localStorage.getItem("currentUser")) || null
  );
  const [userLoading, setUserLoading] = useState(true);
  const [manualLogin, setManualLogin] = useState(
    localStorage.getItem("manualLogin") === "true"
  );
  const userSnapshotUnsub = useRef(null);

  // Subscribe to real-time user doc updates (keeps checkedIn and other fields in sync)
  const subscribeToUserDoc = (uid) => {
    if (userSnapshotUnsub.current) userSnapshotUnsub.current();
    userSnapshotUnsub.current = onSnapshot(
      doc(db, "users", uid),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        setCurrentUser((prev) => {
          if (!prev || prev.uid !== uid) return prev;
          const updated = { uid, data };
          localStorage.setItem("currentUser", JSON.stringify(updated));
          return updated;
        });
      },
      (error) => {
        // permission-denied ocurre en sesiones manuales sin Firebase Auth
        // En ese caso simplemente no actualizamos en tiempo real (los datos del localStorage siguen vigentes)
        if (error.code === "permission-denied") {
          console.warn("onSnapshot users: sin permisos (sesión manual sin auth). Usando datos locales.");
        } else {
          console.error("onSnapshot users error:", error);
        }
      }
    );
  };

  useEffect(() => {
    if (manualLogin) {
      setUserLoading(false);
      // En sesiones manuales no hay Firebase Auth, así que no podemos usar onSnapshot
      // (las reglas de Firestore requieren auth). Los datos se mantienen desde localStorage.
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const uid = user.uid;
        const userDoc = await getDoc(doc(db, "users", uid));
        const userData = userDoc.exists() ? userDoc.data() : null;

        const newUser = { uid, data: userData };
        setCurrentUser(newUser);
        localStorage.setItem("currentUser", JSON.stringify(newUser));
        subscribeToUserDoc(uid);

        // Solicitar permiso de notificaciones
        // try {
        //   const token = await getToken(messaging, {
        //     vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
        //   });

        //   if (token) {
        //     console.log("Token FCM:", token);
        //     await setDoc(
        //       doc(db, "users", uid),
        //       { fcmToken: token },
        //       { merge: true }
        //     );
        //   } else {
        //     console.log("No se obtuvo token de FCM.");
        //   }
        // } catch (error) {
        //   console.error("Error al obtener el token de notificación:", error);
        // }
      } else {
        // No re-autenticar anónimamente si hay una sesión admin activa
        if (localStorage.getItem("adminSession") === "true") {
          setUserLoading(false);
          return;
        }
        try {
          const userCredential = await signInAnonymously(auth);
          const newUser = { uid: userCredential.user.uid, data: null };
          setCurrentUser(newUser);
          localStorage.setItem("currentUser", JSON.stringify(newUser));
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
    if (messaging) {
      onMessage(messaging, (payload) => {
        console.log("Notificación recibida:", payload);
        showNotification({
          title: payload.notification.title,
          message: payload.notification.body,
          color: "blue",
        });
      });
    }
  }, []);

  const updateUser = async (uid, data) => {
    // Filtrar campos undefined para evitar que Firestore los elimine con merge:true
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined)
    );
    await setDoc(doc(db, "users", uid), cleanData, { merge: true });
    const updatedUser = {
      ...currentUser,
      data: { ...currentUser.data, ...cleanData },
    };
    setCurrentUser(updatedUser);
    localStorage.setItem("currentUser", JSON.stringify(updatedUser));
  };

  const logout = async () => {
    try {
      if (userSnapshotUnsub.current) {
        userSnapshotUnsub.current();
        userSnapshotUnsub.current = null;
      }
      await signOut(auth);
      setCurrentUser(null);
      localStorage.removeItem("currentUser");
      localStorage.removeItem("manualLogin");
      setManualLogin(false);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  // En tu UserContext.jsx
  const loginByCedula = async (cedula, eventId) => {
    try {
      setUserLoading(true);

      // Consulta: filtra cédula y eventId
      const q = query(
        collection(db, "users"),
        where("cedula", "==", cedula.trim()),
        where("eventId", "==", eventId)
      );
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        setUserLoading(false);
        return {
          error: "No se encontró ningún usuario con esa cédula en este evento.",
        };
      }

      const userDoc = querySnapshot.docs[0];
      const userData = userDoc.data();
      const uid = userDoc.id;

      // Guardar nueva fecha de conexión
      const now = new Date();
      await updateDoc(doc(db, "users", uid), {
        lastConnection: now,
      });

      // Establecer usuario en el contexto
      const newUser = { uid: userDoc.id, data: userData };
      setCurrentUser(newUser);
      localStorage.setItem("currentUser", JSON.stringify(newUser));
      subscribeToUserDoc(userDoc.id);

      // Evita sobrescribir con sesión anónima
      localStorage.setItem("manualLogin", "true");
      setManualLogin(true);
      setUserLoading(false);

      return { success: true };
    } catch (error) {
      console.error("Error al buscar usuario:", error);
      setUserLoading(false);
      return { error: "Error al buscar usuario. Intente nuevamente." };
    }
  };

  const loginByEmail = async (correo, eventId) => {
  try {
    setUserLoading(true);
    
    const emailLowercase = correo.trim().toLowerCase();

    // Busca el usuario por correo principal y evento
    let q = query(
      collection(db, "users"),
      where("correo", "==", emailLowercase),
      where("eventId", "==", eventId)
    );
    let querySnapshot = await getDocs(q);
    
    // Si no encuentra en correo, busca en contacto.correo
    if (querySnapshot.empty) {
      q = query(
        collection(db, "users"),
        where("contacto.correo", "==", emailLowercase),
        where("eventId", "==", eventId)
      );
      querySnapshot = await getDocs(q);
    }
    
    if (querySnapshot.empty) {
      setUserLoading(false);
      return {
        error: "No se encontró ningún usuario con ese correo en este evento.",
      };
    }

    const userDoc = querySnapshot.docs[0];
    const userData = userDoc.data();
    const uid = userDoc.id;

    // Guardar nueva fecha de conexión
    const now = new Date();
    await updateDoc(doc(db, "users", uid), {
      lastConnection: now,
    });

    // Establecer usuario en el contexto
    const newUser = { uid: userDoc.id, data: userData };
    setCurrentUser(newUser);
    localStorage.setItem("currentUser", JSON.stringify(newUser));
    subscribeToUserDoc(userDoc.id);

    // Evita sobrescribir con sesión anónima
    localStorage.setItem("manualLogin", "true");
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
        loginByEmail
      }}
    >
      {children}
    </UserContext.Provider>
  );
};

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

    let pendingAnonTimer = null;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (pendingAnonTimer) {
        clearTimeout(pendingAnonTimer);
        pendingAnonTimer = null;
      }

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
      } else if (localStorage.getItem("adminSession") === "true") {
        // AdminAuthContext comparte el mismo `auth` y usa un margen de 1500ms
        // antes de confirmar un cierre de sesión real (para tolerar parpadeos
        // transitorios de onAuthStateChanged, p.ej. al abrir una pestaña nueva
        // mientras se restaura la sesión persistida). Igualamos ese margen aquí:
        // si tras esperar la bandera ya no está, no era una sesión admin real
        // y procedemos con el login anónimo en vez de dejar currentUser en null
        // para siempre (lo que rompía el registro con "permission-denied").
        setUserLoading(false);
        pendingAnonTimer = setTimeout(async () => {
          pendingAnonTimer = null;
          if (localStorage.getItem("adminSession") === "true" || auth.currentUser) return;
          try {
            const userCredential = await signInAnonymously(auth);
            const newUser = { uid: userCredential.user.uid, data: null };
            setCurrentUser(newUser);
            localStorage.setItem("currentUser", JSON.stringify(newUser));
          } catch (error) {
            console.error("Error initializing user:", error);
          }
        }, 1600);
        return;
      } else {
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

    return () => {
      if (pendingAnonTimer) clearTimeout(pendingAnonTimer);
      unsubscribe();
    };
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

  // Inicia sesión como un usuario ya conocido (p.ej. el destinatario de un
  // enlace de WhatsApp), sin pasar por el flujo de cédula/correo.
  const loginAsUser = (uid, data) => {
    const newUser = { uid, data };
    setCurrentUser(newUser);
    localStorage.setItem("currentUser", JSON.stringify(newUser));
    localStorage.setItem("manualLogin", "true");
    setManualLogin(true);
    subscribeToUserDoc(uid);
  };

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
    if (userSnapshotUnsub.current) {
      userSnapshotUnsub.current();
      userSnapshotUnsub.current = null;
    }
    // Limpiar el estado local primero: si signOut() falla (red inestable,
    // navegador in-app de WhatsApp/Instagram con storage restringido, etc.)
    // no debe dejar currentUser apuntando al uid/documento de otro evento,
    // porque un registro posterior lo sobrescribiría (ver Landing.jsx).
    setCurrentUser(null);
    localStorage.removeItem("currentUser");
    localStorage.removeItem("manualLogin");
    setManualLogin(false);
    try {
      await signOut(auth);
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

      // Guardar nueva fecha de conexión (no crítico: no debe bloquear el login si falla).
      // En sesiones manuales no siempre hay Firebase Auth (ver comentario más arriba),
      // así que sólo lo intentamos si hay un usuario de Auth activo.
      if (auth.currentUser) {
        try {
          await updateDoc(doc(db, "users", uid), { lastConnection: new Date() });
        } catch (error) {
          console.warn("No se pudo actualizar lastConnection:", error);
        }
      }

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

    // Guardar nueva fecha de conexión (no crítico: no debe bloquear el login si falla).
    // En sesiones manuales no siempre hay Firebase Auth (ver comentario más arriba),
    // así que sólo lo intentamos si hay un usuario de Auth activo.
    if (auth.currentUser) {
      try {
        await updateDoc(doc(db, "users", uid), { lastConnection: new Date() });
      } catch (error) {
        console.warn("No se pudo actualizar lastConnection:", error);
      }
    }

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
        loginByEmail,
        loginAsUser
      }}
    >
      {children}
    </UserContext.Provider>
  );
};

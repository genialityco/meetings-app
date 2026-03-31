import { createContext, useState, useEffect, useContext, ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";

interface AdminProfile {
  email: string;
  displayName: string;
  isSuperAdmin: boolean;
}

interface AdminAuthContextType {
  adminUser: User | null;
  adminLoading: boolean;
  isSuperAdmin: boolean;
  adminProfile: AdminProfile | null;
  loginAdmin: (email: string, password: string) => Promise<void>;
  logoutAdmin: () => Promise<void>;
}

export const AdminAuthContext = createContext<AdminAuthContextType>({
  adminUser: null,
  adminLoading: true,
  isSuperAdmin: false,
  adminProfile: null,
  loginAdmin: async () => {},
  logoutAdmin: async () => {},
});

export const useAdminAuth = () => useContext(AdminAuthContext);

export const AdminAuthProvider = ({ children }: { children: ReactNode }) => {
  const [adminUser, setAdminUser] = useState<User | null>(null);
  const [adminLoading, setAdminLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [adminProfile, setAdminProfile] = useState<AdminProfile | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Verificar que el usuario exista en la colección admins
        const adminDoc = await getDoc(doc(db, "admins", user.uid));

        if (adminDoc.exists()) {
          const data = adminDoc.data() as AdminProfile;
          setAdminUser(user);
          setIsSuperAdmin(data.isSuperAdmin === true);
          setAdminProfile(data);
          localStorage.setItem("adminSession", "true");
        } else {
          // Usuario autenticado pero no es admin → solo limpiar estado,
          // no cerrar sesión aquí para no interferir con flujos de registro
          setAdminUser(null);
          setIsSuperAdmin(false);
          setAdminProfile(null);
          localStorage.removeItem("adminSession");
        }
      } else {
        setAdminUser(null);
        setIsSuperAdmin(false);
        setAdminProfile(null);
        localStorage.removeItem("adminSession");
      }

      setAdminLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const loginAdmin = async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // onAuthStateChanged maneja el resto
    } catch (error: any) {
      const code = error?.code || "";
      if (
        code === "auth/user-not-found" ||
        code === "auth/wrong-password" ||
        code === "auth/invalid-credential" ||
        code === "auth/invalid-email"
      ) {
        throw new Error("Credenciales inválidas.");
      }
      if (code === "auth/too-many-requests") {
        throw new Error("Demasiados intentos. Intenta más tarde.");
      }
      throw new Error("Error al iniciar sesión.");
    }
  };

  const logoutAdmin = async () => {
    await signOut(auth);
    localStorage.removeItem("adminSession");
  };

  return (
    <AdminAuthContext.Provider
      value={{ adminUser, adminLoading, isSuperAdmin, adminProfile, loginAdmin, logoutAdmin }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
};

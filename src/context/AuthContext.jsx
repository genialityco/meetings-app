import { createContext, useState, useEffect } from "react";

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Verificar si el usuario ya está autenticado al cargar
  useEffect(() => {
    const storedAuth = localStorage.getItem("adminAuth");
    if (storedAuth) {
      try {
        const auth = JSON.parse(storedAuth);
        // Verificar que las credenciales sean válidas
        if (auth.email === import.meta.env.VITE_ADMIN_EMAIL && 
            auth.password === import.meta.env.VITE_ADMIN_PASSWORD) {
          setIsAdminAuthenticated(true);
        } else {
          // Credenciales inválidas, limpiar
          localStorage.removeItem("adminAuth");
        }
      } catch (error) {
        console.error("Error al restaurar autenticación:", error);
        localStorage.removeItem("adminAuth");
      }
    }
    setIsLoading(false);
  }, []);

  const login = (email, password) => {
    const adminEmail = import.meta.env.VITE_ADMIN_EMAIL;
    const adminPassword = import.meta.env.VITE_ADMIN_PASSWORD;

    if (email === adminEmail && password === adminPassword) {
      // Guardar en localStorage
      localStorage.setItem("adminAuth", JSON.stringify({ email, password }));
      setIsAdminAuthenticated(true);
      return { success: true };
    } else {
      return { success: false, message: "Credenciales inválidas" };
    }
  };

  const logout = () => {
    localStorage.removeItem("adminAuth");
    setIsAdminAuthenticated(false);
  };

  return (
    <AuthContext.Provider 
      value={{ 
        isAdminAuthenticated, 
        login, 
        logout, 
        isLoading 
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

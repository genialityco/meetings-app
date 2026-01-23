import { useContext } from "react";
import { Navigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { Center, Loader } from "@mantine/core";

const ProtectedRoute = ({ children }) => {
  const { isAdminAuthenticated, isLoading } = useContext(AuthContext);

  // Mostrar loader mientras se verifica la autenticación
  if (isLoading) {
    return (
      <Center style={{ height: "100vh" }}>
        <Loader />
      </Center>
    );
  }

  // Si no está autenticado, redirigir al login
  if (!isAdminAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default ProtectedRoute;

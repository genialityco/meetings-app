import { ReactNode, useContext } from "react";
import { Navigate } from "react-router-dom";
import { Center, Loader } from "@mantine/core";
import { AdminAuthContext } from "../context/AdminAuthContext";

const ProtectedAdminRoute = ({ children }: { children: ReactNode }) => {
  const { adminUser, adminLoading } = useContext(AdminAuthContext);

  if (adminLoading) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  if (!adminUser) {
    return <Navigate to="/admin/login" replace />;
  }

  return <>{children}</>;
};

export default ProtectedAdminRoute;

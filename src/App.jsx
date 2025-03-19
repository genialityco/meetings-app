import { useContext } from "react";
import { Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import AdminPanel from "./pages/admin/AdminPanel";
import MatrixPage from "./pages/MatrixPage";
import { UserContext } from "./context/UserContext";
import UserProfile from "./components/UserProfile";
import PhonesAdminPage from "./pages/PhonesAdminPage.tsx";

const App = () => {
  const { currentUser } = useContext(UserContext);

  return (
    <div>
      {currentUser?.data && <UserProfile />}
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/event/:eventId" element={<Landing />} />
        {/* Ruta dashboard sin evento por defecto */}
        <Route path="/dashboard" element={<Dashboard />} />
        {/* Ruta dashboard filtrada por evento */}
        <Route path="/dashboard/:eventId" element={<Dashboard />} />
        <Route path="/admin" element={<AdminPanel />} />
        <Route path="/matrix/:eventId" element={<MatrixPage />} />
        <Route path="/phonesadmin" element={<PhonesAdminPage />} />
      </Routes>
    </div>
  );
};

export default App;

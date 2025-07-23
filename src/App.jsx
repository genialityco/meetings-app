import { useContext } from "react";
import { Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing";
import AdminPanel from "./pages/admin/AdminPanel";
import { UserContext } from "./context/UserContext";
import UserProfile from "./components/UserProfile";
import PhonesAdminPage from "./pages/PhonesAdminPage.tsx";
import MeetingAutoResponse from "./pages/MeetingAutoResponse";
import EventAdmin from "./pages/admin/EventAdmin";
import Dashboard from "./pages/dashboard/Dashboard.tsx";
import { Container } from "@mantine/core";
import MatrixPage from "./pages/admin/MatrixPage.jsx";
import EventMatchPage from "./pages/admin/EventMatchPage.jsx";
import ImportMeetingsFromExcelPage from "./pages/admin/ImportMeetingsFromExcelPage.jsx";
import AgendaAdminPanel from "./pages/admin/AgendaAdminPanel.jsx";

const App = () => {
  const { currentUser } = useContext(UserContext);

  return (
    <Container fluid>
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
        <Route
          path="/admin/event/:eventId/match"
          element={<EventMatchPage />}
        />

        <Route
          path="/admin/event/:eventId/import-meetings"
          element={<ImportMeetingsFromExcelPage />}
        />

        <Route path="/phonesadmin" element={<PhonesAdminPage />} />
        <Route
          path="/meeting-response/:eventId/:meetingId/:action"
          element={<MeetingAutoResponse />}
        />
        <Route path="/admin/event/:eventId" element={<EventAdmin />} />
        <Route path="/admin/event/:eventId/agenda" element={<AgendaAdminPanel />} />
      </Routes>
    </Container>
  );
};

export default App;

import { Suspense, lazy } from "react";
import { Routes, Route } from "react-router-dom";
import { LoadingOverlay } from "@mantine/core";

// Eager: landing page (ruta más visitada)
import Landing from "./pages/Landing";

// Lazy: todas las demás rutas
const AdminPanel = lazy(() => import("./pages/admin/AdminPanel"));
const PhonesAdminPage = lazy(() => import("./pages/PhonesAdminPage.tsx"));
const MeetingAutoResponse = lazy(() => import("./pages/MeetingAutoResponse"));
const EventAdmin = lazy(() => import("./pages/admin/EventAdmin"));
const Dashboard = lazy(() => import("./pages/dashboard/Dashboard.tsx"));
const CompanyLanding = lazy(() => import("./pages/dashboard/CompanyLanding.tsx"));
const MatrixPage = lazy(() => import("./pages/admin/MatrixPage.jsx"));
const EventMatchPage = lazy(() => import("./pages/admin/EventMatchPage.jsx"));
const ImportMeetingsFromExcelPage = lazy(() => import("./pages/admin/ImportMeetingsFromExcelPage.jsx"));
const AgendaAdminPanel = lazy(() => import("./pages/admin/AgendaAdminPanel.jsx"));
const MeetingSurveys = lazy(() => import("./pages/admin/MeetingSurveys.jsx"));

const App = () => {
  return (
    <Suspense fallback={<LoadingOverlay visible />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/event/:eventId" element={<Landing />} />
        {/* Ruta dashboard sin evento por defecto */}
        <Route path="/dashboard" element={<Dashboard />} />
        {/* Ruta dashboard filtrada por evento */}
        <Route path="/dashboard/:eventId" element={<Dashboard />} />
        {/* Landing de empresa */}
        <Route path="/dashboard/:eventId/company/:companyNit" element={<CompanyLanding />} />
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
        <Route
          path="/admin/event/:eventId/agenda"
          element={<AgendaAdminPanel />}
        />
        <Route
          path="/admin/surveys"
          element={<MeetingSurveys />}
        />
      </Routes>
    </Suspense>
  );
};

export default App;

// import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { MantineProvider } from "@mantine/core";
import { baseTheme } from "./theme.js";
import "./index.css";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/dates/styles.css";
import '@mantine/tiptap/styles.css';
import { Notifications } from "@mantine/notifications";
import { ModalsProvider } from "@mantine/modals";
import { BrowserRouter } from "react-router-dom";
import { UserProvider } from "./context/UserContext.jsx";
import { AdminAuthProvider } from "./context/AdminAuthContext.tsx";

const theme = baseTheme;

createRoot(document.getElementById("root")).render(
  // <StrictMode>
  <UserProvider>
    <BrowserRouter>
      <AdminAuthProvider>
      <MantineProvider theme={theme}>
        <ModalsProvider>
          <Notifications position="top-center" />
          <App />
        </ModalsProvider>
      </MantineProvider>
      </AdminAuthProvider>
    </BrowserRouter>
  </UserProvider>
  // </StrictMode>
);

// import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { createTheme, MantineProvider } from "@mantine/core";
import "./index.css";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/dates/styles.css";
import '@mantine/tiptap/styles.css';
import { Notifications } from "@mantine/notifications";
import { ModalsProvider } from "@mantine/modals";
import { BrowserRouter } from "react-router-dom";
import { UserProvider } from "./context/UserContext.jsx";

const theme = createTheme({
  fontFamily: "Barlow, sans-serif",
  fontFamilyMonospace: "Barlow Mono, monospace",
  headings: { fontFamily: "Barlow, sans-serif" },
  fontSizes: {
    xxs: "10px",
    xs: "12px",
    sm: "14px",
    md: "16px",
    lg: "18px",
    xl: "20px",
    xxl: "24px",
  },
});

createRoot(document.getElementById("root")).render(
  // <StrictMode>
  <UserProvider>
    <BrowserRouter>
      <MantineProvider theme={theme}>
        <ModalsProvider>
          <Notifications />
          <App />
        </ModalsProvider>
      </MantineProvider>
    </BrowserRouter>
  </UserProvider>
  // </StrictMode>
);

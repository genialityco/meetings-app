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

// Recuperación de chunks obsoletos: cuando alguien tiene la app abierta y sale un
// deploy nuevo, el bundle ya cargado sigue referenciando hashes de archivos lazy
// (p. ej. Dashboard-[hash].js) que Netlify ya no sirve; el fallback de SPA devuelve
// index.html (text/html) en su lugar, lo que revienta el import() dinámico sin que
// haya un Error Boundary que lo atrape, dejando la pantalla en blanco. Vite dispara
// este evento en vez de solo rechazar la promesa; recargamos para traer el bundle
// vigente. El flag evita un loop de recargas si el deploy en sí está roto.
window.addEventListener("vite:preloadError", () => {
  const key = "vitePreloadErrorReloaded";
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");
  window.location.reload();
});

createRoot(document.getElementById("root")).render(
  // <StrictMode>
  <UserProvider>
    <BrowserRouter>
      <AdminAuthProvider>
      <MantineProvider theme={theme}>
        <ModalsProvider>
          <Notifications position="top-center" limit={3} />
          <App />
        </ModalsProvider>
      </MantineProvider>
      </AdminAuthProvider>
    </BrowserRouter>
  </UserProvider>
  // </StrictMode>
);

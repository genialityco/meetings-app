import { useEffect } from "react";
import { notifications } from "@mantine/notifications";

// Detecta cuando se publica una versión nueva de la app y recarga la pestaña.
//
// Una pestaña abierta antes de un despliegue sigue ejecutando el código viejo
// hasta que el usuario recarga (p. ej. seguían saliendo WhatsApp con un formato
// ya corregido). Vite genera el bundle principal con hash (/assets/index-<hash>.js):
// se compara el que tiene cargado la pestaña con el que referencia el
// index.html publicado. Netlify sirve index.html con max-age=0, así que la
// consulta siempre trae la versión vigente.
//
// Para no perder lo que el usuario está haciendo, la recarga espera a que no
// esté escribiendo ni tenga un modal abierto; si la pestaña está en segundo
// plano, recarga al volver a ella.

const CHECK_EVERY_MS = 5 * 60 * 1000;
const MIN_GAP_MS = 60 * 1000; // entre consultas disparadas por foco/visibilidad
const BUSY_RETRY_MS = 15 * 1000;
const RELOAD_DELAY_MS = 3000;
const RELOAD_GUARD_KEY = "versionCheck:lastReload";
const ENTRY_RE = /\/assets\/index-[\w-]+\.js/;

const currentEntry = (): string | null => {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'));
  for (const s of scripts) {
    const m = new URL(s.src, window.location.origin).pathname.match(ENTRY_RE);
    if (m) return m[0];
  }
  return null;
};

async function fetchPublishedEntry(): Promise<string | null> {
  const res = await fetch(`/index.html?v=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  const m = (await res.text()).match(ENTRY_RE);
  return m ? m[0] : null;
}

// El usuario está en medio de algo: escribiendo o con un modal/diálogo abierto
const isUserBusy = () => {
  const el = document.activeElement as HTMLElement | null;
  const typing =
    !!el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable);
  const dialogOpen = !!document.querySelector('[role="dialog"], .mantine-Modal-root');
  return typing || dialogOpen;
};

// Evita bucles si por algún motivo la versión publicada no coincide tras recargar
const reloadedRecentlyFor = (target: string) => {
  try {
    const raw = sessionStorage.getItem(RELOAD_GUARD_KEY);
    if (!raw) return false;
    const { to, at } = JSON.parse(raw);
    return to === target && Date.now() - at < 2 * 60 * 1000;
  } catch {
    return false;
  }
};

const markReload = (target: string) => {
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, JSON.stringify({ to: target, at: Date.now() }));
  } catch {
    // sin sessionStorage (modo privado): se recarga igual
  }
};

export function useVersionCheck() {
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const loaded = currentEntry();
    if (!loaded) return;

    let pendingTarget: string | null = null;
    let lastCheck = 0;
    let busyTimer: ReturnType<typeof setTimeout> | undefined;
    let reloading = false;

    const reload = (target: string, notify: boolean) => {
      if (reloading) return;
      reloading = true;
      markReload(target);
      if (notify) {
        notifications.show({
          title: "Nueva versión disponible",
          message: "Actualizando la aplicación…",
          loading: true,
          autoClose: false,
          withCloseButton: false,
        });
        setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
      } else {
        window.location.reload();
      }
    };

    const tryReload = () => {
      if (!pendingTarget || reloading) return;
      // En segundo plano: se recarga al volver (ver onVisible)
      if (document.hidden) return;
      if (isUserBusy()) {
        clearTimeout(busyTimer);
        busyTimer = setTimeout(tryReload, BUSY_RETRY_MS);
        return;
      }
      reload(pendingTarget, true);
    };

    const check = async () => {
      if (pendingTarget || reloading) return;
      lastCheck = Date.now();
      try {
        const published = await fetchPublishedEntry();
        if (published && published !== loaded && !reloadedRecentlyFor(published)) {
          pendingTarget = published;
          tryReload();
        }
      } catch {
        // sin red: se reintenta en la próxima consulta
      }
    };

    const onVisible = () => {
      if (document.hidden) return;
      // Al volver a la pestaña no hay nada a medio escribir: recarga directa
      if (pendingTarget) {
        if (!isUserBusy()) reload(pendingTarget, false);
        else tryReload();
        return;
      }
      if (Date.now() - lastCheck > MIN_GAP_MS) check();
    };

    // Un chunk lazy del despliegue anterior ya no existe en el servidor
    // (navegar a una ruta no visitada tras un deploy): recargar en vez de fallar
    const onPreloadError = (e: Event) => {
      const target = "preload-error";
      if (reloadedRecentlyFor(target)) return;
      e.preventDefault();
      markReload(target);
      window.location.reload();
    };

    const interval = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("vite:preloadError", onPreloadError);
    check();

    return () => {
      clearInterval(interval);
      clearTimeout(busyTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("vite:preloadError", onPreloadError);
    };
  }, []);
}

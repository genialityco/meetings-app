import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView } from '../utils/analytics';

/**
 * Hook para trackear automáticamente las vistas de página
 * Usa React Router para detectar cambios de ruta
 */
export function usePageTracking() {
  const location = useLocation();
  const previousPath = useRef<string>('');

  useEffect(() => {
    // Evitar trackear la misma página dos veces
    if (location.pathname === previousPath.current) {
      return;
    }

    // Generar título de página basado en la ruta
    const pageTitle = getPageTitle(location.pathname);
    
    // Trackear vista de página
    trackPageView(pageTitle, location.pathname + location.search);
    
    // Actualizar referencia
    previousPath.current = location.pathname;
  }, [location]);
}

/**
 * Genera un título legible basado en la ruta
 */
function getPageTitle(pathname: string): string {
  const routes: Record<string, string> = {
    '/': 'Landing',
    '/dashboard': 'Dashboard',
    '/admin': 'Admin Panel',
    '/admin/event': 'Event Admin',
    '/admin/agenda': 'Agenda Admin',
    '/admin/attendees': 'Attendees List',
    '/admin/matrix': 'Matrix',
    '/admin/match': 'Event Match',
    '/admin/import': 'Import Meetings',
    '/admin/surveys': 'Meeting Surveys',
    '/admin/phones': 'Phones Admin',
  };

  // Buscar coincidencia exacta
  if (routes[pathname]) {
    return routes[pathname];
  }

  // Buscar coincidencia parcial
  for (const [route, title] of Object.entries(routes)) {
    if (pathname.startsWith(route) && route !== '/') {
      return title;
    }
  }

  // Generar título desde la ruta
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return 'Home';
  
  return segments
    .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' - ');
}

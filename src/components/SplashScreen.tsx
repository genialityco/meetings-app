/**
 * Pantalla de carga con la imagen de Magnetic (public/splash-magnetic.jpg) y un
 * indicador animado abajo. Es el fallback de las rutas lazy (App.jsx) y la
 * pantalla de la Landing mientras se resuelve la sesión. Solo CSS (index.css):
 * se muestra antes de que cargue cualquier otra cosa.
 */
export default function SplashScreen() {
  return (
    <div className="splash-screen" role="status" aria-label="Cargando Magnetic">
      <div className="splash-loader" aria-hidden="true">
        <div className="splash-dots">
          <span />
          <span />
          <span />
        </div>
        <span className="splash-text">Cargando…</span>
      </div>
    </div>
  );
}

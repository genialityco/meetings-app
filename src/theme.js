import { createTheme, mergeThemeOverrides } from "@mantine/core";
import { generateColors } from "@mantine/colors-generator";

/**
 * Base visual compartida de toda la app. Los MantineProvider anidados (temas
 * por evento) NO heredan del provider padre, así que cualquier tema de evento
 * debe construirse con buildEventTheme() para no perder esta base.
 */
export const baseTheme = createTheme({
  fontFamily: "Barlow, sans-serif",
  fontFamilyMonospace: "Barlow Mono, monospace",
  headings: { fontFamily: "Barlow, sans-serif", fontWeight: "700" },
  fontSizes: {
    xxs: "10px",
    xs: "12px",
    sm: "14px",
    md: "16px",
    lg: "18px",
    xl: "20px",
    xxl: "24px",
  },
  defaultRadius: "md",
  cursorType: "pointer",
  components: {
    Tooltip: {
      defaultProps: { withArrow: true },
    },
    Button: {
      styles: { root: { fontWeight: 600 } },
    },
  },
});

/** Tema por evento: la base de la app + el color primario configurado en el admin. */
export function buildEventTheme(primaryColorHex) {
  if (!primaryColorHex) return baseTheme;
  return mergeThemeOverrides(
    baseTheme,
    createTheme({
      colors: { eventPrimary: generateColors(primaryColorHex) },
      primaryColor: "eventPrimary",
    }),
  );
}

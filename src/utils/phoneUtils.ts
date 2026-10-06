// @ts-expect-error — no official types for this package
import { allCountries as rawCountries } from "country-telephone-data";

interface RawCountry {
  name: string;
  iso2: string;
  dialCode: string;
  priority?: number;
}

const isoToFlag = (iso2: string): string =>
  iso2
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(c.charCodeAt(0) + 127397))
    .join("");

const spanishNames = new Intl.DisplayNames(["es"], { type: "region" });

const getSpanishName = (iso2: string): string => {
  try {
    return spanishNames.of(iso2.toUpperCase()) || iso2;
  } catch {
    return iso2;
  }
};

// Unique per iso2, sorted alphabetically by Spanish name
export const COUNTRY_CODES: { value: string; label: string; dialCode: string }[] = (
  rawCountries as RawCountry[]
)
  .slice()
  .sort((a, b) => getSpanishName(a.iso2).localeCompare(getSpanishName(b.iso2), "es"))
  .map((c) => ({
    value: c.iso2,
    label: `${isoToFlag(c.iso2)} +${c.dialCode} ${getSpanishName(c.iso2)}`,
    dialCode: `+${c.dialCode}`,
  }));

// Minimal timezone → iso2 map as fallback when locale has no region
const TIMEZONE_ISO2: Record<string, string> = {
  "America/Bogota": "co",
  "America/New_York": "us",
  "America/Chicago": "us",
  "America/Denver": "us",
  "America/Los_Angeles": "us",
  "America/Phoenix": "us",
  "America/Mexico_City": "mx",
  "America/Buenos_Aires": "ar",
  "America/Argentina/Buenos_Aires": "ar",
  "America/Sao_Paulo": "br",
  "America/Santiago": "cl",
  "America/Lima": "pe",
  "America/Caracas": "ve",
  "America/Guayaquil": "ec",
  "America/Guatemala": "gt",
  "America/Costa_Rica": "cr",
  "America/El_Salvador": "sv",
  "America/Panama": "pa",
  "Europe/Madrid": "es",
  "Europe/London": "gb",
  "Europe/Paris": "fr",
  "Europe/Berlin": "de",
  "Europe/Rome": "it",
  "Europe/Lisbon": "pt",
  "Asia/Kolkata": "in",
  "Asia/Calcutta": "in",
  "Asia/Shanghai": "cn",
  "Asia/Tokyo": "jp",
  "Asia/Seoul": "kr",
  "Australia/Sydney": "au",
};

export const detectDefaultIso2 = (): string => {
  try {
    const lang = navigator.language || "";
    const parts = lang.split("-");
    if (parts.length > 1) {
      const region = parts[parts.length - 1].toLowerCase();
      if (COUNTRY_CODES.some((c) => c.value === region)) return region;
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return TIMEZONE_ISO2[tz] || "co";
  } catch {
    return "co";
  }
};

export const getDialCodeForIso2 = (iso2: string): string =>
  COUNTRY_CODES.find((c) => c.value === iso2)?.dialCode || "+57";

export const getIso2ForDialCode = (dialCode: string): string =>
  COUNTRY_CODES.find((c) => c.dialCode === dialCode)?.value || "co";

export const parsePhoneValue = (
  value: string,
  defaultIso2: string
): { iso2: string; dialCode: string; number: string } => {
  const fallback = defaultIso2 || "co";
  if (!value) {
    return { iso2: fallback, dialCode: getDialCodeForIso2(fallback), number: "" };
  }
  const m = String(value).trim().match(/^(\+\d{1,4})\s?(.*)/);
  if (m) {
    const dialCode = m[1];
    const iso2 = getIso2ForDialCode(dialCode);
    return { iso2, dialCode, number: m[2] };
  }
  return {
    iso2: fallback,
    dialCode: getDialCodeForIso2(fallback),
    number: String(value).replace(/\D/g, ""),
  };
};

// Número local -> solo dígitos, sin el 0 troncal nacional. En Venezuela (y otros países)
// la gente escribe "0412..." y quedaba "+58 0412...", formato que WhatsApp no reconoce.
// Italia (+39) es la excepción: su 0 inicial sí forma parte del número internacional.
export const cleanLocalPhoneNumber = (raw: string, dialCode: string): string => {
  const digits = String(raw || "").replace(/\D/g, "");
  return dialCode === "+39" ? digits : digits.replace(/^0+/, "");
};

export const isPhoneField =(field: { type?: string; name?: string }): boolean =>
  field.type === "phone" ||
  field.name === "telefono" ||
  field.name === "celular";

// Caracteres invisibles que se cuelan al copiar números (marcas de dirección, BOM)
const INVISIBLE_CHARS = /[​-‏‪-‮⁦-⁩﻿]/g;

// Indicativos conocidos, del más largo al más corto (para separar "58" de "5804...")
const DIAL_CODES = [...new Set(COUNTRY_CODES.map((c) => c.dialCode.replace(/\D/g, "")))].sort(
  (a, b) => b.length - a.length
);

// Número internacional en dígitos: quita el 0 troncal que algunos dejan después
// del indicativo ("+58 0414…" escrito "5804…"); Italia (39) lo conserva.
const fixInternational = (digits: string): string => {
  const cc = DIAL_CODES.find((d) => digits.startsWith(d));
  if (cc && cc !== "39" && digits[cc.length] === "0") return cc + digits.slice(cc.length).replace(/^0+/, "");
  return digits;
};

// Número en el formato que espera WhatsApp: indicativo + número nacional, solo
// dígitos (ej. "+57 300 123 4567" -> "573001234567"). Si el valor no trae
// indicativo se usa el de `defaultIso2`. Devuelve "" si no queda un número válido
// (WhatsApp exige 10–15 dígitos en total).
export const toWhatsAppNumber = (raw: unknown, defaultIso2 = "co"): string => {
  // Si la celda trae varios números ("+58414…/+58414…"), se usa el primero
  const value = String(raw ?? "")
    .replace(INVISIBLE_CHARS, "")
    .split(/[/;,|]/)[0]
    .trim();
  if (!value) return "";

  let digits: string;
  const withSpace = value.match(/^\+(\d{1,4})\s+(.+)$/);
  if (withSpace) {
    // "+58 0412..." -> se quita el 0 troncal del número local
    digits = withSpace[1] + cleanLocalPhoneNumber(withSpace[2], `+${withSpace[1]}`);
  } else {
    const all = value.replace(/\D/g, "");
    if (/^[+±]/.test(value) || all.startsWith("00")) {
      // "+5841…", "±58 04…" o "0058…" (prefijo internacional 00): ya trae indicativo
      digits = fixInternational(all.replace(/^00/, ""));
    } else {
      const local = defaultIso2 === "it" ? all : all.replace(/^0+/, "");
      // Más de 10 dígitos: el número ya trae indicativo (ej. "573001234567",
      // "584147077580"); con 10 o menos es un número nacional sin indicativo
      digits =
        local.length > 10
          ? fixInternational(local)
          : getDialCodeForIso2(defaultIso2).replace(/\D/g, "") + local;
    }
  }

  // En Colombia ningún número empieza por 4 (móviles 3xx, fijos 60x): un "+57 4…"
  // es un móvil venezolano (412/414/416/424/426) con el indicativo equivocado
  if (/^574\d{9}$/.test(digits)) digits = "58" + digits.slice(2);

  // Debe empezar por un indicativo que exista (ej. "+68…" es un error de digitación)
  if (!DIAL_CODES.some((d) => digits.startsWith(d))) return "";
  return digits.length >= 10 && digits.length <= 15 ? digits : "";
};

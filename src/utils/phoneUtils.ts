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

export const isPhoneField = (field: { type?: string; name?: string }): boolean =>
  field.type === "phone" ||
  field.name === "telefono" ||
  field.name === "celular";

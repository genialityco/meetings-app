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

// País → zonas horarias IANA (America/* ya sin prefijo). Se invierte abajo.
// Cubre toda América (público principal) y las zonas más comunes del resto.
const AMERICA_ZONES: Record<string, string[]> = {
  co: ["Bogota"],
  ve: ["Caracas"],
  ec: ["Guayaquil"],
  pe: ["Lima"],
  bo: ["La_Paz"],
  cl: ["Santiago", "Punta_Arenas"],
  ar: [
    "Buenos_Aires", "Cordoba", "Catamarca", "Jujuy", "Mendoza", "Rosario",
    "Argentina/Buenos_Aires", "Argentina/Cordoba", "Argentina/Salta",
    "Argentina/Jujuy", "Argentina/Tucuman", "Argentina/Catamarca",
    "Argentina/La_Rioja", "Argentina/San_Juan", "Argentina/Mendoza",
    "Argentina/San_Luis", "Argentina/Rio_Gallegos", "Argentina/Ushuaia",
  ],
  uy: ["Montevideo"],
  py: ["Asuncion"],
  br: [
    "Sao_Paulo", "Noronha", "Belem", "Fortaleza", "Recife", "Araguaina",
    "Maceio", "Bahia", "Campo_Grande", "Cuiaba", "Santarem", "Porto_Velho",
    "Boa_Vista", "Manaus", "Eirunepe", "Rio_Branco",
  ],
  gy: ["Guyana"],
  sr: ["Paramaribo"],
  gf: ["Cayenne"],
  mx: [
    "Mexico_City", "Cancun", "Merida", "Monterrey", "Matamoros", "Chihuahua",
    "Ciudad_Juarez", "Ojinaga", "Mazatlan", "Bahia_Banderas", "Hermosillo",
    "Tijuana",
  ],
  gt: ["Guatemala"],
  sv: ["El_Salvador"],
  hn: ["Tegucigalpa"],
  ni: ["Managua"],
  cr: ["Costa_Rica"],
  pa: ["Panama"],
  bz: ["Belize"],
  cu: ["Havana"],
  do: ["Santo_Domingo"],
  pr: ["Puerto_Rico"],
  jm: ["Jamaica"],
  ht: ["Port-au-Prince"],
  tt: ["Port_of_Spain"],
  bs: ["Nassau"],
  bb: ["Barbados"],
  aw: ["Aruba"],
  cw: ["Curacao"],
  us: [
    "New_York", "Detroit", "Kentucky/Louisville", "Kentucky/Monticello",
    "Indiana/Indianapolis", "Indiana/Vincennes", "Indiana/Winamac",
    "Indiana/Marengo", "Indiana/Petersburg", "Indiana/Vevay", "Chicago",
    "Indiana/Tell_City", "Indiana/Knox", "Menominee", "North_Dakota/Center",
    "North_Dakota/New_Salem", "North_Dakota/Beulah", "Denver", "Boise",
    "Phoenix", "Los_Angeles", "Anchorage", "Juneau", "Sitka", "Metlakatla",
    "Yakutat", "Nome", "Adak",
  ],
  ca: [
    "Toronto", "Montreal", "Vancouver", "Edmonton", "Winnipeg", "Halifax",
    "St_Johns", "Regina", "Moncton", "Glace_Bay", "Goose_Bay", "Whitehorse",
    "Dawson", "Iqaluit", "Yellowknife", "Swift_Current", "Cambridge_Bay",
    "Rankin_Inlet", "Resolute", "Inuvik", "Creston", "Dawson_Creek",
    "Fort_Nelson", "Atikokan", "Blanc-Sablon", "Nipigon", "Thunder_Bay",
    "Rainy_River", "Pangnirtung",
  ],
};

const OTHER_ZONES: Record<string, string[]> = {
  ec: ["Pacific/Galapagos"],
  cl: ["Pacific/Easter"],
  us: ["Pacific/Honolulu"],
  es: ["Europe/Madrid", "Atlantic/Canary", "Africa/Ceuta"],
  pt: ["Europe/Lisbon", "Atlantic/Madeira", "Atlantic/Azores"],
  fr: ["Europe/Paris"],
  de: ["Europe/Berlin"],
  it: ["Europe/Rome"],
  gb: ["Europe/London"],
  ie: ["Europe/Dublin"],
  nl: ["Europe/Amsterdam"],
  be: ["Europe/Brussels"],
  ch: ["Europe/Zurich"],
  at: ["Europe/Vienna"],
  pl: ["Europe/Warsaw"],
  se: ["Europe/Stockholm"],
  no: ["Europe/Oslo"],
  dk: ["Europe/Copenhagen"],
  fi: ["Europe/Helsinki"],
  gr: ["Europe/Athens"],
  cz: ["Europe/Prague"],
  hu: ["Europe/Budapest"],
  ro: ["Europe/Bucharest"],
  ua: ["Europe/Kyiv", "Europe/Kiev"],
  ru: ["Europe/Moscow"],
  tr: ["Europe/Istanbul"],
  il: ["Asia/Jerusalem", "Asia/Tel_Aviv"],
  ae: ["Asia/Dubai"],
  sa: ["Asia/Riyadh"],
  in: ["Asia/Kolkata", "Asia/Calcutta"],
  cn: ["Asia/Shanghai"],
  hk: ["Asia/Hong_Kong"],
  tw: ["Asia/Taipei"],
  jp: ["Asia/Tokyo"],
  kr: ["Asia/Seoul"],
  sg: ["Asia/Singapore"],
  my: ["Asia/Kuala_Lumpur"],
  th: ["Asia/Bangkok"],
  id: ["Asia/Jakarta"],
  ph: ["Asia/Manila"],
  au: [
    "Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane",
    "Australia/Perth", "Australia/Adelaide", "Australia/Hobart",
    "Australia/Darwin",
  ],
  nz: ["Pacific/Auckland"],
  za: ["Africa/Johannesburg"],
  eg: ["Africa/Cairo"],
  ng: ["Africa/Lagos"],
  ma: ["Africa/Casablanca"],
  ke: ["Africa/Nairobi"],
};

const TIMEZONE_ISO2: Record<string, string> = {};
Object.entries(AMERICA_ZONES).forEach(([iso2, zones]) =>
  zones.forEach((z) => (TIMEZONE_ISO2[`America/${z}`] = iso2)),
);
Object.entries(OTHER_ZONES).forEach(([iso2, zones]) =>
  zones.forEach((z) => (TIMEZONE_ISO2[z] = iso2)),
);

const isKnownIso2 = (iso2: string) => COUNTRY_CODES.some((c) => c.value === iso2);

/**
 * País por defecto del selector de teléfono:
 * 1. Zona horaria del dispositivo (refleja dónde está la persona; no pide permisos).
 * 2. Región de los idiomas del navegador ("es-MX" → mx). Va después porque mucha
 *    gente en Latinoamérica tiene el navegador en "en-US".
 * 3. Colombia.
 */
export const detectDefaultIso2 = (): string => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const byTz = TIMEZONE_ISO2[tz];
    if (byTz && isKnownIso2(byTz)) return byTz;
  } catch {
    /* sin Intl: sigue con el idioma */
  }
  try {
    const langs = navigator.languages?.length
      ? navigator.languages
      : [navigator.language || ""];
    for (const lang of langs) {
      const region = lang.split("-").slice(1).find((p) => /^[a-z]{2}$/i.test(p));
      if (region && isKnownIso2(region.toLowerCase())) return region.toLowerCase();
    }
  } catch {
    /* ignore */
  }
  return "co";
};

export const getDialCodeForIso2 = (iso2: string): string =>
  COUNTRY_CODES.find((c) => c.value === iso2)?.dialCode || "+57";

// País principal cuando varios comparten indicativo (la lista está en orden
// alfabético: sin esto "+1" resolvía a Canadá y "+44" a Guernsey)
const MAIN_ISO2_FOR_DIAL: Record<string, string> = {
  "+1": "us",
  "+7": "ru",
  "+39": "it",
  "+44": "gb",
  "+47": "no",
  "+61": "au",
  "+64": "nz",
  "+212": "ma",
  "+262": "re",
  "+358": "fi",
  "+590": "gp",
  "+599": "cw",
};

/**
 * País de un indicativo. `preferredIso2` (el que la persona eligió o el detectado)
 * gana si comparte ese indicativo: así elegir Canadá (+1) no salta a EE. UU.
 */
export const getIso2ForDialCode = (dialCode: string, preferredIso2?: string): string => {
  if (preferredIso2 && getDialCodeForIso2(preferredIso2) === dialCode) return preferredIso2;
  return (
    MAIN_ISO2_FOR_DIAL[dialCode] ||
    COUNTRY_CODES.find((c) => c.dialCode === dialCode)?.value ||
    "co"
  );
};

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
    const iso2 = getIso2ForDialCode(dialCode, defaultIso2);
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

/** Miljövariabeln med adressen till introduktionsfilmen (docs/drift.md). Läses vid varje förfrågan, inte vid bygget. */
const INTRO_FILM_VARIABLE = "NEXT_PUBLIC_INTRO_FILM_URL";
/** Filmen om kartritningen (ägaren 2026-11-16: en film om banläggning och tävling, en om kartritning, båda på svenska och engelska). */
const MAP_FILM_VARIABLE = "NEXT_PUBLIC_MAP_FILM_URL";

type Environment = Record<string, string | undefined>;

/** En http(s)-adress eller en sökväg på samma värd; annat (tomt, andra scheman, `//värd`) ger `undefined`. */
function filmAddress(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (!URL.canParse(value)) return undefined;
  const url = new URL(value);
  return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
}

/**
 * Filmens adress för språket: på engelska gäller variabeln med `_EN` efter namnet, och saknas den visas den svenska filmen.
 * Namnet slås upp med en variabel: `process.env.NEXT_PUBLIC_…` skrivs annars in i koden när Next bygger, och
 * avbildningen byggs en gång för alla servrar.
 */
function filmUrl(variable: string, environment: Environment, language: "sv" | "en"): string | undefined {
  return (language === "en" ? filmAddress(environment[`${variable}_EN`]) : undefined) ?? filmAddress(environment[variable]);
}

/**
 * Adressen till filmen "Se vad O-Tid kan" längst ned på startsidan, eller `undefined` när variabeln saknas, är tom eller
 * inte är en http(s)-adress eller en sökväg på samma värd. Då visas ingen länk alls.
 */
export const introFilmUrl = (environment: Environment = process.env, language: "sv" | "en" = "sv") => filmUrl(INTRO_FILM_VARIABLE, environment, language);

/** Adressen till filmen om kartritningen, på samma villkor som introduktionsfilmen. */
export const mapFilmUrl = (environment: Environment = process.env, language: "sv" | "en" = "sv") => filmUrl(MAP_FILM_VARIABLE, environment, language);

/**
 * Idéerna 2026-11-08 (demoläge, första steget): `OTID_DEMO_RACE` är den korta koden till en publicerad tävling som ägaren
 * valt som demo (t.ex. en träning på Kungshatt). Startsidan länkar dit; utan giltig kod visas ingen länk.
 */
export function demoRacePath(environment: Record<string, string | undefined> = process.env): string | undefined {
  const value = environment.OTID_DEMO_RACE?.trim().toLowerCase();
  return value && /^[2-9a-hjkmnp-z]{6}$/.test(value) ? `/t/${value}` : undefined;
}

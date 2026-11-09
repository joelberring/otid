/** Miljövariabeln med adressen till introduktionsfilmen (docs/drift.md). Läses vid varje förfrågan, inte vid bygget. */
export const INTRO_FILM_VARIABLE = "NEXT_PUBLIC_INTRO_FILM_URL";

/**
 * Adressen till filmen "Se vad O-Tid kan" längst ned på startsidan, eller `undefined` när variabeln saknas, är tom eller
 * inte är en http(s)-adress eller en sökväg på samma värd. Då visas ingen länk alls.
 *
 * Namnet slås upp med en variabel: `process.env.NEXT_PUBLIC_…` skrivs annars in i koden när Next bygger, och
 * avbildningen byggs en gång för alla servrar.
 */
export function introFilmUrl(environment: Record<string, string | undefined> = process.env): string | undefined {
  const value = environment[INTRO_FILM_VARIABLE]?.trim();
  if (!value) return undefined;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (!URL.canParse(value)) return undefined;
  const url = new URL(value);
  return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
}

/**
 * Idéerna 2026-11-08 (demoläge, första steget): `OTID_DEMO_RACE` är den korta koden till en publicerad tävling som ägaren
 * valt som demo (t.ex. en träning på Kungshatt). Startsidan länkar dit; utan giltig kod visas ingen länk.
 */
export function demoRacePath(environment: Record<string, string | undefined> = process.env): string | undefined {
  const value = environment.OTID_DEMO_RACE?.trim().toLowerCase();
  return value && /^[2-9a-hjkmnp-z]{6}$/.test(value) ? `/t/${value}` : undefined;
}

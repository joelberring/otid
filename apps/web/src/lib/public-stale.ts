/**
 * Steg 51: svarshuvudet som säger att en publik lista gäller en äldre version än tävlingens aktuella (cachen räknar
 * just om den). Webbläsaren hämtar då igen strax i stället för att vänta på nästa väckning (`usePublicRaceData`).
 */
export const PUBLIC_STALE_HEADER = "x-otid-stale";

/** Gäller något av svaren en äldre version? */
export function anyStale(...responses: readonly (Response | undefined)[]): boolean {
  return responses.some((response) => response?.headers.get(PUBLIC_STALE_HEADER) === "1");
}

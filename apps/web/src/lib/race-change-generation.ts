/**
 * Steg 54 (ADR-0177 beslut 7): en ändring som arrangören eller en funktionär gör i arbetsytan (status, start, återkomst,
 * anmälan, banor, publicering, behörighet …) ska synas direkt vid nästa läsning. Alla sådana ändringar går genom `web`
 * (tävlingens instans, Caddy skickar dit allt för inloggade), så varje lyckad skrivning räknar upp tävlingens
 * generation här. Det som delas eller cachas för inloggade (Kvar i skogen, arrangörens resultatlista) har generationen i
 * nyckeln och räknas därför om efter ändringen. Avläsningar räknar inte upp: de är nya resultat, som publikens listor.
 */
const globalGeneration = globalThis as typeof globalThis & { oTidRaceChangeGeneration?: Map<string, number> };
const generations = globalGeneration.oTidRaceChangeGeneration ??= new Map<string, number>();

export function raceChangeGeneration(raceId: string): number {
  return generations.get(raceId) ?? 0;
}

export function bumpRaceChangeGeneration(raceId: string): void {
  generations.set(raceId, raceChangeGeneration(raceId) + 1);
  if (generations.size > 1_000) generations.delete(generations.keys().next().value!);
}

/** Skrivningar som inte räknar upp generationen: nya resultat (avläsningar, får visas högst lite fördröjda) och banläggningen. */
export const RESULT_WRITES: ReadonlySet<string> = new Set(["readouts",
  // Steg 62: banläggningens dokument ändrar inget i tävlingen förrän det förs över (då via source-sync), så autosparandet
  // räknar inte upp generationen.
  "course-setting", "course-setting-import", "course-setting-restore", "course-setting-transfer"]);

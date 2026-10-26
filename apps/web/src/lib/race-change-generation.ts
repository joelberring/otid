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

/** Skrivningar som är nya resultat (avläsningar) och därför får visas som publikens listor, högst lite fördröjda. */
export const RESULT_WRITES: ReadonlySet<string> = new Set(["readouts"]);

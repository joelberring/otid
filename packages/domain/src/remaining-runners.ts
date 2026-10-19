/**
 * PLAN.md steg 25: "Markera alla kvar i skogen som ej start" efter tävlingen. Löpare utan resultat (ingen avläsning
 * och inget beslut) delas i två grupper: de som inte visar något tecken på att ha startat blir ej start, medan de som
 * har stämplat vid en radiokontroll eller prickats av som startade saknas i mål och måste kontrolleras. Funktionen är
 * ren; anroparen läser fakta och sparar besluten som vanliga revisioner (`setEntryStatus`).
 */
export interface RemainingRunnerFacts {
  readonly entryId: string;
  /** Löparen har minst en resultatrevision (avläsning eller beslut). */
  readonly hasResult: boolean;
  /** Brickan har stämplat vid en radiokontroll i tävlingen. */
  readonly radioPunched: boolean;
  /** Avprickningen vid start säger att löparen startade. */
  readonly startCheckedIn: boolean;
}

export interface RemainingRunners {
  /** Löpare som markeras som ej start. */
  readonly didNotStart: readonly string[];
  /** Löpare som har startat men saknar avläsning: "Saknas i mål – kontrollera". */
  readonly missingAtFinish: readonly string[];
}

export function classifyRemainingRunners(facts: readonly RemainingRunnerFacts[]): RemainingRunners {
  const didNotStart: string[] = [];
  const missingAtFinish: string[] = [];
  const seen = new Set<string>();
  for (const runner of facts) {
    if (seen.has(runner.entryId)) throw new Error("Löparen förekommer flera gånger");
    seen.add(runner.entryId);
    if (runner.hasResult) continue;
    if (runner.radioPunched || runner.startCheckedIn) missingAtFinish.push(runner.entryId);
    else didNotStart.push(runner.entryId);
  }
  return { didNotStart, missingAtFinish };
}

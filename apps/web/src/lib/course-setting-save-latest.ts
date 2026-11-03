/**
 * Ett sparande i banläggningen utanför editorn (som utskriftssidans, hittbarhet 2026-11-03): alltid på den senaste
 * versionen, ett i taget. Avvisar servern det för att någon annan hunnit spara (konflikt) läses den senaste versionen och
 * det görs ett nytt försök, tyst. Går det inte heller då är svaret `false`, och den som anropade visar ett lugnt besked
 * vid det som inte sparades ("Ändringen sparades inte – försök igen").
 */
export type SaveAttempt = "saved" | "conflict" | "rejected";

export interface LatestSave {
  /** Den senaste versionen på servern (0 = ingen banläggning än); undefined = går inte att läsa. */
  readonly latest: () => Promise<number | undefined>;
  /** Sparar på `version`. */
  readonly attempt: (version: number) => Promise<SaveAttempt>;
}

export type LatestSaveResult = { readonly saved: true } | { readonly saved: false; readonly reason: "conflict" | "rejected" | "failed" };

export async function saveOnLatest(save: LatestSave, tries = 2): Promise<LatestSaveResult> {
  let reason: "conflict" | "rejected" | "failed" = "failed";
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const version = await save.latest();
      if (version === undefined) return { saved: false, reason: "failed" };
      const outcome = await save.attempt(version);
      if (outcome === "saved") return { saved: true };
      reason = outcome;
      // Ett fel som inte beror på versionen blir inte bättre av ett nytt försök.
      if (outcome === "rejected") break;
    } catch (error) {
      console.error("Banläggningen sparades inte", error);
      return { saved: false, reason: "failed" };
    }
  }
  return { saved: false, reason };
}

/** Kör sparanden ett i taget (nästa börjar när det förra är klart, också när det misslyckades). */
export function serialSaves(): <T>(run: () => Promise<T>) => Promise<T> {
  let previous: Promise<unknown> = Promise.resolve();
  return <T>(run: () => Promise<T>) => {
    const next = previous.then(run, run);
    previous = next.catch(() => undefined);
    return next;
  };
}

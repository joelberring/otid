import type { StartRule } from "./types";

/**
 * PLAN.md steg 25: startstämplingen vid lottad (fast) start. Den lottade tiden är den officiella starten; en
 * startstämpling som avviker mer än toleransen visas som en varning på resultatet (ingen statusändring). Saknar
 * löparen lottad tid (t.ex. efteranmäld utan plats) används startstämplingen som starttid och resultatet får en notis.
 * Toleransen är en konstant tills en klass- eller tävlingsinställning behövs.
 */
export const START_PUNCH_TOLERANCE_MS = 60_000;

export type StartPunchNote =
  /** Startstämplingen ligger mer än toleransen efter (LATE) eller före (EARLY) den lottade tiden. */
  | { readonly kind: "LATE" | "EARLY"; readonly punchedAt: string; readonly scheduledAt: string; readonly deviationMs: number }
  /** Ingen lottad tid: starttiden är startstämplingen. */
  | { readonly kind: "FROM_PUNCH"; readonly punchedAt: string };

export interface StartPunchFacts {
  readonly startRule: StartRule;
  readonly fixedStartTime?: string | null | undefined;
  readonly startPunchedAt?: string | null | undefined;
}

/** Starttiden som resultatet räknas från: stämplingen vid stämplingsstart, annars lottad tid med stämplingen som reserv. */
export function officialStartTime(facts: StartPunchFacts): string | undefined {
  if (facts.startRule === "PUNCH") return facts.startPunchedAt ?? undefined;
  return facts.fixedStartTime ?? facts.startPunchedAt ?? undefined;
}

/** Varningen eller notisen om startstämplingen, eller undefined när inget behöver visas. */
export function startPunchNote(facts: StartPunchFacts, toleranceMs = START_PUNCH_TOLERANCE_MS): StartPunchNote | undefined {
  if (facts.startRule !== "FIXED" || !facts.startPunchedAt) return undefined;
  const punchedMs = Date.parse(facts.startPunchedAt);
  if (!Number.isFinite(punchedMs)) return undefined;
  const punchedAt = new Date(punchedMs).toISOString();
  if (!facts.fixedStartTime) return { kind: "FROM_PUNCH", punchedAt };
  const scheduledMs = Date.parse(facts.fixedStartTime);
  if (!Number.isFinite(scheduledMs)) return undefined;
  const difference = punchedMs - scheduledMs;
  if (Math.abs(difference) <= toleranceMs) return undefined;
  return { kind: difference > 0 ? "LATE" : "EARLY", punchedAt, scheduledAt: new Date(scheduledMs).toISOString(),
    deviationMs: Math.abs(difference) };
}

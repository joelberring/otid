import type { StartCheckinState } from "./start-checkin";
import { UUID_PATTERN as UUID } from "./types";

export interface ForestWatchEntryFacts {
  readonly raceId: string;
  readonly entryId: string;
  readonly startState: StartCheckinState;
  /** Must be established by the caller from a linked return source, never result absence. */
  readonly returnRegistered: boolean;
  readonly activeDns: boolean;
  readonly conflictingReports: boolean;
}

export type ForestWatchState = "STARTED_NO_RETURN" | "UNCONFIRMED" | "NOT_STARTED" | "RETURNED" | "CONFLICT";

export interface ForestWatchEntry {
  readonly entryId: string;
  readonly state: ForestWatchState;
  readonly returnRegistered: boolean;
  readonly needsFollowUp: boolean;
}

export class ForestWatchInputError extends Error {
  constructor() {
    super("Invalid or ambiguous forest watch input");
    this.name = "ForestWatchInputError";
  }
}


/** Classifies every supplied roster entry; does not claim the supplied roster is complete. */
export function buildForestWatchList(raceId: string, entries: readonly ForestWatchEntryFacts[]): readonly ForestWatchEntry[] {
  if (typeof raceId !== "string" || !UUID.test(raceId) || !Array.isArray(entries) || entries.length > 10_000) {
    throw new ForestWatchInputError();
  }
  const seen = new Set<string>();
  const result: ForestWatchEntry[] = [];
  for (const row of entries as readonly ForestWatchEntryFacts[]) {
    if (typeof row !== "object" || row === null || Array.isArray(row) || row.raceId !== raceId ||
        typeof row.entryId !== "string" || !UUID.test(row.entryId) || seen.has(row.entryId) ||
        typeof row.startState !== "string" || !["UNMARKED", "STARTED", "REPORTED_NOT_STARTED"].includes(row.startState) ||
        typeof row.returnRegistered !== "boolean" || typeof row.activeDns !== "boolean" ||
        typeof row.conflictingReports !== "boolean" || Object.keys(row).length !== 6) {
      throw new ForestWatchInputError();
    }
    seen.add(row.entryId);
    const contradictory = row.conflictingReports ||
      (row.returnRegistered && (row.activeDns || row.startState === "REPORTED_NOT_STARTED")) ||
      (row.activeDns && row.startState === "STARTED");
    const state: ForestWatchState = contradictory ? "CONFLICT" : row.returnRegistered ? "RETURNED" :
      row.startState === "STARTED" ? "STARTED_NO_RETURN" :
      row.activeDns || row.startState === "REPORTED_NOT_STARTED" ? "NOT_STARTED" : "UNCONFIRMED";
    result.push({ entryId: row.entryId, state, returnRegistered: row.returnRegistered,
      needsFollowUp: state === "STARTED_NO_RETURN" || state === "UNCONFIRMED" || state === "CONFLICT" });
  }
  return result.sort((a, b) => a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0);
}

/**
 * Det en lista "kvar i skogen" vet om en löpare: skogstillståndet ovan, avprickningen, den lottade starttiden och om
 * brickan har stämplat vid en radiokontroll. `fixedStartTime` är null (eller saknas) vid fri start.
 */
export interface RemainingInForestFacts {
  /** `ForestWatchState`; en sträng så att webbens rader kan lämnas som de är. */
  readonly forestState: string;
  /** `StartCheckinState`; saknas uppgiften gäller dagens regel. */
  readonly startState?: string | undefined;
  readonly fixedStartTime?: string | null | undefined;
  readonly radioPunched: boolean;
}

/**
 * Användartestet 2026-11-12: en löpare med lottad starttid (minutstart eller masstart) som ligger framåt i tiden har inte
 * startat och är inte kvar i skogen. Regeln är försiktig, eftersom listan är den arrangören använder för att veta vilka
 * som inte kommit tillbaka: bara en löpare utan några andra uppgifter (skogstillståndet UNCONFIRMED: ingen avläsning, inget
 * beslut, ingen återkomst, ingen konflikt och ingen avprickning) och utan radiostämpling väntar på sin start. Fri start
 * (ingen starttid), en ogiltig tid och en starttid som passerat ger dagens regel.
 */
export function awaitingScheduledStart(facts: RemainingInForestFacts, now: Date): boolean {
  if (facts.forestState !== "UNCONFIRMED" || facts.startState !== "UNMARKED" || facts.radioPunched) return false;
  if (!facts.fixedStartTime) return false;
  const startsAt = Date.parse(facts.fixedStartTime), at = now.getTime();
  return Number.isFinite(startsAt) && Number.isFinite(at) && startsAt > at;
}

/** Kvar i skogen (ADR-0168): varken återkommen eller ej startande, och inte en löpare som väntar på sin lottade start. */
export function remainsInForest(facts: RemainingInForestFacts, now: Date): boolean {
  if (facts.forestState === "RETURNED" || facts.forestState === "NOT_STARTED") return false;
  return !awaitingScheduledStart(facts, now);
}

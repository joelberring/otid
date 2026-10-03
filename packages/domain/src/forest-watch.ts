import type { StartCheckinState } from "./start-checkin";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

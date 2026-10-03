import type { StartCheckinState } from "./start-checkin";

export interface AppliedStartObservation {
  readonly revision: number;
  readonly state: StartCheckinState;
  readonly observedAt: string;
}

/** Caller supplies verified APPLIED operations only, never conflicts/no-ops. */
export function reportedStartAt(current: { revision: number; state: StartCheckinState },
  observations: readonly AppliedStartObservation[]): string | null {
  if (!Number.isSafeInteger(current.revision) || current.revision < 0 || current.revision !== observations.length) {
    throw new Error("Incomplete operational history");
  }
  let state: StartCheckinState = "UNMARKED", startedAt: string | null = null;
  const ordered = [...observations].sort((a, b) => a.revision - b.revision);
  for (const [index, observation] of ordered.entries()) {
    if (observation.revision !== index + 1 || !["UNMARKED", "STARTED", "REPORTED_NOT_STARTED"].includes(observation.state) ||
      !Number.isFinite(Date.parse(observation.observedAt)) || new Date(observation.observedAt).toISOString() !== observation.observedAt) {
      throw new Error("Invalid operational history");
    }
    if (observation.state !== "STARTED") startedAt = null;
    else if (state !== "STARTED") startedAt = observation.observedAt;
    state = observation.state;
  }
  if (state !== current.state) throw new Error("Operational history contradicts current state");
  return startedAt;
}

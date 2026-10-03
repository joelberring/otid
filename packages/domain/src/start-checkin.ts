/** Operational reports, deliberately separate from result statuses and timing. */
export type StartCheckinState = "UNMARKED" | "STARTED" | "REPORTED_NOT_STARTED";

export interface StartCheckinSnapshot {
  readonly raceId: string;
  readonly entryId: string;
  readonly revision: number;
  readonly state: StartCheckinState;
}

export interface StartCheckinIntent {
  readonly raceId: string;
  readonly entryId: string;
  readonly expectedRevision: number;
  readonly state: StartCheckinState;
}

export type StartCheckinPlan =
  | { readonly kind: "UNCHANGED" }
  | { readonly kind: "CHANGE"; readonly previousRevision: number; readonly next: StartCheckinSnapshot };

export class StartCheckinError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "SCOPE_CONFLICT" | "REVISION_CONFLICT" | "REVISION_EXHAUSTED") {
    super(code);
    this.name = "StartCheckinError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_REVISION = 2_147_483_647;

function validate(value: unknown, revisionKey: "revision" | "expectedRevision"): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StartCheckinError("INVALID_INPUT");
  }
  const row = value as Record<string, unknown>;
  const allowed = ["raceId", "entryId", revisionKey, "state"];
  if (Object.keys(row).length !== allowed.length || Object.keys(row).some(key => !allowed.includes(key)) ||
      typeof row.raceId !== "string" || !UUID.test(row.raceId) ||
      typeof row.entryId !== "string" || !UUID.test(row.entryId) ||
      typeof row[revisionKey] !== "number" || !Number.isInteger(row[revisionKey]) ||
      row[revisionKey] < 0 || row[revisionKey] > MAX_REVISION ||
      typeof row.state !== "string" || !["UNMARKED", "STARTED", "REPORTED_NOT_STARTED"].includes(row.state)) {
    throw new StartCheckinError("INVALID_INPUT");
  }
  if (revisionKey === "revision" && row.revision === 0 && row.state !== "UNMARKED") {
    throw new StartCheckinError("INVALID_INPUT");
  }
}

/** Requires an authorized, locked snapshot. Request replay belongs above this rule. */
export function planStartCheckin(current: StartCheckinSnapshot, intent: StartCheckinIntent): StartCheckinPlan {
  validate(current, "revision");
  validate(intent, "expectedRevision");
  if (current.raceId !== intent.raceId || current.entryId !== intent.entryId) {
    throw new StartCheckinError("SCOPE_CONFLICT");
  }
  if (current.revision !== intent.expectedRevision) throw new StartCheckinError("REVISION_CONFLICT");
  if (current.state === intent.state) return { kind: "UNCHANGED" };
  if (current.revision === MAX_REVISION) throw new StartCheckinError("REVISION_EXHAUSTED");
  return {
    kind: "CHANGE",
    previousRevision: current.revision,
    next: { raceId: current.raceId, entryId: current.entryId, revision: current.revision + 1, state: intent.state }
  };
}

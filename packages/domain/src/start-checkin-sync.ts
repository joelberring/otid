import type { StartCheckinState } from "./start-checkin";

/** The stored operational state selected under the entry lock. */
export interface StartCheckinSyncCurrent {
  readonly revision: number;
  readonly state: StartCheckinState;
  readonly manualReturnRegistered: boolean;
}

export type StartCheckinSyncAction =
  | { readonly kind: "MARK_START"; readonly state: StartCheckinState }
  | { readonly kind: "FINISH_CORRECTION"; readonly state: StartCheckinState; readonly manualReturnRegistered: boolean };

/**
 * This is a deliberately small projection of the already selected result
 * head. The application layer owns result provenance and persistence.
 */
export type StartCheckinSyncResultState =
  | "EMPTY"
  | "ACTIVE_CHECKIN_DNS"
  | "WITHDRAWN_CHECKIN_DNS"
  | "OTHER_RESULT";

export interface StartCheckinSyncInput {
  readonly current: StartCheckinSyncCurrent;
  readonly expectedRevision: number;
  readonly action: StartCheckinSyncAction;
  readonly technicalReturnRegistered: boolean;
  readonly resultState: StartCheckinSyncResultState;
  readonly resultRevision: number;
}

export type StartCheckinDnsEffect = "NONE" | "CREATE" | "WITHDRAW";

export type StartCheckinSyncPlan =
  | { readonly kind: "CONFLICT"; readonly reason: "STALE_REVISION" | "RETURN_ALREADY_REGISTERED" | "RESULT_CONFLICT" }
  | { readonly kind: "UNCHANGED" }
  | {
      readonly kind: "APPLIED";
      readonly revision: number;
      readonly state: StartCheckinState;
      readonly manualReturnRegistered: boolean;
      readonly dnsEffect: StartCheckinDnsEffect;
    };

export class StartCheckinSyncError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "REVISION_EXHAUSTED") {
    super(code);
    this.name = "StartCheckinSyncError";
  }
}

const MAX_PG_INTEGER = 2_147_483_647;
const STATES: readonly StartCheckinState[] = ["UNMARKED", "STARTED", "REPORTED_NOT_STARTED"];
const RESULT_STATES: readonly StartCheckinSyncResultState[] = [
  "EMPTY", "ACTIVE_CHECKIN_DNS", "WITHDRAWN_CHECKIN_DNS", "OTHER_RESULT"
];

function isPostgresInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_PG_INTEGER;
}

function isStartCheckinState(value: unknown): value is StartCheckinState {
  return typeof value === "string" && STATES.includes(value as StartCheckinState);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(row: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(row);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
}

function invalid(): never {
  throw new StartCheckinSyncError("INVALID_INPUT");
}

function validateInput(value: StartCheckinSyncInput): void {
  if (!isPlainObject(value) || !hasExactlyKeys(value, [
    "current", "expectedRevision", "action", "technicalReturnRegistered", "resultState", "resultRevision"
  ])) invalid();

  const current = value.current;
  if (!isPlainObject(current) || !hasExactlyKeys(current, ["revision", "state", "manualReturnRegistered"]) ||
      !isPostgresInteger(current.revision) || !isStartCheckinState(current.state) ||
      typeof current.manualReturnRegistered !== "boolean" ||
      (current.revision === 0 && (current.state !== "UNMARKED" || current.manualReturnRegistered))) invalid();

  if (!isPostgresInteger(value.expectedRevision) || typeof value.technicalReturnRegistered !== "boolean" ||
      typeof value.resultState !== "string" || !RESULT_STATES.includes(value.resultState) ||
      !isPostgresInteger(value.resultRevision)) invalid();

  const action = value.action;
  if (!isPlainObject(action) || typeof action.kind !== "string" || !isStartCheckinState(action.state)) invalid();
  if (action.kind === "MARK_START") {
    if (!hasExactlyKeys(action, ["kind", "state"])) invalid();
  } else if (action.kind === "FINISH_CORRECTION") {
    if (!hasExactlyKeys(action, ["kind", "state", "manualReturnRegistered"]) ||
        typeof action.manualReturnRegistered !== "boolean") invalid();
  } else {
    invalid();
  }

  if ((value.resultState === "EMPTY") !== (value.resultRevision === 0)) invalid();
}

/**
 * Plans one atomic check-in sync effect from locked, validated facts.
 * It never infers a result from absence and never selects a result head.
 */
export function planStartCheckinSync(input: StartCheckinSyncInput): StartCheckinSyncPlan {
  validateInput(input);
  const { current, action } = input;
  if (current.revision !== input.expectedRevision) return { kind: "CONFLICT", reason: "STALE_REVISION" };

  const state = action.state;
  const manualReturnRegistered = action.kind === "MARK_START"
    ? current.manualReturnRegistered
    : action.manualReturnRegistered;
  const negativeState = state === "REPORTED_NOT_STARTED";
  const negativeTarget = negativeState && !manualReturnRegistered;

  // A technical return is evidence that always wins over a new negative report.
  if (negativeState && input.technicalReturnRegistered) {
    return { kind: "CONFLICT", reason: "RETURN_ALREADY_REGISTERED" };
  }
  // Start staff cannot turn a known manual return into a negative report.
  if (action.kind === "MARK_START" && negativeState && current.manualReturnRegistered) {
    return { kind: "CONFLICT", reason: "RETURN_ALREADY_REGISTERED" };
  }
  if (negativeTarget && input.resultState === "OTHER_RESULT") {
    return { kind: "CONFLICT", reason: "RESULT_CONFLICT" };
  }

  const dnsEffect: StartCheckinDnsEffect = negativeTarget
    ? input.resultState === "EMPTY" || input.resultState === "WITHDRAWN_CHECKIN_DNS" ? "CREATE" : "NONE"
    : input.resultState === "ACTIVE_CHECKIN_DNS" ? "WITHDRAW" : "NONE";
  const operationalChange = state !== current.state || manualReturnRegistered !== current.manualReturnRegistered;
  if (!operationalChange && dnsEffect === "NONE") return { kind: "UNCHANGED" };
  if (dnsEffect === "CREATE" && input.resultRevision === MAX_PG_INTEGER) {
    throw new StartCheckinSyncError("REVISION_EXHAUSTED");
  }
  if (current.revision === MAX_PG_INTEGER) throw new StartCheckinSyncError("REVISION_EXHAUSTED");

  return {
    kind: "APPLIED",
    revision: current.revision + 1,
    state,
    manualReturnRegistered,
    dnsEffect
  };
}

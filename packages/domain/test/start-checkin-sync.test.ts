import { describe, expect, it } from "vitest";
import { planStartCheckinSync, StartCheckinSyncError, type StartCheckinSyncInput } from "../src";

const MAX = 2_147_483_647;
const current = (overrides: Partial<StartCheckinSyncInput["current"]> = {}): StartCheckinSyncInput["current"] => ({
  revision: 4, state: "UNMARKED", manualReturnRegistered: false, ...overrides
});
const input = (overrides: Partial<StartCheckinSyncInput> = {}): StartCheckinSyncInput => ({
  current: current(), expectedRevision: 4, action: { kind: "MARK_START", state: "STARTED" },
  technicalReturnRegistered: false, resultState: "EMPTY", resultRevision: 0, ...overrides
});

function expectError(fn: () => unknown, code: StartCheckinSyncError["code"]): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(StartCheckinSyncError);
    if (!(error instanceof StartCheckinSyncError)) throw error;
    expect(error.code).toBe(code);
    return;
  }
  throw new Error("Expected StartCheckinSyncError");
}

describe("start checkin sync planning", () => {
  it("returns a stale conflict before considering a requested result effect", () => {
    expect(planStartCheckinSync(input({ expectedRevision: 3, action: { kind: "MARK_START", state: "REPORTED_NOT_STARTED" }, resultState: "OTHER_RESULT", resultRevision: 8 })))
      .toEqual({ kind: "CONFLICT", reason: "STALE_REVISION" });
  });

  it.each([
    ["EMPTY", 0, "CREATE"],
    ["WITHDRAWN_CHECKIN_DNS", 7, "CREATE"],
    ["ACTIVE_CHECKIN_DNS", 7, "NONE"]
  ] as const)("plans a negative report against %s", (resultState, resultRevision, dnsEffect) => {
    expect(planStartCheckinSync(input({ action: { kind: "MARK_START", state: "REPORTED_NOT_STARTED" }, resultState, resultRevision }))).toEqual({
      kind: "APPLIED", revision: 5, state: "REPORTED_NOT_STARTED", manualReturnRegistered: false, dnsEffect
    });
  });

  it("preserves a current negative report without a new revision when its DNS is already active", () => {
    expect(planStartCheckinSync(input({ current: current({ state: "REPORTED_NOT_STARTED" }), action: { kind: "MARK_START", state: "REPORTED_NOT_STARTED" }, resultState: "ACTIVE_CHECKIN_DNS", resultRevision: 7 })))
      .toEqual({ kind: "UNCHANGED" });
  });

  it("creates a new revision when unchanged negative facts need a withdrawn DNS recreated", () => {
    expect(planStartCheckinSync(input({ current: current({ state: "REPORTED_NOT_STARTED" }), action: { kind: "MARK_START", state: "REPORTED_NOT_STARTED" }, resultState: "WITHDRAWN_CHECKIN_DNS", resultRevision: 7 }))).toEqual({
      kind: "APPLIED", revision: 5, state: "REPORTED_NOT_STARTED", manualReturnRegistered: false, dnsEffect: "CREATE"
    });
  });

  it.each(["UNMARKED", "STARTED"] as const)("withdraws an active checkin DNS for nonnegative %s", state => {
    expect(planStartCheckinSync(input({ action: { kind: "MARK_START", state }, resultState: "ACTIVE_CHECKIN_DNS", resultRevision: 7 }))).toEqual({
      kind: "APPLIED", revision: 5, state, manualReturnRegistered: false, dnsEffect: "WITHDRAW"
    });
  });

  it.each([
    ["EMPTY", 0, "NONE"],
    ["ACTIVE_CHECKIN_DNS", 7, "WITHDRAW"],
    ["WITHDRAWN_CHECKIN_DNS", 7, "NONE"],
    ["OTHER_RESULT", 8, "NONE"]
  ] as const)("covers the nonnegative DNS matrix for %s", (resultState, resultRevision, dnsEffect) => {
    expect(planStartCheckinSync(input({
      action: { kind: "MARK_START", state: "STARTED" }, resultState, resultRevision
    }))).toEqual({
      kind: "APPLIED", revision: 5, state: "STARTED", manualReturnRegistered: false, dnsEffect
    });
  });

  it("allows a nonnegative report alongside another result without affecting it", () => {
    expect(planStartCheckinSync(input({ action: { kind: "MARK_START", state: "STARTED" }, resultState: "OTHER_RESULT", resultRevision: 8 }))).toEqual({
      kind: "APPLIED", revision: 5, state: "STARTED", manualReturnRegistered: false, dnsEffect: "NONE"
    });
  });

  it("rejects a negative target when a technical return or another result exists", () => {
    const action = { kind: "MARK_START", state: "REPORTED_NOT_STARTED" } as const;
    expect(planStartCheckinSync(input({ action, technicalReturnRegistered: true }))).toEqual({ kind: "CONFLICT", reason: "RETURN_ALREADY_REGISTERED" });
    expect(planStartCheckinSync(input({ action, resultState: "OTHER_RESULT", resultRevision: 8 }))).toEqual({ kind: "CONFLICT", reason: "RESULT_CONFLICT" });
  });

  it("keeps a manual return on MARK_START and rejects a negative MARK_START against it", () => {
    const knownReturn = current({ manualReturnRegistered: true });
    expect(planStartCheckinSync(input({ current: knownReturn, action: { kind: "MARK_START", state: "STARTED" } }))).toEqual({
      kind: "APPLIED", revision: 5, state: "STARTED", manualReturnRegistered: true, dnsEffect: "NONE"
    });
    expect(planStartCheckinSync(input({ current: knownReturn, action: { kind: "MARK_START", state: "REPORTED_NOT_STARTED" } })))
      .toEqual({ kind: "CONFLICT", reason: "RETURN_ALREADY_REGISTERED" });
  });

  it("lets finish correction explicitly add a manual return and withdraw DNS", () => {
    expect(planStartCheckinSync(input({
      current: current({ state: "REPORTED_NOT_STARTED" }),
      action: { kind: "FINISH_CORRECTION", state: "REPORTED_NOT_STARTED", manualReturnRegistered: true },
      resultState: "ACTIVE_CHECKIN_DNS", resultRevision: 7
    }))).toEqual({ kind: "APPLIED", revision: 5, state: "REPORTED_NOT_STARTED", manualReturnRegistered: true, dnsEffect: "WITHDRAW" });
  });

  it("allows a finish correction to remove a manual return before creating DNS", () => {
    expect(planStartCheckinSync(input({
      current: current({ state: "REPORTED_NOT_STARTED", manualReturnRegistered: true }),
      action: { kind: "FINISH_CORRECTION", state: "REPORTED_NOT_STARTED", manualReturnRegistered: false }
    }))).toEqual({ kind: "APPLIED", revision: 5, state: "REPORTED_NOT_STARTED", manualReturnRegistered: false, dnsEffect: "CREATE" });
  });

  it("rejects a technical return even when a finish correction carries a manual return", () => {
    expect(planStartCheckinSync(input({
      action: { kind: "FINISH_CORRECTION", state: "REPORTED_NOT_STARTED", manualReturnRegistered: true },
      technicalReturnRegistered: true
    }))).toEqual({ kind: "CONFLICT", reason: "RETURN_ALREADY_REGISTERED" });
  });

  it("does not increment for a genuine no-op", () => {
    expect(planStartCheckinSync(input({ current: current({ state: "STARTED" }), action: { kind: "MARK_START", state: "STARTED" } })))
      .toEqual({ kind: "UNCHANGED" });
  });

  it("rejects an effect that would exceed PostgreSQL integer range but permits no-op at the limit", () => {
    const exhausted = current({ revision: MAX, state: "STARTED" });
    expectError(() => planStartCheckinSync(input({ current: exhausted, expectedRevision: MAX, action: { kind: "MARK_START", state: "UNMARKED" } })), "REVISION_EXHAUSTED");
    expect(planStartCheckinSync(input({ current: exhausted, expectedRevision: MAX, action: { kind: "MARK_START", state: "STARTED" } }))).toEqual({ kind: "UNCHANGED" });
  });

  it("rejects DNS creation when its separate result revision is exhausted", () => {
    expectError(() => planStartCheckinSync(input({
      action: { kind: "MARK_START", state: "REPORTED_NOT_STARTED" },
      resultState: "WITHDRAWN_CHECKIN_DNS", resultRevision: MAX
    })), "REVISION_EXHAUSTED");
  });

  it.each([
    input({ current: { revision: 0, state: "STARTED", manualReturnRegistered: false } }),
    input({ current: { revision: 0, state: "UNMARKED", manualReturnRegistered: true } }),
    input({ resultState: "EMPTY", resultRevision: 1 }),
    input({ resultState: "ACTIVE_CHECKIN_DNS", resultRevision: 0 }),
    { ...input(), extra: true },
    input({ action: { kind: "MARK_START", state: "STARTED", manualReturnRegistered: false } as never }),
    input({ action: { kind: "FINISH_CORRECTION", state: "STARTED" } as never }),
    input({ expectedRevision: -1 }),
    input({ resultRevision: MAX + 1 })
  ])("rejects malformed input %#", value => {
    expectError(() => planStartCheckinSync(value as StartCheckinSyncInput), "INVALID_INPUT");
  });

  it("does not mutate the frozen input", () => {
    const value = Object.freeze(input({ current: Object.freeze(current()), action: Object.freeze({ kind: "MARK_START", state: "REPORTED_NOT_STARTED" }) }));
    expect(planStartCheckinSync(value)).toEqual({ kind: "APPLIED", revision: 5, state: "REPORTED_NOT_STARTED", manualReturnRegistered: false, dnsEffect: "CREATE" });
    expect(value.current.state).toBe("UNMARKED");
  });
});

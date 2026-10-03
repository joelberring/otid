import { describe, expect, it } from "vitest";
import { planStartCheckin, StartCheckinError, type StartCheckinIntent, type StartCheckinSnapshot, type StartCheckinState } from "../src";

const raceId = "00000000-0000-4000-8000-000000000001";
const entryId = "00000000-0000-4000-8000-000000000002";
const otherId = "00000000-0000-4000-8000-000000000003";
const states: readonly StartCheckinState[] = ["UNMARKED", "STARTED", "REPORTED_NOT_STARTED"];
const snapshot = (state: StartCheckinState = "UNMARKED", revision = 0): StartCheckinSnapshot => ({ raceId, entryId, state, revision });
const intent = (state: StartCheckinState = "STARTED", expectedRevision = 0): StartCheckinIntent => ({ raceId, entryId, state, expectedRevision });
function expectCode(fn: () => unknown, code: StartCheckinError["code"]) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(StartCheckinError);
    if (!(error instanceof StartCheckinError)) throw error;
    expect(error.code).toBe(code);
    return;
  }
  throw new Error("Expected StartCheckinError");
}

describe("manual start checkin", () => {
  it.each(states.flatMap(from => states.map(to => [from, to] as const)))("plans %s to %s without timing or result data", (from, to) => {
    const current = Object.freeze(snapshot(from, 5));
    const request = Object.freeze(intent(to, 5));
    const result = planStartCheckin(current, request);
    expect(result).toEqual(from === to ? { kind: "UNCHANGED" } : {
      kind: "CHANGE", previousRevision: 5, next: { raceId, entryId, revision: 6, state: to }
    });
    expect(current).toEqual(snapshot(from, 5));
    expect(request).toEqual(intent(to, 5));
    expect(planStartCheckin(current, request)).toEqual(result);
  });
  it("keeps initial unmarked distinct from a reported non-start", () => {
    expect(planStartCheckin(snapshot(), intent("UNMARKED"))).toEqual({ kind: "UNCHANGED" });
    expect(planStartCheckin(snapshot(), intent("REPORTED_NOT_STARTED"))).toEqual({
      kind: "CHANGE", previousRevision: 0, next: snapshot("REPORTED_NOT_STARTED", 1)
    });
  });
  it.each(states)("rejects stale intent even when its target is %s", state => {
    expectCode(() => planStartCheckin(snapshot(state, 2), intent(state, 1)), "REVISION_CONFLICT");
  });
  it.each(["raceId", "entryId"] as const)("rejects mismatched %s", key => {
    expectCode(() => planStartCheckin(snapshot(), { ...intent(), [key]: otherId }), "SCOPE_CONFLICT");
  });
  it("does not overflow while allowing an unchanged exhausted snapshot", () => {
    const current = snapshot("STARTED", 2_147_483_647);
    expectCode(() => planStartCheckin(current, intent("UNMARKED", current.revision)), "REVISION_EXHAUSTED");
    expect(planStartCheckin(current, intent("STARTED", current.revision))).toEqual({ kind: "UNCHANGED" });
  });
  it.each([-1, 0.5, NaN, Infinity, 2_147_483_648, "0", null])("rejects invalid revision %s on either boundary", revision => {
    expectCode(() => planStartCheckin({ ...snapshot(), revision } as StartCheckinSnapshot, intent()), "INVALID_INPUT");
    expectCode(() => planStartCheckin(snapshot(), { ...intent(), expectedRevision: revision } as StartCheckinIntent), "INVALID_INPUT");
  });
  it.each([null, [], {}, { ...snapshot(), extra: true }, { ...snapshot(), state: "DNS" },
    { ...snapshot(), state: { toString: () => "UNMARKED" } }, { ...snapshot(), raceId: "bad" },
    { ...snapshot(), entryId: "00000000-0000-4000-8000-00000000000A" }, snapshot("STARTED", 0)])("rejects malformed current input %#", value => {
    expectCode(() => planStartCheckin(value as StartCheckinSnapshot, intent()), "INVALID_INPUT");
  });
  it.each([null, [], {}, { ...intent(), startTime: "2026-01-01" }, { ...intent(), state: "DNS" },
    { ...intent(), state: { toString: () => "STARTED" } }, { ...intent(), raceId: "bad" }])("rejects malformed intent %#", value => {
    expectCode(() => planStartCheckin(snapshot(), value as StartCheckinIntent), "INVALID_INPUT");
  });
});

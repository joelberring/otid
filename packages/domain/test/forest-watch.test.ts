import { describe, expect, it } from "vitest";
import { buildForestWatchList, ForestWatchInputError, type ForestWatchEntryFacts } from "../src";

const raceId = "00000000-0000-4000-8000-000000000001";
const entryId = "00000000-0000-4000-8000-000000000002";
const otherId = "00000000-0000-4000-8000-000000000003";
const facts = (overrides: Partial<ForestWatchEntryFacts> = {}): ForestWatchEntryFacts => ({ raceId, entryId,
  startState: "UNMARKED", returnRegistered: false, activeDns: false, conflictingReports: false, ...overrides });

describe("forest watch list", () => {
  it.each([
    [facts(), "UNCONFIRMED", true],
    [facts({ startState: "STARTED" }), "STARTED_NO_RETURN", true],
    [facts({ startState: "REPORTED_NOT_STARTED" }), "NOT_STARTED", false],
    [facts({ activeDns: true }), "NOT_STARTED", false],
    [facts({ returnRegistered: true }), "RETURNED", false],
    [facts({ startState: "STARTED", returnRegistered: true }), "RETURNED", false],
    [facts({ startState: "REPORTED_NOT_STARTED", returnRegistered: true }), "CONFLICT", true],
    [facts({ activeDns: true, returnRegistered: true }), "CONFLICT", true],
    [facts({ activeDns: true, startState: "STARTED" }), "CONFLICT", true],
    [facts({ conflictingReports: true }), "CONFLICT", true],
    [facts({ conflictingReports: true, returnRegistered: true }), "CONFLICT", true]
  ] as const)("classifies operational facts %# without silently discarding uncertainty", (row, state, needsFollowUp) => {
    expect(buildForestWatchList(raceId, [row])).toEqual([{ entryId, state, needsFollowUp, returnRegistered: row.returnRegistered }]);
  });
  it("preserves all supplied entries, sorts deterministically and does not mutate facts", () => {
    const input = Object.freeze([Object.freeze(facts({ entryId: otherId, startState: "STARTED" })), Object.freeze(facts())]);
    const rows = buildForestWatchList(raceId, input);
    expect(rows.map(r => r.entryId)).toEqual([entryId, otherId]);
    expect(rows).toEqual(buildForestWatchList(raceId, [...input].reverse()));
    expect(input[0]?.entryId).toBe(otherId);
  });
  it("does not manufacture rows for an empty roster", () => {
    expect(buildForestWatchList(raceId, [])).toEqual([]);
  });
  it.each([null, [], {}, facts({ raceId: otherId }), facts({ entryId: "bad" }),
    { ...facts(), returnRegistered: "true" }, { ...facts(), activeDns: null },
    { ...facts(), startState: "DNS" }, { ...facts(), conflictingReports: undefined },
    { ...facts(), resultStatus: "OK" }])("rejects malformed or cross-race facts %#", value => {
    expect(() => buildForestWatchList(raceId, [value as ForestWatchEntryFacts])).toThrowError(ForestWatchInputError);
  });
  it("rejects duplicate identities rather than merging their evidence", () => {
    expect(() => buildForestWatchList(raceId, [facts(), facts({ returnRegistered: true })])).toThrowError(ForestWatchInputError);
  });
  it("rejects invalid scope, non-array or excessive input", () => {
    expect(() => buildForestWatchList("bad", [])).toThrowError(ForestWatchInputError);
    expect(() => buildForestWatchList(raceId, null as unknown as ForestWatchEntryFacts[])).toThrowError(ForestWatchInputError);
    expect(() => buildForestWatchList(raceId, Array.from({ length: 10_001 }, () => facts()))).toThrowError(ForestWatchInputError);
  });
});

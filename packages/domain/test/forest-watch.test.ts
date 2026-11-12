import { describe, expect, it } from "vitest";
import { awaitingScheduledStart, buildForestWatchList, ForestWatchInputError, remainsInForest, type ForestWatchEntryFacts,
  type RemainingInForestFacts } from "../src";

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

describe("kvar i skogen före lottad start (användartest 2026-11-12)", () => {
  const now = new Date("2026-11-12T06:20:00.000Z"); // 07:20 svensk tid
  const runner = (overrides: Partial<RemainingInForestFacts> = {}): RemainingInForestFacts => ({ forestState: "UNCONFIRMED",
    startState: "UNMARKED", fixedStartTime: "2026-11-12T06:25:00.000Z", radioPunched: false, ...overrides });

  it("räknar inte en löpare med lottad starttid framåt i tiden (minutstart eller masstart)", () => {
    expect(awaitingScheduledStart(runner(), now)).toBe(true);
    expect(remainsInForest(runner(), now)).toBe(false);
    // Masstart en kvart senare: samma starttid för alla, samma regel.
    expect(remainsInForest(runner({ fixedStartTime: "2026-11-12T06:35:00.000Z" }), now)).toBe(false);
  });

  it("räknar löparen som i dag när starttiden har passerat eller saknas (fri start)", () => {
    expect(remainsInForest(runner({ fixedStartTime: "2026-11-12T06:20:00.000Z" }), now)).toBe(true);
    expect(remainsInForest(runner(), new Date("2026-11-12T06:25:00.001Z"))).toBe(true);
    expect(remainsInForest(runner(), new Date("2026-11-13T10:00:00.000Z"))).toBe(true);
    expect(remainsInForest(runner({ fixedStartTime: null }), now)).toBe(true);
    expect(remainsInForest(runner({ fixedStartTime: undefined }), now)).toBe(true);
    expect(remainsInForest(runner({ fixedStartTime: "inte en tid" }), now)).toBe(true);
    expect(remainsInForest(runner(), new Date(Number.NaN))).toBe(true);
  });

  it("låter radiostämpling, registrerad start, konflikt och okänd avprickning gälla oavsett starttid", () => {
    expect(remainsInForest(runner({ radioPunched: true }), now)).toBe(true);
    expect(remainsInForest(runner({ forestState: "STARTED_NO_RETURN", startState: "STARTED" }), now)).toBe(true);
    expect(remainsInForest(runner({ forestState: "CONFLICT" }), now)).toBe(true);
    expect(remainsInForest(runner({ startState: undefined }), now)).toBe(true);
  });

  it("räknar aldrig återkomna eller ej startande, oavsett starttid", () => {
    expect(remainsInForest(runner({ forestState: "RETURNED" }), now)).toBe(false);
    expect(remainsInForest(runner({ forestState: "NOT_STARTED", startState: "REPORTED_NOT_STARTED" }), now)).toBe(false);
    expect(remainsInForest(runner({ forestState: "RETURNED", fixedStartTime: null }), now)).toBe(false);
  });
});

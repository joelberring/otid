import { describe, expect, it } from "vitest";
import type { EntryTransferCandidates } from "@o-tid/contracts";
import { filterAdministratorRoster, missingFixedStartTime, needsPaymentAttention,
  orderAdministratorRoster } from "./administrator-roster-filter";

type Entry = EntryTransferCandidates["entries"][number];
const classId = "20000000-0000-4000-8000-000000000001";
const fixedClassId = "20000000-0000-4000-8000-000000000002";
const classes = new Map([[classId, "Öppen 5"]]);

function entry(id: number, paymentStatus: Entry["paymentStatus"], overrides: Partial<Entry> = {}): Entry {
  return {
    id: `30000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    displayName: `Löpare ${id}`, organisationName: "Skärgårdens OK", classId, version: 1,
    paymentStatus, paymentStatusVersion: 1, resultFreshness: "CURRENT_SNAPSHOT",
    effectiveResult: { state: "ACTIVE_RESULT", selectedRevision: {
      id: "40000000-0000-4000-8000-000000000001", revision: 1 }, resultSnapshotVersion: 1,
      result: { revision: 1, status: "OK", reason: "COMPLETE", elapsedMs: 60_000 } },
    resultRevisionMarker: null, fixedStartTime: null, activeAssignment: null,
    multipleActiveAssignments: false, ...overrides,
  };
}

const allFiltersOff = { query: "", olderResultsOnly: false, rentalCardsOnly: false,
  paymentAttentionOnly: false, resultState: "ALL" as const };

describe("TASK208 gällande resultatläge i hela deltagarunderlaget", () => {
  it("skiljer varje publicerad status från inget aktivt och inget publicerat, och kombinerar äldre-filter", () => {
    const selectedRevision = { id: "40000000-0000-4000-8000-000000000001", revision: 1 };
    const statusRows = (["OK", "MP", "DNS", "DNF", "DSQ", "OOC", "NT"] as const).map((status, index) =>
      entry(index + 1, "PAID", { resultFreshness: status === "MP" ? "OLDER_SNAPSHOT" : "CURRENT_SNAPSHOT",
        effectiveResult: { state: "ACTIVE_RESULT", selectedRevision, resultSnapshotVersion: status === "MP" ? 1 : 2,
          result: status === "OK" ? { revision: 1, status, reason: "COMPLETE", elapsedMs: 60_000 } :
            status === "MP" ? { revision: 1, status, reason: "MISSING_CONTROL", elapsedMs: 60_000 } :
              status === "DNS" ? { revision: 1, status, reason: "DID_NOT_START" } :
                status === "DNF" ? { revision: 1, status, reason: "DID_NOT_FINISH" } :
                  status === "DSQ" ? { revision: 1, status, reason: "MANUAL_DISQUALIFICATION" } :
                    status === "OOC" ? { revision: 1, status, reason: "OUT_OF_COMPETITION" } :
                      { revision: 1, status, reason: "WITHOUT_TIMING" } } }));
    const rows = [...statusRows,
      entry(8, "PAID", { resultFreshness: "NO_ACTIVE_RESULT",
        effectiveResult: { state: "NO_ACTIVE_RESULT", selectedRevision } }),
      entry(9, "PAID", { resultFreshness: "NO_PUBLISHED_RESULT",
        effectiveResult: { state: "NO_PUBLISHED_RESULT", selectedRevision: null } })];
    for (const [resultState, expected] of [
      ["OK", 1], ["MP", 2], ["DNS", 3], ["DNF", 4], ["DSQ", 5], ["OOC", 6], ["NT", 7],
      ["NO_ACTIVE_RESULT", 8], ["NO_PUBLISHED_RESULT", 9]
    ] as const) expect(filterAdministratorRoster(rows, classes, { ...allFiltersOff, resultState }).map(row => row.id))
      .toEqual([rows[expected - 1]?.id]);
    expect(filterAdministratorRoster(rows, classes, { ...allFiltersOff, resultState: "ALL" })).toEqual(rows);
    expect(filterAdministratorRoster(rows, classes, { ...allFiltersOff, resultState: "MP", olderResultsOnly: true }))
      .toEqual([rows[1]]);
    expect(filterAdministratorRoster(rows, classes, { ...allFiltersOff, resultState: "OK", olderResultsOnly: true }))
      .toEqual([]);
  });
});

describe("TASK167 private roster payment-attention filter", () => {
  it("treats only unmarked and unpaid as needing review, never an unknown status", () => {
    expect(["UNMARKED", "UNPAID", "PAID", "WAIVED", "UNKNOWN"].map(needsPaymentAttention))
      .toEqual([true, true, false, false, false]);
  });

  it("combines payment review with existing name/class, older-result and rental filters", () => {
    const rows = [
      entry(1, "UNMARKED", { displayName: "Åsa Löpare", resultFreshness: "OLDER_SNAPSHOT",
        activeAssignment: { id: "40000000-0000-4000-8000-000000000001", cardNumber: "12345", isRental: true, rentalReturned: false } }),
      entry(2, "UNPAID", { displayName: "Bertil Löpare" }),
      entry(3, "PAID", { displayName: "Åsa Betald" }),
      entry(4, "WAIVED", { displayName: "Cecilia Fri" }),
    ];
    expect(filterAdministratorRoster(rows, classes, { ...allFiltersOff, paymentAttentionOnly: true }).map(row => row.id))
      .toEqual([rows[0]?.id, rows[1]?.id]);
    expect(filterAdministratorRoster(rows, classes, { ...allFiltersOff, query: "åsa öppen 5", paymentAttentionOnly: true,
      olderResultsOnly: true, rentalCardsOnly: true }).map(row => row.id)).toEqual([rows[0]?.id]);
    expect(filterAdministratorRoster(rows, classes, allFiltersOff)).toEqual(rows);
  });

  it("returns an empty review list when all entries are paid or waived", () => {
    const rows = [entry(1, "PAID"), entry(2, "WAIVED")];
    expect(filterAdministratorRoster(rows, classes, { ...allFiltersOff, paymentAttentionOnly: true })).toEqual([]);
    expect(filterAdministratorRoster(rows, classes, allFiltersOff)).toEqual(rows);
  });
});

describe("TASK201 fixed-start follow-up", () => {
  it("only flags a missing time in a fixed-start class", () => {
    const noTime = entry(1, "PAID");
    const assigned = entry(2, "PAID", { fixedStartTime: "2026-09-23T08:00:00.000Z" });
    expect(missingFixedStartTime(noTime, "FIXED")).toBe(true);
    expect(missingFixedStartTime(noTime, "PUNCH")).toBe(false);
    expect(missingFixedStartTime(noTime, undefined)).toBe(false);
    expect(missingFixedStartTime(assigned, "FIXED")).toBe(false);
  });
});

describe("TASK203 participant order before pagination", () => {
  it("keeps server name order, sorts assigned fixed times first, and preserves ties and input", () => {
    const rows = Array.from({ length: 28 }, (_, index) => entry(index + 1, "PAID"));
    rows[0] = { ...rows[0]!, classId: fixedClassId, fixedStartTime: "2026-09-23T08:00:00.000Z" };
    rows[20] = { ...rows[20]!, classId: fixedClassId, fixedStartTime: null };
    rows[25] = { ...rows[25]!, classId: fixedClassId, fixedStartTime: "2026-09-23T10:00:00.000+02:00" };
    rows[26] = { ...rows[26]!, classId: fixedClassId, fixedStartTime: "2026-09-23T07:30:00.000Z" };
    const startRules = new Map<string, { startRule: "FIXED" | "PUNCH" }>([
      [classId, { startRule: "PUNCH" }], [fixedClassId, { startRule: "FIXED" }],
    ]);
    const originalIds = rows.map(row => row.id);
    const nameOrder = orderAdministratorRoster(rows, startRules, "NAME");
    expect(nameOrder.map(row => row.id)).toEqual(originalIds);
    expect(nameOrder).not.toBe(rows);

    const sorted = orderAdministratorRoster(rows, startRules, "FIXED_START");
    expect(sorted.slice(0, 3).map(row => row.id)).toEqual([rows[26].id, rows[0].id, rows[25].id]);
    expect(sorted.slice(24, 28).map(row => row.id)).toEqual([rows[22]!.id, rows[23]!.id, rows[24]!.id, rows[27]!.id]);
    expect(rows.map(row => row.id)).toEqual(originalIds);
    const matches = filterAdministratorRoster(rows, classes, { ...allFiltersOff, query: "Löpare 2" });
    expect(orderAdministratorRoster(matches, startRules, "FIXED_START")[0]?.id).toBe(rows[26]?.id);
  });
});

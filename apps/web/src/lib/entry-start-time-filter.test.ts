import { expect, it } from "vitest";
import type { EntryStartTimeAdminListResponse } from "@o-tid/contracts";
import { filterEntryStartTimes } from "./entry-start-time-filter";
const entries: EntryStartTimeAdminListResponse["entries"] = [
  { id: "first", displayName: "Åsa Exempel", classId: "d21", className: "D21", version: 2, fixedStartTime: "2026-09-09T08:00:00.000Z" },
  { id: "second", displayName: "Åsa Exempel", classId: "open", className: "Öppen", version: 1, fixedStartTime: null }
];
it("normalizes Unicode and case without changing source order or data", () => {
  const original = structuredClone(entries);
  expect(filterEntryStartTimes(entries, " a\u030aSA ")).toEqual(entries);
  expect(filterEntryStartTimes(entries, " ")).toEqual(entries);
  expect(entries).toEqual(original);
});
it("filters class, retains missing time and does not search fabricated fields", () => {
  expect(filterEntryStartTimes(entries, "öPPEN")).toEqual([entries[1]]);
  expect(filterEntryStartTimes(entries, "d21")).toEqual([entries[0]]);
  expect(filterEntryStartTimes(entries, "null")).toEqual([]);
  expect(filterEntryStartTimes(entries, "ingen träff")).toEqual([]);
});

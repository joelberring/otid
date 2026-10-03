import { expect, it } from "vitest";
import type { EntryCardAdminListResponse } from "@o-tid/contracts";
import { filterEntryCards } from "./entry-card-filter";

const entries: EntryCardAdminListResponse["entries"] = [
  { id: "first", displayName: "Åsa Exempel", classId: "open", className: "Öppen", version: 1,
    activeAssignment: { id: "assignment", cardNumber: "123456" }, multipleActiveAssignments: false },
  { id: "second", displayName: "Åsa Exempel", classId: "d21", className: "D21", version: 1,
    activeAssignment: null, multipleActiveAssignments: true }
];
it("normalizes Unicode/case and preserves order and input", () => {
  const original = structuredClone(entries);
  expect(filterEntryCards(entries, " a\u030aSA ")).toEqual(entries);
  expect(filterEntryCards(entries, " ")).toEqual(entries);
  expect(entries).toEqual(original);
});
it("matches class or active card without fabricating ambiguous assignments", () => {
  expect(filterEntryCards(entries, "öPPEN").map(entry => entry.id)).toEqual(["first"]);
  expect(filterEntryCards(entries, "3456").map(entry => entry.id)).toEqual(["first"]);
  expect(filterEntryCards(entries, "d21").map(entry => entry.id)).toEqual(["second"]);
  expect(filterEntryCards(entries, "null")).toEqual([]);
});

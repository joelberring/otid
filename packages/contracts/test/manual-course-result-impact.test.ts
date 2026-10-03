import { expect, it } from "vitest";
import { manualCourseResultImpactResponseSchema } from "../src";

const id = "10000000-0000-4000-8000-000000000001";
const revisionId = "10000000-0000-4000-8000-000000000002";

it("TASK083 validates only one strict latest revision header per entry", () => {
  const value = {
    formatVersion: 1, raceId: id, classId: id, className: "Öppen", snapshotVersion: 2,
    course: { id, name: "Manuell", currentVersionId: id, currentVersion: 1, controlCodes: [31, 42] },
    totals: { entryCount: 2, entriesWithResults: 1, historicalResultRevisions: 3 },
    entries: [{ entryId: id, displayName: "Ada Impact", latestResultRevision: { id: revisionId, revision: 3, status: "OK", courseVersionId: id,
      snapshotVersion: 2, published: true, effectiveManualDecision: "APPROVAL" } }],
    generatedAt: "2026-09-19T12:00:00.000Z"
  };
  expect(manualCourseResultImpactResponseSchema.safeParse(value).success).toBe(true);
  expect(manualCourseResultImpactResponseSchema.safeParse({ ...value, totals: { ...value.totals, entriesWithResults: 2 } }).success).toBe(false);
  expect(manualCourseResultImpactResponseSchema.safeParse({ ...value, entries: [...value.entries, value.entries[0]] }).success).toBe(false);
  expect(manualCourseResultImpactResponseSchema.safeParse({ ...value, unexpected: true }).success).toBe(false);
});

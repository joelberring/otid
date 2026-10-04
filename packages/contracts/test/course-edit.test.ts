import { expect, it } from "vitest";
import { courseEditIdempotencyKeySchema, courseEditPreviewResponseSchema, courseEditRequestSchema,
  courseEditResponseSchema } from "../src";

const id = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const request = { formatVersion: 1, requestId: id, expectedSnapshotVersion: 3, courseId: id, controlCodes: [31, 33],
  confirmResultChanges: true };

it("Redigera bana: begäran är strikt och nyckeln binder begärans id", () => {
  expect(courseEditRequestSchema.safeParse(request).success).toBe(true);
  expect(courseEditRequestSchema.safeParse({ ...request, controlCodes: [] }).success).toBe(false);
  expect(courseEditRequestSchema.safeParse({ ...request, extra: 1 }).success).toBe(false);
  expect(courseEditIdempotencyKeySchema.safeParse(`course-edit:${id}`).success).toBe(true);
  expect(courseEditIdempotencyKeySchema.safeParse(`course:${id}`).success).toBe(false);
});

it("Redigera bana: beskedet går ihop och kräver bekräftelse bara när en status ändras", () => {
  const preview = { formatVersion: 1, raceId: id, courseId: id, courseName: "Lång", snapshotVersion: 3,
    currentControlCodes: [31, 32, 33], controlCodes: [31, 33], readOutCount: 2, becomesOkCount: 1,
    becomesMispunchedCount: 0, unchangedCount: 1, notRecalculatedCount: 0, requiresConfirmation: true,
    changes: [{ entryId: id, displayName: "Ada Löpare", className: "H21", before: "MP", after: "OK" }] };
  expect(courseEditPreviewResponseSchema.safeParse(preview).success).toBe(true);
  expect(courseEditPreviewResponseSchema.safeParse({ ...preview, requiresConfirmation: false }).success).toBe(false);
  expect(courseEditPreviewResponseSchema.safeParse({ ...preview, unchangedCount: 0 }).success).toBe(false);
});

it("Redigera bana: kvittensen binder begäran och ett steg i tävlingens version", () => {
  const response = { formatVersion: 1, replayed: false, requestId: id, raceId: id, courseId: id, request,
    previousCourseVersionId: id, courseVersionId: other, classIds: [id], snapshotVersionBefore: 3, snapshotVersionAfter: 4,
    recalculated: [{ entryId: id, resultRevisionId: other, revision: 2 }], editedAt: "2026-10-03T12:00:00.000Z" };
  expect(courseEditResponseSchema.safeParse(response).success).toBe(true);
  expect(courseEditResponseSchema.safeParse({ ...response, snapshotVersionAfter: 5 }).success).toBe(false);
  expect(courseEditResponseSchema.safeParse({ ...response, courseVersionId: id }).success).toBe(false);
});

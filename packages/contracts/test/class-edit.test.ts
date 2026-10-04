import { expect, it } from "vitest";
import { classEditIdempotencyKeySchema, classEditPreviewResponseSchema, classEditRequestSchema,
  classEditResponseSchema } from "../src";

const id = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const request = { formatVersion: 1, requestId: id, expectedSnapshotVersion: 3, classId: id, className: "H21",
  courseId: other, startRule: "PUNCH", confirmResultChanges: false };

it("Redigera klass: begäran är strikt och nyckeln binder begärans id", () => {
  expect(classEditRequestSchema.safeParse(request).success).toBe(true);
  expect(classEditRequestSchema.safeParse({ ...request, className: " " }).success).toBe(false);
  expect(classEditRequestSchema.safeParse({ ...request, startRule: "MASS" }).success).toBe(false);
  expect(classEditRequestSchema.safeParse({ ...request, extra: 1 }).success).toBe(false);
  expect(classEditIdempotencyKeySchema.safeParse(`class-edit:${id}`).success).toBe(true);
  expect(classEditIdempotencyKeySchema.safeParse(`course-edit:${id}`).success).toBe(false);
});

it("Redigera klass: beskedet går ihop och kräver bekräftelse bara när en status ändras", () => {
  const preview = { formatVersion: 1, raceId: id, classId: id, className: "H21", snapshotVersion: 3, courseId: other,
    courseName: "Kort", startRule: "PUNCH", readOutCount: 2, becomesOkCount: 1, becomesMispunchedCount: 0, unchangedCount: 1,
    notRecalculatedCount: 0, clearedStartTimeCount: 0, requiresConfirmation: true,
    changes: [{ entryId: id, displayName: "Ada Löpare", className: "H21", before: "MP", after: "OK" }] };
  expect(classEditPreviewResponseSchema.safeParse(preview).success).toBe(true);
  expect(classEditPreviewResponseSchema.safeParse({ ...preview, requiresConfirmation: false }).success).toBe(false);
  expect(classEditPreviewResponseSchema.safeParse({ ...preview, readOutCount: 3 }).success).toBe(false);
});

it("Redigera klass: kvittensen binder begäran, en verklig ändring och ett steg i tävlingens version", () => {
  const response = { formatVersion: 1, replayed: false, requestId: id, raceId: id, classId: id, request,
    previousClassName: "H21", previousCourseVersionId: id, courseVersionId: other, previousStartRule: "PUNCH",
    clearedStartTimeCount: 0, snapshotVersionBefore: 3, snapshotVersionAfter: 4,
    recalculated: [{ entryId: id, resultRevisionId: other, revision: 2 }], editedAt: "2026-10-04T12:00:00.000Z" };
  expect(classEditResponseSchema.safeParse(response).success).toBe(true);
  expect(classEditResponseSchema.safeParse({ ...response, snapshotVersionAfter: 5 }).success).toBe(false);
  expect(classEditResponseSchema.safeParse({ ...response, courseVersionId: id }).success).toBe(false);
});

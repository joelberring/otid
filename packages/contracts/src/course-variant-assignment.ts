import { z } from "zod";
import { courseEditChangeSchema, courseVariantCodeSchema } from "./course-edit";

/**
 * Gafflingar (ADR-0169 beslut 2): byt variant på en löpare (deltagarkortet) och
 * "Fördela gafflingar" i en klass. Bekräftelse krävs bara när ett resultat ändras.
 */
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const count = z.number().int().nonnegative().max(10_000);
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const recalculated = z.array(z.object({ entryId: uuid, resultRevisionId: uuid, revision: version }).strict()).max(10_000);

export const entryVariantPreviewRequestSchema = z.object({
  formatVersion: z.literal(1), expectedSnapshotVersion: version, expectedEntryVersion: version, variantCode: courseVariantCodeSchema
}).strict();

export const entryVariantPreviewResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, entryId: uuid, snapshotVersion: version,
  currentVariantCode: courseVariantCodeSchema.nullable(), variantCode: courseVariantCodeSchema,
  readOutCount: count, becomesOkCount: count, becomesMispunchedCount: count, unchangedCount: count, notRecalculatedCount: count,
  changes: z.array(courseEditChangeSchema).max(1), requiresConfirmation: z.boolean()
}).strict().superRefine((value, context) => {
  if (value.readOutCount > 1 || value.becomesOkCount + value.becomesMispunchedCount + value.unchangedCount + value.notRecalculatedCount !== value.readOutCount ||
      value.changes.length !== value.becomesOkCount + value.becomesMispunchedCount || value.requiresConfirmation !== value.changes.length > 0) {
    context.addIssue({ code: "custom", message: "Beskedet måste gå ihop" });
  }
});

export const entryVariantRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, expectedSnapshotVersion: version, expectedEntryVersion: version, entryId: uuid,
  variantCode: courseVariantCodeSchema, confirmResultChanges: z.boolean()
}).strict();

export const entryVariantIdempotencyKeySchema = z.string().regex(
  /^entry-variant:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const entryVariantResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, entryId: uuid, request: entryVariantRequestSchema,
  previousVariantCode: courseVariantCodeSchema.nullable(), entryVersionAfter: version, snapshotVersionBefore: version,
  snapshotVersionAfter: version, recalculated, changedAt: instant
}).strict().superRefine((value, context) => {
  if (value.snapshotVersionAfter !== value.snapshotVersionBefore + 1 || value.requestId !== value.request.requestId ||
      value.entryId !== value.request.entryId || value.snapshotVersionBefore !== value.request.expectedSnapshotVersion ||
      value.entryVersionAfter !== value.request.expectedEntryVersion + 1) {
    context.addIssue({ code: "custom", message: "Kvittensen måste binda begäran och versionsföljd" });
  }
});

export const classVariantDistributionRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, expectedSnapshotVersion: version, classId: uuid
}).strict();

export const classVariantDistributionIdempotencyKeySchema = z.string().regex(
  /^variant-distribution:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const classVariantDistributionResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, classId: uuid,
  request: classVariantDistributionRequestSchema, assignedCount: count, recalculatedCount: count,
  snapshotVersionBefore: version, snapshotVersionAfter: version, distributedAt: instant
}).strict().superRefine((value, context) => {
  if (value.snapshotVersionAfter !== value.snapshotVersionBefore + 1 || value.requestId !== value.request.requestId ||
      value.classId !== value.request.classId || value.snapshotVersionBefore !== value.request.expectedSnapshotVersion) {
    context.addIssue({ code: "custom", message: "Kvittensen måste binda begäran och versionsföljd" });
  }
});

export type EntryVariantPreviewRequest = z.infer<typeof entryVariantPreviewRequestSchema>;
export type EntryVariantPreviewResponse = z.infer<typeof entryVariantPreviewResponseSchema>;
export type EntryVariantRequest = z.infer<typeof entryVariantRequestSchema>;
export type EntryVariantResponse = z.infer<typeof entryVariantResponseSchema>;
export type ClassVariantDistributionRequest = z.infer<typeof classVariantDistributionRequestSchema>;
export type ClassVariantDistributionResponse = z.infer<typeof classVariantDistributionResponseSchema>;

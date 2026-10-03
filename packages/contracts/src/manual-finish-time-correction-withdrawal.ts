import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().refine((value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)));

const revisionRef = z.object({ id: uuid, revision: version }).strict();

/** Read-only proof that exactly one currently active TASK093 correction may be withdrawn. */
export const manualFinishTimeCorrectionWithdrawalCandidateSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, entryId: uuid, entryName: z.string().trim().min(1).max(321),
  entryVersion: version, classId: uuid, className: z.string().trim().min(1).max(160),
  courseVersionId: uuid, snapshotVersion: version, basisHash: sha256,
  correctionId: uuid,
  source: revisionRef.extend({ finishTime: instant }),
  corrected: revisionRef.extend({ finishTime: instant }),
  absoluteHead: revisionRef
}).strict().superRefine((value, context) => {
  if (value.corrected.id !== value.absoluteHead.id || value.corrected.revision !== value.absoluteHead.revision ||
      value.corrected.revision !== value.source.revision + 1) {
    context.addIssue({ code: "custom", message: "Återtagandet kräver den aktuella direkta rättningskedjan" });
  }
});

export const manualFinishTimeCorrectionWithdrawalRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, entryId: uuid, expectedEntryVersion: version,
  expectedClassId: uuid, expectedCourseVersionId: uuid, expectedSnapshotVersion: version, expectedBasisHash: sha256,
  expectedCorrectionId: uuid, expectedSource: revisionRef, expectedCorrected: revisionRef,
  expectedAbsoluteHead: revisionRef, acknowledgedWithdrawal: z.literal(true)
}).strict().superRefine((value, context) => {
  if (value.expectedCorrected.id !== value.expectedAbsoluteHead.id ||
      value.expectedCorrected.revision !== value.expectedAbsoluteHead.revision ||
      value.expectedCorrected.revision !== value.expectedSource.revision + 1) {
    context.addIssue({ code: "custom", message: "Intentet måste binda den direkta rättningskedjan" });
  }
});

export const manualFinishTimeCorrectionWithdrawalIdempotencyKeySchema = z.string().regex(
  /^manual-finish-time-correction-withdrawal:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
);

export const manualFinishTimeCorrectionWithdrawalResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, withdrawalId: uuid,
  raceId: uuid, entryId: uuid, classId: uuid, courseVersionId: uuid, snapshotVersion: version,
  correctionId: uuid, source: revisionRef.extend({ finishTime: instant }), corrected: revisionRef.extend({ finishTime: instant }),
  created: revisionRef.extend({ finishTime: instant }),
  cause: z.literal("MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL"),
  request: manualFinishTimeCorrectionWithdrawalRequestSchema, withdrawnAt: instant
}).strict().superRefine((value, context) => {
  if (value.requestId !== value.request.requestId || value.entryId !== value.request.entryId ||
      value.correctionId !== value.request.expectedCorrectionId ||
      value.source.id !== value.request.expectedSource.id || value.corrected.id !== value.request.expectedCorrected.id ||
      value.created.revision !== value.corrected.revision + 1 || value.created.finishTime !== value.source.finishTime) {
    context.addIssue({ code: "custom", message: "Kvittensen måste återställa exakt granskat tekniskt utfall" });
  }
});

export type ManualFinishTimeCorrectionWithdrawalCandidate = z.infer<typeof manualFinishTimeCorrectionWithdrawalCandidateSchema>;
export type ManualFinishTimeCorrectionWithdrawalRequest = z.infer<typeof manualFinishTimeCorrectionWithdrawalRequestSchema>;
export type ManualFinishTimeCorrectionWithdrawalResponse = z.infer<typeof manualFinishTimeCorrectionWithdrawalResponseSchema>;

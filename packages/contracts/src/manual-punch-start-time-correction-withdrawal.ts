import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().refine((value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)));
const revisionRef = z.object({ id: uuid, revision: version }).strict();

export const manualPunchStartTimeCorrectionWithdrawalCandidateSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, entryId: uuid, entryName: z.string().trim().min(1).max(321),
  entryVersion: version, classId: uuid, className: z.string().trim().min(1).max(160),
  courseVersionId: uuid, snapshotVersion: version, basisHash: sha256, correctionId: uuid,
  source: revisionRef.extend({ startTime: instant }), corrected: revisionRef.extend({ startTime: instant }), absoluteHead: revisionRef
}).strict().superRefine((value, context) => {
  if (value.corrected.id !== value.absoluteHead.id || value.corrected.revision !== value.absoluteHead.revision || value.corrected.revision !== value.source.revision + 1) context.addIssue({ code: "custom", message: "Återtagandet kräver den aktuella direkta starttidsrättningskedjan" });
});

export const manualPunchStartTimeCorrectionWithdrawalRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, entryId: uuid, expectedEntryVersion: version, expectedClassId: uuid,
  expectedCourseVersionId: uuid, expectedSnapshotVersion: version, expectedBasisHash: sha256, expectedCorrectionId: uuid,
  expectedSource: revisionRef, expectedCorrected: revisionRef, expectedAbsoluteHead: revisionRef, acknowledgedWithdrawal: z.literal(true)
}).strict().superRefine((value, context) => {
  if (value.expectedCorrected.id !== value.expectedAbsoluteHead.id || value.expectedCorrected.revision !== value.expectedAbsoluteHead.revision || value.expectedCorrected.revision !== value.expectedSource.revision + 1) context.addIssue({ code: "custom", message: "Intentet måste binda den direkta starttidsrättningskedjan" });
});

export const manualPunchStartTimeCorrectionWithdrawalIdempotencyKeySchema = z.string().regex(/^manual-punch-start-time-correction-withdrawal:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const manualPunchStartTimeCorrectionWithdrawalResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, withdrawalId: uuid, raceId: uuid, entryId: uuid,
  classId: uuid, courseVersionId: uuid, snapshotVersion: version, correctionId: uuid,
  source: revisionRef.extend({ startTime: instant }), corrected: revisionRef.extend({ startTime: instant }), created: revisionRef.extend({ startTime: instant }),
  cause: z.literal("MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL"), request: manualPunchStartTimeCorrectionWithdrawalRequestSchema, withdrawnAt: instant
}).strict().superRefine((value, context) => {
  if (value.requestId !== value.request.requestId || value.entryId !== value.request.entryId || value.correctionId !== value.request.expectedCorrectionId || value.source.id !== value.request.expectedSource.id || value.corrected.id !== value.request.expectedCorrected.id || value.created.revision !== value.corrected.revision + 1 || value.created.startTime !== value.source.startTime) context.addIssue({ code: "custom", message: "Kvittensen måste återställa exakt granskat tekniskt utfall" });
});

export type ManualPunchStartTimeCorrectionWithdrawalCandidate = z.infer<typeof manualPunchStartTimeCorrectionWithdrawalCandidateSchema>;
export type ManualPunchStartTimeCorrectionWithdrawalRequest = z.infer<typeof manualPunchStartTimeCorrectionWithdrawalRequestSchema>;
export type ManualPunchStartTimeCorrectionWithdrawalResponse = z.infer<typeof manualPunchStartTimeCorrectionWithdrawalResponseSchema>;

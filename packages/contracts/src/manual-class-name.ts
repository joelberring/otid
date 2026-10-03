import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const exactName = z.string().min(1).max(160);
const newName = z.string().trim().min(1).max(160);
const utcMilliseconds = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine(value =>
  Number(value.slice(0, 4)) >= 1 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);

export const manualClassNameCandidateSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, classId: uuid, snapshotVersion: version,
  className: exactName, courseVersionId: uuid, editable: z.boolean()
}).strict();

export const manualClassNameChangeRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, expectedSnapshotVersion: version,
  expectedClassName: exactName, className: newName
}).strict();

export const manualClassNameChangeIdempotencyKeySchema = z.string().regex(
  /^manual-class-name:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const manualClassNameChangeResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid,
  classId: uuid, courseVersionId: uuid, previousClassName: exactName, className: newName,
  request: manualClassNameChangeRequestSchema,
  snapshotVersionBefore: version, snapshotVersionAfter: version, changedAt: utcMilliseconds
}).strict().superRefine((value, context) => {
  if (value.requestId !== value.request.requestId || value.previousClassName !== value.request.expectedClassName ||
    value.className !== value.request.className || value.snapshotVersionBefore !== value.request.expectedSnapshotVersion) {
    context.addIssue({ code: "custom", path: ["request"], message: "Kvittensen måste binda det granskade namnbytet" });
  }
  if (value.snapshotVersionAfter !== value.snapshotVersionBefore + 1) {
    context.addIssue({ code: "custom", path: ["snapshotVersionAfter"], message: "Snapshotversionen måste öka exakt ett steg" });
  }
});

export type ManualClassNameCandidate = z.infer<typeof manualClassNameCandidateSchema>;
export type ManualClassNameChangeRequest = z.infer<typeof manualClassNameChangeRequestSchema>;
export type ManualClassNameChangeResponse = z.infer<typeof manualClassNameChangeResponseSchema>;

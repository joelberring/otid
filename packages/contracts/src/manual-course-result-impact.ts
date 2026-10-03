import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const controlCode = z.number().int().positive().max(2_147_483_647);
const instant = z.iso.datetime({ precision: 3 });

export const manualCourseResultImpactDecisionSchema = z.enum([
  "NONE", "DNS", "CHECKIN_DNS", "DSQ", "APPROVAL", "DNF", "OOC", "NT"
]);

const latestRevisionSchema = z.object({
  id: uuid,
  revision: version,
  status: z.string().trim().min(1).max(64),
  courseVersionId: uuid,
  snapshotVersion: version,
  published: z.boolean(),
  effectiveManualDecision: manualCourseResultImpactDecisionSchema
}).strict();

const impactEntrySchema = z.object({
  entryId: uuid,
  displayName: z.string().trim().min(1).max(321),
  latestResultRevision: latestRevisionSchema
}).strict();

export const manualCourseResultImpactResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  classId: uuid,
  className: z.string().trim().min(1).max(160),
  course: z.object({
    id: uuid,
    name: z.string().trim().min(1).max(160),
    currentVersionId: uuid,
    currentVersion: version,
    controlCodes: z.array(controlCode).min(1).max(1000)
  }).strict(),
  snapshotVersion: version,
  totals: z.object({
    entryCount: z.number().int().nonnegative().max(10_000),
    entriesWithResults: z.number().int().nonnegative().max(10_000),
    historicalResultRevisions: z.number().int().nonnegative()
  }).strict(),
  entries: z.array(impactEntrySchema).max(10_000),
  generatedAt: instant
}).strict().superRefine((value, context) => {
  if (value.totals.entriesWithResults !== value.entries.length ||
      value.totals.entriesWithResults > value.totals.entryCount ||
      value.totals.historicalResultRevisions < value.totals.entriesWithResults) {
    context.addIssue({ code: "custom", path: ["totals"], message: "Påverkanstotalerna stämmer inte" });
  }
  if (new Set(value.entries.map(entry => entry.entryId)).size !== value.entries.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Varje deltagare får bara ha ett senaste revisionshuvud" });
  }
});

export type ManualCourseResultImpactResponse = z.infer<typeof manualCourseResultImpactResponseSchema>;

import { z } from "zod";

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Id måste vara ett kanoniskt gemener-UUID"
);
const positiveVersionSchema = z.number().int().positive();
const aggregateCountSchema = z.number().int().nonnegative();
const nameSchema = z.string().trim().min(1).max(160);
const instantSchema = z.iso.datetime({ offset: true });

export const raceOverviewAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_race_overview_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const raceOverviewAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  capability: z.literal("VIEW_RACE_OVERVIEW"),
  expiresAt: instantSchema
}).strict();

const raceOverviewRaceSchema = z.object({
  id: canonicalUuidSchema,
  eventName: nameSchema,
  name: nameSchema,
  raceDate: z.iso.date(),
  timeZone: z.string().trim().min(1).max(100),
  snapshotVersion: positiveVersionSchema
}).strict();

const raceOverviewClassSchema = z.object({
  id: canonicalUuidSchema,
  name: nameSchema,
  startRule: z.enum(["FIXED", "PUNCH"]),
  entryCount: aggregateCountSchema
}).strict();

const raceOverviewCourseSchema = z.object({
  id: canonicalUuidSchema,
  name: nameSchema
}).strict();

const raceOverviewCountsSchema = z.object({
  classes: aggregateCountSchema,
  courses: aggregateCountSchema,
  entries: aggregateCountSchema,
  activeCardAssignments: aggregateCountSchema,
  readouts: aggregateCountSchema,
  resultRevisions: aggregateCountSchema,
  imports: aggregateCountSchema
}).strict();

const raceOverviewLatestActivitySchema = z.object({
  readoutAt: instantSchema.nullable(),
  resultRevisionAt: instantSchema.nullable(),
  importAt: instantSchema.nullable()
}).strict();

export const raceOverviewResponseSchema = z.object({
  formatVersion: z.literal(1),
  race: raceOverviewRaceSchema,
  classes: z.array(raceOverviewClassSchema).max(1000),
  courses: z.array(raceOverviewCourseSchema).max(1000),
  counts: raceOverviewCountsSchema,
  latestActivity: raceOverviewLatestActivitySchema
}).strict().superRefine((response, context) => {
  const classIds = new Set(response.classes.map((raceClass) => raceClass.id));
  if (classIds.size !== response.classes.length) {
    context.addIssue({ code: "custom", path: ["classes"], message: "Klass-id måste vara unika" });
  }
  const courseIds = new Set(response.courses.map((course) => course.id));
  if (courseIds.size !== response.courses.length) {
    context.addIssue({ code: "custom", path: ["courses"], message: "Ban-id måste vara unika" });
  }
  if (response.counts.classes !== response.classes.length) {
    context.addIssue({ code: "custom", path: ["counts", "classes"], message: "Klassantalet måste matcha listan" });
  }
  if (response.counts.courses !== response.courses.length) {
    context.addIssue({ code: "custom", path: ["counts", "courses"], message: "Banantalet måste matcha listan" });
  }
  const classEntryCount = response.classes.reduce((sum, raceClass) => sum + raceClass.entryCount, 0);
  if (!Number.isSafeInteger(classEntryCount) || response.counts.entries !== classEntryCount) {
    context.addIssue({ code: "custom", path: ["counts", "entries"], message: "Deltagarantalet måste matcha klassaggregaten" });
  }
});

export const raceOverviewAdminErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INTERNAL_ERROR"
]);

export const raceOverviewAdminErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: raceOverviewAdminErrorCodeSchema
}).strict();

export type RaceOverviewAdminLoginRequest = z.infer<typeof raceOverviewAdminLoginRequestSchema>;
export type RaceOverviewAdminLoginResponse = z.infer<typeof raceOverviewAdminLoginResponseSchema>;
export type RaceOverviewResponse = z.infer<typeof raceOverviewResponseSchema>;
export type RaceOverviewAdminErrorCode = z.infer<typeof raceOverviewAdminErrorCodeSchema>;
export type RaceOverviewAdminErrorResponse = z.infer<typeof raceOverviewAdminErrorResponseSchema>;

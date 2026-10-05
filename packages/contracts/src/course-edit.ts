import { z } from "zod";
import { rogainingSetupSchema } from "./rogaining";

/** Redigera bana (ADR-0169): ett ställe för att ändra en banas kontrollföljd, även när löpare läst ut. */
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const count = z.number().int().nonnegative().max(10_000);
const name = z.string().trim().min(1).max(160);
const controlCode = z.number().int().positive().max(2_147_483_647);
const controlCodes = z.array(controlCode).min(1).max(1000);
const status = z.enum(["OK", "MP"]);
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
/** ADR-0169 beslut 2: variantens kod, t.ex. "AC". */
export const courseVariantCodeSchema = z.string().min(1).max(32).refine(value => value === value.trim(), "Koden får inte börja eller sluta med blanksteg");
const legPoint = z.union([z.literal("START"), z.literal("FINISH"), controlCode]);

export const courseEditListResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, snapshotVersion: version,
  courses: z.array(z.object({
    courseId: uuid, courseVersionId: uuid, name, controlCodes: z.array(controlCode).max(1000),
    classes: z.array(z.object({ classId: uuid, name }).strict()).max(1000),
    entryCount: count, readOutCount: count,
    // Gafflad bana: varianterna med kontrollföljd och löpare. Tom lista = inte gafflad.
    variants: z.array(z.object({ code: courseVariantCodeSchema, controlCodes, entryCount: count, readOutCount: count }).strict()).max(100),
    // Gafflingskontroll: sträckor som inte finns lika många gånger i alla varianter.
    unevenLegs: z.array(z.object({ from: legPoint, to: legPoint, variantCodes: z.array(courseVariantCodeSchema).max(1000) }).strict()).max(1000)
  }).strict()).max(1000),
  // ADR-0169 beslut 4: klasserna som tabell (bana, startsätt, anmälda, avlästa/resultat, status).
  classes: z.array(z.object({
    classId: uuid, name, courseId: uuid, startRule: z.enum(["PUNCH", "FIXED"]), entryCount: count, readOutCount: count,
    resultCount: count, missingStartTimeCount: count, renamable: z.boolean(),
    // Gafflad klass: antal varianter och löpare utan variant ("Fördela gafflingar").
    variantCount: count, missingVariantCount: count
  }).strict()).max(1000),
  // ADR-0170 beslut 5: kontrollernas poäng och klassernas rogainingregler ("Kontroller & poäng").
  rogaining: rogainingSetupSchema
}).strict();

export const courseEditPreviewRequestSchema = z.object({
  formatVersion: z.literal(1), expectedSnapshotVersion: version, controlCodes, variantCode: courseVariantCodeSchema.optional()
}).strict();

export const courseEditChangeSchema = z.object({
  entryId: uuid, displayName: z.string().min(1).max(400), className: name, before: status, after: status
}).strict();

export const courseEditPreviewResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, courseId: uuid, courseName: name, snapshotVersion: version,
  variantCode: courseVariantCodeSchema.optional(), currentControlCodes: z.array(controlCode).max(1000), controlCodes,
  readOutCount: count, becomesOkCount: count, becomesMispunchedCount: count, unchangedCount: count,
  notRecalculatedCount: count, changes: z.array(courseEditChangeSchema).max(10_000), requiresConfirmation: z.boolean()
}).strict().superRefine((value, context) => {
  if (value.becomesOkCount + value.becomesMispunchedCount + value.unchangedCount + value.notRecalculatedCount !== value.readOutCount ||
      value.changes.length !== value.becomesOkCount + value.becomesMispunchedCount ||
      value.requiresConfirmation !== value.changes.length > 0) {
    context.addIssue({ code: "custom", message: "Beskedet måste gå ihop" });
  }
});

export const courseEditRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, expectedSnapshotVersion: version, courseId: uuid, controlCodes,
  variantCode: courseVariantCodeSchema.optional(), confirmResultChanges: z.boolean()
}).strict();

export const courseEditIdempotencyKeySchema = z.string().regex(
  /^course-edit:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const courseEditResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, courseId: uuid,
  request: courseEditRequestSchema, previousCourseVersionId: uuid, courseVersionId: uuid,
  classIds: z.array(uuid).max(1000), snapshotVersionBefore: version, snapshotVersionAfter: version,
  recalculated: z.array(z.object({ entryId: uuid, resultRevisionId: uuid, revision: version }).strict()).max(10_000),
  editedAt: instant
}).strict().superRefine((value, context) => {
  if (value.snapshotVersionAfter !== value.snapshotVersionBefore + 1 || value.requestId !== value.request.requestId ||
      value.courseId !== value.request.courseId || value.snapshotVersionBefore !== value.request.expectedSnapshotVersion ||
      value.previousCourseVersionId === value.courseVersionId) {
    context.addIssue({ code: "custom", message: "Kvittensen måste binda begäran och versionsföljd" });
  }
});

export type CourseEditListResponse = z.infer<typeof courseEditListResponseSchema>;
export type CourseEditPreviewRequest = z.infer<typeof courseEditPreviewRequestSchema>;
export type CourseEditPreviewResponse = z.infer<typeof courseEditPreviewResponseSchema>;
export type CourseEditRequest = z.infer<typeof courseEditRequestSchema>;
export type CourseEditResponse = z.infer<typeof courseEditResponseSchema>;

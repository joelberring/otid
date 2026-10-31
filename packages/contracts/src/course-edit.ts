import { z } from "zod";
import { rogainingSetupSchema } from "./rogaining";
import { prefixedUuidPattern, uuidSchema as uuid } from "./ids";
import { courseForkingSchema, courseForkingViewSchema, forkingModeSchema } from "./course-forking";

/** Redigera bana (ADR-0169): ett ställe för att ändra en banas kontrollföljd, även när löpare läst ut. */
const version = z.number().int().positive().max(2_147_483_647);
const count = z.number().int().nonnegative().max(10_000);
const name = z.string().trim().min(1).max(160);
const controlCode = z.number().int().positive().max(2_147_483_647);
const controlCodes = z.array(controlCode).min(1).max(1000);
const status = z.enum(["OK", "OVERTIME", "MP"]);
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
/** ADR-0169 beslut 2: variantens kod, t.ex. "AC". */
export const courseVariantCodeSchema = z.string().min(1).max(32).refine(value => value === value.trim(), "Koden får inte börja eller sluta med blanksteg");
const legPoint = z.union([z.literal("START"), z.literal("FINISH"), controlCode]);

export const courseEditListResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, snapshotVersion: version,
  courses: z.array(z.object({
    courseId: uuid, courseVersionId: uuid, name, controlCodes: z.array(controlCode).max(1000),
    /** Längd och stigning i meter (PLAN.md steg 25); null när de inte är kända. */
    lengthMeters: z.number().int().min(1).max(1_000_000).nullable().optional(),
    climbMeters: z.number().int().min(0).max(100_000).nullable().optional(),
    classes: z.array(z.object({ classId: uuid, name }).strict()).max(1000),
    entryCount: count, readOutCount: count,
    // Gafflad bana: varianterna med kontrollföljd och löpare. Tom lista = inte gafflad.
    variants: z.array(z.object({ code: courseVariantCodeSchema, controlCodes, entryCount: count, readOutCount: count,
      /** Steg 49: variantens längd i meter när den är känd. */
      lengthMeters: z.number().int().min(1).max(1_000_000).nullable().optional() }).strict()).max(100),
    // Gafflingskontroll: sträckor som inte finns lika många gånger i alla varianter.
    unevenLegs: z.array(z.object({ from: legPoint, to: legPoint, variantCodes: z.array(courseVariantCodeSchema).max(1000) }).strict()).max(1000),
    /**
     * Steg 49: strukturen (sparad, eller härledd ur varianterna) med varje variants val, för bilden. `stored` = sparad
     * struktur; `convertible` = den härledda strukturen klarar reglerna ("Gör om till struktur"), `addedCount` = varianter
     * som tillkommer då. Null för en bana utan varianter.
     */
    forking: courseForkingViewSchema.extend({ stored: z.boolean(), convertible: z.boolean(), addedCount: count }).nullable().optional(),
    forkingMode: forkingModeSchema.optional(),
    /** Steg 49: rättvisekontrollen per gafflingssätt (stoppar aldrig att banan sparas eller används). */
    fairness: z.object({ level: z.enum(["NONE", "NOTICE", "WARNING"]),
      warningLegs: z.array(z.object({ from: legPoint, to: legPoint, variantCodes: z.array(courseVariantCodeSchema).max(1000) }).strict()).max(1000),
      noticeLegs: z.array(z.object({ from: legPoint, to: legPoint, variantCodes: z.array(courseVariantCodeSchema).max(1000) }).strict()).max(1000),
      shortestMeters: z.number().int().min(1).max(1_000_000).nullable(), longestMeters: z.number().int().min(1).max(1_000_000).nullable()
    }).strict().optional(),
    /** Steg 61: kontrollen före tävlingen (domänens `forkingReadiness`). Saknas för ogafflade banor och stafettbanor. */
    readiness: z.object({ ok: z.boolean(), variantCount: count, tooManyVariants: z.boolean(), tooManyLetters: z.boolean(),
      unusedVariants: z.array(courseVariantCodeSchema).max(1000), unusedExpected: z.boolean(),
      missingVariant: z.array(z.object({ className: name, count }).strict()).max(1000),
      uneven: z.array(z.object({ className: name, point: z.number().int().min(1).max(1000),
        counts: z.array(z.object({ letters: z.string().min(1).max(32), count }).strict()).max(100) }).strict()).max(1000)
    }).strict().optional()
  }).strict()).max(1000),
  // ADR-0169 beslut 4: klasserna som tabell (bana, startsätt, anmälda, avlästa/resultat, status).
  classes: z.array(z.object({
    classId: uuid, name, courseId: uuid, startRule: z.enum(["PUNCH", "FIXED"]), entryCount: count, readOutCount: count,
    resultCount: count, missingStartTimeCount: count, renamable: z.boolean(),
    // Gafflad klass: antal varianter och löpare utan variant ("Fördela gafflingar").
    variantCount: count, missingVariantCount: count,
    /** Maxtid i minuter (PLAN.md steg 25); null = ingen. Rogainingklasser har egen tidsgräns och ingen maxtid. */
    maxTimeMinutes: z.number().int().min(1).max(1440).nullable().optional(), rogaining: z.boolean().optional()
  }).strict()).max(1000),
  // ADR-0170 beslut 5: kontrollernas poäng och klassernas rogainingregler ("Kontroller & poäng").
  rogaining: rogainingSetupSchema
}).strict();

/** Steg 49: en ny struktur ersätter banans kontroller och varianter; då anges varken kontroller eller variant. */
const forkingOrControls = (value: { controlCodes?: unknown; variantCode?: unknown; forking?: unknown }, context: z.RefinementCtx) => {
  if (value.forking === undefined ? value.controlCodes === undefined : value.controlCodes !== undefined || value.variantCode !== undefined) {
    context.addIssue({ code: "custom", message: "Ange kontroller eller en gafflingsstruktur" });
  }
};

export const courseEditPreviewRequestSchema = z.object({
  formatVersion: z.literal(1), controlCodes: controlCodes.optional(), variantCode: courseVariantCodeSchema.optional(),
  forking: courseForkingSchema.optional()
}).strict().superRefine(forkingOrControls);

export const courseEditChangeSchema = z.object({
  entryId: uuid, displayName: z.string().min(1).max(400), className: name, before: status, after: status
}).strict();

export const courseEditPreviewResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, courseId: uuid, courseName: name, snapshotVersion: version,
  variantCode: courseVariantCodeSchema.optional(), currentControlCodes: z.array(controlCode).max(1000),
  /** Tom när en gafflingsstruktur prövas (varianterna står då i `forking`). */
  controlCodes: z.array(controlCode).max(1000),
  /**
   * Steg 49: varianterna som strukturen ger, med koden som samma kontrollföljd hade förut (`previousCode`), koderna som
   * försvinner, löpare som behåller sin kontrollföljd under en ny kod och löpare som får en ny variant.
   */
  forking: z.object({
    variants: z.array(z.object({ code: courseVariantCodeSchema, controlCodes, previousCode: courseVariantCodeSchema.nullable() }).strict()).max(100),
    removedCodes: z.array(courseVariantCodeSchema).max(100), renamedEntryCount: count, reassignedEntryCount: count
  }).strict().optional(),
  readOutCount: count, becomesOkCount: count, becomesMispunchedCount: count, unchangedCount: count,
  notRecalculatedCount: count, changes: z.array(courseEditChangeSchema).max(10_000), requiresConfirmation: z.boolean(),
  /** Steg 44: avlästa löpare med ett manuellt beslut (manuell tid, godkänt, brutit …) som följer med till den nya banan. */
  manualDecisionCount: count
}).strict().superRefine((value, context) => {
  if (value.manualDecisionCount > value.readOutCount) context.addIssue({ code: "custom", message: "Beskedet måste gå ihop" });
  if (value.becomesOkCount + value.becomesMispunchedCount + value.unchangedCount + value.notRecalculatedCount !== value.readOutCount ||
      value.changes.length !== value.becomesOkCount + value.becomesMispunchedCount ||
      value.requiresConfirmation !== value.changes.length > 0) {
    context.addIssue({ code: "custom", message: "Beskedet måste gå ihop" });
  }
});

export const courseEditRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, courseId: uuid, controlCodes: controlCodes.optional(),
  variantCode: courseVariantCodeSchema.optional(), forking: courseForkingSchema.optional(), confirmResultChanges: z.boolean()
}).strict().superRefine(forkingOrControls);

export const courseEditIdempotencyKeySchema = z.string().regex(
  prefixedUuidPattern("course-edit"));

export const courseEditResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, courseId: uuid,
  request: courseEditRequestSchema, previousCourseVersionId: uuid, courseVersionId: uuid,
  classIds: z.array(uuid).max(1000), snapshotVersionBefore: version, snapshotVersionAfter: version,
  recalculated: z.array(z.object({ entryId: uuid, resultRevisionId: uuid, revision: version }).strict()).max(10_000),
  editedAt: instant
}).strict().superRefine((value, context) => {
  if (value.snapshotVersionAfter !== value.snapshotVersionBefore + 1 || value.requestId !== value.request.requestId ||
      value.courseId !== value.request.courseId ||
      value.previousCourseVersionId === value.courseVersionId) {
    context.addIssue({ code: "custom", message: "Kvittensen måste binda begäran och versionsföljd" });
  }
});

/**
 * Banans längd och stigning (PLAN.md steg 25). Uppgifterna påverkar inga resultat och sparas direkt (ADR-0169 beslut 4).
 */
export const courseDetailsRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, courseId: uuid,
  lengthMeters: z.number().int().min(1).max(1_000_000).nullable(),
  climbMeters: z.number().int().min(0).max(100_000).nullable(),
  /** Steg 49: gafflingssätt (utjämnad eller fulgaffling); påverkar bara rättvisekontrollen. */
  forkingMode: forkingModeSchema.optional()
}).strict();
export const courseDetailsIdempotencyKeySchema = z.string().regex(prefixedUuidPattern("course-details"));
export const courseDetailsResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, request: courseDetailsRequestSchema,
  savedAt: instant
}).strict();
export type CourseDetailsRequest = z.infer<typeof courseDetailsRequestSchema>;
export type CourseDetailsResponse = z.infer<typeof courseDetailsResponseSchema>;

export type CourseEditListResponse = z.infer<typeof courseEditListResponseSchema>;
export type CourseEditPreviewRequest = z.infer<typeof courseEditPreviewRequestSchema>;
export type CourseEditPreviewResponse = z.infer<typeof courseEditPreviewResponseSchema>;
export type CourseEditRequest = z.infer<typeof courseEditRequestSchema>;
export type CourseEditResponse = z.infer<typeof courseEditResponseSchema>;

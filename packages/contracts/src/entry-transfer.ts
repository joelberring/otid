import { z } from "zod";
import { fixedStartTimeSchema } from "./entry-start-time-admin";
import { classMaxEntriesSchema } from "./class-capacity";
import { entryPaymentStatusSchema } from "./entry-payment-status-admin";
import { speakerBoardEffectiveResultSchema } from "./speaker-board";
import { courseVariantCodeSchema } from "./course-edit";
import { raceTypeSchema } from "./race-settings";
import { racePublicationStateSchema } from "./race-publication";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const startRule = z.enum(["FIXED", "PUNCH"]);
export const entryTransferResultFreshnessSchema = z.enum([
  "NO_PUBLISHED_RESULT",
  "NO_ACTIVE_RESULT",
  "CURRENT_SNAPSHOT",
  "OLDER_SNAPSHOT"
]);
const selectedResultRevisionSchema = z.object({ id: uuid, revision: version }).strict();
export const entryTransferEffectiveResultSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("NO_PUBLISHED_RESULT"), selectedRevision: z.null() }).strict(),
  z.object({ state: z.literal("NO_ACTIVE_RESULT"), selectedRevision: selectedResultRevisionSchema }).strict(),
  z.object({ state: z.literal("ACTIVE_RESULT"), selectedRevision: selectedResultRevisionSchema,
    resultSnapshotVersion: version, result: speakerBoardEffectiveResultSchema }).strict()
]).superRefine((value, context) => {
  if (value.state === "ACTIVE_RESULT" && value.result.revision > value.selectedRevision.revision) {
    context.addIssue({ code: "custom", path: ["result", "revision"], message: "Gällande revision är nyare än valt publicerat huvud" });
  }
});
export const entryTransferResultRevisionMarkerSchema = z.enum([
  "MANUAL_FINISH_TIME_CORRECTION",
  "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL"
]);
export const entryTransferRequestSchema = z.object({
  formatVersion: z.literal(1), expectedEntryVersion: version, expectedClassId: uuid,
  expectedSnapshotVersion: version, expectedFixedStartTime: fixedStartTimeSchema.nullable(),
  targetClassId: uuid, expectedTargetCourseVersionId: uuid, expectedTargetStartRule: startRule,
  fixedStartTime: fixedStartTimeSchema.nullable()
}).strict().refine(value => value.expectedClassId !== value.targetClassId &&
  (value.expectedTargetStartRule === "FIXED" ? value.fixedStartTime !== null : value.fixedStartTime === null));

export const entryTransferCandidatesSchema = z.object({
  formatVersion: z.literal(2), raceId: uuid, eventName: z.string().trim().min(1).max(160),
  raceName: z.string().trim().min(1).max(160), snapshotVersion: version, raceDate: z.iso.date(),
  /** ADR-0170: tävlingstypen styr vilka delar arbetsytan visar. */
  raceType: raceTypeSchema,
  /** ADR-0172 beslut 4: publicerad tävling och kort adress till tävlingssidan. */
  publication: racePublicationStateSchema,
  generatedAt: z.iso.datetime({ offset: true }),
  timeZone: z.string().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat("sv-SE", { timeZone: value }); return true; } catch { return false; }
  }),
  classes: z.array(z.object({ id: uuid, name: z.string().min(1).max(160), courseVersionId: uuid,
    courseName: z.string().trim().min(1).max(160), courseVersion: version, startRule,
    maxEntries: classMaxEntriesSchema, capacityVersion: version, entryCount: z.number().int().min(0).max(10_000),
    /** Klassen har en gällande lottning: efteranmälda får en tid av appen (PLAN.md steg 9). */
    startDrawn: z.boolean(),
    /** Gafflad klass: banans varianter i visningsordning (ADR-0169 beslut 2). Tom = inte gafflad. */
    courseVariants: z.array(courseVariantCodeSchema).max(100),
    /** Stafettklass (ADR-0169 beslut 3): antal sträckor. Saknas för individuella klasser. */
    relayLegCount: z.number().int().min(2).max(20).optional(),
    /** Startlistorna (PLAN.md steg 13): första kontroll (startfålla), lottningens startsätt och vakanta tider. */
    firstControlCode: z.number().int().positive().max(2_147_483_647).nullable().optional(),
    drawMethod: z.enum(["MINUTE", "MASS"]).nullable().optional(),
    vacancies: z.array(z.iso.datetime({ offset: true })).max(10_000).optional()
  }).strict()).max(1000),
  entries: z.array(z.object({ id: uuid, displayName: z.string().min(1).max(321),
    organisationName: z.string().min(1).max(240).nullable(), classId: uuid, version,
    paymentStatus: entryPaymentStatusSchema, paymentStatusVersion: version,
    resultFreshness: entryTransferResultFreshnessSchema,
    effectiveResult: entryTransferEffectiveResultSchema,
    resultRevisionMarker: entryTransferResultRevisionMarkerSchema.nullable(),
    fixedStartTime: fixedStartTimeSchema.nullable(),
    /** Löparens variant; null = ingen tilldelad variant. */
    courseVariantCode: courseVariantCodeSchema.nullable(),
    /** Sträcklöpare i en stafettklass: laget och sträckan. */
    relay: z.object({ teamId: uuid, teamNumber: z.number().int().min(1).max(99_999), teamName: z.string().min(1).max(160),
      leg: z.number().int().min(1).max(20) }).strict().optional(),
    activeAssignment: z.object({ id: uuid, cardNumber: z.string().min(1).max(32), isRental: z.boolean(),
      rentalReturned: z.boolean() }).strict().nullable(),
    multipleActiveAssignments: z.boolean()
  }).strict().refine(row => !row.multipleActiveAssignments || row.activeAssignment === null)).max(10_000)
}).strict().refine(value => {
  const classes = new Set(value.classes.map(row => row.id));
  return classes.size === value.classes.length && new Set(value.entries.map(row => row.id)).size === value.entries.length &&
    value.entries.every(row => classes.has(row.classId) && (
      row.effectiveResult.state === "NO_PUBLISHED_RESULT" ? row.resultFreshness === "NO_PUBLISHED_RESULT" :
      row.effectiveResult.state === "NO_ACTIVE_RESULT" ? row.resultFreshness === "NO_ACTIVE_RESULT" :
      // ADR-0169: aktualiteten avgörs av löparens eget underlag, inte av tävlingsversionen.
      row.effectiveResult.resultSnapshotVersion <= value.snapshotVersion &&
        (row.resultFreshness === "CURRENT_SNAPSHOT" || row.resultFreshness === "OLDER_SNAPSHOT")
    ));
});
export const entryTransferIdempotencyKeySchema = z.string().regex(
  /^entry-transfer:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const entryTransferResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, entryId: uuid,
  request: entryTransferRequestSchema, entryVersionAfter: version, snapshotVersionAfter: version,
  changedAt: z.iso.datetime({ offset: true })
}).strict().refine(value => value.entryVersionAfter === value.request.expectedEntryVersion + 1 &&
  value.snapshotVersionAfter === value.request.expectedSnapshotVersion + 1);
export type EntryTransferRequest = z.infer<typeof entryTransferRequestSchema>;
export type EntryTransferResultFreshness = z.infer<typeof entryTransferResultFreshnessSchema>;
export type EntryTransferResultRevisionMarker = z.infer<typeof entryTransferResultRevisionMarkerSchema>;
export type EntryTransferCandidates = z.infer<typeof entryTransferCandidatesSchema>;
export type EntryTransferResponse = z.infer<typeof entryTransferResponseSchema>;

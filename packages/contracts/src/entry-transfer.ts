import { z } from "zod";
import { fixedStartTimeSchema } from "./entry-start-time-admin";
import { classMaxEntriesSchema } from "./class-capacity";
import { entryPaymentStatusSchema } from "./entry-payment-status-admin";
import { speakerBoardEffectiveResultSchema } from "./speaker-board";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const startRule = z.enum(["FIXED", "PUNCH"]);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const assignedStartSlotSchema = z.object({
  drawRequestId: uuid,
  sourceHash: sha256,
  fixedStartTime: fixedStartTimeSchema
}).strict();
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
  expectedTargetCapacityVersion: version.optional(),
  fixedStartTime: fixedStartTimeSchema.nullable(),
  assignedStartSlot: assignedStartSlotSchema.nullable().optional()
}).strict().refine(value => value.expectedClassId !== value.targetClassId &&
  (value.expectedTargetStartRule === "FIXED" ? value.fixedStartTime !== null : value.fixedStartTime === null) &&
  ((value.assignedStartSlot ?? null) === null || (value.expectedTargetStartRule === "FIXED" &&
    value.expectedTargetCapacityVersion !== undefined && value.fixedStartTime === value.assignedStartSlot?.fixedStartTime)));

const availableTransferStartSlotsSchema = z.object({
  status: z.literal("AVAILABLE"), drawRequestId: uuid, sourceHash: sha256,
  slots: z.array(z.object({ fixedStartTime: fixedStartTimeSchema }).strict()).min(1).max(10_000)
}).strict().superRefine((value, context) => {
  if (new Set(value.slots.map(slot => slot.fixedStartTime)).size !== value.slots.length) {
    context.addIssue({ code: "custom", message: "Dubbla starttider i slotunderlaget" });
  }
});
const unavailableTransferStartSlotsSchema = z.object({
  status: z.literal("UNAVAILABLE"), reason: z.enum(["NO_SAVED_DRAW", "PLAN_CHANGED", "NO_FUTURE_SLOT"])
}).strict();
export const entryTransferStartSlotCandidatesSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, entryId: uuid, targetClassId: uuid,
  snapshotVersion: version, targetCourseVersionId: uuid, targetCapacityVersion: version,
  startRule: z.literal("FIXED"), plan: z.union([availableTransferStartSlotsSchema, unavailableTransferStartSlotsSchema])
}).strict();

export const entryTransferCandidatesSchema = z.object({
  formatVersion: z.literal(2), raceId: uuid, eventName: z.string().trim().min(1).max(160),
  raceName: z.string().trim().min(1).max(160), snapshotVersion: version, raceDate: z.iso.date(),
  generatedAt: z.iso.datetime({ offset: true }),
  timeZone: z.string().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat("sv-SE", { timeZone: value }); return true; } catch { return false; }
  }),
  classes: z.array(z.object({ id: uuid, name: z.string().min(1).max(160), courseVersionId: uuid,
    courseName: z.string().trim().min(1).max(160), courseVersion: version, startRule,
    maxEntries: classMaxEntriesSchema, capacityVersion: version, entryCount: z.number().int().min(0).max(10_000)
  }).strict()).max(1000),
  entries: z.array(z.object({ id: uuid, displayName: z.string().min(1).max(321),
    organisationName: z.string().min(1).max(240).nullable(), classId: uuid, version,
    paymentStatus: entryPaymentStatusSchema, paymentStatusVersion: version,
    resultFreshness: entryTransferResultFreshnessSchema,
    effectiveResult: entryTransferEffectiveResultSchema,
    resultRevisionMarker: entryTransferResultRevisionMarkerSchema.nullable(),
    fixedStartTime: fixedStartTimeSchema.nullable(),
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
      row.effectiveResult.resultSnapshotVersion <= value.snapshotVersion &&
        row.resultFreshness === (row.effectiveResult.resultSnapshotVersion === value.snapshotVersion
          ? "CURRENT_SNAPSHOT" : "OLDER_SNAPSHOT")
    ));
});
export const entryTransferIdempotencyKeySchema = z.string().regex(
  /^entry-transfer:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const entryTransferResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, entryId: uuid,
  request: entryTransferRequestSchema, entryVersionAfter: version, snapshotVersionAfter: version,
  changedAt: z.iso.datetime({ offset: true }), assignedStartSlot: z.object({
    assignmentId: uuid, drawRequestId: uuid, sourceHash: sha256, fixedStartTime: fixedStartTimeSchema
  }).strict().nullable()
}).strict().refine(value => value.entryVersionAfter === value.request.expectedEntryVersion + 1 &&
  value.snapshotVersionAfter === value.request.expectedSnapshotVersion + 1 &&
  ((value.request.assignedStartSlot ?? null) === null ? value.assignedStartSlot === null : value.assignedStartSlot !== null &&
    value.assignedStartSlot.drawRequestId === value.request.assignedStartSlot?.drawRequestId &&
    value.assignedStartSlot.sourceHash === value.request.assignedStartSlot?.sourceHash &&
    value.assignedStartSlot.fixedStartTime === value.request.assignedStartSlot?.fixedStartTime));
export type EntryTransferRequest = z.infer<typeof entryTransferRequestSchema>;
export type EntryTransferResultFreshness = z.infer<typeof entryTransferResultFreshnessSchema>;
export type EntryTransferResultRevisionMarker = z.infer<typeof entryTransferResultRevisionMarkerSchema>;
export type EntryTransferCandidates = z.infer<typeof entryTransferCandidatesSchema>;
export type EntryTransferStartSlotCandidates = z.infer<typeof entryTransferStartSlotCandidatesSchema>;
export type EntryTransferResponse = z.infer<typeof entryTransferResponseSchema>;

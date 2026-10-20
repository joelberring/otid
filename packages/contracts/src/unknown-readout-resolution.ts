import { z } from "zod";
import { newEntryCardNumberSchema } from "./entry-card-admin";
import { prefixedUuidPattern, uuidSchema as uuid } from "./ids";

const version = z.number().int().positive().max(2_147_483_647);
const engineVersion = z.string().trim().min(1).max(64);
const latestResultRevision = z.object({ id: uuid, revision: version }).strict();

export const unknownReadoutResolutionCandidateResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  snapshotVersion: version,
  engineVersion,
  readouts: z.array(z.object({
    id: uuid,
    cardNumber: newEntryCardNumberSchema,
    readAt: z.iso.datetime({ offset: true }),
    finishPunchedAt: z.iso.datetime({ offset: true }).nullable(),
    /** Steg 31 (B4): brickan har redan lästs ut för en annan deltagare med andra stämplingar (lånad bricka?). */
    alreadyReadOutBy: z.object({ entryId: uuid, name: z.string().trim().min(1).max(321) }).strict().nullable().optional()
  }).strict()).max(10_000),
  classes: z.array(z.object({
    id: uuid,
    name: z.string().trim().min(1).max(160),
    courseVersionId: uuid,
    maxEntries: z.number().int().min(0).max(10_000).nullable(),
    entryCount: z.number().int().min(0).max(10_000)
  }).strict()).max(1_000),
  entries: z.array(z.object({
    id: uuid,
    givenName: z.string().trim().min(1).max(160),
    familyName: z.string().trim().min(1).max(160),
    organisationName: z.string().trim().min(1).max(240).nullable(),
    classId: uuid,
    entryVersion: version,
    activeAssignment: z.object({ id: uuid, cardNumber: newEntryCardNumberSchema }).strict().nullable(),
    latestResultRevision: latestResultRevision.nullable()
  }).strict()).max(10_000)
}).strict().superRefine((value, context) => {
  for (const [path, ids] of [
    ["readouts", value.readouts.map((row) => row.id)],
    ["classes", value.classes.map((row) => row.id)],
    ["entries", value.entries.map((row) => row.id)]
  ] as const) {
    if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: [path], message: "Id måste vara unika" });
  }
  for (const raceClass of value.classes) {
    if (raceClass.maxEntries !== null && raceClass.entryCount > raceClass.maxEntries) {
      context.addIssue({ code: "custom", path: ["classes"], message: "Klassen överskrider kapaciteten" });
    }
  }
});

const common = {
  formatVersion: z.literal(1),
  requestId: uuid,
  readoutId: uuid,
  cardNumber: newEntryCardNumberSchema,
    expectedEngineVersion: engineVersion
};

export const unknownReadoutResolutionRequestSchema = z.discriminatedUnion("target", [
  z.object({
    ...common,
    target: z.literal("EXISTING_ENTRY"),
    entryId: uuid,
    expectedEntryVersion: version,
    expectedClassId: uuid,
    expectedAssignment: z.object({ id: uuid, cardNumber: newEntryCardNumberSchema }).strict().nullable(),
    expectedLatestResultRevision: latestResultRevision.nullable()
  }).strict(),
  z.object({
    ...common,
    target: z.literal("NEW_ENTRY"),
    classId: uuid,
    expectedCourseVersionId: uuid,
    givenName: z.string().trim().min(1).max(160),
    familyName: z.string().trim().min(1).max(160),
    organisationName: z.string().trim().min(1).max(200).nullable()
  }).strict()
]);

export const unknownReadoutResolutionIdempotencyKeySchema = z.string().regex(
  prefixedUuidPattern("unknown-readout-resolution")
);

export const unknownReadoutResolutionResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: uuid,
  raceId: uuid,
  readoutId: uuid,
  cardNumber: newEntryCardNumberSchema,
  target: z.enum(["EXISTING_ENTRY", "NEW_ENTRY"]),
  entryId: uuid,
  entryVersion: version,
  classId: uuid,
  assignmentId: uuid,
  resultRevisionId: uuid,
  revision: version,
  cause: z.literal("UNKNOWN_READOUT_RESOLUTION"),
  status: z.enum(["OK", "OVERTIME", "MP"]),
  reason: z.enum(["COMPLETE", "MISSING_START", "MISSING_FINISH", "MISSING_CONTROL", "WRONG_ORDER", "INVALID_TIME_ORDER",
    "MAX_TIME_EXCEEDED"]),
  engineVersion,
  snapshotVersionBefore: version,
  snapshotVersionAfter: version,
  courseVersionId: uuid,
  resolvedAt: z.iso.datetime({ offset: true })
}).strict().refine((row) => row.snapshotVersionAfter === row.snapshotVersionBefore + 1);

export type UnknownReadoutResolutionCandidateResponse = z.infer<typeof unknownReadoutResolutionCandidateResponseSchema>;
export type UnknownReadoutResolutionRequest = z.infer<typeof unknownReadoutResolutionRequestSchema>;
export type UnknownReadoutResolutionResponse = z.infer<typeof unknownReadoutResolutionResponseSchema>;

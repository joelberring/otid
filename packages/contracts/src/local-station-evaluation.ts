import { z } from "zod";

const uuidSchema = z.uuid();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const codesSchema = z.array(z.number().int().positive()).max(1_000);
const splitSchema = z.object({
  controlCode: z.number().int().positive(),
  occurrence: z.number().int().positive(),
  elapsedMs: z.number().int(),
  legMs: z.number().int()
}).strict();

const identityFields = {
  entryId: uuidSchema,
  classId: uuidSchema,
  courseVersionId: uuidSchema
};
const explanationFields = {
  missingControls: codesSchema,
  extraPunches: codesSchema,
  splits: z.array(splitSchema).max(1_000)
};
const timedFields = {
  ...identityFields,
  startTime: z.iso.datetime({ offset: true }),
  finishTime: z.iso.datetime({ offset: true }),
  elapsedMs: z.number().int(),
  ...explanationFields
};

export const evaluationResultSchema = z.discriminatedUnion("reason", [
  z.object({
    status: z.literal("UNKNOWN_CARD"),
    reason: z.literal("UNKNOWN_CARD"),
    ...explanationFields
  }).strict(),
  z.object({
    status: z.literal("MP"),
    reason: z.literal("MISSING_START"),
    ...identityFields,
    ...explanationFields
  }).strict(),
  z.object({
    status: z.literal("MP"),
    reason: z.literal("MISSING_FINISH"),
    ...identityFields,
    startTime: z.iso.datetime({ offset: true }),
    ...explanationFields
  }).strict(),
  z.object({
    status: z.literal("MP"),
    reason: z.literal("INVALID_TIME_ORDER"),
    ...identityFields,
    startTime: z.string().min(1).max(64),
    finishTime: z.string().min(1).max(64),
    ...explanationFields
  }).strict(),
  z.object({
    status: z.literal("MP"),
    reason: z.literal("MISSING_CONTROL"),
    ...timedFields
  }).strict(),
  z.object({
    status: z.literal("MP"),
    reason: z.literal("WRONG_ORDER"),
    ...timedFields
  }).strict(),
  z.object({
    status: z.literal("OK"),
    reason: z.literal("COMPLETE"),
    ...timedFields
  }).strict()
]);

export const localStationEvaluationSchema = z.object({
  formatVersion: z.literal(1),
  deviceId: uuidSchema,
  localSequence: z.number().int().positive(),
  raceId: uuidSchema,
  packageVersion: z.number().int().positive(),
  packagePayloadSha256: sha256Schema,
  engineVersion: z.string().trim().min(1).max(64),
  snapshotVersion: z.number().int().positive(),
  evaluation: evaluationResultSchema
}).strict();

export type LocalStationEvaluation = z.infer<typeof localStationEvaluationSchema>;

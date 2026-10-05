import { z } from "zod";
import { rogainingScoreSchema } from "./rogaining";

const safeMillisecondsSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const publicResultReasonV1Schema = z.enum([
  "COMPLETE",
  "MISSING_START",
  "MISSING_FINISH",
  "MISSING_CONTROL",
  "WRONG_ORDER",
  "INVALID_TIME_ORDER",
  "DID_NOT_START"
]);
export const publicResultReasonV2Schema = z.enum([
  ...publicResultReasonV1Schema.options,
  "MANUAL_DISQUALIFICATION"
]);
export const publicResultReasonV3Schema = z.enum([
  ...publicResultReasonV2Schema.options,
  "MANUAL_APPROVAL"
]);
export const publicResultReasonV4Schema = z.enum([
  ...publicResultReasonV3Schema.options,
  "DID_NOT_FINISH"
]);
export const publicResultReasonV5Schema = z.enum([
  ...publicResultReasonV4Schema.options,
  "OUT_OF_COMPETITION"
]);
export const publicResultReasonV6Schema = z.enum([
  ...publicResultReasonV5Schema.options,
  "WITHOUT_TIMING"
]);
export const publicResultReasonSchema = publicResultReasonV6Schema;

export const publicResultSplitSchema = z.object({
  controlCode: z.number().int().positive(),
  occurrence: z.number().int().positive(),
  elapsedMs: safeMillisecondsSchema,
  legMs: safeMillisecondsSchema
}).strict();

const publicResultCommonFields = {
  className: z.string().trim().min(1).max(160),
  givenName: z.string().trim().min(1).max(160),
  familyName: z.string().trim().min(1).max(160),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  revision: z.number().int().positive(),
  elapsedMs: safeMillisecondsSchema.optional(),
  splits: z.array(publicResultSplitSchema).max(256),
  rankingState: z.enum(["RANKED", "NOT_RANKABLE_STATUS", "MIXED_COURSE_VERSIONS"]),
  position: z.number().int().positive().max(10_000).optional(),
  timeBehindMs: safeMillisecondsSchema.optional()
};

interface PublicResultValidationValue {
  status: "OK" | "MP" | "DSQ" | "DNF" | "OOC" | "DNS";
  reason: string;
  elapsedMs?: number | undefined;
  splits: readonly { elapsedMs: number }[];
  rankingState: "RANKED" | "NOT_RANKABLE_STATUS" | "MIXED_COURSE_VERSIONS";
  position?: number | undefined;
  timeBehindMs?: number | undefined;
  rogaining?: unknown;
}

function validatePublicResult(result: PublicResultValidationValue, context: z.RefinementCtx): void {
  const hasPosition = result.position !== undefined;
  const hasTimeBehind = result.timeBehindMs !== undefined;
  // Rogaining rangordnas på poäng: placering utan tid efter.
  if (result.rogaining !== undefined ? hasTimeBehind : hasPosition !== hasTimeBehind) {
    context.addIssue({ code: "custom", message: "Position och tid efter måste förekomma tillsammans" });
  }
  if (result.status === "OK" &&
      ((result.reason !== "COMPLETE" && result.reason !== "MANUAL_APPROVAL") || result.elapsedMs === undefined)) {
    context.addIssue({ code: "custom", message: "OK kräver teknisk eller manuell godkännandeorsak och totaltid" });
  }
  if (result.status === "MP" &&
      result.reason !== "MISSING_START" && result.reason !== "MISSING_FINISH" &&
      result.reason !== "MISSING_CONTROL" && result.reason !== "WRONG_ORDER" &&
      result.reason !== "INVALID_TIME_ORDER") {
    context.addIssue({ code: "custom", message: "MP kräver en teknisk MP-orsak" });
  }
  if (result.status === "DSQ" &&
      (result.reason !== "MANUAL_DISQUALIFICATION" || hasPosition || hasTimeBehind)) {
    context.addIssue({ code: "custom", message: "DSQ kräver manuell orsak och får inte ha ranking" });
  }
  if (result.status === "DNS" &&
      (result.reason !== "DID_NOT_START" || result.elapsedMs !== undefined || result.splits.length > 0 ||
       hasPosition || hasTimeBehind)) {
    context.addIssue({ code: "custom", message: "DNS måste vara status-only utan tid, splits eller ranking" });
  }
  if (result.status === "DNF" &&
      (result.reason !== "DID_NOT_FINISH" || result.elapsedMs !== undefined || result.splits.length > 0 ||
       hasPosition || hasTimeBehind)) {
    context.addIssue({ code: "custom", message: "DNF måste vara status-only utan tid, splits eller ranking" });
  }
  if (result.status === "OOC" &&
      (result.reason !== "OUT_OF_COMPETITION" || hasPosition || hasTimeBehind)) {
    context.addIssue({ code: "custom", message: "OOC kräver utom-tävlan-orsak och får inte ha ranking" });
  }
  if (result.rankingState === "RANKED" &&
      (result.status !== "OK" || !hasPosition || (!hasTimeBehind && result.rogaining === undefined))) {
    context.addIssue({ code: "custom", message: "RANKED kräver OK, position och tid efter" });
  }
  if (result.rankingState === "NOT_RANKABLE_STATUS" &&
      ((result.status !== "MP" && result.status !== "DSQ" && result.status !== "DNF" &&
        result.status !== "OOC" && result.status !== "DNS") ||
       hasPosition || hasTimeBehind)) {
    context.addIssue({
      code: "custom",
      message: "NOT_RANKABLE_STATUS kräver orankad MP, DSQ, DNF, OOC eller DNS"
    });
  }
  if (result.rankingState === "MIXED_COURSE_VERSIONS" &&
      (result.status !== "OK" || hasPosition || hasTimeBehind)) {
    context.addIssue({ code: "custom", message: "MIXED_COURSE_VERSIONS kräver orankad OK" });
  }
  if (result.elapsedMs === undefined && result.splits.length > 0) {
    context.addIssue({ code: "custom", message: "Sträcktider kräver totaltid" });
  }
  if (result.elapsedMs !== undefined) {
    if (result.timeBehindMs !== undefined && result.timeBehindMs > result.elapsedMs) {
      context.addIssue({ code: "custom", message: "Tid efter får inte överstiga totaltiden" });
    }
    if (result.splits.some((split) => split.elapsedMs > result.elapsedMs!)) {
      context.addIssue({ code: "custom", message: "Kumulativ sträcktid får inte överstiga totaltiden" });
    }
  }
}

export const publicResultV1Schema = z.object({
  ...publicResultCommonFields,
  status: z.enum(["OK", "MP", "DNS"]),
  reason: publicResultReasonV1Schema
}).strict().superRefine(validatePublicResult);

export const publicResultV2Schema = z.object({
  ...publicResultCommonFields,
  status: z.enum(["OK", "MP", "DSQ", "DNS"]),
  reason: publicResultReasonV2Schema
}).strict().superRefine(validatePublicResult);

export const publicResultV3Schema = z.object({
  ...publicResultCommonFields,
  status: z.enum(["OK", "MP", "DSQ", "DNS"]),
  reason: publicResultReasonV3Schema,
  missingControls: z.array(z.number().int().positive()).max(256),
  extraPunches: z.array(z.number().int().positive()).max(256)
}).strict().superRefine(validatePublicResult);

export const publicResultV4Schema = z.object({
  ...publicResultCommonFields,
  status: z.enum(["OK", "MP", "DSQ", "DNF", "DNS"]),
  reason: publicResultReasonV4Schema,
  missingControls: z.array(z.number().int().positive()).max(256),
  extraPunches: z.array(z.number().int().positive()).max(256)
}).strict().superRefine(validatePublicResult);

export const publicResultV5Schema = z.object({
  ...publicResultCommonFields,
  status: z.enum(["OK", "MP", "DSQ", "DNF", "OOC", "DNS"]),
  reason: publicResultReasonV5Schema,
  missingControls: z.array(z.number().int().positive()).max(256),
  extraPunches: z.array(z.number().int().positive()).max(256)
}).strict().superRefine(validatePublicResult);

/** NT deliberately exposes display state only, never technical timing/control facts. */
export const publicWithoutTimingResultSchema = z.object({
  className: z.string().trim().min(1).max(160),
  givenName: z.string().trim().min(1).max(160),
  familyName: z.string().trim().min(1).max(160),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  revision: z.number().int().positive(),
  status: z.literal("NT"),
  reason: z.literal("WITHOUT_TIMING"),
  rankingState: z.literal("NOT_RANKABLE_STATUS")
}).strict();

/** TASK 006M public format. Older formats intentionally reject NT. */
export const publicResultV6Schema = z.union([
  publicResultV5Schema,
  publicWithoutTimingResultSchema
]);

/** TASK089 adds a stable opaque link identity without exposing internal ids. */
export const publicResultIdSchema = z.uuid();

const publicResultV7TimingFields = {
  ...publicResultCommonFields,
  publicResultId: publicResultIdSchema,
  /** Gafflad bana: varianten som löparen bedömdes mot (ADR-0169 beslut 2). */
  courseVariantCode: z.string().min(1).max(32).optional(),
  missingControls: z.array(z.number().int().positive()).max(256),
  extraPunches: z.array(z.number().int().positive()).max(256),
  /** Rogaining (ADR-0170 beslut 5): poäng, straff och summa. */
  rogaining: rogainingScoreSchema.optional()
};

const publicResultV7TimedSchema = z.object({
  ...publicResultV7TimingFields,
  status: z.enum(["OK", "MP", "DSQ", "DNF", "OOC", "DNS"]),
  reason: publicResultReasonV6Schema
}).strict().superRefine(validatePublicResult);

const publicWithoutTimingResultV7Schema = z.object({
  className: z.string().trim().min(1).max(160),
  givenName: z.string().trim().min(1).max(160),
  familyName: z.string().trim().min(1).max(160),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  publicResultId: publicResultIdSchema,
  revision: z.number().int().positive(),
  status: z.literal("NT"),
  reason: z.literal("WITHOUT_TIMING"),
  rankingState: z.literal("NOT_RANKABLE_STATUS")
}).strict();

export const publicResultV7Schema = z.union([
  publicResultV7TimedSchema,
  publicWithoutTimingResultV7Schema
]);

export const publicResultSchema = z.union([
  publicResultV1Schema,
  publicResultV2Schema,
  publicResultV3Schema,
  publicResultV4Schema,
  publicResultV5Schema,
  publicResultV6Schema,
  publicResultV7Schema
]);

export const publicResultListResponseV1Schema = z.object({
  formatVersion: z.literal(1),
  results: z.array(publicResultV1Schema).max(10_000)
}).strict();

export const publicResultListResponseV2Schema = z.object({
  formatVersion: z.literal(2),
  results: z.array(publicResultV2Schema).max(10_000)
}).strict();

export const publicResultListResponseV3Schema = z.object({
  formatVersion: z.literal(3),
  results: z.array(publicResultV3Schema).max(10_000)
}).strict();

export const publicResultListResponseV4Schema = z.object({
  formatVersion: z.literal(4),
  results: z.array(publicResultV4Schema).max(10_000)
}).strict();

export const publicResultListResponseV5Schema = z.object({
  formatVersion: z.literal(5),
  results: z.array(publicResultV5Schema).max(10_000)
}).strict();

export const publicResultListResponseV6Schema = z.object({
  formatVersion: z.literal(6),
  results: z.array(publicResultV6Schema).max(10_000)
}).strict();

export const publicResultListResponseV7Schema = z.object({
  formatVersion: z.literal(7),
  results: z.array(publicResultV7Schema).max(10_000)
}).strict();

/** Detail deliberately contains exactly one list-format public row. */
export const publicResultDetailResponseSchema = z.object({
  formatVersion: z.literal(1),
  result: publicResultV7Schema
}).strict();

export const publicResultListResponseSchema = z.discriminatedUnion("formatVersion", [
  publicResultListResponseV1Schema,
  publicResultListResponseV2Schema,
  publicResultListResponseV3Schema,
  publicResultListResponseV4Schema,
  publicResultListResponseV5Schema,
  publicResultListResponseV6Schema,
  publicResultListResponseV7Schema
]);

export type PublicResultV1 = z.infer<typeof publicResultV1Schema>;
export type PublicResultV2 = z.infer<typeof publicResultV2Schema>;
export type PublicResultV3 = z.infer<typeof publicResultV3Schema>;
export type PublicResultV4 = z.infer<typeof publicResultV4Schema>;
export type PublicResultV5 = z.infer<typeof publicResultV5Schema>;
export type PublicWithoutTimingResult = z.infer<typeof publicWithoutTimingResultSchema>;
export type PublicResultV6 = z.infer<typeof publicResultV6Schema>;
export type PublicResultV7 = z.infer<typeof publicResultV7Schema>;
export type PublicResult = z.infer<typeof publicResultSchema>;
export type PublicResultListResponseV1 = z.infer<typeof publicResultListResponseV1Schema>;
export type PublicResultListResponseV2 = z.infer<typeof publicResultListResponseV2Schema>;
export type PublicResultListResponseV3 = z.infer<typeof publicResultListResponseV3Schema>;
export type PublicResultListResponseV4 = z.infer<typeof publicResultListResponseV4Schema>;
export type PublicResultListResponseV5 = z.infer<typeof publicResultListResponseV5Schema>;
export type PublicResultListResponseV6 = z.infer<typeof publicResultListResponseV6Schema>;
export type PublicResultListResponseV7 = z.infer<typeof publicResultListResponseV7Schema>;
export type PublicResultListResponse = z.infer<typeof publicResultListResponseSchema>;
export type PublicResultDetailResponse = z.infer<typeof publicResultDetailResponseSchema>;

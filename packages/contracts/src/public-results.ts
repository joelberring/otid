import { z } from "zod";
import { rogainingScoreSchema } from "./rogaining";
import { courseForkingViewSchema } from "./course-forking";

const safeMillisecondsSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** PLAN.md steg 25: MAX_TIME_EXCEEDED = maxtid överskriden. */
const publicResultReasonSchema = z.enum([
  "COMPLETE",
  "MISSING_START",
  "MISSING_FINISH",
  "MISSING_CONTROL",
  "WRONG_ORDER",
  "INVALID_TIME_ORDER",
  "DID_NOT_START",
  "MANUAL_DISQUALIFICATION",
  "MANUAL_APPROVAL",
  "DID_NOT_FINISH",
  "OUT_OF_COMPETITION",
  "WITHOUT_TIMING",
  "MAX_TIME_EXCEEDED"
]);

export const publicResultSplitSchema = z.object({
  controlCode: z.number().int().positive(),
  occurrence: z.number().int().positive(),
  elapsedMs: safeMillisecondsSchema,
  legMs: safeMillisecondsSchema
}).strict();

const publicResultCommonFields = {
  className: z.string().trim().min(1).max(160),
  givenName: z.string().trim().min(1).max(160),
  // Steg 68: tomt när träningsgruppen visar bara förnamn.
  familyName: z.string().trim().max(160),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  revision: z.number().int().positive(),
  elapsedMs: safeMillisecondsSchema.optional(),
  splits: z.array(publicResultSplitSchema).max(256),
  rankingState: z.enum(["RANKED", "NOT_RANKABLE_STATUS", "MIXED_COURSE_VERSIONS"]),
  position: z.number().int().positive().max(10_000).optional(),
  timeBehindMs: safeMillisecondsSchema.optional()
};

interface PublicResultValidationValue {
  status: "OK" | "OVERTIME" | "MP" | "DSQ" | "DNF" | "OOC" | "DNS";
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
  if (result.status === "OVERTIME" &&
      (result.reason !== "MAX_TIME_EXCEEDED" || result.elapsedMs === undefined || hasPosition || hasTimeBehind)) {
    context.addIssue({ code: "custom", message: "OVERTIME kräver maxtidsorsak och totaltid men ingen ranking" });
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
  // Steg 38: brutit med avläsning visar sträcktiderna fram till sista stämplade kontrollen, aldrig tid eller placering.
  if (result.status === "DNF" &&
      (result.reason !== "DID_NOT_FINISH" || result.elapsedMs !== undefined || hasPosition || hasTimeBehind)) {
    context.addIssue({ code: "custom", message: "DNF får inte ha tid eller ranking" });
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
      ((result.status !== "OVERTIME" && result.status !== "MP" && result.status !== "DSQ" && result.status !== "DNF" &&
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
  // Brutit, disk och utom tävlan utan mål (steg 38) har sträcktider utan totaltid.
  if (result.elapsedMs === undefined && result.splits.length > 0 &&
      result.status !== "DNF" && result.status !== "DSQ" && result.status !== "OOC") {
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
  status: z.enum(["OK", "OVERTIME", "MP", "DSQ", "DNF", "OOC", "DNS"]),
  reason: publicResultReasonSchema
}).strict().superRefine(validatePublicResult);

const publicWithoutTimingResultV7Schema = z.object({
  className: z.string().trim().min(1).max(160),
  givenName: z.string().trim().min(1).max(160),
  // Steg 68: tomt när träningsgruppen visar bara förnamn.
  familyName: z.string().trim().max(160),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  publicResultId: publicResultIdSchema,
  revision: z.number().int().positive(),
  status: z.literal("NT"),
  reason: z.literal("WITHOUT_TIMING"),
  rankingState: z.literal("NOT_RANKABLE_STATUS"),
  /** Steg 38: med avläsning sträcktiderna fram till sista stämplade kontrollen (aldrig tid). */
  splits: z.array(publicResultSplitSchema).max(256).optional()
}).strict();

export const publicResultV7Schema = z.union([
  publicResultV7TimedSchema,
  publicWithoutTimingResultV7Schema
]);

/**
 * PLAN.md steg 25: listans ställning. Preliminär tills tävlingen fastställts; officiell när den senaste fastställda
 * hela tävlingen har samma resultat som listan (inget har ändrats efter fastställandet).
 */
export const publicResultStandingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PRELIMINARY") }).strict(),
  z.object({ kind: z.literal("OFFICIAL"), finalizedAt: z.iso.datetime({ offset: true }),
    /** Tävlingens tidszon för fastställandets klockslag. */
    timeZone: z.string().trim().min(1).max(100) }).strict()
]);

/** Klassens bana med längd och stigning för listornas rubriker (PLAN.md steg 25). */
export const publicClassCourseSchema = z.object({
  className: z.string().trim().min(1).max(160),
  courseName: z.string().trim().min(1).max(160),
  lengthMeters: z.number().int().min(1).max(1_000_000).nullable(),
  climbMeters: z.number().int().min(0).max(100_000).nullable(),
  /** Steg 49: gafflad bana: strukturen och varje variants val för bilden "Visa gafflingar". */
  forking: courseForkingViewSchema.optional()
}).strict();

export const publicResultListResponseV7Schema = z.object({
  formatVersion: z.literal(7),
  results: z.array(publicResultV7Schema).max(10_000),
  standing: publicResultStandingSchema.optional(),
  classCourses: z.array(publicClassCourseSchema).max(1_000).optional()
}).strict();

/** Detail deliberately contains exactly one list-format public row. */
export const publicResultDetailResponseSchema = z.object({
  formatVersion: z.literal(1),
  result: publicResultV7Schema,
  /** Steg 49: klassens bana (med gafflingarna) för "Visa gafflingar". */
  classCourse: publicClassCourseSchema.optional(),
  /** Steg 52: "Visa på kartan" finns (banorna är publika eller den som frågar är arrangör eller funktionär). */
  controlMap: z.boolean().optional()
}).strict();

/** @alias Gällande listformat (7). */
export const publicResultListResponseSchema = publicResultListResponseV7Schema;

export type PublicResultV7 = z.infer<typeof publicResultV7Schema>;
export type PublicResultListResponseV7 = z.infer<typeof publicResultListResponseV7Schema>;
export type PublicResultListResponse = z.infer<typeof publicResultListResponseSchema>;
export type PublicResultDetailResponse = z.infer<typeof publicResultDetailResponseSchema>;
export type PublicResultStanding = z.infer<typeof publicResultStandingSchema>;
export type PublicClassCourse = z.infer<typeof publicClassCourseSchema>;

import { z } from "zod";
import { UUID_PATTERN, prefixedUuidPattern } from "./ids";

const canonicalUuidSchema = z.string().regex(
  UUID_PATTERN,
  "Id måste vara ett kanoniskt gemener-UUID"
);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "Hash måste vara SHA-256 i gemener");
const positiveVersionSchema = z.number().int().positive();
const boundedCountSchema = z.number().int().min(0).max(10_000);
const instantSchema = z.iso.datetime({ offset: true });

export const resultFinalizationScopeSchema = z.enum(["CLASS", "RACE"]);

/**
 * These codes describe why an otherwise read-only finalization candidate is
 * not safe to freeze. They deliberately do not encode a new result status.
 */
export const resultFinalizationBlockerCodeSchema = z.enum([
  "EMPTY_CLASS",
  "NO_ENTRIES",
  "MISSING_RESULT_REVISION",
  "LATEST_RESULT_UNPUBLISHED",
  "WITHDRAWN_DID_NOT_START",
  "INVALID_RESULT_REVISION",
  "RESULT_CLASS_MISMATCH",
  "RESULT_COURSE_MISMATCH",
  "STALE_RESULT_SNAPSHOT",
  "MIXED_COURSE_VERSIONS",
  "TOO_MANY_RESULTS",
  "TOO_MANY_CLASSES",
  "UNKNOWN_CARD_UNRESOLVED",
  "MISSING_CLASS_FINALIZATION",
  "CLASS_FINALIZATION_OUTDATED",
  "MULTI_RACE_EVENT"
]);

const classBlockerCodes = new Set<z.infer<typeof resultFinalizationBlockerCodeSchema>>([
  "EMPTY_CLASS",
  "MISSING_RESULT_REVISION",
  "LATEST_RESULT_UNPUBLISHED",
  "WITHDRAWN_DID_NOT_START",
  "INVALID_RESULT_REVISION",
  "RESULT_CLASS_MISMATCH",
  "RESULT_COURSE_MISMATCH",
  "STALE_RESULT_SNAPSHOT",
  "MIXED_COURSE_VERSIONS",
  "TOO_MANY_RESULTS"
]);
const raceBlockerCodes = new Set<z.infer<typeof resultFinalizationBlockerCodeSchema>>([
  "NO_ENTRIES",
  "TOO_MANY_RESULTS",
  "TOO_MANY_CLASSES",
  "UNKNOWN_CARD_UNRESOLVED",
  "MISSING_CLASS_FINALIZATION",
  "CLASS_FINALIZATION_OUTDATED",
  "MULTI_RACE_EVENT"
]);



const finalizationCommonMetadata = {
  id: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  scopeRevision: positiveVersionSchema,
  sourceSnapshotVersion: positiveVersionSchema,
  basisHash: sha256Schema,
  frozenProjectionHash: sha256Schema,
  entryCount: boundedCountSchema,
  classCount: z.number().int().min(1).max(1_000),
  finalizedAt: instantSchema
};

/** Metadata only: never the frozen projection, XML, PII, or source facts. */
export const classResultFinalizationMetadataSchema = z.object({
  ...finalizationCommonMetadata,
  scope: z.literal("CLASS"),
  classId: canonicalUuidSchema,
  completeXmlSha256: z.null()
}).strict().superRefine((metadata, context) => {
  if (metadata.classCount !== 1) {
    context.addIssue({ code: "custom", path: ["classCount"], message: "Klassfinalisering måste innehålla exakt en klass" });
  }
  if (metadata.entryCount < 1) {
    context.addIssue({ code: "custom", path: ["entryCount"], message: "Klassfinalisering måste täcka minst en entry" });
  }
});

/** Metadata only for an immutable, saved Complete document. */
export const raceResultFinalizationMetadataSchema = z.object({
  ...finalizationCommonMetadata,
  scope: z.literal("RACE"),
  classId: z.null(),
  completeXmlSha256: sha256Schema
}).strict().superRefine((metadata, context) => {
  if (metadata.entryCount < 1) {
    context.addIssue({ code: "custom", path: ["entryCount"], message: "Loppsfinalisering måste täcka minst en entry" });
  }
});

export const resultFinalizationMetadataSchema = z.discriminatedUnion("scope", [
  classResultFinalizationMetadataSchema,
  raceResultFinalizationMetadataSchema
]);

export const resultFinalizationClassCandidateSchema = z.object({
  classId: canonicalUuidSchema,
  className: z.string().trim().min(1).max(160),
  entryCount: boundedCountSchema,
  blockerCodes: z.array(resultFinalizationBlockerCodeSchema).max(16),
  basisHash: sha256Schema,
  latestFinalization: classResultFinalizationMetadataSchema.nullable()
}).strict().superRefine((candidate, context) => {
  const codes = new Set(candidate.blockerCodes);
  if (codes.size !== candidate.blockerCodes.length) {
    context.addIssue({ code: "custom", path: ["blockerCodes"], message: "Blockerarkoder måste vara unika" });
  }
  for (const code of candidate.blockerCodes) {
    if (!classBlockerCodes.has(code)) {
      context.addIssue({ code: "custom", path: ["blockerCodes"], message: "Blockerarkoden gäller inte en klass" });
    }
  }
  const hasEmptyClass = codes.has("EMPTY_CLASS");
  if ((candidate.entryCount === 0) !== hasEmptyClass) {
    context.addIssue({ code: "custom", path: ["entryCount"], message: "Tom klass måste markeras uttryckligt" });
  }
  if (candidate.latestFinalization !== null && candidate.latestFinalization.classId !== candidate.classId) {
    context.addIssue({ code: "custom", path: ["latestFinalization", "classId"], message: "Klassfinaliseringens klass matchar inte kandidaten" });
  }
});

export const resultFinalizationRaceCandidateSchema = z.object({
  entryCount: boundedCountSchema,
  nonEmptyClassCount: z.number().int().min(0).max(1_000),
  unresolvedUnknownCardReadoutCount: boundedCountSchema,
  blockerCodes: z.array(resultFinalizationBlockerCodeSchema).max(16),
  basisHash: sha256Schema,
  latestFinalization: raceResultFinalizationMetadataSchema.nullable()
}).strict().superRefine((candidate, context) => {
  const codes = new Set(candidate.blockerCodes);
  if (codes.size !== candidate.blockerCodes.length) {
    context.addIssue({ code: "custom", path: ["blockerCodes"], message: "Blockerarkoder måste vara unika" });
  }
  for (const code of candidate.blockerCodes) {
    if (!raceBlockerCodes.has(code)) {
      context.addIssue({ code: "custom", path: ["blockerCodes"], message: "Blockerarkoden gäller inte loppet" });
    }
  }
  if ((candidate.entryCount === 0) !== codes.has("NO_ENTRIES")) {
    context.addIssue({ code: "custom", path: ["entryCount"], message: "Tomt lopp måste markeras uttryckligt" });
  }
  if ((candidate.unresolvedUnknownCardReadoutCount > 0) !== codes.has("UNKNOWN_CARD_UNRESOLVED")) {
    context.addIssue({ code: "custom", path: ["unresolvedUnknownCardReadoutCount"], message: "Olösta okända brickor måste markeras uttryckligt" });
  }
});

export const resultFinalizationCandidateResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  race: resultFinalizationRaceCandidateSchema,
  classes: z.array(resultFinalizationClassCandidateSchema).max(1_000)
}).strict().superRefine((response, context) => {
  const classIds = new Set(response.classes.map((candidate) => candidate.classId));
  if (classIds.size !== response.classes.length) {
    context.addIssue({ code: "custom", path: ["classes"], message: "Klasskandidater måste vara unika" });
  }
  const nonEmptyClassCount = response.classes.filter((candidate) => candidate.entryCount > 0).length;
  if (response.race.nonEmptyClassCount !== nonEmptyClassCount) {
    context.addIssue({ code: "custom", path: ["race", "nonEmptyClassCount"], message: "Antalet icke-tomma klasser motsäger kandidaterna" });
  }
  const entryCount = response.classes.reduce((total, candidate) => total + candidate.entryCount, 0);
  if (response.race.entryCount !== entryCount) {
    context.addIssue({ code: "custom", path: ["race", "entryCount"], message: "Loppets entryantal motsäger klasskandidaterna" });
  }
});

const expectedLatestScopeRevisionSchema = positiveVersionSchema.nullable();
const mutationCommon = {
  formatVersion: z.literal(1),
    expectedBasisHash: sha256Schema,
  expectedLatestScopeRevision: expectedLatestScopeRevisionSchema
};

/**
 * The current candidate's snapshot/hash and the scope-local finalization head
 * are all frozen into the write intent. `classId: null` is deliberate for RACE.
 */
export const resultFinalizationRequestSchema = z.discriminatedUnion("scope", [
  z.object({
    ...mutationCommon,
    scope: z.literal("CLASS"),
    classId: canonicalUuidSchema
  }).strict(),
  z.object({
    ...mutationCommon,
    scope: z.literal("RACE"),
    classId: z.null()
  }).strict()
]);

export const resultFinalizationIdempotencyKeySchema = z.string().regex(
  prefixedUuidPattern("result-finalization"),
  "Idempotency-Key måste vara result-finalization:<kanoniskt request-uuid>"
);

export const resultFinalizationResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuidSchema,
  finalization: resultFinalizationMetadataSchema
}).strict();

/** The export capability sees only immutable RACE-finalization metadata. */
export const frozenRaceFinalizationListResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  finalizations: z.array(raceResultFinalizationMetadataSchema).max(10_000)
}).strict().superRefine((response, context) => {
  const ids = new Set(response.finalizations.map((finalization) => finalization.id));
  const revisions = new Set(response.finalizations.map((finalization) => finalization.scopeRevision));
  if (ids.size !== response.finalizations.length || revisions.size !== response.finalizations.length) {
    context.addIssue({ code: "custom", path: ["finalizations"], message: "Finaliseringslistan innehåller dubbletter" });
  }
  if (response.finalizations.some((finalization) => finalization.raceId !== response.raceId)) {
    context.addIssue({ code: "custom", path: ["finalizations"], message: "Finaliseringen tillhör ett annat lopp" });
  }
});

const frozenExpectedControlSchema = z.object({
  controlCode: z.number().int().positive(),
  occurrence: z.number().int().positive()
}).strict();

const frozenSplitSchema = z.object({
  controlCode: z.number().int().positive(),
  occurrence: z.number().int().positive(),
  elapsedMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
}).strict();

const frozenIofPersonCommonFields = {
  entryExternalId: z.string().trim().min(1).max(160).nullable(),
  givenName: z.string().trim().min(1).max(160),
  familyName: z.string().trim().min(1).max(160),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  startTime: instantSchema.nullable(),
  finishTime: instantSchema.nullable(),
  elapsedMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  position: z.number().int().positive().max(10_000).nullable(),
  timeBehindMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  expectedControls: z.array(frozenExpectedControlSchema).max(256),
  splits: z.array(frozenSplitSchema).max(256)
};

const frozenManualApprovalProofSchema = z.object({
  decisionId: canonicalUuidSchema,
  targetResultRevisionId: canonicalUuidSchema
}).strict();

interface FrozenPersonValidationValue {
  status: "OK" | "MP" | "DSQ" | "DNF" | "OOC" | "DNS";
  startTime: string | null;
  finishTime: string | null;
  elapsedMs: number | null;
  position: number | null;
  timeBehindMs: number | null;
  expectedControls: readonly { controlCode: number; occurrence: number }[];
  splits: readonly { controlCode: number; occurrence: number; elapsedMs: number }[];
  manualApprovalProof?: { decisionId: string; targetResultRevisionId: string } | null;
}

function validateFrozenIofPerson(result: FrozenPersonValidationValue, context: z.RefinementCtx): void {
  const hasPosition = result.position !== null;
  const hasTimeBehind = result.timeBehindMs !== null;
  if (hasPosition !== hasTimeBehind) {
    context.addIssue({ code: "custom", path: ["position"], message: "Position och tid efter måste förekomma tillsammans" });
  }
  if (result.status === "OK" &&
      (result.startTime === null || result.finishTime === null || result.elapsedMs === null || !hasPosition)) {
    context.addIssue({ code: "custom", path: ["status"], message: "Finaliserad OK kräver tid och ranking" });
  }
  if ((result.status === "MP" || result.status === "DSQ" || result.status === "OOC") &&
      (hasPosition || hasTimeBehind)) {
    context.addIssue({ code: "custom", path: ["position"], message: "MP, DSQ och OOC får inte ha ranking" });
  }
  if ((result.status === "DNS" || result.status === "DNF") &&
      (result.startTime !== null || result.finishTime !== null || result.elapsedMs !== null ||
       hasPosition || hasTimeBehind || result.expectedControls.length !== 0 || result.splits.length !== 0)) {
    context.addIssue({ code: "custom", path: ["status"], message: "Finaliserad DNS/DNF måste vara status-only" });
  }
  if (result.status === "OOC" && result.finishTime !== null && result.startTime === null) {
    context.addIssue({ code: "custom", path: ["finishTime"], message: "Finaliserad OOC får inte ha mål utan start" });
  }
  if (result.status === "OOC" && result.elapsedMs === null && result.splits.length !== 0) {
    context.addIssue({ code: "custom", path: ["splits"], message: "Finaliserad OOC får inte ha splits utan totaltid" });
  }
  if (result.elapsedMs !== null && (result.startTime === null || result.finishTime === null)) {
    context.addIssue({ code: "custom", path: ["elapsedMs"], message: "Totaltid kräver start- och måltid" });
  }
  if (result.elapsedMs !== null && result.startTime !== null && result.finishTime !== null &&
      Date.parse(result.finishTime) - Date.parse(result.startTime) !== result.elapsedMs) {
    context.addIssue({ code: "custom", path: ["elapsedMs"], message: "Totaltid motsäger start och mål" });
  }
  if (result.timeBehindMs !== null && result.elapsedMs !== null && result.timeBehindMs > result.elapsedMs) {
    context.addIssue({ code: "custom", path: ["timeBehindMs"], message: "Tid efter får inte överstiga totaltiden" });
  }
  const expectedKeys = new Set<string>();
  const occurrences = new Map<number, number>();
  for (const [index, control] of result.expectedControls.entries()) {
    const expectedOccurrence = (occurrences.get(control.controlCode) ?? 0) + 1;
    occurrences.set(control.controlCode, expectedOccurrence);
    const key = `${control.controlCode}:${control.occurrence}`;
    if (control.occurrence !== expectedOccurrence || expectedKeys.has(key)) {
      context.addIssue({ code: "custom", path: ["expectedControls", index], message: "Kontrollföljden är inte canonical" });
    }
    expectedKeys.add(key);
  }
  const splitKeys = new Set<string>();
  let previousElapsedMs = -1;
  for (const [index, split] of result.splits.entries()) {
    const key = `${split.controlCode}:${split.occurrence}`;
    if (!expectedKeys.has(key) || splitKeys.has(key)) {
      context.addIssue({ code: "custom", path: ["splits", index], message: "Split hör inte entydigt till fryst bana" });
    }
    if (split.elapsedMs < previousElapsedMs || (result.elapsedMs !== null && split.elapsedMs > result.elapsedMs)) {
      context.addIssue({ code: "custom", path: ["splits", index], message: "Split-tiden motsäger fryst resultat" });
    }
    previousElapsedMs = split.elapsedMs;
    splitKeys.add(key);
  }
  if (result.status === "OK" && result.manualApprovalProof == null &&
      [...expectedKeys].some((key) => !splitKeys.has(key))) {
    context.addIssue({ code: "custom", path: ["splits"], message: "Finaliserad OK saknar split" });
  }
  if (result.status !== "OK" && result.manualApprovalProof != null) {
    context.addIssue({ code: "custom", path: ["manualApprovalProof"], message: "Manuellt godkännandebevis kräver OK" });
  }
}

/** Den frysta personraden (IOF 3.0 PersonResult) i nuvarande format (9). */
export const frozenIofPersonProjectionV9Schema = z.object({
  ...frozenIofPersonCommonFields,
  status: z.enum(["OK", "MP", "DSQ", "DNF", "OOC", "DNS"]),
  manualApprovalProof: frozenManualApprovalProofSchema.nullable()
}).strict().superRefine(validateFrozenIofPerson);
export const frozenIofPersonProjectionSchema = frozenIofPersonProjectionV9Schema;

const frozenSourceBase = {
  entryId: canonicalUuidSchema,
  resultRevisionId: canonicalUuidSchema,
  revision: positiveVersionSchema,
  courseVersionId: canonicalUuidSchema
};

/** Arrangörens beslut som kan frysas (ADR-0173 beslut 1: beslutet finns bara som resultatrevision). */
export const frozenManualDecisionCauseSchema = z.enum(["MANUAL_DID_NOT_START", "MANUAL_DISQUALIFICATION",
  "MANUAL_DISQUALIFICATION_WITHDRAWAL", "MANUAL_RESULT_APPROVAL", "MANUAL_RESULT_APPROVAL_WITHDRAWAL",
  "MANUAL_DID_NOT_FINISH", "MANUAL_DID_NOT_FINISH_WITHDRAWAL", "MANUAL_OUT_OF_COMPETITION",
  "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL", "MANUAL_WITHOUT_TIMING_WITHDRAWAL"]);

/** Var det frysta resultatet kommer ifrån: en avläsning, avprickningens ej start eller ett beslut. */
export const frozenFinalizationResultSourceV9Schema = z.discriminatedUnion("kind", [
  z.object({
    ...frozenSourceBase,
    kind: z.literal("READOUT_RESULT"),
    readoutId: canonicalUuidSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("START_CHECKIN_DID_NOT_START"),
    startCheckinDnsDecisionId: canonicalUuidSchema,
    operationRequestId: canonicalUuidSchema,
    startCheckinRevisionId: canonicalUuidSchema,
    operationalRevision: positiveVersionSchema,
    withdrawal: z.null()
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_DECISION"),
    cause: frozenManualDecisionCauseSchema,
    absoluteResultRevisionId: canonicalUuidSchema,
    absoluteResultRevision: positiveVersionSchema,
    /** Revisionen under ett kvarliggande beslut (disk, godkännande, brutit, utom tävlan). */
    underlyingResultRevisionId: canonicalUuidSchema.nullable()
  }).strict()
]);

const EXPECTED_STATUSES: Record<z.infer<typeof frozenManualDecisionCauseSchema>, readonly string[]> = {
  MANUAL_DID_NOT_START: ["DNS"], MANUAL_DISQUALIFICATION: ["DSQ"], MANUAL_RESULT_APPROVAL: ["OK"],
  MANUAL_DID_NOT_FINISH: ["DNF"], MANUAL_OUT_OF_COMPETITION: ["OOC"],
  MANUAL_DISQUALIFICATION_WITHDRAWAL: ["OK", "MP"], MANUAL_RESULT_APPROVAL_WITHDRAWAL: ["OK", "MP"],
  MANUAL_DID_NOT_FINISH_WITHDRAWAL: ["OK", "MP"], MANUAL_OUT_OF_COMPETITION_WITHDRAWAL: ["OK", "MP"],
  MANUAL_WITHOUT_TIMING_WITHDRAWAL: ["OK", "MP"]
};

export const frozenFinalizationResultV9Schema = z.object({
  source: frozenFinalizationResultSourceV9Schema,
  personResult: frozenIofPersonProjectionV9Schema
}).strict().superRefine((result, context) => {
  const source = result.source;
  const expectedStatuses = source.kind === "START_CHECKIN_DID_NOT_START" ? ["DNS"]
    : source.kind === "MANUAL_DECISION" ? EXPECTED_STATUSES[source.cause] : ["OK", "MP"];
  if (!expectedStatuses.includes(result.personResult.status)) {
    context.addIssue({ code: "custom", path: ["personResult", "status"], message: "Resultatstatus motsäger fryst proveniens" });
  }
  if (source.kind === "MANUAL_DECISION" && source.cause === "MANUAL_RESULT_APPROVAL") {
    const proof = result.personResult.manualApprovalProof;
    if (proof === null || proof.decisionId !== source.resultRevisionId ||
        proof.targetResultRevisionId !== source.underlyingResultRevisionId) {
      context.addIssue({ code: "custom", path: ["personResult", "manualApprovalProof"], message: "Godkännandebeviset måste matcha fryst proveniens" });
    }
  } else if (result.personResult.manualApprovalProof !== null) {
    context.addIssue({ code: "custom", path: ["personResult", "manualApprovalProof"], message: "Endast aktivt manuellt godkännande får bära bevis" });
  }
});

function validateFrozenClassData(
  raceClass: { results: readonly { source: { entryId: string; revision: number } }[] },
  context: z.RefinementCtx
): void {
  const entryIds = new Set<string>();
  const revisions = new Set<string>();
  for (const [index, result] of raceClass.results.entries()) {
    if (entryIds.has(result.source.entryId)) {
      context.addIssue({ code: "custom", path: ["results", index, "source", "entryId"], message: "Entry får bara täckas en gång" });
    }
    const revisionKey = `${result.source.entryId}:${result.source.revision}`;
    if (revisions.has(revisionKey)) {
      context.addIssue({ code: "custom", path: ["results", index, "source", "revision"], message: "Källrevision förekommer flera gånger" });
    }
    entryIds.add(result.source.entryId);
    revisions.add(revisionKey);
  }
}

export const frozenClassDataV9Schema = z.object({
  name: z.string().trim().min(1).max(160),
  externalId: z.string().trim().min(1).max(160).nullable(),
  results: z.array(frozenFinalizationResultV9Schema).min(1).max(10_000)
}).strict().superRefine(validateFrozenClassData);

/**
 * Private persisted CLASS projection. It intentionally contains the PII and
 * source IDs needed to reproduce a result document; it is never an HTTP DTO.
 */
export const frozenClassFinalizationProjectionV9Schema = z.object({
  formatVersion: z.literal(9),
  scope: z.literal("CLASS"),
  raceId: canonicalUuidSchema,
  classId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  basisSha256: sha256Schema,
  class: frozenClassDataV9Schema
}).strict();
export const frozenClassFinalizationProjectionSchema = frozenClassFinalizationProjectionV9Schema;

const selectedFrozenClassV9Schema = z.object({
  classFinalizationId: canonicalUuidSchema,
  classFinalizationRevision: positiveVersionSchema,
  classBasisSha256: sha256Schema,
  classId: canonicalUuidSchema,
  class: frozenClassDataV9Schema
}).strict();

function validateFrozenRaceProjection(
  projection: { classes: readonly { classFinalizationId: string; classId: string; class: { results: readonly { source: { entryId: string } }[] } }[] },
  context: z.RefinementCtx
): void {
  const finalizationIds = new Set<string>();
  const classIds = new Set<string>();
  const entryIds = new Set<string>();
  let entryCount = 0;
  for (const [index, selected] of projection.classes.entries()) {
    if (finalizationIds.has(selected.classFinalizationId)) {
      context.addIssue({ code: "custom", path: ["classes", index], message: "Vald klassfinalisering förekommer flera gånger" });
    }
    if (classIds.has(selected.classId)) {
      context.addIssue({ code: "custom", path: ["classes", index, "classId"], message: "Fryst klass förekommer flera gånger" });
    }
    for (const [resultIndex, result] of selected.class.results.entries()) {
      if (entryIds.has(result.source.entryId)) {
        context.addIssue({ code: "custom", path: ["classes", index, "class", "results", resultIndex, "source", "entryId"], message: "Entry får bara täckas en gång i loppet" });
      }
      entryIds.add(result.source.entryId);
    }
    entryCount += selected.class.results.length;
    finalizationIds.add(selected.classFinalizationId);
    classIds.add(selected.classId);
  }
  if (entryCount > 10_000) {
    context.addIssue({ code: "custom", path: ["classes"], message: "Fryst loppsprojektion innehåller för många resultat" });
  }
}

/**
 * Private persisted RACE projection. Each embedded class is copied, rather
 * than joined at export time, so later display/control changes cannot rewrite
 * the saved Complete document.
 */
export const frozenRaceFinalizationProjectionV9Schema = z.object({
  formatVersion: z.literal(9),
  scope: z.literal("RACE"),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  basisSha256: sha256Schema,
  eventName: z.string().trim().min(1).max(160),
  classes: z.array(selectedFrozenClassV9Schema).min(1).max(1_000)
}).strict().superRefine(validateFrozenRaceProjection);
export const frozenRaceFinalizationProjectionSchema = frozenRaceFinalizationProjectionV9Schema;

export const frozenResultFinalizationProjectionSchema = z.union([
  frozenClassFinalizationProjectionV9Schema,
  frozenRaceFinalizationProjectionV9Schema
]);

export const resultFinalizationAdminErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "TOO_LARGE",
  "INTERNAL_ERROR"
]);

export const resultFinalizationAdminErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: resultFinalizationAdminErrorCodeSchema
}).strict();

export type ResultFinalizationScope = z.infer<typeof resultFinalizationScopeSchema>;
export type ResultFinalizationBlockerCode = z.infer<typeof resultFinalizationBlockerCodeSchema>;
export type ClassResultFinalizationMetadata = z.infer<typeof classResultFinalizationMetadataSchema>;
export type RaceResultFinalizationMetadata = z.infer<typeof raceResultFinalizationMetadataSchema>;
export type ResultFinalizationMetadata = z.infer<typeof resultFinalizationMetadataSchema>;
export type ResultFinalizationClassCandidate = z.infer<typeof resultFinalizationClassCandidateSchema>;
export type ResultFinalizationRaceCandidate = z.infer<typeof resultFinalizationRaceCandidateSchema>;
export type ResultFinalizationCandidateResponse = z.infer<typeof resultFinalizationCandidateResponseSchema>;
export type ResultFinalizationRequest = z.infer<typeof resultFinalizationRequestSchema>;
export type ResultFinalizationResponse = z.infer<typeof resultFinalizationResponseSchema>;
export type FrozenRaceFinalizationListResponse = z.infer<typeof frozenRaceFinalizationListResponseSchema>;
export type FrozenIofPersonProjectionV9 = z.infer<typeof frozenIofPersonProjectionV9Schema>;
export type FrozenIofPersonProjection = z.infer<typeof frozenIofPersonProjectionSchema>;
export type FrozenManualDecisionCause = z.infer<typeof frozenManualDecisionCauseSchema>;
export type FrozenFinalizationResultSourceV9 = z.infer<typeof frozenFinalizationResultSourceV9Schema>;
export type FrozenClassFinalizationProjectionV9 = z.infer<typeof frozenClassFinalizationProjectionV9Schema>;
export type FrozenClassFinalizationProjection = z.infer<typeof frozenClassFinalizationProjectionSchema>;
export type FrozenRaceFinalizationProjectionV9 = z.infer<typeof frozenRaceFinalizationProjectionV9Schema>;
export type FrozenRaceFinalizationProjection = z.infer<typeof frozenRaceFinalizationProjectionSchema>;
export type FrozenResultFinalizationProjection = z.infer<typeof frozenResultFinalizationProjectionSchema>;
export type ResultFinalizationAdminErrorCode = z.infer<typeof resultFinalizationAdminErrorCodeSchema>;

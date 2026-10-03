import { z } from "zod";

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
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

export const resultFinalizationAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_result_finalize_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const resultFinalizationAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  capability: z.literal("FINALIZE_RESULTS"),
  expiresAt: instantSchema
}).strict();

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
  expectedSnapshotVersion: positiveVersionSchema,
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
  /^result-finalization:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
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

export const frozenIofPersonProjectionV1Schema = z.object({
  ...frozenIofPersonCommonFields,
  status: z.enum(["OK", "MP", "DNS"])
}).strict().superRefine(validateFrozenIofPerson);

export const frozenIofPersonProjectionV2Schema = z.object({
  ...frozenIofPersonCommonFields,
  status: z.enum(["OK", "MP", "DSQ", "DNS"])
}).strict().superRefine(validateFrozenIofPerson);

export const frozenIofPersonProjectionV3Schema = z.object({
  ...frozenIofPersonCommonFields,
  status: z.enum(["OK", "MP", "DSQ", "DNS"]),
  manualApprovalProof: frozenManualApprovalProofSchema.nullable()
}).strict().superRefine(validateFrozenIofPerson);

export const frozenIofPersonProjectionV4Schema = z.object({
  ...frozenIofPersonCommonFields,
  status: z.enum(["OK", "MP", "DSQ", "DNF", "DNS"]),
  manualApprovalProof: frozenManualApprovalProofSchema.nullable()
}).strict().superRefine(validateFrozenIofPerson);

export const frozenIofPersonProjectionV5Schema = z.object({
  ...frozenIofPersonCommonFields,
  status: z.enum(["OK", "MP", "DSQ", "DNF", "DNS"]),
  manualApprovalProof: frozenManualApprovalProofSchema.nullable()
}).strict().superRefine(validateFrozenIofPerson);

export const frozenIofPersonProjectionV6Schema = z.object({
  ...frozenIofPersonCommonFields,
  status: z.enum(["OK", "MP", "DSQ", "DNF", "OOC", "DNS"]),
  manualApprovalProof: frozenManualApprovalProofSchema.nullable()
}).strict().superRefine(validateFrozenIofPerson);

export const frozenIofPersonProjectionSchema = z.union([
  frozenIofPersonProjectionV1Schema,
  frozenIofPersonProjectionV2Schema,
  frozenIofPersonProjectionV3Schema,
  frozenIofPersonProjectionV4Schema,
  frozenIofPersonProjectionV5Schema,
  frozenIofPersonProjectionV6Schema
]);

const frozenSourceBase = {
  entryId: canonicalUuidSchema,
  resultRevisionId: canonicalUuidSchema,
  revision: positiveVersionSchema,
  courseVersionId: canonicalUuidSchema
};

export const frozenFinalizationResultSourceV1Schema = z.object(frozenSourceBase).strict();

export const frozenFinalizationResultSourceV2Schema = z.discriminatedUnion("kind", [
  z.object({
    ...frozenSourceBase,
    kind: z.literal("READOUT_RESULT"),
    readoutId: canonicalUuidSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_DID_NOT_START"),
    didNotStartDecisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_DISQUALIFICATION"),
    resultDisqualificationDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    absoluteResultRevisionId: canonicalUuidSchema,
    absoluteResultRevision: positiveVersionSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_DISQUALIFICATION_WITHDRAWAL"),
    resultDisqualificationWithdrawalId: canonicalUuidSchema,
    resultDisqualificationDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    disqualifiedResultRevisionId: canonicalUuidSchema,
    restorationSourceResultRevisionId: canonicalUuidSchema
  }).strict()
]);

export const frozenFinalizationResultSourceV3Schema = z.discriminatedUnion("kind", [
  z.object({
    ...frozenSourceBase,
    kind: z.literal("READOUT_RESULT"),
    readoutId: canonicalUuidSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_DID_NOT_START"),
    didNotStartDecisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_DISQUALIFICATION"),
    resultDisqualificationDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    absoluteResultRevisionId: canonicalUuidSchema,
    absoluteResultRevision: positiveVersionSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_DISQUALIFICATION_WITHDRAWAL"),
    resultDisqualificationWithdrawalId: canonicalUuidSchema,
    resultDisqualificationDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    disqualifiedResultRevisionId: canonicalUuidSchema,
    restorationSourceResultRevisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_RESULT_APPROVAL"),
    resultApprovalDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    approvedResultRevisionId: canonicalUuidSchema,
    absoluteResultRevisionId: canonicalUuidSchema,
    absoluteResultRevision: positiveVersionSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_RESULT_APPROVAL_WITHDRAWAL"),
    resultApprovalWithdrawalId: canonicalUuidSchema,
    resultApprovalDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    approvedResultRevisionId: canonicalUuidSchema,
    restorationSourceResultRevisionId: canonicalUuidSchema
  }).strict()
]);

export const frozenFinalizationResultSourceV4Schema = z.discriminatedUnion("kind", [
  z.object({
    ...frozenSourceBase,
    kind: z.literal("READOUT_RESULT"),
    readoutId: canonicalUuidSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_DID_NOT_START"),
    didNotStartDecisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_DID_NOT_FINISH"),
    didNotFinishDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    absoluteResultRevisionId: canonicalUuidSchema,
    absoluteResultRevision: positiveVersionSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_DISQUALIFICATION"),
    resultDisqualificationDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    absoluteResultRevisionId: canonicalUuidSchema,
    absoluteResultRevision: positiveVersionSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_DISQUALIFICATION_WITHDRAWAL"),
    resultDisqualificationWithdrawalId: canonicalUuidSchema,
    resultDisqualificationDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    disqualifiedResultRevisionId: canonicalUuidSchema,
    restorationSourceResultRevisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_RESULT_APPROVAL"),
    resultApprovalDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    approvedResultRevisionId: canonicalUuidSchema,
    absoluteResultRevisionId: canonicalUuidSchema,
    absoluteResultRevision: positiveVersionSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_RESULT_APPROVAL_WITHDRAWAL"),
    resultApprovalWithdrawalId: canonicalUuidSchema,
    resultApprovalDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    approvedResultRevisionId: canonicalUuidSchema,
    restorationSourceResultRevisionId: canonicalUuidSchema
  }).strict()
]);

export const frozenFinalizationResultSourceV5Schema = z.discriminatedUnion("kind", [
  z.object({
    ...frozenSourceBase,
    kind: z.literal("READOUT_RESULT"),
    readoutId: canonicalUuidSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_DID_NOT_START"),
    didNotStartDecisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_DID_NOT_FINISH"),
    didNotFinishDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    absoluteResultRevisionId: canonicalUuidSchema,
    absoluteResultRevision: positiveVersionSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_DID_NOT_FINISH_WITHDRAWAL"),
    didNotFinishWithdrawalId: canonicalUuidSchema,
    didNotFinishDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    didNotFinishResultRevisionId: canonicalUuidSchema,
    restorationSourceResultRevisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_DISQUALIFICATION"),
    resultDisqualificationDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    absoluteResultRevisionId: canonicalUuidSchema,
    absoluteResultRevision: positiveVersionSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_DISQUALIFICATION_WITHDRAWAL"),
    resultDisqualificationWithdrawalId: canonicalUuidSchema,
    resultDisqualificationDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    disqualifiedResultRevisionId: canonicalUuidSchema,
    restorationSourceResultRevisionId: canonicalUuidSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_RESULT_APPROVAL"),
    resultApprovalDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    approvedResultRevisionId: canonicalUuidSchema,
    absoluteResultRevisionId: canonicalUuidSchema,
    absoluteResultRevision: positiveVersionSchema
  }).strict(),
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_RESULT_APPROVAL_WITHDRAWAL"),
    resultApprovalWithdrawalId: canonicalUuidSchema,
    resultApprovalDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    approvedResultRevisionId: canonicalUuidSchema,
    restorationSourceResultRevisionId: canonicalUuidSchema
  }).strict()
]);

export const frozenFinalizationResultSourceV6Schema = z.discriminatedUnion("kind", [
  ...frozenFinalizationResultSourceV5Schema.options,
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_OUT_OF_COMPETITION"),
    notCompetingDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    absoluteResultRevisionId: canonicalUuidSchema,
    absoluteResultRevision: positiveVersionSchema
  }).strict()
]);

/** TASK 006L freezes every reciprocal OOC withdrawal identity. */
export const frozenFinalizationResultSourceV7Schema = z.discriminatedUnion("kind", [
  ...frozenFinalizationResultSourceV6Schema.options,
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"),
    notCompetingWithdrawalId: canonicalUuidSchema,
    notCompetingDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    outOfCompetitionResultRevisionId: canonicalUuidSchema,
    absoluteResultRevisionId: canonicalUuidSchema,
    absoluteResultRevision: positiveVersionSchema,
    restorationSourceResultRevisionId: canonicalUuidSchema
  }).strict()
]);

/** TASK 006N freezes every reciprocal NT withdrawal identity. */
export const frozenFinalizationResultSourceV8Schema = z.discriminatedUnion("kind", [
  ...frozenFinalizationResultSourceV7Schema.options,
  z.object({
    ...frozenSourceBase,
    kind: z.literal("MANUAL_WITHOUT_TIMING_WITHDRAWAL"),
    withoutTimingWithdrawalId: canonicalUuidSchema,
    withoutTimingDecisionId: canonicalUuidSchema,
    targetResultRevisionId: canonicalUuidSchema,
    withoutTimingResultRevisionId: canonicalUuidSchema,
    absoluteResultRevisionId: canonicalUuidSchema,
    absoluteResultRevision: positiveVersionSchema,
    restorationSourceResultRevisionId: canonicalUuidSchema
  }).strict()
]);

/** TASK 006W freezes verified start-checkin DNS separately from manual DNS. */
export const frozenFinalizationResultSourceV9Schema = z.discriminatedUnion("kind", [
  ...frozenFinalizationResultSourceV8Schema.options,
  z.object({
    ...frozenSourceBase,
    kind: z.literal("START_CHECKIN_DID_NOT_START"),
    startCheckinDnsDecisionId: canonicalUuidSchema,
    operationRequestId: canonicalUuidSchema,
    startCheckinRevisionId: canonicalUuidSchema,
    operationalRevision: positiveVersionSchema,
    withdrawal: z.null()
  }).strict()
]);

export const frozenFinalizationResultV1Schema = z.object({
  source: frozenFinalizationResultSourceV1Schema,
  personResult: frozenIofPersonProjectionV1Schema
}).strict();

export const frozenFinalizationResultV2Schema = z.object({
  source: frozenFinalizationResultSourceV2Schema,
  personResult: frozenIofPersonProjectionV2Schema
}).strict().superRefine((result, context) => {
  const expectedStatuses = result.source.kind === "MANUAL_DID_NOT_START"
    ? ["DNS"]
    : result.source.kind === "MANUAL_DISQUALIFICATION"
      ? ["DSQ"]
      : result.source.kind === "MANUAL_DISQUALIFICATION_WITHDRAWAL"
        ? ["OK", "MP"]
        : ["OK", "MP"];
  if (!expectedStatuses.includes(result.personResult.status)) {
    context.addIssue({ code: "custom", path: ["personResult", "status"], message: "Resultatstatus motsäger fryst proveniens" });
  }
});

export const frozenFinalizationResultV3Schema = z.object({
  source: frozenFinalizationResultSourceV3Schema,
  personResult: frozenIofPersonProjectionV3Schema
}).strict().superRefine((result, context) => {
  const expectedStatuses = result.source.kind === "MANUAL_DID_NOT_START"
    ? ["DNS"]
    : result.source.kind === "MANUAL_DISQUALIFICATION"
      ? ["DSQ"]
      : result.source.kind === "MANUAL_DISQUALIFICATION_WITHDRAWAL"
        ? ["OK", "MP"]
        : result.source.kind === "MANUAL_RESULT_APPROVAL"
          ? ["OK"]
          : ["OK", "MP"];
  if (!expectedStatuses.includes(result.personResult.status)) {
    context.addIssue({ code: "custom", path: ["personResult", "status"], message: "Resultatstatus motsäger fryst proveniens" });
  }
  if (result.source.kind === "MANUAL_RESULT_APPROVAL") {
    const proof = result.personResult.manualApprovalProof;
    if (proof === null || proof.decisionId !== result.source.resultApprovalDecisionId ||
        proof.targetResultRevisionId !== result.source.targetResultRevisionId) {
      context.addIssue({ code: "custom", path: ["personResult", "manualApprovalProof"], message: "Godkännandebeviset måste matcha fryst proveniens" });
    }
  } else if (result.personResult.manualApprovalProof !== null) {
    context.addIssue({ code: "custom", path: ["personResult", "manualApprovalProof"], message: "Endast aktivt manuellt godkännande får bära bevis" });
  }
});

export const frozenFinalizationResultV4Schema = z.object({
  source: frozenFinalizationResultSourceV4Schema,
  personResult: frozenIofPersonProjectionV4Schema
}).strict().superRefine((result, context) => {
  const expectedStatuses = result.source.kind === "MANUAL_DID_NOT_START"
    ? ["DNS"]
    : result.source.kind === "MANUAL_DID_NOT_FINISH"
      ? ["DNF"]
      : result.source.kind === "MANUAL_DISQUALIFICATION"
        ? ["DSQ"]
        : result.source.kind === "MANUAL_DISQUALIFICATION_WITHDRAWAL"
          ? ["OK", "MP"]
          : result.source.kind === "MANUAL_RESULT_APPROVAL"
            ? ["OK"]
            : ["OK", "MP"];
  if (!expectedStatuses.includes(result.personResult.status)) {
    context.addIssue({ code: "custom", path: ["personResult", "status"], message: "Resultatstatus motsäger fryst proveniens" });
  }
  if (result.source.kind === "MANUAL_RESULT_APPROVAL") {
    const proof = result.personResult.manualApprovalProof;
    if (proof === null || proof.decisionId !== result.source.resultApprovalDecisionId ||
        proof.targetResultRevisionId !== result.source.targetResultRevisionId) {
      context.addIssue({ code: "custom", path: ["personResult", "manualApprovalProof"], message: "Godkännandebeviset måste matcha fryst proveniens" });
    }
  } else if (result.personResult.manualApprovalProof !== null) {
    context.addIssue({ code: "custom", path: ["personResult", "manualApprovalProof"], message: "Endast aktivt manuellt godkännande får bära bevis" });
  }
});

export const frozenFinalizationResultV5Schema = z.object({
  source: frozenFinalizationResultSourceV5Schema,
  personResult: frozenIofPersonProjectionV5Schema
}).strict().superRefine((result, context) => {
  const expectedStatuses = result.source.kind === "MANUAL_DID_NOT_START"
    ? ["DNS"]
    : result.source.kind === "MANUAL_DID_NOT_FINISH"
      ? ["DNF"]
      : result.source.kind === "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
        ? ["OK", "MP"]
        : result.source.kind === "MANUAL_DISQUALIFICATION"
          ? ["DSQ"]
          : result.source.kind === "MANUAL_DISQUALIFICATION_WITHDRAWAL"
            ? ["OK", "MP"]
            : result.source.kind === "MANUAL_RESULT_APPROVAL"
              ? ["OK"]
              : ["OK", "MP"];
  if (!expectedStatuses.includes(result.personResult.status)) {
    context.addIssue({ code: "custom", path: ["personResult", "status"], message: "Resultatstatus motsäger fryst proveniens" });
  }
  if (result.source.kind === "MANUAL_RESULT_APPROVAL") {
    const proof = result.personResult.manualApprovalProof;
    if (proof === null || proof.decisionId !== result.source.resultApprovalDecisionId ||
        proof.targetResultRevisionId !== result.source.targetResultRevisionId) {
      context.addIssue({ code: "custom", path: ["personResult", "manualApprovalProof"], message: "Godkännandebeviset måste matcha fryst proveniens" });
    }
  } else if (result.personResult.manualApprovalProof !== null) {
    context.addIssue({ code: "custom", path: ["personResult", "manualApprovalProof"], message: "Endast aktivt manuellt godkännande får bära bevis" });
  }
});

export const frozenFinalizationResultV6Schema = z.object({
  source: frozenFinalizationResultSourceV6Schema,
  personResult: frozenIofPersonProjectionV6Schema
}).strict().superRefine((result, context) => {
  const expectedStatuses = result.source.kind === "MANUAL_DID_NOT_START"
    ? ["DNS"]
    : result.source.kind === "MANUAL_DID_NOT_FINISH"
      ? ["DNF"]
      : result.source.kind === "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
        ? ["OK", "MP"]
        : result.source.kind === "MANUAL_OUT_OF_COMPETITION"
          ? ["OOC"]
          : result.source.kind === "MANUAL_DISQUALIFICATION"
            ? ["DSQ"]
            : result.source.kind === "MANUAL_DISQUALIFICATION_WITHDRAWAL"
              ? ["OK", "MP"]
              : result.source.kind === "MANUAL_RESULT_APPROVAL"
                ? ["OK"]
                : ["OK", "MP"];
  if (!expectedStatuses.includes(result.personResult.status)) {
    context.addIssue({ code: "custom", path: ["personResult", "status"], message: "Resultatstatus motsäger fryst proveniens" });
  }
  if (result.source.kind === "MANUAL_RESULT_APPROVAL") {
    const proof = result.personResult.manualApprovalProof;
    if (proof === null || proof.decisionId !== result.source.resultApprovalDecisionId ||
        proof.targetResultRevisionId !== result.source.targetResultRevisionId) {
      context.addIssue({ code: "custom", path: ["personResult", "manualApprovalProof"], message: "Godkännandebeviset måste matcha fryst proveniens" });
    }
  } else if (result.personResult.manualApprovalProof !== null) {
    context.addIssue({ code: "custom", path: ["personResult", "manualApprovalProof"], message: "Endast aktivt manuellt godkännande får bära bevis" });
  }
});

export const frozenIofPersonProjectionV7Schema = frozenIofPersonProjectionV6Schema;

export const frozenFinalizationResultV7Schema = z.object({
  source: frozenFinalizationResultSourceV7Schema,
  personResult: frozenIofPersonProjectionV7Schema
}).strict().superRefine((result, context) => {
  const expectedStatuses = result.source.kind === "MANUAL_DID_NOT_START"
    ? ["DNS"]
    : result.source.kind === "MANUAL_DID_NOT_FINISH"
      ? ["DNF"]
      : result.source.kind === "MANUAL_DID_NOT_FINISH_WITHDRAWAL" ||
          result.source.kind === "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL" ||
          result.source.kind === "MANUAL_DISQUALIFICATION_WITHDRAWAL"
        ? ["OK", "MP"]
        : result.source.kind === "MANUAL_OUT_OF_COMPETITION"
          ? ["OOC"]
          : result.source.kind === "MANUAL_DISQUALIFICATION"
            ? ["DSQ"]
            : result.source.kind === "MANUAL_RESULT_APPROVAL"
              ? ["OK"]
              : ["OK", "MP"];
  if (!expectedStatuses.includes(result.personResult.status)) {
    context.addIssue({ code: "custom", path: ["personResult", "status"], message: "Resultatstatus motsäger fryst proveniens" });
  }
  if (result.source.kind === "MANUAL_RESULT_APPROVAL") {
    const proof = result.personResult.manualApprovalProof;
    if (proof === null || proof.decisionId !== result.source.resultApprovalDecisionId ||
        proof.targetResultRevisionId !== result.source.targetResultRevisionId) {
      context.addIssue({ code: "custom", path: ["personResult", "manualApprovalProof"], message: "Godkännandebeviset måste matcha fryst proveniens" });
    }
  } else if (result.personResult.manualApprovalProof !== null) {
    context.addIssue({ code: "custom", path: ["personResult", "manualApprovalProof"], message: "Endast aktivt manuellt godkännande får bära bevis" });
  }
});

export const frozenIofPersonProjectionV8Schema = frozenIofPersonProjectionV7Schema;

export const frozenIofPersonProjectionV9Schema = frozenIofPersonProjectionV8Schema;

export const frozenFinalizationResultV8Schema = z.object({
  source: frozenFinalizationResultSourceV8Schema,
  personResult: frozenIofPersonProjectionV8Schema
}).strict().superRefine((result, context) => {
  const expectedStatuses = result.source.kind === "MANUAL_DID_NOT_START"
    ? ["DNS"]
    : result.source.kind === "MANUAL_DID_NOT_FINISH"
      ? ["DNF"]
      : result.source.kind === "MANUAL_DID_NOT_FINISH_WITHDRAWAL" ||
          result.source.kind === "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL" ||
          result.source.kind === "MANUAL_WITHOUT_TIMING_WITHDRAWAL" ||
          result.source.kind === "MANUAL_DISQUALIFICATION_WITHDRAWAL"
        ? ["OK", "MP"]
        : result.source.kind === "MANUAL_OUT_OF_COMPETITION"
          ? ["OOC"]
          : result.source.kind === "MANUAL_DISQUALIFICATION"
            ? ["DSQ"]
            : result.source.kind === "MANUAL_RESULT_APPROVAL"
              ? ["OK"]
              : ["OK", "MP"];
  if (!expectedStatuses.includes(result.personResult.status)) {
    context.addIssue({ code: "custom", path: ["personResult", "status"], message: "Resultatstatus motsäger fryst proveniens" });
  }
  if (result.source.kind === "MANUAL_RESULT_APPROVAL") {
    const proof = result.personResult.manualApprovalProof;
    if (proof === null || proof.decisionId !== result.source.resultApprovalDecisionId ||
        proof.targetResultRevisionId !== result.source.targetResultRevisionId) {
      context.addIssue({ code: "custom", path: ["personResult", "manualApprovalProof"], message: "Godkännandebeviset måste matcha fryst proveniens" });
    }
  } else if (result.personResult.manualApprovalProof !== null) {
    context.addIssue({ code: "custom", path: ["personResult", "manualApprovalProof"], message: "Endast aktivt manuellt godkännande får bära bevis" });
  }
});

export const frozenFinalizationResultV9Schema = z.object({
  source: frozenFinalizationResultSourceV9Schema,
  personResult: frozenIofPersonProjectionV9Schema
}).strict().superRefine((result, context) => {
  const expectedStatuses = result.source.kind === "MANUAL_DID_NOT_START" ||
      result.source.kind === "START_CHECKIN_DID_NOT_START"
    ? ["DNS"]
    : result.source.kind === "MANUAL_DID_NOT_FINISH"
      ? ["DNF"]
      : result.source.kind === "MANUAL_DID_NOT_FINISH_WITHDRAWAL" ||
          result.source.kind === "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL" ||
          result.source.kind === "MANUAL_WITHOUT_TIMING_WITHDRAWAL" ||
          result.source.kind === "MANUAL_DISQUALIFICATION_WITHDRAWAL"
        ? ["OK", "MP"]
        : result.source.kind === "MANUAL_OUT_OF_COMPETITION"
          ? ["OOC"]
          : result.source.kind === "MANUAL_DISQUALIFICATION"
            ? ["DSQ"]
            : result.source.kind === "MANUAL_RESULT_APPROVAL"
              ? ["OK"]
              : ["OK", "MP"];
  if (!expectedStatuses.includes(result.personResult.status)) {
    context.addIssue({ code: "custom", path: ["personResult", "status"], message: "Resultatstatus motsäger fryst proveniens" });
  }
  if (result.source.kind === "MANUAL_RESULT_APPROVAL") {
    const proof = result.personResult.manualApprovalProof;
    if (proof === null || proof.decisionId !== result.source.resultApprovalDecisionId ||
        proof.targetResultRevisionId !== result.source.targetResultRevisionId) {
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

export const frozenClassDataV1Schema = z.object({
  name: z.string().trim().min(1).max(160),
  externalId: z.string().trim().min(1).max(160).nullable(),
  results: z.array(frozenFinalizationResultV1Schema).min(1).max(10_000)
}).strict().superRefine(validateFrozenClassData);

export const frozenClassDataV2Schema = z.object({
  name: z.string().trim().min(1).max(160),
  externalId: z.string().trim().min(1).max(160).nullable(),
  results: z.array(frozenFinalizationResultV2Schema).min(1).max(10_000)
}).strict().superRefine(validateFrozenClassData);

export const frozenClassDataV3Schema = z.object({
  name: z.string().trim().min(1).max(160),
  externalId: z.string().trim().min(1).max(160).nullable(),
  results: z.array(frozenFinalizationResultV3Schema).min(1).max(10_000)
}).strict().superRefine(validateFrozenClassData);

export const frozenClassDataV4Schema = z.object({
  name: z.string().trim().min(1).max(160),
  externalId: z.string().trim().min(1).max(160).nullable(),
  results: z.array(frozenFinalizationResultV4Schema).min(1).max(10_000)
}).strict().superRefine(validateFrozenClassData);

export const frozenClassDataV5Schema = z.object({
  name: z.string().trim().min(1).max(160),
  externalId: z.string().trim().min(1).max(160).nullable(),
  results: z.array(frozenFinalizationResultV5Schema).min(1).max(10_000)
}).strict().superRefine(validateFrozenClassData);

export const frozenClassDataV6Schema = z.object({
  name: z.string().trim().min(1).max(160),
  externalId: z.string().trim().min(1).max(160).nullable(),
  results: z.array(frozenFinalizationResultV6Schema).min(1).max(10_000)
}).strict().superRefine(validateFrozenClassData);

export const frozenClassDataV7Schema = z.object({
  name: z.string().trim().min(1).max(160),
  externalId: z.string().trim().min(1).max(160).nullable(),
  results: z.array(frozenFinalizationResultV7Schema).min(1).max(10_000)
}).strict().superRefine(validateFrozenClassData);

export const frozenClassDataV8Schema = z.object({
  name: z.string().trim().min(1).max(160),
  externalId: z.string().trim().min(1).max(160).nullable(),
  results: z.array(frozenFinalizationResultV8Schema).min(1).max(10_000)
}).strict().superRefine(validateFrozenClassData);

export const frozenClassDataV9Schema = z.object({
  name: z.string().trim().min(1).max(160),
  externalId: z.string().trim().min(1).max(160).nullable(),
  results: z.array(frozenFinalizationResultV9Schema).min(1).max(10_000)
}).strict().superRefine(validateFrozenClassData);

/**
 * Private persisted CLASS projection. It intentionally contains the PII and
 * source IDs needed to reproduce a result document; it is never an HTTP DTO.
 */
export const frozenClassFinalizationProjectionV1Schema = z.object({
  formatVersion: z.literal(1),
  scope: z.literal("CLASS"),
  raceId: canonicalUuidSchema,
  classId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  basisSha256: sha256Schema,
  class: frozenClassDataV1Schema
}).strict();

export const frozenClassFinalizationProjectionV2Schema = z.object({
  formatVersion: z.literal(2),
  scope: z.literal("CLASS"),
  raceId: canonicalUuidSchema,
  classId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  basisSha256: sha256Schema,
  class: frozenClassDataV2Schema
}).strict();

export const frozenClassFinalizationProjectionV3Schema = z.object({
  formatVersion: z.literal(3),
  scope: z.literal("CLASS"),
  raceId: canonicalUuidSchema,
  classId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  basisSha256: sha256Schema,
  class: frozenClassDataV3Schema
}).strict();

export const frozenClassFinalizationProjectionV4Schema = z.object({
  formatVersion: z.literal(4),
  scope: z.literal("CLASS"),
  raceId: canonicalUuidSchema,
  classId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  basisSha256: sha256Schema,
  class: frozenClassDataV4Schema
}).strict();

export const frozenClassFinalizationProjectionV5Schema = z.object({
  formatVersion: z.literal(5),
  scope: z.literal("CLASS"),
  raceId: canonicalUuidSchema,
  classId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  basisSha256: sha256Schema,
  class: frozenClassDataV5Schema
}).strict();

export const frozenClassFinalizationProjectionV6Schema = z.object({
  formatVersion: z.literal(6),
  scope: z.literal("CLASS"),
  raceId: canonicalUuidSchema,
  classId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  basisSha256: sha256Schema,
  class: frozenClassDataV6Schema
}).strict();

export const frozenClassFinalizationProjectionV7Schema = z.object({
  formatVersion: z.literal(7),
  scope: z.literal("CLASS"),
  raceId: canonicalUuidSchema,
  classId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  basisSha256: sha256Schema,
  class: frozenClassDataV7Schema
}).strict();

export const frozenClassFinalizationProjectionV8Schema = z.object({
  formatVersion: z.literal(8),
  scope: z.literal("CLASS"),
  raceId: canonicalUuidSchema,
  classId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  basisSha256: sha256Schema,
  class: frozenClassDataV8Schema
}).strict();

export const frozenClassFinalizationProjectionV9Schema = z.object({
  formatVersion: z.literal(9),
  scope: z.literal("CLASS"),
  raceId: canonicalUuidSchema,
  classId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  basisSha256: sha256Schema,
  class: frozenClassDataV9Schema
}).strict();

export const frozenClassFinalizationProjectionSchema = z.discriminatedUnion("formatVersion", [
  frozenClassFinalizationProjectionV1Schema,
  frozenClassFinalizationProjectionV2Schema,
  frozenClassFinalizationProjectionV3Schema,
  frozenClassFinalizationProjectionV4Schema,
  frozenClassFinalizationProjectionV5Schema,
  frozenClassFinalizationProjectionV6Schema,
  frozenClassFinalizationProjectionV7Schema,
  frozenClassFinalizationProjectionV8Schema,
  frozenClassFinalizationProjectionV9Schema
]);

const selectedFrozenClassV1Schema = z.object({
  classFinalizationId: canonicalUuidSchema,
  classFinalizationRevision: positiveVersionSchema,
  classBasisSha256: sha256Schema,
  classId: canonicalUuidSchema,
  class: frozenClassDataV1Schema
}).strict();

const selectedFrozenClassV2Schema = z.object({
  classFinalizationId: canonicalUuidSchema,
  classFinalizationRevision: positiveVersionSchema,
  classBasisSha256: sha256Schema,
  classId: canonicalUuidSchema,
  class: frozenClassDataV2Schema
}).strict();

const selectedFrozenClassV3Schema = z.object({
  classFinalizationId: canonicalUuidSchema,
  classFinalizationRevision: positiveVersionSchema,
  classBasisSha256: sha256Schema,
  classId: canonicalUuidSchema,
  class: frozenClassDataV3Schema
}).strict();

const selectedFrozenClassV4Schema = z.object({
  classFinalizationId: canonicalUuidSchema,
  classFinalizationRevision: positiveVersionSchema,
  classBasisSha256: sha256Schema,
  classId: canonicalUuidSchema,
  class: frozenClassDataV4Schema
}).strict();

const selectedFrozenClassV5Schema = z.object({
  classFinalizationId: canonicalUuidSchema,
  classFinalizationRevision: positiveVersionSchema,
  classBasisSha256: sha256Schema,
  classId: canonicalUuidSchema,
  class: frozenClassDataV5Schema
}).strict();

const selectedFrozenClassV6Schema = z.object({
  classFinalizationId: canonicalUuidSchema,
  classFinalizationRevision: positiveVersionSchema,
  classBasisSha256: sha256Schema,
  classId: canonicalUuidSchema,
  class: frozenClassDataV6Schema
}).strict();

const selectedFrozenClassV7Schema = z.object({
  classFinalizationId: canonicalUuidSchema,
  classFinalizationRevision: positiveVersionSchema,
  classBasisSha256: sha256Schema,
  classId: canonicalUuidSchema,
  class: frozenClassDataV7Schema
}).strict();

const selectedFrozenClassV8Schema = z.object({
  classFinalizationId: canonicalUuidSchema,
  classFinalizationRevision: positiveVersionSchema,
  classBasisSha256: sha256Schema,
  classId: canonicalUuidSchema,
  class: frozenClassDataV8Schema
}).strict();

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
export const frozenRaceFinalizationProjectionV1Schema = z.object({
  formatVersion: z.literal(1),
  scope: z.literal("RACE"),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  basisSha256: sha256Schema,
  eventName: z.string().trim().min(1).max(160),
  classes: z.array(selectedFrozenClassV1Schema).min(1).max(1_000)
}).strict().superRefine(validateFrozenRaceProjection);

export const frozenRaceFinalizationProjectionV2Schema = z.object({
  formatVersion: z.literal(2),
  scope: z.literal("RACE"),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  basisSha256: sha256Schema,
  eventName: z.string().trim().min(1).max(160),
  classes: z.array(selectedFrozenClassV2Schema).min(1).max(1_000)
}).strict().superRefine(validateFrozenRaceProjection);

export const frozenRaceFinalizationProjectionV3Schema = z.object({
  formatVersion: z.literal(3),
  scope: z.literal("RACE"),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  basisSha256: sha256Schema,
  eventName: z.string().trim().min(1).max(160),
  classes: z.array(selectedFrozenClassV3Schema).min(1).max(1_000)
}).strict().superRefine(validateFrozenRaceProjection);

export const frozenRaceFinalizationProjectionV4Schema = z.object({
  formatVersion: z.literal(4),
  scope: z.literal("RACE"),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  basisSha256: sha256Schema,
  eventName: z.string().trim().min(1).max(160),
  classes: z.array(selectedFrozenClassV4Schema).min(1).max(1_000)
}).strict().superRefine(validateFrozenRaceProjection);

export const frozenRaceFinalizationProjectionV5Schema = z.object({
  formatVersion: z.literal(5),
  scope: z.literal("RACE"),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  basisSha256: sha256Schema,
  eventName: z.string().trim().min(1).max(160),
  classes: z.array(selectedFrozenClassV5Schema).min(1).max(1_000)
}).strict().superRefine(validateFrozenRaceProjection);

export const frozenRaceFinalizationProjectionV6Schema = z.object({
  formatVersion: z.literal(6),
  scope: z.literal("RACE"),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  basisSha256: sha256Schema,
  eventName: z.string().trim().min(1).max(160),
  classes: z.array(selectedFrozenClassV6Schema).min(1).max(1_000)
}).strict().superRefine(validateFrozenRaceProjection);

export const frozenRaceFinalizationProjectionV7Schema = z.object({
  formatVersion: z.literal(7),
  scope: z.literal("RACE"),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  basisSha256: sha256Schema,
  eventName: z.string().trim().min(1).max(160),
  classes: z.array(selectedFrozenClassV7Schema).min(1).max(1_000)
}).strict().superRefine(validateFrozenRaceProjection);

export const frozenRaceFinalizationProjectionV8Schema = z.object({
  formatVersion: z.literal(8),
  scope: z.literal("RACE"),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  basisSha256: sha256Schema,
  eventName: z.string().trim().min(1).max(160),
  classes: z.array(selectedFrozenClassV8Schema).min(1).max(1_000)
}).strict().superRefine(validateFrozenRaceProjection);

export const frozenRaceFinalizationProjectionV9Schema = z.object({
  formatVersion: z.literal(9),
  scope: z.literal("RACE"),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  basisSha256: sha256Schema,
  eventName: z.string().trim().min(1).max(160),
  classes: z.array(selectedFrozenClassV9Schema).min(1).max(1_000)
}).strict().superRefine(validateFrozenRaceProjection);

export const frozenRaceFinalizationProjectionSchema = z.discriminatedUnion("formatVersion", [
  frozenRaceFinalizationProjectionV1Schema,
  frozenRaceFinalizationProjectionV2Schema,
  frozenRaceFinalizationProjectionV3Schema,
  frozenRaceFinalizationProjectionV4Schema,
  frozenRaceFinalizationProjectionV5Schema,
  frozenRaceFinalizationProjectionV6Schema,
  frozenRaceFinalizationProjectionV7Schema,
  frozenRaceFinalizationProjectionV8Schema,
  frozenRaceFinalizationProjectionV9Schema
]);

export const frozenResultFinalizationProjectionSchema = z.union([
  frozenClassFinalizationProjectionV1Schema,
  frozenRaceFinalizationProjectionV1Schema,
  frozenClassFinalizationProjectionV2Schema,
  frozenRaceFinalizationProjectionV2Schema,
  frozenClassFinalizationProjectionV3Schema,
  frozenRaceFinalizationProjectionV3Schema,
  frozenClassFinalizationProjectionV4Schema,
  frozenRaceFinalizationProjectionV4Schema,
  frozenClassFinalizationProjectionV5Schema,
  frozenRaceFinalizationProjectionV5Schema,
  frozenClassFinalizationProjectionV6Schema,
  frozenRaceFinalizationProjectionV6Schema,
  frozenClassFinalizationProjectionV7Schema,
  frozenRaceFinalizationProjectionV7Schema,
  frozenClassFinalizationProjectionV8Schema,
  frozenRaceFinalizationProjectionV8Schema,
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
export type ResultFinalizationAdminLoginRequest = z.infer<typeof resultFinalizationAdminLoginRequestSchema>;
export type ResultFinalizationAdminLoginResponse = z.infer<typeof resultFinalizationAdminLoginResponseSchema>;
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
export type FrozenIofPersonProjectionV1 = z.infer<typeof frozenIofPersonProjectionV1Schema>;
export type FrozenIofPersonProjectionV2 = z.infer<typeof frozenIofPersonProjectionV2Schema>;
export type FrozenIofPersonProjectionV3 = z.infer<typeof frozenIofPersonProjectionV3Schema>;
export type FrozenIofPersonProjectionV4 = z.infer<typeof frozenIofPersonProjectionV4Schema>;
export type FrozenIofPersonProjectionV5 = z.infer<typeof frozenIofPersonProjectionV5Schema>;
export type FrozenIofPersonProjectionV6 = z.infer<typeof frozenIofPersonProjectionV6Schema>;
export type FrozenIofPersonProjectionV7 = z.infer<typeof frozenIofPersonProjectionV7Schema>;
export type FrozenIofPersonProjectionV8 = z.infer<typeof frozenIofPersonProjectionV8Schema>;
export type FrozenIofPersonProjectionV9 = z.infer<typeof frozenIofPersonProjectionV9Schema>;
export type FrozenIofPersonProjection = z.infer<typeof frozenIofPersonProjectionSchema>;
export type FrozenFinalizationResultSourceV1 = z.infer<typeof frozenFinalizationResultSourceV1Schema>;
export type FrozenFinalizationResultSourceV2 = z.infer<typeof frozenFinalizationResultSourceV2Schema>;
export type FrozenFinalizationResultSourceV3 = z.infer<typeof frozenFinalizationResultSourceV3Schema>;
export type FrozenFinalizationResultSourceV4 = z.infer<typeof frozenFinalizationResultSourceV4Schema>;
export type FrozenFinalizationResultSourceV5 = z.infer<typeof frozenFinalizationResultSourceV5Schema>;
export type FrozenFinalizationResultSourceV6 = z.infer<typeof frozenFinalizationResultSourceV6Schema>;
export type FrozenFinalizationResultSourceV7 = z.infer<typeof frozenFinalizationResultSourceV7Schema>;
export type FrozenFinalizationResultSourceV8 = z.infer<typeof frozenFinalizationResultSourceV8Schema>;
export type FrozenFinalizationResultSourceV9 = z.infer<typeof frozenFinalizationResultSourceV9Schema>;
export type FrozenClassFinalizationProjectionV1 = z.infer<typeof frozenClassFinalizationProjectionV1Schema>;
export type FrozenClassFinalizationProjectionV2 = z.infer<typeof frozenClassFinalizationProjectionV2Schema>;
export type FrozenClassFinalizationProjectionV3 = z.infer<typeof frozenClassFinalizationProjectionV3Schema>;
export type FrozenClassFinalizationProjectionV4 = z.infer<typeof frozenClassFinalizationProjectionV4Schema>;
export type FrozenClassFinalizationProjectionV5 = z.infer<typeof frozenClassFinalizationProjectionV5Schema>;
export type FrozenClassFinalizationProjectionV6 = z.infer<typeof frozenClassFinalizationProjectionV6Schema>;
export type FrozenClassFinalizationProjectionV7 = z.infer<typeof frozenClassFinalizationProjectionV7Schema>;
export type FrozenClassFinalizationProjectionV8 = z.infer<typeof frozenClassFinalizationProjectionV8Schema>;
export type FrozenClassFinalizationProjectionV9 = z.infer<typeof frozenClassFinalizationProjectionV9Schema>;
export type FrozenClassFinalizationProjection = z.infer<typeof frozenClassFinalizationProjectionSchema>;
export type FrozenRaceFinalizationProjectionV1 = z.infer<typeof frozenRaceFinalizationProjectionV1Schema>;
export type FrozenRaceFinalizationProjectionV2 = z.infer<typeof frozenRaceFinalizationProjectionV2Schema>;
export type FrozenRaceFinalizationProjectionV3 = z.infer<typeof frozenRaceFinalizationProjectionV3Schema>;
export type FrozenRaceFinalizationProjectionV4 = z.infer<typeof frozenRaceFinalizationProjectionV4Schema>;
export type FrozenRaceFinalizationProjectionV5 = z.infer<typeof frozenRaceFinalizationProjectionV5Schema>;
export type FrozenRaceFinalizationProjectionV6 = z.infer<typeof frozenRaceFinalizationProjectionV6Schema>;
export type FrozenRaceFinalizationProjectionV7 = z.infer<typeof frozenRaceFinalizationProjectionV7Schema>;
export type FrozenRaceFinalizationProjectionV8 = z.infer<typeof frozenRaceFinalizationProjectionV8Schema>;
export type FrozenRaceFinalizationProjectionV9 = z.infer<typeof frozenRaceFinalizationProjectionV9Schema>;
export type FrozenRaceFinalizationProjection = z.infer<typeof frozenRaceFinalizationProjectionSchema>;
export type FrozenResultFinalizationProjection = z.infer<typeof frozenResultFinalizationProjectionSchema>;
export type ResultFinalizationAdminErrorCode = z.infer<typeof resultFinalizationAdminErrorCodeSchema>;

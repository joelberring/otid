import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  canonicalJsonBytes,
  classResultFinalizationMetadataSchema,
  frozenClassFinalizationProjectionSchema,
  frozenRaceFinalizationListResponseSchema,
  frozenRaceFinalizationProjectionSchema,
  publicFrozenRaceResultsResponseSchema,
  raceResultFinalizationMetadataSchema,
  resultFinalizationCandidateResponseSchema,
  resultFinalizationIdempotencyKeySchema,
  resultFinalizationRequestSchema,
  resultFinalizationResponseSchema,
  type ClassResultFinalizationMetadata,
  type FrozenClassFinalizationProjection,
  type FrozenFinalizationResultSourceV9,
  type FrozenIofPersonProjection,
  type FrozenIofPersonProjectionV9,
  type FrozenRaceFinalizationListResponse,
  type FrozenRaceFinalizationProjection,
  type FrozenRaceFinalizationProjectionV9,
  type PublicFrozenRaceResultsResponse,
  type RaceResultFinalizationMetadata,
  type ResultFinalizationBlockerCode,
  type ResultFinalizationCandidateResponse,
  type ResultFinalizationRequest,
  type ResultFinalizationResponse
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import { ClassRankingError, compareResultStatuses, rankClassResults } from "@o-tid/domain";
import {
  serializeIofResultList,
  type IofResultListClass,
  type IofResultListPersonResult
} from "@o-tid/iof-xml";
import {
  authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { StoredResultRevisionConflict, parseStrictStoredResultRevision } from "./stored-result-revision";
import { isEffectiveResultCurrent, loadResultBasisHashes } from "./result-basis";
import { loadCourseVersionVariants } from "./course-variants";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_CLASSES = 1_000;
const MAX_RESULTS = 10_000;
const MAX_EXPECTED_CONTROLS = 256;

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type ResultFinalizationRow = typeof schema.resultFinalizations.$inferSelect;

export type ResultFinalizationCandidateResult =
  | { status: "unauthorized" | "forbidden" | "not-found" | "conflict" | "too-large" }
  | { status: "ok"; response: ResultFinalizationCandidateResponse };

export type FinalizeResultsInput = Omit<PairingAdminRequestAuthentication, "capability"> & {
  idempotencyKey: string | null;
  request: unknown;
};

export type FinalizeResultsResult =
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" | "too-large" }
  | { status: "finalized"; response: ResultFinalizationResponse };

export type FrozenRaceFinalizationListResult =
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "ok"; response: FrozenRaceFinalizationListResponse };

export type FrozenIofResultListExportResult =
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "ok"; bytes: Uint8Array; finalization: RaceResultFinalizationMetadata };

export type PublicFrozenRaceResultsResult =
  | { status: "not-found" | "conflict" }
  | { status: "ok"; response: PublicFrozenRaceResultsResponse };

export type LatestPublicFrozenRaceFinalizationResult =
  | { status: "not-found" | "conflict" }
  | { status: "ok"; finalizationId: string };

export interface ResultFinalizationRuntimeOptions {
  readonly now?: Date;
  readonly finalizationId?: string;
}

class StoredFinalizationConflict extends Error {}
class FinalizationTooLarge extends Error {}

const BLOCKER_ORDER: readonly ResultFinalizationBlockerCode[] = [
  "EMPTY_CLASS",
  "NO_ENTRIES",
  "MISSING_RESULT_REVISION",
  "WITHDRAWN_DID_NOT_START",
  "LATEST_RESULT_UNPUBLISHED",
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
];

function sortedBlockers(values: ReadonlySet<ResultFinalizationBlockerCode>): ResultFinalizationBlockerCode[] {
  return BLOCKER_ORDER.filter((value) => values.has(value));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function optionalIofId(source: string | null, externalId: string | null): string | null {
  return source === "iof" && externalId !== null && externalId.length > 0 ? externalId : null;
}

function sha256Bytes(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalHash(value: unknown): string {
  return sha256Bytes(canonicalJsonBytes(value));
}

// Den frysta grunden har ett fast format; underlagshashen (ADR-0169) ingår inte i den.
function resultRevisionBasis(revision: Omit<typeof schema.resultRevisions.$inferSelect, "basisHash">) {
  return {
    id: revision.id,
    raceId: revision.raceId,
    entryId: revision.entryId,
    readoutId: revision.readoutId,
    didNotStartDecisionId: revision.didNotStartDecisionId,
    startCheckinDnsDecisionId: revision.startCheckinDnsDecisionId,
    disqualificationDecisionId: revision.disqualificationDecisionId,
    disqualificationWithdrawalId: revision.disqualificationWithdrawalId,
    approvalDecisionId: revision.approvalDecisionId,
    approvalWithdrawalId: revision.approvalWithdrawalId,
    didNotFinishDecisionId: revision.didNotFinishDecisionId,
    didNotFinishWithdrawalId: revision.didNotFinishWithdrawalId,
    notCompetingDecisionId: revision.notCompetingDecisionId,
    notCompetingWithdrawalId: revision.notCompetingWithdrawalId,
    withoutTimingDecisionId: revision.withoutTimingDecisionId,
    withoutTimingWithdrawalId: revision.withoutTimingWithdrawalId,
    controlNeutralizationId: revision.controlNeutralizationId,
    revision: revision.revision,
    cause: revision.cause,
    status: revision.status,
    reason: revision.reason,
    evaluation: revision.evaluation,
    engineVersion: revision.engineVersion,
    snapshotVersion: revision.snapshotVersion,
    courseVersionId: revision.courseVersionId,
    published: revision.published,
    createdAt: revision.createdAt.toISOString()
  };
}

function expectedControls(rows: readonly { sequence: number; controlCode: number }[]) {
  const occurrences = new Map<number, number>();
  return rows.map((row, index) => {
    if (!Number.isSafeInteger(row.sequence) || row.sequence !== index + 1 ||
        !Number.isSafeInteger(row.controlCode) || row.controlCode < 1) {
      throw new StoredFinalizationConflict("Ogiltig bankontroll");
    }
    const occurrence = (occurrences.get(row.controlCode) ?? 0) + 1;
    occurrences.set(row.controlCode, occurrence);
    return { controlCode: row.controlCode, occurrence };
  });
}

function asIofPerson(result: FrozenIofPersonProjection): IofResultListPersonResult {
  const identity = {
    givenName: result.givenName,
    familyName: result.familyName,
    ...(result.entryExternalId === null ? {} : { entryExternalId: result.entryExternalId }),
    ...(result.organisationName === null ? {} : { organisationName: result.organisationName })
  };
  if (result.status === "DNF") return { ...identity, status: "DNF" };
  if (result.status === "OOC") {
    return {
      ...identity,
      status: "OOC",
      expectedControls: result.expectedControls,
      splits: result.splits,
      ...(result.startTime === null ? {} : { startTime: result.startTime }),
      ...(result.finishTime === null ? {} : { finishTime: result.finishTime }),
      ...(result.elapsedMs === null ? {} : { elapsedMs: result.elapsedMs })
    };
  }
  return {
    ...identity,
    status: result.status,
    expectedControls: result.expectedControls,
    splits: result.splits,
    ...(result.startTime === null ? {} : { startTime: result.startTime }),
    ...(result.finishTime === null ? {} : { finishTime: result.finishTime }),
    ...(result.elapsedMs === null ? {} : { elapsedMs: result.elapsedMs }),
    ...(result.position === null ? {} : { position: result.position }),
    ...(result.timeBehindMs === null ? {} : { timeBehindMs: result.timeBehindMs }),
    ...("manualApprovalProof" in result && result.manualApprovalProof !== null
      ? { manualApprovalProof: result.manualApprovalProof }
      : {})
  };
}

function asIofClass(value: { name: string; externalId: string | null; results: readonly { personResult: FrozenIofPersonProjection }[] }): IofResultListClass {
  return {
    className: value.name,
    results: value.results.map((result) => asIofPerson(result.personResult)),
    ...(value.externalId === null ? {} : { classExternalId: value.externalId })
  };
}

function finalizationMetadata(row: ResultFinalizationRow): ClassResultFinalizationMetadata | RaceResultFinalizationMetadata {
  const frozenProjectionHash = canonicalHash(row.frozenProjection);
  if (row.scope === "CLASS") {
    const projection = frozenClassFinalizationProjectionSchema.parse(row.frozenProjection);
    if (row.classId === null || projection.raceId !== row.raceId || projection.classId !== row.classId ||
        projection.snapshotVersion !== row.sourceSnapshotVersion || projection.basisSha256 !== row.sourceHash ||
        row.completeXml !== null || row.completeXmlHash !== null) {
      throw new StoredFinalizationConflict("Klassfinaliseringen motsäger sin frysta projektion");
    }
    return classResultFinalizationMetadataSchema.parse({
      id: row.id,
      raceId: row.raceId,
      scope: "CLASS",
      classId: row.classId,
      scopeRevision: row.scopeRevision,
      sourceSnapshotVersion: row.sourceSnapshotVersion,
      basisHash: row.sourceHash,
      frozenProjectionHash,
      entryCount: projection.class.results.length,
      classCount: 1,
      completeXmlSha256: null,
      finalizedAt: row.finalizedAt.toISOString()
    });
  }

  const projection = frozenRaceFinalizationProjectionSchema.parse(row.frozenProjection);
  if (row.classId !== null || projection.raceId !== row.raceId ||
      projection.snapshotVersion !== row.sourceSnapshotVersion || projection.basisSha256 !== row.sourceHash ||
      row.completeXml === null || row.completeXmlHash === null || sha256Bytes(row.completeXml) !== row.completeXmlHash) {
    throw new StoredFinalizationConflict("Loppsfinaliseringen motsäger sin frysta projektion eller XML");
  }
  return raceResultFinalizationMetadataSchema.parse({
    id: row.id,
    raceId: row.raceId,
    scope: "RACE",
    classId: null,
    scopeRevision: row.scopeRevision,
    sourceSnapshotVersion: row.sourceSnapshotVersion,
    basisHash: row.sourceHash,
    frozenProjectionHash,
    entryCount: projection.classes.reduce((total, raceClass) => total + raceClass.class.results.length, 0),
    classCount: projection.classes.length,
    completeXmlSha256: row.completeXmlHash,
    finalizedAt: row.finalizedAt.toISOString()
  });
}

interface LockedRace {
  readonly id: string;
  readonly eventId: string;
  readonly snapshotVersion: number;
}

interface BuiltBasis {
  readonly response: ResultFinalizationCandidateResponse;
  readonly classProjectionById: ReadonlyMap<string, FrozenClassFinalizationProjection>;
  readonly raceProjection?: FrozenRaceFinalizationProjection;
}

async function buildFinalizationBasis(tx: DatabaseTransaction, race: LockedRace): Promise<BuiltBasis> {
  const [eventRows, siblingRaces, classRows, entryRows, latestRows, unresolvedRows, finalizationRows] = await Promise.all([
    tx.select({ name: schema.events.name }).from(schema.events)
      .where(eq(schema.events.id, race.eventId)).limit(1),
    tx.select({ id: schema.races.id }).from(schema.races)
      .where(eq(schema.races.eventId, race.eventId)).orderBy(asc(schema.races.id)).limit(2),
    tx.select({
      id: schema.classes.id,
      name: schema.classes.name,
      courseVersionId: schema.classes.courseVersionId,
      externalSource: schema.classes.externalSource,
      externalId: schema.classes.externalId
    }).from(schema.classes).where(eq(schema.classes.raceId, race.id))
      .orderBy(asc(schema.classes.name), asc(schema.classes.id)).limit(MAX_CLASSES + 1),
    tx.select({
      id: schema.entries.id,
      classId: schema.entries.classId,
      givenName: schema.entries.givenName,
      familyName: schema.entries.familyName,
      organisationName: schema.entries.organisationName,
      externalSource: schema.entries.externalSource,
      externalId: schema.entries.externalId,
      courseVariantCode: schema.entries.courseVariantCode
    }).from(schema.entries).where(eq(schema.entries.raceId, race.id))
      .orderBy(asc(schema.entries.classId), asc(schema.entries.familyName), asc(schema.entries.givenName), asc(schema.entries.id))
      .limit(MAX_RESULTS + 1),
    tx.selectDistinctOn([schema.resultRevisions.entryId], {
      id: schema.resultRevisions.id,
      raceId: schema.resultRevisions.raceId,
      entryId: schema.resultRevisions.entryId,
      revision: schema.resultRevisions.revision,
      status: schema.resultRevisions.status,
      reason: schema.resultRevisions.reason,
      cause: schema.resultRevisions.cause,
      readoutId: schema.resultRevisions.readoutId,
      didNotStartDecisionId: schema.resultRevisions.didNotStartDecisionId,
      startCheckinDnsDecisionId: schema.resultRevisions.startCheckinDnsDecisionId,
      controlNeutralizationId: schema.resultRevisions.controlNeutralizationId,
      disqualificationDecisionId: schema.resultRevisions.disqualificationDecisionId,
      disqualificationWithdrawalId: schema.resultRevisions.disqualificationWithdrawalId,
      approvalDecisionId: schema.resultRevisions.approvalDecisionId,
      approvalWithdrawalId: schema.resultRevisions.approvalWithdrawalId,
      didNotFinishDecisionId: schema.resultRevisions.didNotFinishDecisionId,
      didNotFinishWithdrawalId: schema.resultRevisions.didNotFinishWithdrawalId,
      notCompetingDecisionId: schema.resultRevisions.notCompetingDecisionId,
      notCompetingWithdrawalId: schema.resultRevisions.notCompetingWithdrawalId,
      withoutTimingDecisionId: schema.resultRevisions.withoutTimingDecisionId,
      withoutTimingWithdrawalId: schema.resultRevisions.withoutTimingWithdrawalId,
      manualFinishTimeCorrectionId: schema.resultRevisions.manualFinishTimeCorrectionId,
      manualFinishTimeCorrectionWithdrawalId: schema.resultRevisions.manualFinishTimeCorrectionWithdrawalId,
      manualPunchStartTimeCorrectionId: schema.resultRevisions.manualPunchStartTimeCorrectionId,
      manualPunchStartTimeCorrectionWithdrawalId: schema.resultRevisions.manualPunchStartTimeCorrectionWithdrawalId,
      shortenedCourseClassTransferId: schema.resultRevisions.shortenedCourseClassTransferId,
      evaluation: schema.resultRevisions.evaluation,
      engineVersion: schema.resultRevisions.engineVersion,
      snapshotVersion: schema.resultRevisions.snapshotVersion,
      basisHash: schema.resultRevisions.basisHash,
      courseVersionId: schema.resultRevisions.courseVersionId,
      published: schema.resultRevisions.published,
      createdAt: schema.resultRevisions.createdAt
    }).from(schema.resultRevisions)
      .innerJoin(schema.entries, and(
        eq(schema.resultRevisions.entryId, schema.entries.id),
        eq(schema.entries.raceId, race.id)
      ))
      .where(eq(schema.resultRevisions.raceId, race.id))
      .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id))
      .limit(MAX_RESULTS + 1),
    tx.select({ value: count(schema.cardReadouts.id) }).from(schema.cardReadouts)
      .innerJoin(schema.deviceIngestOutcomes, eq(schema.cardReadouts.rawMessageId, schema.deviceIngestOutcomes.rawMessageId))
      .leftJoin(schema.resultRevisions, eq(schema.cardReadouts.id, schema.resultRevisions.readoutId))
      .leftJoin(schema.unknownReadoutResolutions,
        eq(schema.cardReadouts.id, schema.unknownReadoutResolutions.readoutId))
      .where(and(
        eq(schema.cardReadouts.raceId, race.id),
        sql`${schema.deviceIngestOutcomes.serverResult}->>'status' = 'UNKNOWN_CARD'`,
        isNull(schema.resultRevisions.id),
        isNull(schema.unknownReadoutResolutions.requestId)
      )),
    tx.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.raceId, race.id))
      .orderBy(asc(schema.resultFinalizations.scope), asc(schema.resultFinalizations.classId), desc(schema.resultFinalizations.scopeRevision))
  ]);

  if (!eventRows[0]) throw new StoredFinalizationConflict("Eventet saknas");
  if (classRows.length > MAX_CLASSES || entryRows.length > MAX_RESULTS || latestRows.length > MAX_RESULTS) {
    throw new FinalizationTooLarge();
  }

  const latestStates = await resolveStoredResultHeadStates(tx, race.id, latestRows);
  const basisHashes = await loadResultBasisHashes(tx, race.id);
  const latestStateByEntry = new Map(latestStates.map((state) => [state.head.entryId, state]));

  const courseVersionIds = [...new Set(classRows.map((raceClass) => raceClass.courseVersionId))];
  const controlRows = courseVersionIds.length === 0 ? [] : await tx.select({
    courseVersionId: schema.courseControls.courseVersionId,
    sequence: schema.courseControls.sequence,
    controlCode: schema.controls.code,
    controlRaceId: schema.controls.raceId
  }).from(schema.courseControls)
    .innerJoin(schema.controls, eq(schema.courseControls.controlId, schema.controls.id))
    .where(inArray(schema.courseControls.courseVersionId, courseVersionIds))
    .orderBy(asc(schema.courseControls.courseVersionId), asc(schema.courseControls.sequence), asc(schema.courseControls.id));

  const controlsByVersion = new Map<string, Array<{ sequence: number; controlCode: number }>>();
  for (const row of controlRows) {
    if (row.controlRaceId !== race.id) throw new StoredFinalizationConflict("Bankontrollen tillhör ett annat lopp");
    const controls = controlsByVersion.get(row.courseVersionId) ?? [];
    controls.push({ sequence: row.sequence, controlCode: row.controlCode });
    if (controls.length > MAX_EXPECTED_CONTROLS) throw new FinalizationTooLarge();
    controlsByVersion.set(row.courseVersionId, controls);
  }

  // Gafflad bana: varje löpare har sin variants kontroller (ADR-0169 beslut 2).
  const variantsByVersion = await loadCourseVersionVariants(tx, courseVersionIds);
  const entriesByClass = new Map<string, typeof entryRows>();
  for (const entry of entryRows) {
    const entries = entriesByClass.get(entry.classId) ?? [];
    entries.push(entry);
    entriesByClass.set(entry.classId, entries);
  }
  const latestByEntry = new Map(latestRows.map((row) => [row.entryId, row]));

  const latestClassFinalizationByClass = new Map<string, ResultFinalizationRow>();
  let latestRaceFinalization: ResultFinalizationRow | undefined;
  for (const row of finalizationRows) {
    if (row.scope === "CLASS" && row.classId !== null && !latestClassFinalizationByClass.has(row.classId)) {
      latestClassFinalizationByClass.set(row.classId, row);
    }
    if (row.scope === "RACE" && latestRaceFinalization === undefined) latestRaceFinalization = row;
  }

  const classProjectionById = new Map<string, FrozenClassFinalizationProjection>();
  const classCandidates: ResultFinalizationCandidateResponse["classes"] = [];
  for (const raceClass of classRows) {
    const entries = entriesByClass.get(raceClass.id) ?? [];
    const blockers = new Set<ResultFinalizationBlockerCode>();
    if (entries.length === 0) blockers.add("EMPTY_CLASS");
    const basisEntries: unknown[] = [];
    const validResults: Array<{
      source: FrozenFinalizationResultSourceV9;
      person: Omit<FrozenIofPersonProjectionV9, "position" | "timeBehindMs">;
    }> = [];

    const controlRowsForClass = controlsByVersion.get(raceClass.courseVersionId) ?? [];
    let controls: ReturnType<typeof expectedControls> = [];
    const classVariants = variantsByVersion.get(raceClass.courseVersionId) ?? [];
    try {
      controls = expectedControls(controlRowsForClass);
      if (controls.length === 0 && entries.length > 0 && classVariants.length === 0) blockers.add("INVALID_RESULT_REVISION");
    } catch {
      blockers.add("INVALID_RESULT_REVISION");
    }

    for (const entry of entries) {
      const absoluteRevision = latestByEntry.get(entry.id);
      const revisionState = latestStateByEntry.get(entry.id);
      if (absoluteRevision?.controlNeutralizationId !== null) blockers.add("INVALID_RESULT_REVISION");
      const variant = classVariants.length === 0 ? undefined : classVariants.find(row => row.code === entry.courseVariantCode);
      if (classVariants.length > 0 && !variant) blockers.add("INVALID_RESULT_REVISION");
      const entryControls = variant
        ? expectedControls(variant.controlCodes.map((controlCode, index) => ({ sequence: index + 1, controlCode }))) : controls;
      basisEntries.push({
        entry: {
          id: entry.id,
          classId: entry.classId,
          givenName: entry.givenName,
          familyName: entry.familyName,
          organisationName: entry.organisationName,
          externalSource: entry.externalSource,
          externalId: entry.externalId,
          ...(variant ? { courseVariantCode: variant.code, controls: entryControls } : {})
        },
        absoluteRevision: absoluteRevision ? resultRevisionBasis(absoluteRevision) : null,
        effectiveRevision: revisionState?.state === "ACTIVE_RESULT"
          ? resultRevisionBasis(revisionState.head)
          : null,
        startCheckinDns: revisionState?.startCheckinDns ? {
          decisionId: revisionState.startCheckinDns.source.decision.id,
          operationRequestId: revisionState.startCheckinDns.source.operation.requestId,
          operationContentHash: revisionState.startCheckinDns.source.operation.contentHash,
          startCheckinRevisionId: revisionState.startCheckinDns.source.operationalRevision.id,
          operationalRevision: revisionState.startCheckinDns.source.operationalRevision.revision
        } : null,
        withdrawal: revisionState?.state === "NO_ACTIVE_RESULT" ? {
          id: revisionState.withdrawal.id,
          ...("didNotStartDecisionId" in revisionState.withdrawal
            ? { didNotStartDecisionId: revisionState.withdrawal.didNotStartDecisionId, reason: revisionState.withdrawal.reason }
            : { kind: "START_CHECKIN_DID_NOT_START", startCheckinDnsDecisionId: revisionState.withdrawal.startCheckinDnsDecisionId,
              operationRequestId: revisionState.withdrawal.operationRequestId }),
          withdrawnResultRevisionId: revisionState.withdrawal.withdrawnResultRevisionId,
          policyVersion: revisionState.withdrawal.policyVersion,
          withdrawnAt: revisionState.withdrawal.withdrawnAt.toISOString()
        } : null,
        disqualification: revisionState?.state === "ACTIVE_RESULT" && revisionState.disqualification !== null ? {
          decision: {
            id: revisionState.disqualification.decision.id,
            requestId: revisionState.disqualification.decision.requestId,
            actorCredentialId: revisionState.disqualification.decision.actorCredentialId,
            targetResultRevisionId: revisionState.disqualification.decision.targetResultRevisionId,
            targetResultRevision: revisionState.disqualification.decision.targetResultRevision,
            createdResultRevisionId: revisionState.disqualification.decision.createdResultRevisionId,
            createdResultRevision: revisionState.disqualification.decision.createdResultRevision,
            policyVersion: revisionState.disqualification.decision.policyVersion,
            decidedAt: revisionState.disqualification.decision.decidedAt.toISOString()
          },
          targetResultRevisionId: revisionState.disqualification.target.id,
          disqualifiedResultRevisionId: revisionState.disqualification.disqualified.id,
          withdrawal: revisionState.disqualification.withdrawal === null ? null : {
            id: revisionState.disqualification.withdrawal.id,
            requestId: revisionState.disqualification.withdrawal.requestId,
            actorCredentialId: revisionState.disqualification.withdrawal.actorCredentialId,
            expectedLatestResultRevisionId:
              revisionState.disqualification.withdrawal.expectedLatestResultRevisionId,
            expectedLatestResultRevision:
              revisionState.disqualification.withdrawal.expectedLatestResultRevision,
            restoredFromResultRevisionId:
              revisionState.disqualification.withdrawal.restoredFromResultRevisionId,
            restoredFromResultRevision:
              revisionState.disqualification.withdrawal.restoredFromResultRevision,
            createdResultRevisionId: revisionState.disqualification.withdrawal.createdResultRevisionId,
            createdResultRevision: revisionState.disqualification.withdrawal.createdResultRevision,
            policyVersion: revisionState.disqualification.withdrawal.policyVersion,
            reason: revisionState.disqualification.withdrawal.reason,
            withdrawnAt: revisionState.disqualification.withdrawal.withdrawnAt.toISOString()
          },
          restorationSourceResultRevisionId: revisionState.disqualification.restorationSource?.id ?? null,
          restorationResultRevisionId: revisionState.disqualification.restoration?.id ?? null
        } : null,
        approval: revisionState?.state === "ACTIVE_RESULT" && revisionState.approval !== null ? {
          decision: {
            id: revisionState.approval.decision.id,
            requestId: revisionState.approval.decision.requestId,
            actorCredentialId: revisionState.approval.decision.actorCredentialId,
            targetResultRevisionId: revisionState.approval.decision.targetResultRevisionId,
            targetResultRevision: revisionState.approval.decision.targetResultRevision,
            createdResultRevisionId: revisionState.approval.decision.createdResultRevisionId,
            createdResultRevision: revisionState.approval.decision.createdResultRevision,
            policyVersion: revisionState.approval.decision.policyVersion,
            decidedAt: revisionState.approval.decision.decidedAt.toISOString()
          },
          targetResultRevisionId: revisionState.approval.target.id,
          approvedResultRevisionId: revisionState.approval.approved.id,
          withdrawal: revisionState.approval.withdrawal === null ? null : {
            id: revisionState.approval.withdrawal.id,
            requestId: revisionState.approval.withdrawal.requestId,
            actorCredentialId: revisionState.approval.withdrawal.actorCredentialId,
            expectedLatestResultRevisionId: revisionState.approval.withdrawal.expectedLatestResultRevisionId,
            expectedLatestResultRevision: revisionState.approval.withdrawal.expectedLatestResultRevision,
            restoredFromResultRevisionId: revisionState.approval.withdrawal.restoredFromResultRevisionId,
            restoredFromResultRevision: revisionState.approval.withdrawal.restoredFromResultRevision,
            createdResultRevisionId: revisionState.approval.withdrawal.createdResultRevisionId,
            createdResultRevision: revisionState.approval.withdrawal.createdResultRevision,
            policyVersion: revisionState.approval.withdrawal.policyVersion,
            reason: revisionState.approval.withdrawal.reason,
            withdrawnAt: revisionState.approval.withdrawal.withdrawnAt.toISOString()
          },
          restorationSourceResultRevisionId: revisionState.approval.restorationSource?.id ?? null,
          restorationResultRevisionId: revisionState.approval.restoration?.id ?? null
        } : null,
        didNotFinish: revisionState?.state === "ACTIVE_RESULT" && revisionState.didNotFinish !== null ? {
          decision: {
            id: revisionState.didNotFinish.decision.id,
            requestId: revisionState.didNotFinish.decision.requestId,
            actorCredentialId: revisionState.didNotFinish.decision.actorCredentialId,
            expectedEntryVersion: revisionState.didNotFinish.decision.expectedEntryVersion,
            expectedClassId: revisionState.didNotFinish.decision.expectedClassId,
            expectedCourseVersionId: revisionState.didNotFinish.decision.expectedCourseVersionId,
            expectedSnapshotVersion: revisionState.didNotFinish.decision.expectedSnapshotVersion,
            targetResultRevisionId: revisionState.didNotFinish.decision.targetResultRevisionId,
            targetResultRevision: revisionState.didNotFinish.decision.targetResultRevision,
            createdResultRevisionId: revisionState.didNotFinish.decision.createdResultRevisionId,
            createdResultRevision: revisionState.didNotFinish.decision.createdResultRevision,
            policyVersion: revisionState.didNotFinish.decision.policyVersion,
            status: revisionState.didNotFinish.decision.status,
            reason: revisionState.didNotFinish.decision.reason,
            decidedAt: revisionState.didNotFinish.decision.decidedAt.toISOString()
          },
          targetResultRevisionId: revisionState.didNotFinish.target.id,
          didNotFinishResultRevisionId: revisionState.didNotFinish.didNotFinish.id,
          absoluteSelectedHead: {
            id: revisionState.selectedHead.id,
            revision: revisionState.selectedHead.revision
          },
          withdrawal: revisionState.didNotFinish.withdrawal === null ? null : {
            id: revisionState.didNotFinish.withdrawal.id,
            requestId: revisionState.didNotFinish.withdrawal.requestId,
            actorCredentialId: revisionState.didNotFinish.withdrawal.actorCredentialId,
            targetResultRevisionId: revisionState.didNotFinish.withdrawal.targetResultRevisionId,
            targetResultRevision: revisionState.didNotFinish.withdrawal.targetResultRevision,
            expectedLatestResultRevisionId:
              revisionState.didNotFinish.withdrawal.expectedLatestResultRevisionId,
            expectedLatestResultRevision:
              revisionState.didNotFinish.withdrawal.expectedLatestResultRevision,
            restoredFromResultRevisionId:
              revisionState.didNotFinish.withdrawal.restoredFromResultRevisionId,
            restoredFromResultRevision:
              revisionState.didNotFinish.withdrawal.restoredFromResultRevision,
            createdResultRevisionId: revisionState.didNotFinish.withdrawal.createdResultRevisionId,
            createdResultRevision: revisionState.didNotFinish.withdrawal.createdResultRevision,
            policyVersion: revisionState.didNotFinish.withdrawal.policyVersion,
            reason: revisionState.didNotFinish.withdrawal.reason,
            withdrawnAt: revisionState.didNotFinish.withdrawal.withdrawnAt.toISOString()
          },
          restorationSourceResultRevisionId:
            revisionState.didNotFinish.restorationSource?.id ?? null,
          restorationResultRevisionId: revisionState.didNotFinish.restoration?.id ?? null
        } : null,
        notCompeting: revisionState?.state === "ACTIVE_RESULT" && revisionState.notCompeting !== null ? {
          decision: {
            id: revisionState.notCompeting.decision.id,
            requestId: revisionState.notCompeting.decision.requestId,
            actorCredentialId: revisionState.notCompeting.decision.actorCredentialId,
            expectedEntryVersion: revisionState.notCompeting.decision.expectedEntryVersion,
            expectedClassId: revisionState.notCompeting.decision.expectedClassId,
            expectedCourseVersionId: revisionState.notCompeting.decision.expectedCourseVersionId,
            expectedSnapshotVersion: revisionState.notCompeting.decision.expectedSnapshotVersion,
            targetResultRevisionId: revisionState.notCompeting.decision.targetResultRevisionId,
            targetResultRevision: revisionState.notCompeting.decision.targetResultRevision,
            createdResultRevisionId: revisionState.notCompeting.decision.createdResultRevisionId,
            createdResultRevision: revisionState.notCompeting.decision.createdResultRevision,
            policyVersion: revisionState.notCompeting.decision.policyVersion,
            status: revisionState.notCompeting.decision.status,
            reason: revisionState.notCompeting.decision.reason,
            decidedAt: revisionState.notCompeting.decision.decidedAt.toISOString()
          },
          targetResultRevisionId: revisionState.notCompeting.target.id,
          outOfCompetitionResultRevisionId: revisionState.notCompeting.outOfCompetition.id,
          absoluteSelectedHead: {
            id: revisionState.selectedHead.id,
            revision: revisionState.selectedHead.revision
          },
          withdrawal: revisionState.notCompeting.withdrawal === null ? null : {
            id: revisionState.notCompeting.withdrawal.id,
            requestId: revisionState.notCompeting.withdrawal.requestId,
            actorCredentialId: revisionState.notCompeting.withdrawal.actorCredentialId,
            notCompetingDecisionId: revisionState.notCompeting.withdrawal.notCompetingDecisionId,
            withdrawnResultRevisionId: revisionState.notCompeting.withdrawal.withdrawnResultRevisionId,
            withdrawnResultRevision: revisionState.notCompeting.withdrawal.withdrawnResultRevision,
            expectedLatestResultRevisionId:
              revisionState.notCompeting.withdrawal.expectedLatestResultRevisionId,
            expectedLatestResultRevision:
              revisionState.notCompeting.withdrawal.expectedLatestResultRevision,
            restoredFromResultRevisionId:
              revisionState.notCompeting.withdrawal.restoredFromResultRevisionId,
            restoredFromResultRevision:
              revisionState.notCompeting.withdrawal.restoredFromResultRevision,
            createdResultRevisionId: revisionState.notCompeting.withdrawal.createdResultRevisionId,
            createdResultRevision: revisionState.notCompeting.withdrawal.createdResultRevision,
            policyVersion: revisionState.notCompeting.withdrawal.policyVersion,
            reason: revisionState.notCompeting.withdrawal.reason,
            withdrawnAt: revisionState.notCompeting.withdrawal.withdrawnAt.toISOString()
          },
          restorationSourceResultRevisionId:
            revisionState.notCompeting.restorationSource?.id ?? null,
          restorationResultRevisionId: revisionState.notCompeting.restoration?.id ?? null
        } : null,
        withoutTiming: revisionState?.state === "ACTIVE_RESULT" && revisionState.withoutTiming !== null ? {
          decision: {
            id: revisionState.withoutTiming.decision.id,
            requestId: revisionState.withoutTiming.decision.requestId,
            actorCredentialId: revisionState.withoutTiming.decision.actorCredentialId,
            expectedEntryVersion: revisionState.withoutTiming.decision.expectedEntryVersion,
            expectedClassId: revisionState.withoutTiming.decision.expectedClassId,
            expectedCourseVersionId: revisionState.withoutTiming.decision.expectedCourseVersionId,
            expectedSnapshotVersion: revisionState.withoutTiming.decision.expectedSnapshotVersion,
            targetResultRevisionId: revisionState.withoutTiming.decision.targetResultRevisionId,
            targetResultRevision: revisionState.withoutTiming.decision.targetResultRevision,
            createdResultRevisionId: revisionState.withoutTiming.decision.createdResultRevisionId,
            createdResultRevision: revisionState.withoutTiming.decision.createdResultRevision,
            policyVersion: revisionState.withoutTiming.decision.policyVersion,
            status: revisionState.withoutTiming.decision.status,
            reason: revisionState.withoutTiming.decision.reason,
            decidedAt: revisionState.withoutTiming.decision.decidedAt.toISOString()
          },
          targetResultRevisionId: revisionState.withoutTiming.target.id,
          withoutTimingResultRevisionId: revisionState.withoutTiming.withoutTiming.id,
          absoluteSelectedHead: {
            id: revisionState.selectedHead.id,
            revision: revisionState.selectedHead.revision
          },
          withdrawal: revisionState.withoutTiming.withdrawal === null ? null : {
            id: revisionState.withoutTiming.withdrawal.id,
            requestId: revisionState.withoutTiming.withdrawal.requestId,
            actorCredentialId: revisionState.withoutTiming.withdrawal.actorCredentialId,
            withoutTimingDecisionId: revisionState.withoutTiming.withdrawal.withoutTimingDecisionId,
            withdrawnResultRevisionId: revisionState.withoutTiming.withdrawal.withdrawnResultRevisionId,
            withdrawnResultRevision: revisionState.withoutTiming.withdrawal.withdrawnResultRevision,
            expectedLatestResultRevisionId:
              revisionState.withoutTiming.withdrawal.expectedLatestResultRevisionId,
            expectedLatestResultRevision:
              revisionState.withoutTiming.withdrawal.expectedLatestResultRevision,
            restoredFromResultRevisionId:
              revisionState.withoutTiming.withdrawal.restoredFromResultRevisionId,
            restoredFromResultRevision:
              revisionState.withoutTiming.withdrawal.restoredFromResultRevision,
            createdResultRevisionId: revisionState.withoutTiming.withdrawal.createdResultRevisionId,
            createdResultRevision: revisionState.withoutTiming.withdrawal.createdResultRevision,
            policyVersion: revisionState.withoutTiming.withdrawal.policyVersion,
            reason: revisionState.withoutTiming.withdrawal.reason,
            withdrawnAt: revisionState.withoutTiming.withdrawal.withdrawnAt.toISOString()
          },
          restorationSourceResultRevisionId:
            revisionState.withoutTiming.restorationSource?.id ?? null,
          restorationResultRevisionId: revisionState.withoutTiming.restoration?.id ?? null
        } : null
      });
      if (!absoluteRevision) {
        blockers.add("MISSING_RESULT_REVISION");
        continue;
      }
      if (!revisionState) throw new StoredFinalizationConflict("Resultathuvudets livscykel saknas");
      if (revisionState.state === "NO_ACTIVE_RESULT") {
        blockers.add("WITHDRAWN_DID_NOT_START");
        continue;
      }
      if (revisionState.withoutTiming?.withdrawal === null) {
        blockers.add("INVALID_RESULT_REVISION");
        continue;
      }
      const revision = revisionState.head;
      if (!revision.published) blockers.add("LATEST_RESULT_UNPUBLISHED");
      let evaluation;
      try {
        evaluation = parseStrictStoredResultRevision(revision, revisionState.startCheckinDns?.source,
          revisionState.finishTimeCorrection ?? undefined, revisionState.finishTimeCorrectionWithdrawal ?? undefined,
          revisionState.punchStartTimeCorrection ?? undefined, revisionState.punchStartTimeCorrectionWithdrawal ?? undefined,
          revisionState.shortenedCourseClassTransfer ?? undefined);
      } catch (error) {
        if (!(error instanceof StoredResultRevisionConflict)) throw error;
        blockers.add("INVALID_RESULT_REVISION");
        continue;
      }
      if (evaluation.status === "NT") {
        blockers.add("INVALID_RESULT_REVISION");
        continue;
      }
      if (evaluation.classId !== raceClass.id) blockers.add("RESULT_CLASS_MISMATCH");
      if (evaluation.courseVersionId !== raceClass.courseVersionId) blockers.add("RESULT_COURSE_MISMATCH");
      if (!isEffectiveResultCurrent(revisionState, basisHashes.get(entry.id), race.snapshotVersion)) blockers.add("STALE_RESULT_SNAPSHOT");

      const expectedKeys = new Set(entryControls.map((control) => `${control.controlCode}:${control.occurrence}`));
      const splitKeys = new Set<string>();
      const evaluationSplits = "splits" in evaluation ? evaluation.splits : [];
      const resultControls = evaluation.status === "DNS" || evaluation.status === "DNF" ? [] : entryControls;
      for (const split of evaluationSplits) {
        const splitKey = `${split.controlCode}:${split.occurrence}`;
        if (!expectedKeys.has(splitKey) || splitKeys.has(splitKey)) blockers.add("INVALID_RESULT_REVISION");
        splitKeys.add(splitKey);
      }
      let source: FrozenFinalizationResultSourceV9;
      if (revision.cause === "START_CHECKIN_DID_NOT_START" && revisionState.startCheckinDns &&
          revisionState.startCheckinDns.correction === null) {
        const decision = revisionState.startCheckinDns.source.decision;
        source = {
          kind: "START_CHECKIN_DID_NOT_START", startCheckinDnsDecisionId: decision.id,
          operationRequestId: decision.operationRequestId, startCheckinRevisionId: decision.startCheckinRevisionId,
          operationalRevision: decision.operationalRevision, withdrawal: null,
          entryId: entry.id, resultRevisionId: revision.id, revision: revision.revision,
          courseVersionId: revision.courseVersionId
        };
      } else if (revision.cause === "MANUAL_DID_NOT_START" && revision.didNotStartDecisionId !== null) {
        source = {
          kind: "MANUAL_DID_NOT_START",
          didNotStartDecisionId: revision.didNotStartDecisionId,
          entryId: entry.id,
          resultRevisionId: revision.id,
          revision: revision.revision,
          courseVersionId: revision.courseVersionId
        };
      } else if (revision.cause === "MANUAL_DID_NOT_FINISH" && revisionState.didNotFinish !== null &&
          revisionState.didNotFinish.didNotFinish.id === revision.id &&
          revision.didNotFinishDecisionId === revisionState.didNotFinish.decision.id) {
        source = {
          kind: "MANUAL_DID_NOT_FINISH",
          didNotFinishDecisionId: revisionState.didNotFinish.decision.id,
          targetResultRevisionId: revisionState.didNotFinish.target.id,
          absoluteResultRevisionId: revisionState.selectedHead.id,
          absoluteResultRevision: revisionState.selectedHead.revision,
          entryId: entry.id,
          resultRevisionId: revision.id,
          revision: revision.revision,
          courseVersionId: revision.courseVersionId
        };
      } else if (revision.cause === "MANUAL_DID_NOT_FINISH_WITHDRAWAL" &&
          revisionState.didNotFinish?.withdrawal !== null &&
          revisionState.didNotFinish?.withdrawal !== undefined &&
          revisionState.didNotFinish.restoration?.id === revision.id &&
          revision.didNotFinishWithdrawalId === revisionState.didNotFinish.withdrawal.id) {
        source = {
          kind: "MANUAL_DID_NOT_FINISH_WITHDRAWAL",
          didNotFinishWithdrawalId: revisionState.didNotFinish.withdrawal.id,
          didNotFinishDecisionId: revisionState.didNotFinish.decision.id,
          targetResultRevisionId: revisionState.didNotFinish.target.id,
          didNotFinishResultRevisionId: revisionState.didNotFinish.didNotFinish.id,
          restorationSourceResultRevisionId:
            revisionState.didNotFinish.withdrawal.restoredFromResultRevisionId,
          entryId: entry.id,
          resultRevisionId: revision.id,
          revision: revision.revision,
          courseVersionId: revision.courseVersionId
        };
      } else if (revision.cause === "MANUAL_OUT_OF_COMPETITION" &&
          revisionState.notCompeting !== null &&
          revisionState.notCompeting.outOfCompetition.id === revision.id &&
          revision.notCompetingDecisionId === revisionState.notCompeting.decision.id) {
        source = {
          kind: "MANUAL_OUT_OF_COMPETITION",
          notCompetingDecisionId: revisionState.notCompeting.decision.id,
          targetResultRevisionId: revisionState.notCompeting.target.id,
          absoluteResultRevisionId: absoluteRevision.id,
          absoluteResultRevision: absoluteRevision.revision,
          entryId: entry.id,
          resultRevisionId: revision.id,
          revision: revision.revision,
          courseVersionId: revision.courseVersionId
        };
      } else if (revision.cause === "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL" &&
          revisionState.notCompeting?.withdrawal !== null &&
          revisionState.notCompeting?.withdrawal !== undefined &&
          revisionState.notCompeting.restoration?.id === revision.id &&
          revision.notCompetingWithdrawalId === revisionState.notCompeting.withdrawal.id) {
        source = {
          kind: "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL",
          notCompetingWithdrawalId: revisionState.notCompeting.withdrawal.id,
          notCompetingDecisionId: revisionState.notCompeting.decision.id,
          targetResultRevisionId: revisionState.notCompeting.target.id,
          outOfCompetitionResultRevisionId: revisionState.notCompeting.outOfCompetition.id,
          absoluteResultRevisionId:
            revisionState.notCompeting.withdrawal.expectedLatestResultRevisionId,
          absoluteResultRevision:
            revisionState.notCompeting.withdrawal.expectedLatestResultRevision,
          restorationSourceResultRevisionId:
            revisionState.notCompeting.withdrawal.restoredFromResultRevisionId,
          entryId: entry.id,
          resultRevisionId: revision.id,
          revision: revision.revision,
          courseVersionId: revision.courseVersionId
        };
      } else if (revision.cause === "MANUAL_WITHOUT_TIMING_WITHDRAWAL" &&
          revisionState.withoutTiming?.withdrawal !== null &&
          revisionState.withoutTiming?.withdrawal !== undefined &&
          revisionState.withoutTiming.restoration?.id === revision.id &&
          revision.withoutTimingWithdrawalId === revisionState.withoutTiming.withdrawal.id) {
        source = {
          kind: "MANUAL_WITHOUT_TIMING_WITHDRAWAL",
          withoutTimingWithdrawalId: revisionState.withoutTiming.withdrawal.id,
          withoutTimingDecisionId: revisionState.withoutTiming.decision.id,
          targetResultRevisionId: revisionState.withoutTiming.target.id,
          withoutTimingResultRevisionId: revisionState.withoutTiming.withoutTiming.id,
          absoluteResultRevisionId:
            revisionState.withoutTiming.withdrawal.expectedLatestResultRevisionId,
          absoluteResultRevision:
            revisionState.withoutTiming.withdrawal.expectedLatestResultRevision,
          restorationSourceResultRevisionId:
            revisionState.withoutTiming.withdrawal.restoredFromResultRevisionId,
          entryId: entry.id,
          resultRevisionId: revision.id,
          revision: revision.revision,
          courseVersionId: revision.courseVersionId
        };
      } else if (revision.cause === "MANUAL_DISQUALIFICATION" && revisionState.disqualification !== null) {
        source = {
          kind: "MANUAL_DISQUALIFICATION",
          resultDisqualificationDecisionId: revisionState.disqualification.decision.id,
          targetResultRevisionId: revisionState.disqualification.target.id,
          absoluteResultRevisionId: absoluteRevision.id,
          absoluteResultRevision: absoluteRevision.revision,
          entryId: entry.id,
          resultRevisionId: revision.id,
          revision: revision.revision,
          courseVersionId: revision.courseVersionId
        };
      } else if (revision.cause === "MANUAL_DISQUALIFICATION_WITHDRAWAL" &&
          revisionState.disqualification?.withdrawal !== null &&
          revisionState.disqualification?.withdrawal !== undefined) {
        source = {
          kind: "MANUAL_DISQUALIFICATION_WITHDRAWAL",
          resultDisqualificationWithdrawalId: revisionState.disqualification.withdrawal.id,
          resultDisqualificationDecisionId: revisionState.disqualification.decision.id,
          targetResultRevisionId: revisionState.disqualification.target.id,
          disqualifiedResultRevisionId: revisionState.disqualification.disqualified.id,
          restorationSourceResultRevisionId: revisionState.disqualification.withdrawal.restoredFromResultRevisionId,
          entryId: entry.id,
          resultRevisionId: revision.id,
          revision: revision.revision,
          courseVersionId: revision.courseVersionId
        };
      } else if (revision.cause === "MANUAL_RESULT_APPROVAL" && revisionState.approval !== null &&
          revisionState.approval.withdrawal === null && revisionState.approval.approved.id === revision.id) {
        source = {
          kind: "MANUAL_RESULT_APPROVAL",
          resultApprovalDecisionId: revisionState.approval.decision.id,
          targetResultRevisionId: revisionState.approval.target.id,
          approvedResultRevisionId: revisionState.approval.approved.id,
          absoluteResultRevisionId: absoluteRevision.id,
          absoluteResultRevision: absoluteRevision.revision,
          entryId: entry.id,
          resultRevisionId: revision.id,
          revision: revision.revision,
          courseVersionId: revision.courseVersionId
        };
      } else if (revision.cause === "MANUAL_RESULT_APPROVAL_WITHDRAWAL" &&
          revisionState.approval?.withdrawal !== null && revisionState.approval?.withdrawal !== undefined &&
          revisionState.approval.restoration?.id === revision.id) {
        source = {
          kind: "MANUAL_RESULT_APPROVAL_WITHDRAWAL",
          resultApprovalWithdrawalId: revisionState.approval.withdrawal.id,
          resultApprovalDecisionId: revisionState.approval.decision.id,
          targetResultRevisionId: revisionState.approval.target.id,
          approvedResultRevisionId: revisionState.approval.approved.id,
          restorationSourceResultRevisionId: revisionState.approval.withdrawal.restoredFromResultRevisionId,
          entryId: entry.id,
          resultRevisionId: revision.id,
          revision: revision.revision,
          courseVersionId: revision.courseVersionId
        };
      } else if (revision.readoutId !== null) {
        source = {
          kind: "READOUT_RESULT",
          readoutId: revision.readoutId,
          entryId: entry.id,
          resultRevisionId: revision.id,
          revision: revision.revision,
          courseVersionId: revision.courseVersionId
        };
      } else {
        blockers.add("INVALID_RESULT_REVISION");
        continue;
      }
      validResults.push({
        source,
        person: {
          entryExternalId: optionalIofId(entry.externalSource, entry.externalId),
          givenName: entry.givenName,
          familyName: entry.familyName,
          organisationName: entry.organisationName,
          status: evaluation.status,
          startTime: "startTime" in evaluation ? evaluation.startTime : null,
          finishTime: "finishTime" in evaluation ? evaluation.finishTime : null,
          elapsedMs: "elapsedMs" in evaluation ? evaluation.elapsedMs : null,
          expectedControls: resultControls,
          splits: evaluationSplits.map((split) => ({
            controlCode: split.controlCode,
            occurrence: split.occurrence,
            elapsedMs: split.elapsedMs
          })),
          manualApprovalProof: source.kind === "MANUAL_RESULT_APPROVAL" ? {
            decisionId: source.resultApprovalDecisionId,
            targetResultRevisionId: source.targetResultRevisionId
          } : null
        }
      });
    }

    const classBasis = {
      formatVersion: 9,
      kind: "CLASS_FINALIZATION_BASIS",
      raceId: race.id,
      snapshotVersion: race.snapshotVersion,
      class: {
        id: raceClass.id,
        name: raceClass.name,
        courseVersionId: raceClass.courseVersionId,
        externalSource: raceClass.externalSource,
        externalId: raceClass.externalId,
        controls
      },
      entries: basisEntries
    } as const;
    const basisHash = canonicalHash(classBasis);

    if (validResults.length === entries.length && entries.length > 0) {
      try {
        const ranking = new Map(rankClassResults(validResults.map((result) => ({
          key: result.source.entryId,
          status: result.person.status,
          ...(result.person.elapsedMs === null ? {} : { elapsedMs: result.person.elapsedMs }),
          courseVersionId: result.source.courseVersionId
        }))).map((result) => [result.key, result]));
        if ([...ranking.values()].some((result) => result.rankingState === "MIXED_COURSE_VERSIONS")) {
          blockers.add("MIXED_COURSE_VERSIONS");
        }
        validResults.sort((left, right) =>
          compareResultStatuses(left.person.status, right.person.status) ||
          ((left.person.elapsedMs ?? Number.MAX_SAFE_INTEGER) - (right.person.elapsedMs ?? Number.MAX_SAFE_INTEGER)) ||
          compareText(left.person.familyName, right.person.familyName) ||
          compareText(left.person.givenName, right.person.givenName) ||
          compareText(left.person.entryExternalId ?? "", right.person.entryExternalId ?? "") ||
          compareText(left.source.entryId, right.source.entryId)
        );
        if (blockers.size === 0) {
          const projection = frozenClassFinalizationProjectionSchema.parse({
            formatVersion: 9,
            scope: "CLASS",
            raceId: race.id,
            classId: raceClass.id,
            snapshotVersion: race.snapshotVersion,
            basisSha256: basisHash,
            class: {
              name: raceClass.name,
              externalId: optionalIofId(raceClass.externalSource, raceClass.externalId),
              results: validResults.map((result) => {
                const ranked = ranking.get(result.source.entryId);
                if (!ranked) throw new StoredFinalizationConflict("Resultatet saknar ranking");
                return {
                  source: result.source,
                  personResult: {
                    ...result.person,
                    position: ranked.position ?? null,
                    timeBehindMs: ranked.timeBehindMs ?? null
                  }
                };
              })
            }
          });
          classProjectionById.set(raceClass.id, projection);
        }
      } catch (error) {
        if (error instanceof ClassRankingError) blockers.add("INVALID_RESULT_REVISION");
        else throw error;
      }
    }

    const latestRow = latestClassFinalizationByClass.get(raceClass.id);
    const latestMetadata = latestRow ? finalizationMetadata(latestRow) : null;
    if (latestMetadata !== null && latestMetadata.scope !== "CLASS") {
      throw new StoredFinalizationConflict("Fel finaliseringsscope för klass");
    }
    classCandidates.push({
      classId: raceClass.id,
      className: raceClass.name,
      entryCount: entries.length,
      blockerCodes: sortedBlockers(blockers),
      basisHash,
      latestFinalization: latestMetadata
    });
  }

  const raceBlockers = new Set<ResultFinalizationBlockerCode>();
  if (entryRows.length === 0) raceBlockers.add("NO_ENTRIES");
  if (siblingRaces.length !== 1 || siblingRaces[0]?.id !== race.id) raceBlockers.add("MULTI_RACE_EVENT");
  const unresolvedUnknownCardReadoutCount = unresolvedRows[0]?.value ?? 0;
  if (unresolvedUnknownCardReadoutCount > 0) raceBlockers.add("UNKNOWN_CARD_UNRESOLVED");

  const selectedClasses: FrozenRaceFinalizationProjectionV9["classes"] = [];
  const raceBasisClasses: unknown[] = [];
  for (const candidate of classCandidates.filter((item) => item.entryCount > 0)) {
    const latestRow = latestClassFinalizationByClass.get(candidate.classId);
    if (!latestRow) {
      raceBlockers.add("MISSING_CLASS_FINALIZATION");
      raceBasisClasses.push({ classId: candidate.classId, finalization: null, currentBasisHash: candidate.basisHash });
      continue;
    }
    const parsed = frozenClassFinalizationProjectionSchema.safeParse(latestRow.frozenProjection);
    const currentProjection = classProjectionById.get(candidate.classId);
    const current = candidate.blockerCodes.length === 0 && currentProjection !== undefined && parsed.success &&
      parsed.data.formatVersion === 9 && currentProjection.formatVersion === 9 &&
      latestRow.sourceSnapshotVersion === race.snapshotVersion && latestRow.sourceHash === candidate.basisHash &&
      parsed.data.basisSha256 === candidate.basisHash && parsed.data.classId === candidate.classId;
    raceBasisClasses.push({
      classId: candidate.classId,
      finalizationId: latestRow.id,
      revision: latestRow.scopeRevision,
      sourceHash: latestRow.sourceHash,
      frozenProjectionHash: canonicalHash(latestRow.frozenProjection),
      currentBasisHash: candidate.basisHash
    });
    if (!current || !parsed.success || parsed.data.formatVersion !== 9) {
      raceBlockers.add("CLASS_FINALIZATION_OUTDATED");
      continue;
    }
    selectedClasses.push({
      classFinalizationId: latestRow.id,
      classFinalizationRevision: latestRow.scopeRevision,
      classBasisSha256: latestRow.sourceHash,
      classId: candidate.classId,
      class: parsed.data.class
    });
  }

  const raceBasis = {
    formatVersion: 9,
    kind: "RACE_FINALIZATION_BASIS",
    raceId: race.id,
    snapshotVersion: race.snapshotVersion,
    eventName: eventRows[0].name,
    siblingRaceIds: siblingRaces.map((sibling) => sibling.id),
    unresolvedUnknownCardReadoutCount,
    classes: raceBasisClasses
  } as const;
  const raceBasisHash = canonicalHash(raceBasis);
  let raceProjection: FrozenRaceFinalizationProjection | undefined;
  if (raceBlockers.size === 0) {
    raceProjection = frozenRaceFinalizationProjectionSchema.parse({
      formatVersion: 9,
      scope: "RACE",
      raceId: race.id,
      snapshotVersion: race.snapshotVersion,
      basisSha256: raceBasisHash,
      eventName: eventRows[0].name,
      classes: selectedClasses
    });
  }

  const latestRaceMetadata = latestRaceFinalization ? finalizationMetadata(latestRaceFinalization) : null;
  if (latestRaceMetadata !== null && latestRaceMetadata.scope !== "RACE") {
    throw new StoredFinalizationConflict("Fel finaliseringsscope för lopp");
  }
  return {
    response: resultFinalizationCandidateResponseSchema.parse({
      formatVersion: 1,
      raceId: race.id,
      snapshotVersion: race.snapshotVersion,
      race: {
        entryCount: entryRows.length,
        nonEmptyClassCount: classCandidates.filter((candidate) => candidate.entryCount > 0).length,
        unresolvedUnknownCardReadoutCount,
        blockerCodes: sortedBlockers(raceBlockers),
        basisHash: raceBasisHash,
        latestFinalization: latestRaceMetadata
      },
      classes: classCandidates
    }),
    classProjectionById,
    ...(raceProjection === undefined ? {} : { raceProjection })
  };
}

export async function listResultFinalizationCandidatesAsAdmin(
  db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability">,
  now = new Date()
): Promise<ResultFinalizationCandidateResult> {
  if (!UUID_PATTERN.test(input.raceId)) return { status: "not-found" };
  try {
    return await db.transaction(async (tx) => {
      const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
        ...input,
        capability: "FINALIZE_RESULTS"
      }, now);
      if (authorization.status !== "authenticated") return authorization;
      const [race] = await tx.select({
        id: schema.races.id,
        eventId: schema.races.eventId,
        snapshotVersion: schema.races.snapshotVersion
      }).from(schema.races).where(eq(schema.races.id, authorization.principal.raceId)).for("share");
      if (!race) return { status: "not-found" } as const;
      return { status: "ok", response: (await buildFinalizationBasis(tx, race)).response } as const;
    }, { isolationLevel: "repeatable read" });
  } catch (error) {
    if (error instanceof FinalizationTooLarge) return { status: "too-large" };
    if (error instanceof StoredFinalizationConflict || error instanceof ClassRankingError) return { status: "conflict" };
    throw error;
  }
}

function exactReplay(
  row: ResultFinalizationRow,
  requestId: string,
  actorCredentialId: string,
  raceId: string,
  request: ResultFinalizationRequest
): boolean {
  return row.requestId === requestId && row.actorCredentialId === actorCredentialId && row.raceId === raceId &&
    row.scope === request.scope && row.classId === request.classId &&
    row.sourceSnapshotVersion === request.expectedSnapshotVersion && row.sourceHash === request.expectedBasisHash &&
    row.scopeRevision === (request.expectedLatestScopeRevision ?? 0) + 1;
}

export async function finalizeResultsAsAdmin(
  db: Database,
  input: FinalizeResultsInput,
  options: ResultFinalizationRuntimeOptions = {}
): Promise<FinalizeResultsResult> {
  if (!UUID_PATTERN.test(input.raceId)) return { status: "not-found" };
  const idempotencyKey = resultFinalizationIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const request = resultFinalizationRequestSchema.safeParse(input.request);
  if (!idempotencyKey.success || !request.success) return { status: "invalid-request" };
  const requestId = idempotencyKey.data.slice("result-finalization:".length);
  const finalizedAt = options.now ?? new Date();
  if (!Number.isFinite(finalizedAt.getTime())) throw new Error("Finaliseringstiden är ogiltig");
  const finalizationId = options.finalizationId ?? randomUUID();
  if (!UUID_PATTERN.test(finalizationId)) throw new Error("Finaliserings-id är ogiltigt");

  try {
    return await db.transaction(async (tx) => {
      const authorization = await authenticatePairingAdminSessionForMutation(tx, {
        ...input,
        capability: "FINALIZE_RESULTS",
        requireCsrf: true
      }, finalizedAt);
      if (authorization.status !== "authenticated") return authorization;
      const [race] = await tx.select({
        id: schema.races.id,
        eventId: schema.races.eventId,
        snapshotVersion: schema.races.snapshotVersion
      }).from(schema.races).where(eq(schema.races.id, authorization.principal.raceId)).for("update");
      if (!race) return { status: "not-found" } as const;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);

      const [existing] = await tx.select().from(schema.resultFinalizations)
        .where(eq(schema.resultFinalizations.requestId, requestId));
      if (existing) {
        if (!exactReplay(existing, requestId, authorization.principal.accessCredentialId, race.id, request.data)) {
          return { status: "conflict" } as const;
        }
        return {
          status: "finalized",
          response: resultFinalizationResponseSchema.parse({
            formatVersion: 1,
            replayed: true,
            requestId,
            finalization: finalizationMetadata(existing)
          })
        } as const;
      }

      const basis = await buildFinalizationBasis(tx, race);
      if (basis.response.snapshotVersion !== request.data.expectedSnapshotVersion) return { status: "conflict" } as const;
      const candidate = request.data.scope === "CLASS"
        ? basis.response.classes.find((item) => item.classId === request.data.classId)
        : basis.response.race;
      if (!candidate) return { status: "not-found" } as const;
      if (candidate.basisHash !== request.data.expectedBasisHash || candidate.blockerCodes.length > 0) {
        return { status: "conflict" } as const;
      }
      const latest = request.data.scope === "CLASS"
        ? candidate.latestFinalization
        : basis.response.race.latestFinalization;
      if ((latest?.scopeRevision ?? null) !== request.data.expectedLatestScopeRevision) {
        return { status: "conflict" } as const;
      }
      const scopeRevision = (latest?.scopeRevision ?? 0) + 1;

      let frozenProjection: FrozenClassFinalizationProjection | FrozenRaceFinalizationProjection;
      let completeXml: string | null = null;
      let completeXmlHash: string | null = null;
      if (request.data.scope === "CLASS") {
        const projection = basis.classProjectionById.get(request.data.classId);
        if (!projection) return { status: "conflict" } as const;
        frozenProjection = projection;
      } else {
        if (!basis.raceProjection) return { status: "conflict" } as const;
        frozenProjection = basis.raceProjection;
        const bytes = serializeIofResultList({
          status: "Complete",
          finalizationProof: {
            finalizationId,
            revision: scopeRevision,
            sourceHash: request.data.expectedBasisHash
          },
          eventName: basis.raceProjection.eventName,
          classes: basis.raceProjection.classes.map((raceClass) => asIofClass(raceClass.class))
        });
        completeXml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        completeXmlHash = sha256Bytes(bytes);
      }

      const [saved] = await tx.insert(schema.resultFinalizations).values({
        id: finalizationId,
        requestId,
        raceId: race.id,
        scope: request.data.scope,
        classId: request.data.classId,
        scopeRevision,
        sourceSnapshotVersion: race.snapshotVersion,
        sourceHash: request.data.expectedBasisHash,
        frozenProjection,
        completeXml,
        completeXmlHash,
        actorCredentialId: authorization.principal.accessCredentialId,
        finalizedAt
      }).returning();
      if (!saved) throw new Error("Finaliseringen kunde inte sparas");
      const metadata = finalizationMetadata(saved);
      await tx.insert(schema.auditEvents).values({
        raceId: race.id,
        entityType: "result_finalization",
        entityId: saved.id,
        action: saved.scope === "CLASS" ? "RESULT_CLASS_FINALIZED" : "RESULT_RACE_FINALIZED",
        actorKind: authorization.principal.capability === "MANAGE_RACE"
          ? "RACE_ADMIN_ACCESS_CREDENTIAL" : "RESULT_FINALIZATION_ACCESS_CREDENTIAL",
        actorId: authorization.principal.accessCredentialId,
        requestId,
        after: {
          scope: metadata.scope,
          classId: metadata.classId,
          scopeRevision: metadata.scopeRevision,
          sourceSnapshotVersion: metadata.sourceSnapshotVersion,
          basisHash: metadata.basisHash,
          frozenProjectionHash: metadata.frozenProjectionHash,
          entryCount: metadata.entryCount,
          classCount: metadata.classCount,
          completeXmlSha256: metadata.completeXmlSha256,
          finalizedAt: metadata.finalizedAt
        }
      });
      return {
        status: "finalized",
        response: resultFinalizationResponseSchema.parse({
          formatVersion: 1,
          replayed: false,
          requestId,
          finalization: metadata
        })
      } as const;
    });
  } catch (error) {
    if (error instanceof FinalizationTooLarge) return { status: "too-large" };
    if (error instanceof StoredFinalizationConflict || error instanceof ClassRankingError) return { status: "conflict" };
    throw error;
  }
}

export async function listFrozenRaceFinalizationsAsAdmin(
  db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf" | "csrfCookie" | "csrfHeader">,
  now = new Date()
): Promise<FrozenRaceFinalizationListResult> {
  if (!UUID_PATTERN.test(input.raceId)) return { status: "invalid-request" };
  try {
    return await db.transaction(async (tx) => {
      const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
        ...input,
        capability: "EXPORT_IOF_RESULT_LIST"
      }, now);
      if (authorization.status !== "authenticated") return authorization;
      const [race] = await tx.select({ id: schema.races.id }).from(schema.races)
        .where(eq(schema.races.id, authorization.principal.raceId)).for("share");
      if (!race) return { status: "not-found" } as const;
      const rows = await tx.select().from(schema.resultFinalizations).where(and(
        eq(schema.resultFinalizations.raceId, race.id),
        eq(schema.resultFinalizations.scope, "RACE")
      )).orderBy(desc(schema.resultFinalizations.scopeRevision)).limit(10_001);
      if (rows.length > 10_000) return { status: "conflict" } as const;
      const response = frozenRaceFinalizationListResponseSchema.parse({
        formatVersion: 1,
        raceId: race.id,
        finalizations: rows.map((row) => finalizationMetadata(row))
      });
      return { status: "ok", response } as const;
    }, { isolationLevel: "repeatable read" });
  } catch (error) {
    if (error instanceof StoredFinalizationConflict) return { status: "conflict" };
    throw error;
  }
}

export async function exportFrozenIofResultListAsAdmin(
  db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf" | "csrfCookie" | "csrfHeader"> & {
    finalizationId: string;
  },
  now = new Date()
): Promise<FrozenIofResultListExportResult> {
  if (!UUID_PATTERN.test(input.raceId) || !UUID_PATTERN.test(input.finalizationId)) {
    return { status: "invalid-request" };
  }
  try {
    return await db.transaction(async (tx) => {
      const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
        sessionToken: input.sessionToken,
        raceId: input.raceId,
        capability: "EXPORT_IOF_RESULT_LIST"
      }, now);
      if (authorization.status !== "authenticated") return authorization;
      const [race] = await tx.select({ id: schema.races.id }).from(schema.races)
        .where(eq(schema.races.id, authorization.principal.raceId)).for("share");
      if (!race) return { status: "not-found" } as const;
      const [row] = await tx.select().from(schema.resultFinalizations).where(and(
        eq(schema.resultFinalizations.id, input.finalizationId),
        eq(schema.resultFinalizations.raceId, race.id),
        eq(schema.resultFinalizations.scope, "RACE")
      ));
      if (!row || row.completeXml === null) return { status: "not-found" } as const;
      const metadata = finalizationMetadata(row);
      if (metadata.scope !== "RACE") throw new StoredFinalizationConflict("Finaliseringen är inte ett lopp");
      return {
        status: "ok",
        bytes: new TextEncoder().encode(row.completeXml),
        finalization: metadata
      } as const;
    }, { isolationLevel: "repeatable read" });
  } catch (error) {
    if (error instanceof StoredFinalizationConflict) return { status: "conflict" };
    throw error;
  }
}

function publicFrozenRaceResultsFromRow(row: ResultFinalizationRow): PublicFrozenRaceResultsResponse {
  const parsedProjection = frozenRaceFinalizationProjectionSchema.safeParse(row.frozenProjection);
  if (!parsedProjection.success) {
    throw new StoredFinalizationConflict("Loppsfinaliseringen har ett ogiltigt fryst manifest");
  }
  const metadata = finalizationMetadata(row);
  if (metadata.scope !== "RACE") {
    throw new StoredFinalizationConflict("Finaliseringen är inte ett lopp");
  }
  return publicFrozenRaceResultsResponseSchema.parse({
    formatVersion: 1,
    eventName: parsedProjection.data.eventName,
    finalizedAt: row.finalizedAt.toISOString(),
    results: parsedProjection.data.classes.flatMap((selectedClass) =>
      selectedClass.class.results.map(({ personResult }) => ({
        className: selectedClass.class.name,
        givenName: personResult.givenName,
        familyName: personResult.familyName,
        organisationName: personResult.organisationName,
        status: personResult.status,
        elapsedMs: personResult.elapsedMs,
        position: personResult.position,
        timeBehindMs: personResult.timeBehindMs
      }))
    )
  });
}

/**
 * Reads exactly one immutable RACE finalization. This must never call the
 * live public result projection: later result revisions are intentionally
 * unrelated to an already shared finalization URL.
 */
export async function readPublicFrozenRaceResults(
  db: Database,
  raceId: string,
  finalizationId: string
): Promise<PublicFrozenRaceResultsResult> {
  if (!UUID_PATTERN.test(raceId) || !UUID_PATTERN.test(finalizationId)) return { status: "not-found" };
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.select().from(schema.resultFinalizations).where(and(
        eq(schema.resultFinalizations.id, finalizationId),
        eq(schema.resultFinalizations.raceId, raceId),
        eq(schema.resultFinalizations.scope, "RACE")
      ));
      if (!row) return { status: "not-found" } as const;
      return { status: "ok", response: publicFrozenRaceResultsFromRow(row) } as const;
    }, { isolationLevel: "repeatable read" });
  } catch (error) {
    if (error instanceof StoredFinalizationConflict) return { status: "conflict" };
    throw error;
  }
}

/** The live page may discover a link, but the linked representation stays explicit. */
export async function readLatestPublicFrozenRaceFinalization(
  db: Database,
  raceId: string
): Promise<LatestPublicFrozenRaceFinalizationResult> {
  if (!UUID_PATTERN.test(raceId)) return { status: "not-found" };
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.select({ id: schema.resultFinalizations.id }).from(schema.resultFinalizations).where(and(
        eq(schema.resultFinalizations.raceId, raceId),
        eq(schema.resultFinalizations.scope, "RACE")
      )).orderBy(desc(schema.resultFinalizations.scopeRevision)).limit(1);
      if (!row) return { status: "not-found" } as const;
      const exact = await tx.select().from(schema.resultFinalizations).where(and(
        eq(schema.resultFinalizations.id, row.id),
        eq(schema.resultFinalizations.raceId, raceId),
        eq(schema.resultFinalizations.scope, "RACE")
      )).limit(1);
      const finalization = exact[0];
      if (!finalization) return { status: "not-found" } as const;
      publicFrozenRaceResultsFromRow(finalization);
      return { status: "ok", finalizationId: finalization.id } as const;
    }, { isolationLevel: "repeatable read" });
  } catch (error) {
    if (error instanceof StoredFinalizationConflict) return { status: "conflict" };
    throw error;
  }
}

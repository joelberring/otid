import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  classResultFinalizationMetadataSchema,
  frozenClassFinalizationProjectionSchema,
  frozenRaceFinalizationProjectionSchema,
  raceResultFinalizationMetadataSchema,
  resultFinalizationCandidateResponseSchema,
  type ClassResultFinalizationMetadata,
  type FrozenClassFinalizationProjection,
  type FrozenFinalizationResultSourceV9,
  type FrozenManualDecisionCause,
  type FrozenIofPersonProjection,
  type FrozenIofPersonProjectionV9,
  type FrozenRaceFinalizationProjection,
  type FrozenRaceFinalizationProjectionV9,
  type RaceResultFinalizationMetadata,
  type ResultFinalizationBlockerCode,
  type ResultFinalizationCandidateResponse
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import { ClassRankingError, compareResultStatuses, rankClassResults } from "@o-tid/domain";
import {
  type IofResultListClass, type IofResultListCourse,
  type IofResultListPersonResult
} from "@o-tid/iof-xml";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { StoredResultRevisionConflict, parseStrictStoredResultRevision } from "./stored-result-revision";
import { isEffectiveResultCurrent, loadResultBasisHashes } from "./result-basis";
import { loadCourseVersionVariants } from "./course-variants";
import { canonicalHash, compareText, sha256Hex as sha256Bytes } from "./serialization";


export class StoredFinalizationConflict extends Error {}
export class FinalizationTooLarge extends Error {}

/** Underlaget för ett fastställande: blockerare, frysta resultat och hashar (delad från result-finalization.ts). */
const MAX_CLASSES = 1_000;
const MAX_RESULTS = 10_000;
const MAX_EXPECTED_CONTROLS = 256;
/** Beslut som fryses som eget underlag (utan tidtagning och tidsrättningar blockerar fastställandet). */
const MANUAL_SOURCE_CAUSES: ReadonlySet<string> = new Set<FrozenManualDecisionCause>(["MANUAL_DID_NOT_START",
  "MANUAL_DISQUALIFICATION", "MANUAL_DISQUALIFICATION_WITHDRAWAL", "MANUAL_RESULT_APPROVAL", "MANUAL_RESULT_APPROVAL_WITHDRAWAL",
  "MANUAL_DID_NOT_FINISH", "MANUAL_DID_NOT_FINISH_WITHDRAWAL", "MANUAL_OUT_OF_COMPETITION", "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL",
  "MANUAL_WITHOUT_TIMING_WITHDRAWAL"]);

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type ResultFinalizationRow = typeof schema.resultFinalizations.$inferSelect;

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

function optionalIofId(source: string | null, externalId: string | null): string | null {
  return source === "iof" && externalId !== null && externalId.length > 0 ? externalId : null;
}


// Den frysta grunden har ett fast format; underlagshashen (ADR-0169) ingår inte i den.
function resultRevisionBasis(revision: Omit<typeof schema.resultRevisions.$inferSelect,
  "basisHash" | "requestId" | "actorAccountId" | "shortenedCourseClassTransferId" | "note">) {
  return {
    id: revision.id,
    raceId: revision.raceId,
    entryId: revision.entryId,
    readoutId: revision.readoutId,
    startCheckinDnsDecisionId: revision.startCheckinDnsDecisionId,
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

/** Banan i den fastställda filen: variantens namn i en gafflad klass ("Lång-AC"), längd och stigning. */
function frozenCourse(raceClass: { courseName: string; lengthMeters: number | null; climbMeters: number | null }, variantCode: string | undefined) {
  return { name: variantCode ? `${raceClass.courseName}-${variantCode}` : raceClass.courseName,
    ...(raceClass.lengthMeters === null ? {} : { lengthMeters: raceClass.lengthMeters }),
    ...(raceClass.climbMeters === null ? {} : { climbMeters: raceClass.climbMeters }) };
}

/** Eventors person- och klubb-id, brickan och löparens bana för IOF-filen (PLAN.md steg 25). */
function iofIdentity(entry: { eventorPersonId: string | null; eventorOrganisationId: string | null }, cardNumber: string | undefined,
  course: ReturnType<typeof frozenCourse> | undefined) {
  return { ...(entry.eventorPersonId ? { personEventorId: entry.eventorPersonId } : {}),
    ...(entry.eventorOrganisationId ? { organisationEventorId: entry.eventorOrganisationId } : {}),
    ...(cardNumber ? { cardNumber } : {}), ...(course ? { course } : {}) };
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
    ...(result.organisationName === null ? {} : { organisationName: result.organisationName }),
    ...(result.personEventorId === undefined ? {} : { personEventorId: result.personEventorId }),
    ...(result.organisationEventorId === undefined ? {} : { organisationEventorId: result.organisationEventorId }),
    ...(result.cardNumber === undefined ? {} : { cardNumber: result.cardNumber }),
    ...(result.course === undefined ? {} : { course: result.course })
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
  // Ett tekniskt godkänt resultat saknar inga kontroller: en förväntad kontroll utan split stämplades utan giltig tid
  // (före start eller efter mål) och skrivs som SplitTime utan Time (PLAN.md steg 13).
  const approved = "manualApprovalProof" in result && result.manualApprovalProof !== null;
  const timed = new Set(result.splits.map((split) => `${split.controlCode}:${split.occurrence}`));
  const untimed = result.status === "OK" && !approved
    ? result.expectedControls.filter((control) => !timed.has(`${control.controlCode}:${control.occurrence}`)) : [];
  return {
    ...identity,
    status: result.status,
    expectedControls: result.expectedControls,
    splits: result.splits,
    ...(untimed.length === 0 ? {} : { untimedControls: untimed }),
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

export function asIofClass(value: { name: string; externalId: string | null; course?: IofResultListCourse | undefined;
  results: readonly { personResult: FrozenIofPersonProjection }[] }): IofResultListClass {
  return {
    className: value.name,
    ...(value.course === undefined ? {} : { course: value.course }),
    results: value.results.map((result) => asIofPerson(result.personResult)),
    ...(value.externalId === null ? {} : { classExternalId: value.externalId })
  };
}

export function finalizationMetadata(row: ResultFinalizationRow): ClassResultFinalizationMetadata | RaceResultFinalizationMetadata {
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

export async function buildFinalizationBasis(tx: DatabaseTransaction, race: LockedRace): Promise<BuiltBasis> {
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
      externalId: schema.classes.externalId,
      courseName: schema.courses.name,
      lengthMeters: schema.courses.lengthMeters,
      climbMeters: schema.courses.climbMeters
    }).from(schema.classes)
      .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
      .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
      .where(eq(schema.classes.raceId, race.id))
      .orderBy(asc(schema.classes.name), asc(schema.classes.id)).limit(MAX_CLASSES + 1),
    tx.select({
      id: schema.entries.id,
      classId: schema.entries.classId,
      givenName: schema.entries.givenName,
      familyName: schema.entries.familyName,
      organisationName: schema.entries.organisationName,
      externalSource: schema.entries.externalSource,
      externalId: schema.entries.externalId,
      eventorPersonId: schema.entries.eventorPersonId,
      eventorOrganisationId: schema.entries.eventorOrganisationId,
      courseVariantCode: schema.entries.courseVariantCode
    }).from(schema.entries).where(and(eq(schema.entries.raceId, race.id), isNull(schema.entries.struckAt)))
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
      startCheckinDnsDecisionId: schema.resultRevisions.startCheckinDnsDecisionId,
      controlNeutralizationId: schema.resultRevisions.controlNeutralizationId,
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
        eq(schema.entries.raceId, race.id),
        isNull(schema.entries.struckAt)
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
  // PLAN.md steg 25: brickan i den fastställda IOF-filen (ControlCard).
  const cardRows = await tx.select({ entryId: schema.cardAssignments.entryId, cardNumber: schema.cardAssignments.cardNumber })
    .from(schema.cardAssignments).where(and(eq(schema.cardAssignments.raceId, race.id), eq(schema.cardAssignments.active, true)));
  const cardByEntry = new Map(cardRows.filter((row) => /^[1-9][0-9]{0,31}$/.test(row.cardNumber)).map((row) => [row.entryId, row.cardNumber]));

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
      // En saknad revision är MISSING_RESULT_REVISION nedan, inte ett ogiltigt resultat (PLAN.md steg 27).
      if (absoluteRevision && absoluteRevision.controlNeutralizationId !== null) blockers.add("INVALID_RESULT_REVISION");
      const variant = classVariants.length === 0 ? undefined : classVariants.find(row => row.code === entry.courseVariantCode);
      if (classVariants.length > 0 && !variant) blockers.add("INVALID_RESULT_REVISION");
      const entryControls = variant
        ? expectedControls(variant.controlCodes.map((controlCode, index) => ({ sequence: index + 1, controlCode }))) : controls;
      const identity = iofIdentity(entry, cardByEntry.get(entry.id),
        variant ? frozenCourse(raceClass, variant.code) : undefined);
      basisEntries.push({
        entry: {
          id: entry.id,
          classId: entry.classId,
          givenName: entry.givenName,
          familyName: entry.familyName,
          organisationName: entry.organisationName,
          externalSource: entry.externalSource,
          externalId: entry.externalId,
          ...identity,
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
        governing: revisionState?.governing ?? null,
        underlyingResultRevisionId: revisionState?.underlyingId ?? null,
        noActiveResult: revisionState?.state === "NO_ACTIVE_RESULT"
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
      if (revisionState.governing === "NT") {
        blockers.add("INVALID_RESULT_REVISION");
        continue;
      }
      const revision = revisionState.head;
      if (!revision.published) blockers.add("LATEST_RESULT_UNPUBLISHED");
      let evaluation;
      try {
        evaluation = parseStrictStoredResultRevision(revision, revisionState.startCheckinDns?.source);
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
      } else if (MANUAL_SOURCE_CAUSES.has(revision.cause)) {
        source = {
          kind: "MANUAL_DECISION",
          cause: revision.cause as FrozenManualDecisionCause,
          absoluteResultRevisionId: absoluteRevision.id,
          absoluteResultRevision: absoluteRevision.revision,
          underlyingResultRevisionId: revisionState.underlyingId,
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
          ...identity,
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
          manualApprovalProof: source.kind === "MANUAL_DECISION" && source.cause === "MANUAL_RESULT_APPROVAL" &&
            source.underlyingResultRevisionId !== null ? {
              decisionId: source.resultRevisionId,
              targetResultRevisionId: source.underlyingResultRevisionId
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
              course: frozenCourse(raceClass, undefined),
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

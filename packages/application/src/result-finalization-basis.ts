import {
  frozenClassFinalizationProjectionSchema,
  frozenManualDecisionCauseSchema,
  frozenRaceFinalizationProjectionSchema,
  resultFinalizationCandidateResponseSchema,
  type FrozenClassFinalizationProjection,
  type FrozenFinalizationResultSourceV9,
  type FrozenManualDecisionCause,
  type FrozenIofPersonProjection,
  type FrozenRaceFinalizationProjection,
  type ResultFinalizationBlockerCode,
  type ResultFinalizationCandidateResponse
} from "@o-tid/contracts";
import type { schema } from "@o-tid/database";
import { ClassRankingError, compareResultStatuses, rankClassResults } from "@o-tid/domain";
import { StoredResultRevisionConflict, parseStrictStoredResultRevision } from "./stored-result-revision";
import { isEffectiveResultCurrent } from "./result-basis";
import { canonicalHash, compareText } from "./serialization";
import {
  StoredFinalizationConflict, expectedControls, finalizationMetadata, frozenCourse, iofIdentity
} from "./result-finalization-projection";
import { loadFinalizationSources, type DatabaseTransaction, type LockedRace } from "./result-finalization-load";

/**
 * Underlaget för ett fastställande: blockerare, frysta resultat och hashar (delad från result-finalization.ts). Läsningen ur
 * databasen står i `result-finalization-load.ts` och den frysta projektionen (IOF, metadata) i `result-finalization-projection.ts`.
 */
/**
 * Beslut som fryses som eget underlag. Steg 38: alla avgjorda beslut, även manuell tid, godkända kontroller och rättad
 * tid (de saknar avläsning på revisionen och blockerade förut fastställandet som "kan inte kontrolleras").
 */
const MANUAL_SOURCE_CAUSES: ReadonlySet<string> = new Set<FrozenManualDecisionCause>(frozenManualDecisionCauseSchema.options);

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

/** Steg 38: löparen som ett hinder gäller, så att arrangören kan öppna deltagarkortet. */
export interface FinalizationEntryIssue {
  readonly entryId: string;
  readonly displayName: string;
  readonly code: ResultFinalizationBlockerCode;
}

interface BuiltBasis {
  readonly response: ResultFinalizationCandidateResponse;
  /** Hinder per löpare och klass (klassens id). */
  readonly entryIssuesByClass: ReadonlyMap<string, readonly FinalizationEntryIssue[]>;
  readonly classProjectionById: ReadonlyMap<string, FrozenClassFinalizationProjection>;
  readonly raceProjection?: FrozenRaceFinalizationProjection;
}

export async function buildFinalizationBasis(tx: DatabaseTransaction, race: LockedRace): Promise<BuiltBasis> {
  const {
    eventName, siblingRaces, classRows, entryRows, unresolvedRows, latestStateByEntry, basisHashes, legCourses, controlsByVersion,
    variantsByVersion, entriesByClass, latestByEntry, cardByEntry, latestClassFinalizationByClass, latestRaceFinalization
  } = await loadFinalizationSources(tx, race);

  const classProjectionById = new Map<string, FrozenClassFinalizationProjection>();
  const entryIssuesByClass = new Map<string, FinalizationEntryIssue[]>();
  const classCandidates: ResultFinalizationCandidateResponse["classes"] = [];
  for (const raceClass of classRows) {
    const entries = entriesByClass.get(raceClass.id) ?? [];
    const blockers = new Set<ResultFinalizationBlockerCode>();
    const issues: FinalizationEntryIssue[] = [];
    entryIssuesByClass.set(raceClass.id, issues);
    /** Ett hinder som gäller en löpare: klassen blockeras och löparen anges. */
    const flag = (entry: (typeof entries)[number], code: ResultFinalizationBlockerCode) => {
      blockers.add(code);
      if (!issues.some((issue) => issue.entryId === entry.id && issue.code === code)) {
        issues.push({ entryId: entry.id, displayName: `${entry.givenName} ${entry.familyName}`, code });
      }
    };
    if (entries.length === 0) blockers.add("EMPTY_CLASS");
    const basisEntries: unknown[] = [];
    const validResults: Array<{
      source: FrozenFinalizationResultSourceV9;
      person: Omit<FrozenIofPersonProjection, "position" | "timeBehindMs">;
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
      // Steg 47: en stafettsträcka med egen bana fastställs mot den banan.
      const legCourse = entry.legCourseVersionId ? legCourses.get(entry.legCourseVersionId) : undefined;
      if (entry.legCourseVersionId && !legCourse) throw new StoredFinalizationConflict("Sträckans bana saknas");
      const entryCourseVersionId = entry.legCourseVersionId ?? raceClass.courseVersionId;
      const entryVariants = legCourse ? variantsByVersion.get(entry.legCourseVersionId!) ?? [] : classVariants;
      // En saknad revision är MISSING_RESULT_REVISION nedan, inte ett ogiltigt resultat (PLAN.md steg 27).
      const variant = entryVariants.length === 0 ? undefined : entryVariants.find(row => row.code === entry.courseVariantCode);
      if (entryVariants.length > 0 && !variant) flag(entry, "INVALID_RESULT_REVISION");
      let entryControls = controls;
      try {
        entryControls = variant ? expectedControls(variant.controlCodes.map((controlCode, index) => ({ sequence: index + 1, controlCode })))
          : legCourse ? expectedControls(controlsByVersion.get(entry.legCourseVersionId!) ?? []) : controls;
      } catch {
        flag(entry, "INVALID_RESULT_REVISION");
      }
      const identity = iofIdentity(entry, cardByEntry.get(entry.id),
        legCourse ? frozenCourse(legCourse, variant?.code) : variant ? frozenCourse(raceClass, variant.code) : undefined);
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
          ...(variant ? { courseVariantCode: variant.code, controls: entryControls } : {}),
          ...(legCourse ? { courseVersionId: entryCourseVersionId, controls: entryControls } : {})
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
        flag(entry, "MISSING_RESULT_REVISION");
        continue;
      }
      if (!revisionState) throw new StoredFinalizationConflict("Resultathuvudets livscykel saknas");
      if (revisionState.state === "NO_ACTIVE_RESULT") {
        flag(entry, "WITHDRAWN_DID_NOT_START");
        continue;
      }
      const revision = revisionState.head;
      if (!revision.published) flag(entry, "LATEST_RESULT_UNPUBLISHED");
      let evaluation;
      try {
        evaluation = parseStrictStoredResultRevision(revision, revisionState.startCheckinDns?.source);
      } catch (error) {
        if (!(error instanceof StoredResultRevisionConflict)) throw error;
        flag(entry, "INVALID_RESULT_REVISION");
        continue;
      }
      if (evaluation.classId !== raceClass.id) flag(entry, "RESULT_CLASS_MISMATCH");
      if (evaluation.courseVersionId !== entryCourseVersionId) flag(entry, "RESULT_COURSE_MISMATCH");
      if (!isEffectiveResultCurrent(revisionState, basisHashes.get(entry.id), race.snapshotVersion)) flag(entry, "STALE_RESULT_SNAPSHOT");

      const expectedKeys = new Set(entryControls.map((control) => `${control.controlCode}:${control.occurrence}`));
      const splitKeys = new Set<string>();
      const evaluationSplits = "splits" in evaluation ? evaluation.splits ?? [] : [];
      // Steg 38: brutit och deltog utan tid med sträcktider har banans kontroller; utan sträcktider är de bara status.
      const statusOnly = evaluation.status === "DNS" ||
        ((evaluation.status === "DNF" || evaluation.status === "NT") && evaluationSplits.length === 0);
      const resultControls = statusOnly ? [] : entryControls;
      for (const split of evaluationSplits) {
        const splitKey = `${split.controlCode}:${split.occurrence}`;
        if (!expectedKeys.has(splitKey) || splitKeys.has(splitKey)) flag(entry, "INVALID_RESULT_REVISION");
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
        flag(entry, "INVALID_RESULT_REVISION");
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
          startTime: "startTime" in evaluation ? evaluation.startTime ?? null : null,
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

  const selectedClasses: FrozenRaceFinalizationProjection["classes"] = [];
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
    eventName,
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
      eventName,
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
    entryIssuesByClass,
    ...(raceProjection === undefined ? {} : { raceProjection })
  };
}

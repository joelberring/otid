import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import {
  iofResultListExportMetadataSchema,
  type IofResultListExportMetadata
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import { ClassRankingError, compareResultStatuses, rankClassResults, storedResultCourseVariant } from "@o-tid/domain";
import {
  serializeIofResultList,
  type IofResultListPersonResult,
  type IofResultListProjection,
} from "@o-tid/iof-xml";
import {
  authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { parseStrictStoredResultRevision } from "./stored-result-revision";
import { isResultCurrent, loadResultBasisHashes } from "./result-basis";
import { loadCourseVersionVariants } from "./course-variants";
import { relayTeamResultsForExport } from "./relay-export";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_CLASSES = 1_000;
const MAX_RESULTS = 10_000;
const MAX_OMITTED_ENTRIES = 10_000;
const MAX_EXPECTED_CONTROLS = 256;

export type IofResultListExportResult =
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" | "too-large" }
  | { status: "ok"; bytes: Uint8Array; metadata: IofResultListExportMetadata };

export type AuthenticatedIofResultListExportInput = Omit<
  PairingAdminRequestAuthentication,
  "capability" | "requireCsrf" | "csrfCookie" | "csrfHeader"
>;

class StoredResultListConflict extends Error {}
class ResultListTooLarge extends Error {}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function optionalIofId(source: string | null, externalId: string | null): string | undefined {
  return source === "iof" && externalId !== null && externalId.length > 0 ? externalId : undefined;
}

function expectedControls(rows: readonly { sequence: number; controlCode: number }[]) {
  const occurrences = new Map<number, number>();
  return rows.map((row, index) => {
    if (!Number.isSafeInteger(row.sequence) || row.sequence !== index + 1 ||
        !Number.isSafeInteger(row.controlCode) || row.controlCode < 1) {
      throw new StoredResultListConflict("Ogiltig historisk bankontroll");
    }
    const occurrence = (occurrences.get(row.controlCode) ?? 0) + 1;
    occurrences.set(row.controlCode, occurrence);
    return { controlCode: row.controlCode, occurrence };
  });
}

function expectedControlsForRevision(
  rows: readonly { id: string; sequence: number; controlCode: number }[],
  neutralization: { classId: string; courseVersionId: string; courseControlId: string; sequence: number; controlCode: number } | undefined,
  evaluationClassId: string | undefined,
  courseVersionId: string
) {
  const original = expectedControls(rows);
  if (!neutralization) return { expected: original, splitKeyMap: new Map(original.map((control) => [`${control.controlCode}:${control.occurrence}`, control])) };
  if (neutralization.classId !== evaluationClassId || neutralization.courseVersionId !== courseVersionId) {
    throw new StoredResultListConflict("Neutraliseringens klass eller banversion motsäger resultatrevisionen");
  }
  const neutralizedIndex = rows.findIndex((row) => row.id === neutralization.courseControlId &&
    row.sequence === neutralization.sequence && row.controlCode === neutralization.controlCode);
  if (neutralizedIndex < 0) throw new StoredResultListConflict("Neutraliseringen saknar historisk kontrollförekomst");
  // The physical sequence keeps its original numbers; the IOF projection's
  // expected list is contiguous after the omitted occurrence.
  const filteredRows = rows.filter((_row, index) => index !== neutralizedIndex)
    .map((row, index) => ({ sequence: index + 1, controlCode: row.controlCode }));
  const expected = expectedControls(filteredRows);
  const splitKeyMap = new Map<string, { controlCode: number; occurrence: number }>();
  let filteredIndex = 0;
  for (const [index, control] of original.entries()) {
    if (index === neutralizedIndex) continue;
    const projected = expected[filteredIndex++];
    if (!projected) throw new StoredResultListConflict("Neutraliserad kontrollprojektion saknar förekomst");
    splitKeyMap.set(`${control.controlCode}:${control.occurrence}`, projected);
  }
  return { expected, splitKeyMap };
}

export async function exportIofResultListAsAdmin(
  db: Database,
  input: AuthenticatedIofResultListExportInput,
  now = new Date()
): Promise<IofResultListExportResult> {
  if (!UUID_PATTERN.test(input.raceId)) return { status: "invalid-request" };
  try {
    return await db.transaction(async (tx) => {
      const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
        sessionToken: input.sessionToken,
        raceId: input.raceId,
        capability: "EXPORT_IOF_RESULT_LIST"
      }, now);
      if (authorization.status !== "authenticated") return authorization;

      const [race] = await tx.select({
        id: schema.races.id,
        eventId: schema.races.eventId,
        snapshotVersion: schema.races.snapshotVersion
      }).from(schema.races)
        .where(eq(schema.races.id, authorization.principal.raceId))
        .for("share");
      if (!race) return { status: "not-found" } as const;

      const [event, siblingRaces, entryAggregate] = await Promise.all([
        tx.select({ name: schema.events.name }).from(schema.events)
          .where(eq(schema.events.id, race.eventId)).limit(1),
        tx.select({ id: schema.races.id }).from(schema.races)
          .where(eq(schema.races.eventId, race.eventId)).orderBy(asc(schema.races.id)).limit(2),
        tx.select({ value: count(schema.entries.id) }).from(schema.entries)
          .where(eq(schema.entries.raceId, race.id))
      ]);
      if (!event[0]) return { status: "not-found" } as const;
      if (siblingRaces.length !== 1 || siblingRaces[0]?.id !== race.id) {
        return { status: "conflict" } as const;
      }

      const latestRows = await tx.selectDistinctOn([schema.resultRevisions.entryId], {
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
        createdAt: schema.resultRevisions.createdAt,
        givenName: schema.entries.givenName,
        familyName: schema.entries.familyName,
        organisationName: schema.entries.organisationName,
        entryExternalSource: schema.entries.externalSource,
        entryExternalId: schema.entries.externalId,
        courseVariantCode: schema.entries.courseVariantCode
      }).from(schema.resultRevisions)
        .innerJoin(schema.entries, and(
          eq(schema.resultRevisions.entryId, schema.entries.id),
          eq(schema.entries.raceId, race.id)
        ))
        .where(and(
          eq(schema.resultRevisions.raceId, race.id),
          eq(schema.resultRevisions.published, true)
        ))
        .orderBy(
          asc(schema.resultRevisions.entryId),
          desc(schema.resultRevisions.revision),
          desc(schema.resultRevisions.id)
        )
        .limit(MAX_RESULTS + 1);
      if (latestRows.length > MAX_RESULTS) throw new ResultListTooLarge();

      const headStates = await resolveStoredResultHeadStates(tx, race.id, latestRows);
      const basisHashes = await loadResultBasisHashes(tx, race.id);
      if (headStates.some((state) =>
        state.state === "ACTIVE_RESULT" && state.withoutTiming?.withdrawal === null)) {
        throw new StoredResultListConflict("Utan tidtagning saknar sanningsenlig IOF 3.0-mappning");
      }
      const stateByHeadId = new Map(headStates.map((state) => [state.head.id, state]));
      const activeRows = headStates.flatMap((state) => {
        if (state.state !== "ACTIVE_RESULT") return [];
        const approval = state.approval;
        return [{
          ...state.head,
          manualApprovalProof: state.head.cause === "MANUAL_RESULT_APPROVAL" && approval !== null &&
            approval.withdrawal === null && approval.approved.id === state.head.id ? {
              decisionId: approval.decision.id,
              targetResultRevisionId: approval.target.id
            } : null,
          finishTimeCorrectionProof: state.finishTimeCorrection,
          finishTimeCorrectionWithdrawalProof: state.finishTimeCorrectionWithdrawal,
          punchStartTimeCorrectionProof: state.punchStartTimeCorrection,
          punchStartTimeCorrectionWithdrawalProof: state.punchStartTimeCorrectionWithdrawal
        }];
      });
      const totalEntries = entryAggregate[0]?.value ?? 0;
      const omittedEntryCount = totalEntries - activeRows.length;
      if (!Number.isSafeInteger(omittedEntryCount) || omittedEntryCount < 0) {
        throw new StoredResultListConflict("Deltagaraggregatet motsäger resultatuppsättningen");
      }
      if (omittedEntryCount > MAX_OMITTED_ENTRIES) throw new ResultListTooLarge();

      const parsedRows = activeRows.map((row) => {
        const state = stateByHeadId.get(row.id);
        if (!state) throw new StoredResultListConflict("Resultatets livscykel saknas");
        const evaluation = parseStrictStoredResultRevision(row,
          state.startCheckinDns?.source,
          row.finishTimeCorrectionProof ?? undefined, row.finishTimeCorrectionWithdrawalProof ?? undefined,
          row.punchStartTimeCorrectionProof ?? undefined, row.punchStartTimeCorrectionWithdrawalProof ?? undefined,
          state.shortenedCourseClassTransfer ?? undefined);
        if (evaluation.status === "NT") {
          throw new StoredResultListConflict("Utan tidtagning saknar sanningsenlig IOF 3.0-mappning");
        }
        if (row.snapshotVersion > race.snapshotVersion) {
          throw new StoredResultListConflict("Resultatrevisionen motsäger sin evaluation");
        }
        return { ...row, evaluation };
      });

      const classIds = [...new Set(parsedRows.map((row) => row.evaluation.classId))];
      if (classIds.length > MAX_CLASSES) throw new ResultListTooLarge();
      const courseVersionIds = [...new Set(parsedRows.map((row) => row.courseVersionId))];

      const classRows = classIds.length === 0 ? [] : await tx.select({
        id: schema.classes.id,
        name: schema.classes.name,
        externalSource: schema.classes.externalSource,
        externalId: schema.classes.externalId
      }).from(schema.classes).where(and(
        eq(schema.classes.raceId, race.id),
        inArray(schema.classes.id, classIds)
      ));
      if (classRows.length !== classIds.length) {
        throw new StoredResultListConflict("Historisk resultatklass saknas i loppet");
      }

      const versionRows = courseVersionIds.length === 0 ? [] : await tx.select({
        id: schema.courseVersions.id,
        raceId: schema.courses.raceId
      }).from(schema.courseVersions)
        .innerJoin(schema.courses, eq(schema.courseVersions.courseId, schema.courses.id))
        .where(inArray(schema.courseVersions.id, courseVersionIds));
      if (versionRows.length !== courseVersionIds.length || versionRows.some((row) => row.raceId !== race.id)) {
        throw new StoredResultListConflict("Historisk banversion saknas i loppet");
      }

      const controlRows = courseVersionIds.length === 0 ? [] : await tx.select({
        id: schema.courseControls.id,
        courseVersionId: schema.courseControls.courseVersionId,
        sequence: schema.courseControls.sequence,
        controlCode: schema.controls.code,
        controlRaceId: schema.controls.raceId
      }).from(schema.courseControls)
        .innerJoin(schema.controls, eq(schema.courseControls.controlId, schema.controls.id))
        .where(inArray(schema.courseControls.courseVersionId, courseVersionIds))
        .orderBy(
          asc(schema.courseControls.courseVersionId),
          asc(schema.courseControls.sequence),
          asc(schema.courseControls.id)
        );

      const controlsByVersion = new Map<string, Array<{ id: string; sequence: number; controlCode: number }>>();
      for (const row of controlRows) {
        if (row.controlRaceId !== race.id) {
          throw new StoredResultListConflict("Historisk kontroll tillhör ett annat lopp");
        }
        const rows = controlsByVersion.get(row.courseVersionId) ?? [];
        rows.push({ id: row.id, sequence: row.sequence, controlCode: row.controlCode });
        if (rows.length > MAX_EXPECTED_CONTROLS) throw new ResultListTooLarge();
        controlsByVersion.set(row.courseVersionId, rows);
      }
      // Gafflad bana: resultatets kontroller är löparens variant (ADR-0169 beslut 2).
      const variantsByVersion = await loadCourseVersionVariants(tx, courseVersionIds);
      for (const versionId of courseVersionIds) {
        if ((controlsByVersion.get(versionId)?.length ?? 0) === 0 && !variantsByVersion.has(versionId)) {
          throw new StoredResultListConflict("Historisk banversion saknar kontroller");
        }
      }

      const classById = new Map(classRows.map((row) => [row.id, row]));
      const neutralizationIds = [...new Set(parsedRows.flatMap((row) => row.controlNeutralizationId === null ? [] : [row.controlNeutralizationId]))];
      const neutralizationRows = neutralizationIds.length === 0 ? [] : await tx.select({
        id: schema.classControlNeutralizations.id, raceId: schema.classControlNeutralizations.raceId,
        classId: schema.classControlNeutralizations.classId, courseVersionId: schema.classControlNeutralizations.courseVersionId,
        courseControlId: schema.classControlNeutralizations.courseControlId, sequence: schema.classControlNeutralizations.sequence,
        controlCode: schema.classControlNeutralizations.controlCode
      }).from(schema.classControlNeutralizations).where(inArray(schema.classControlNeutralizations.id, neutralizationIds));
      if (neutralizationRows.length !== neutralizationIds.length || neutralizationRows.some((row) => row.raceId !== race.id)) {
        throw new StoredResultListConflict("Neutraliseringsprovenansen saknas eller ligger utanför loppet");
      }
      const neutralizationById = new Map(neutralizationRows.map((row) => [row.id, row]));
      const resultsByClass = new Map<string, Array<IofResultListPersonResult & {
        internalEntryId: string;
        internalCourseVersionId: string;
      }>>();
      const revisionControls = (row: (typeof parsedRows)[number]) => {
        const variants = variantsByVersion.get(row.courseVersionId);
        if (!variants) return controlsByVersion.get(row.courseVersionId) ?? [];
        const variant = storedResultCourseVariant(variants, row.courseVariantCode,
          ("splits" in row.evaluation ? row.evaluation.splits : []).map((split) => split.controlCode));
        return (variant?.controlCodes ?? []).map((controlCode, index) => ({ id: `${row.courseVersionId}:${index + 1}`, sequence: index + 1, controlCode }));
      };
      for (const row of parsedRows) {
        const projection = row.evaluation.status === "DNS" || row.evaluation.status === "DNF"
          ? { expected: [], splitKeyMap: new Map<string, { controlCode: number; occurrence: number }>() }
          : expectedControlsForRevision(revisionControls(row),
            row.controlNeutralizationId === null ? undefined : neutralizationById.get(row.controlNeutralizationId),
            row.evaluation.classId, row.courseVersionId);
        const expected = projection.expected;
        const expectedKeys = new Set(expected.map((control) => `${control.controlCode}:${control.occurrence}`));
        const splitKeys = new Set<string>();
        const rawEvaluationSplits = "splits" in row.evaluation ? row.evaluation.splits : [];
        const evaluationSplits = rawEvaluationSplits.map((split) => {
          if (row.evaluation.status === "DNS" || row.evaluation.status === "DNF") return split;
          const projected = projection.splitKeyMap.get(`${split.controlCode}:${split.occurrence}`);
          if (!projected) throw new StoredResultListConflict("Evaluationens split saknar neutraliserad projektion");
          return { ...split, controlCode: projected.controlCode, occurrence: projected.occurrence };
        });
        for (const split of evaluationSplits) {
          const key = `${split.controlCode}:${split.occurrence}`;
          if (!expectedKeys.has(key) || splitKeys.has(key)) {
            throw new StoredResultListConflict("Evaluationens splits motsäger den historiska banan");
          }
          splitKeys.add(key);
        }
        const entryExternalId = optionalIofId(row.entryExternalSource, row.entryExternalId);
        const shared = {
          internalEntryId: row.entryId,
          internalCourseVersionId: row.courseVersionId,
          givenName: row.givenName,
          familyName: row.familyName,
          ...(entryExternalId === undefined ? {} : { entryExternalId }),
          ...(row.organisationName === null ? {} : { organisationName: row.organisationName })
        };
        const result: IofResultListPersonResult & typeof shared = row.evaluation.status === "DNF"
          ? { ...shared, status: "DNF" }
          : row.evaluation.status === "OOC"
            ? {
              ...shared,
              status: "OOC",
              expectedControls: expected,
              splits: evaluationSplits.map((split) => ({
                controlCode: split.controlCode,
                occurrence: split.occurrence,
                elapsedMs: split.elapsedMs
              })),
              ...("startTime" in row.evaluation ? { startTime: row.evaluation.startTime } : {}),
              ...("finishTime" in row.evaluation ? { finishTime: row.evaluation.finishTime } : {}),
              ...("elapsedMs" in row.evaluation ? { elapsedMs: row.evaluation.elapsedMs } : {})
            }
            : {
            ...shared,
            status: row.evaluation.status,
            expectedControls: expected,
            splits: evaluationSplits.map((split) => ({
              controlCode: split.controlCode,
              occurrence: split.occurrence,
              elapsedMs: split.elapsedMs
            })),
            ...("startTime" in row.evaluation ? { startTime: row.evaluation.startTime } : {}),
            ...("finishTime" in row.evaluation ? { finishTime: row.evaluation.finishTime } : {}),
            ...("elapsedMs" in row.evaluation ? { elapsedMs: row.evaluation.elapsedMs } : {}),
            ...(row.manualApprovalProof === null ? {} : { manualApprovalProof: row.manualApprovalProof })
          };
        const results = resultsByClass.get(row.evaluation.classId) ?? [];
        results.push(result);
        resultsByClass.set(row.evaluation.classId, results);
      }

      // Stafett: sträcklöparnas personresultat samlas i lagresultat (TeamResult) per stafettklass.
      const personByEntry = new Map([...resultsByClass.values()].flat().map(({ internalEntryId, internalCourseVersionId, ...result }) => {
        void internalCourseVersionId;
        return [internalEntryId, result as IofResultListPersonResult] as const;
      }));
      const teamResultsByClass = await relayTeamResultsForExport(tx, race.id, personByEntry);
      const classesWithInternalIds = classIds.map((classId) => {
        const raceClass = classById.get(classId);
        if (!raceClass) throw new StoredResultListConflict("Historisk resultatklass saknas");
        const classExternalId = optionalIofId(raceClass.externalSource, raceClass.externalId);
        const teamResults = teamResultsByClass.get(classId);
        if (teamResults) {
          return { internalClassId: classId, className: raceClass.name, ...(classExternalId === undefined ? {} : { classExternalId }),
            results: [], teamResults };
        }
        const results = resultsByClass.get(classId) ?? [];
        const rankingByKey = new Map(rankClassResults(results.map((result) => ({
          key: result.internalEntryId,
          status: result.status,
          ...(result.elapsedMs === undefined ? {} : { elapsedMs: result.elapsedMs }),
          courseVersionId: result.internalCourseVersionId
        }))).map((ranking) => [ranking.key, ranking]));
        results.sort((left, right) =>
          compareResultStatuses(left.status, right.status) ||
          ((left.elapsedMs ?? Number.MAX_SAFE_INTEGER) - (right.elapsedMs ?? Number.MAX_SAFE_INTEGER)) ||
          compareText(left.familyName, right.familyName) ||
          compareText(left.givenName, right.givenName) ||
          compareText(left.entryExternalId ?? "", right.entryExternalId ?? "") ||
          compareText(left.internalEntryId, right.internalEntryId)
        );
        return {
          internalClassId: classId,
          className: raceClass.name,
          ...(classExternalId === undefined ? {} : { classExternalId }),
          results: results.map(({ internalEntryId, internalCourseVersionId, ...result }) => {
            void internalCourseVersionId;
            const ranking = rankingByKey.get(internalEntryId);
            if (!ranking) throw new StoredResultListConflict("Resultatet saknar härledd rankingstate");
            if (result.status === "DNF" || result.status === "OOC") {
              if (ranking.position !== undefined || ranking.timeBehindMs !== undefined) {
                throw new StoredResultListConflict("DNF och OOC får inte ha ranking");
              }
              return result;
            }
            return {
              ...result,
              ...(ranking.position === undefined ? {} : { position: ranking.position }),
              ...(ranking.timeBehindMs === undefined ? {} : { timeBehindMs: ranking.timeBehindMs })
            };
          })
        };
      }).sort((left, right) =>
        compareText(left.className, right.className) ||
        compareText(left.classExternalId ?? "", right.classExternalId ?? "") ||
        compareText(left.internalClassId, right.internalClassId)
      );
      const classes: IofResultListProjection["classes"] = classesWithInternalIds.map(
        ({ internalClassId, ...raceClass }) => {
          void internalClassId;
          return raceClass;
        }
      );

      let bytes: Uint8Array;
      try {
        bytes = serializeIofResultList({ status: "Snapshot", eventName: event[0].name, classes });
      } catch {
        throw new StoredResultListConflict("Exportprojektionen kan inte serialiseras");
      }
      const metadata = iofResultListExportMetadataSchema.parse({
        formatVersion: 1,
        raceId: race.id,
        snapshotVersion: race.snapshotVersion,
        classCount: classes.length,
        resultCount: parsedRows.length,
        staleResultCount: parsedRows.filter((row) => !isResultCurrent(row, basisHashes.get(row.entryId), race.snapshotVersion)).length,
        omittedEntryCount,
        sha256: createHash("sha256").update(bytes).digest("hex")
      });
      return { status: "ok", bytes, metadata } as const;
    }, { isolationLevel: "repeatable read" });
  } catch (error) {
    if (error instanceof ResultListTooLarge) return { status: "too-large" };
    if (error instanceof StoredResultListConflict || error instanceof ClassRankingError) {
      return { status: "conflict" };
    }
    throw error;
  }
}

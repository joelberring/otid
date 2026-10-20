import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  iofResultListExportMetadataSchema,
  type IofResultListExportMetadata
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import { ClassRankingError, compareResultStatuses, rankClassResults, storedResultCourseVariant } from "@o-tid/domain";
import {
  serializeIofResultList,
  type IofResultListCourse,
  type IofResultListPersonResult,
  type IofResultListProjection,
} from "@o-tid/iof-xml";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { parseStrictStoredResultRevision } from "./stored-result-revision";
import { isResultCurrent, loadResultBasisHashes } from "./result-basis";
import { loadCourseVersionVariants } from "./course-variants";
import { relayTeamResultsForExport } from "./relay-export";
import { UUID_PATTERN, compareText, sha256Hex } from "./serialization";
import { loadControlCodesOutOfOrder } from "./snapshot";

const MAX_CLASSES = 1_000;
const MAX_RESULTS = 10_000;
const MAX_OMITTED_ENTRIES = 10_000;
const MAX_EXPECTED_CONTROLS = 256;

export type IofResultListExportResult =
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" | "too-large" }
  | { status: "ok"; bytes: Uint8Array; metadata: IofResultListExportMetadata };

export type AuthenticatedIofResultListExportInput = Omit<RaceSessionProof, "csrfCookie" | "csrfHeader">;

class StoredResultListConflict extends Error {}
class ResultListTooLarge extends Error {}

function externalIofId(source: string | null, externalId: string | null): string | undefined {
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

/**
 * Förväntade kontroller för exportens sträcktider. En kontroll ur funktion (PLAN.md steg 31) har ingen sträcktid och
 * utelämnas; förekomsterna av övriga koder är desamma som i bedömningen.
 */
function expectedControlsForRevision(rows: readonly { id: string; sequence: number; controlCode: number }[], outOfOrder: ReadonlySet<number>) {
  const expected = expectedControls(rows).filter((control) => !outOfOrder.has(control.controlCode));
  return { expected, splitKeyMap: new Map(expected.map((control) => [`${control.controlCode}:${control.occurrence}`, control])) };
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Rogaining: de räknade kontrollerna (en gång var, i stämplingsordning) som förväntade kontroller. */
function rogainingProjection(controls: readonly { controlCode: number }[]) {
  const expected = controls.map((control) => ({ controlCode: control.controlCode, occurrence: 1 }));
  return { expected, splitKeyMap: new Map(expected.map((control) => [`${control.controlCode}:1`, control])) };
}

/** IOF 3.0 Score: summan (type="Score") först, straffet (type="Penalty") när löparen var för sen. */
function rogainingScores(score: { readonly total: number; readonly penalty: number }) {
  return [{ type: "Score", value: score.total }, ...(score.penalty > 0 ? [{ type: "Penalty", value: score.penalty }] : [])];
}

/**
 * Förväntade kontroller utan split som inte heller saknas: de stämplades men utan giltig tid (före start eller efter
 * mål, se domänens sträcktider). De skrivs som SplitTime utan Time i stället för "Missing" (PLAN.md steg 13).
 */
function untimedControls(expected: readonly { controlCode: number; occurrence: number }[],
  splits: readonly { controlCode: number; occurrence: number }[], missingControls: readonly number[]) {
  const timed = new Set(splits.map((split) => `${split.controlCode}:${split.occurrence}`));
  const missing = new Map<number, number>();
  for (const code of missingControls) missing.set(code, (missing.get(code) ?? 0) + 1);
  return expected.filter((control) => {
    if (timed.has(`${control.controlCode}:${control.occurrence}`)) return false;
    const left = missing.get(control.controlCode) ?? 0;
    if (left > 0) { missing.set(control.controlCode, left - 1); return false; }
    return true;
  });
}

export async function exportIofResultListAsAdmin(
  db: Database,
  input: AuthenticatedIofResultListExportInput,
  now = new Date()
): Promise<IofResultListExportResult> {
  if (!UUID_PATTERN.test(input.raceId)) return { status: "invalid-request" };
  return exportIofResultList(db, async (tx) => {
    const authorization = await requireRaceRole(tx, {
      sessionToken: input.sessionToken,
      raceId: input.raceId,
      role: "ADMIN"
    }, now, "share");
    if (authorization.status !== "authenticated") return authorization;
    return projectIofResultList(tx, authorization.principal.raceId, { externalIds: true });
  });
}

/**
 * PLAN.md steg 13: samma IOF-resultatlista för de publika resultaten. Den bygger på samma publicerade resultat
 * som den publika listan men tar inte med externa id:n (Eventor/IOF) för löpare och klasser.
 */
export async function exportPublicIofResultList(db: Database, raceId: string): Promise<IofResultListExportResult> {
  if (!UUID_PATTERN.test(raceId)) return { status: "not-found" };
  return exportIofResultList(db, (tx) => projectIofResultList(tx, raceId, { externalIds: false }));
}

async function exportIofResultList(db: Database, run: (tx: Transaction) => Promise<IofResultListExportResult>): Promise<IofResultListExportResult> {
  try {
    return await db.transaction(run, { isolationLevel: "repeatable read" });
  } catch (error) {
    if (error instanceof ResultListTooLarge) return { status: "too-large" };
    if (error instanceof StoredResultListConflict || error instanceof ClassRankingError) {
      return { status: "conflict" };
    }
    throw error;
  }
}

/** IOF-banan: namn (varianten i en gafflad klass, annars banans namn), längd och stigning i meter. */
function iofCourse(course: { courseName: string; lengthMeters: number | null; climbMeters: number | null } | undefined,
  variantCode: string | undefined): IofResultListCourse | undefined {
  if (!course) return undefined;
  return { name: variantCode ? `${course.courseName}-${variantCode}` : course.courseName,
    ...(course.lengthMeters === null ? {} : { lengthMeters: course.lengthMeters }),
    ...(course.climbMeters === null ? {} : { climbMeters: course.climbMeters }) };
}

async function projectIofResultList(tx: Transaction, raceId: string, options: { externalIds: boolean }): Promise<IofResultListExportResult> {
  const optionalIofId = (source: string | null, externalId: string | null) => options.externalIds ? externalIofId(source, externalId) : undefined;
  const [race] = await tx.select({
    id: schema.races.id,
    eventId: schema.races.eventId,
    snapshotVersion: schema.races.snapshotVersion
  }).from(schema.races)
    .where(eq(schema.races.id, raceId))
    .for("share");
  if (!race) return { status: "not-found" } as const;

  const [event, siblingRaces, entryAggregate] = await Promise.all([
    tx.select({ name: schema.events.name }).from(schema.events)
      .where(eq(schema.events.id, race.eventId)).limit(1),
    tx.select({ id: schema.races.id }).from(schema.races)
      .where(eq(schema.races.eventId, race.eventId)).orderBy(asc(schema.races.id)).limit(2),
    tx.select({ value: count(schema.entries.id) }).from(schema.entries)
      .where(and(eq(schema.entries.raceId, race.id), isNull(schema.entries.struckAt)))
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
  startCheckinDnsDecisionId: schema.resultRevisions.startCheckinDnsDecisionId,
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
    eventorPersonId: schema.entries.eventorPersonId,
    eventorOrganisationId: schema.entries.eventorOrganisationId,
    courseVariantCode: schema.entries.courseVariantCode
  }).from(schema.resultRevisions)
    .innerJoin(schema.entries, and(
      eq(schema.resultRevisions.entryId, schema.entries.id),
      eq(schema.entries.raceId, race.id),
      isNull(schema.entries.struckAt)
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
    state.state === "ACTIVE_RESULT" && state.governing === "NT")) {
    throw new StoredResultListConflict("Utan tidtagning saknar sanningsenlig IOF 3.0-mappning");
  }
  const stateByHeadId = new Map(headStates.map((state) => [state.head.id, state]));
  const activeRows = headStates.flatMap((state) => {
    if (state.state !== "ACTIVE_RESULT") return [];
    return [{
      ...state.head,
      manualApprovalProof: state.head.cause === "MANUAL_RESULT_APPROVAL" && state.governing === "APPROVAL" &&
        state.underlyingId !== null ? { decisionId: state.head.id, targetResultRevisionId: state.underlyingId } : null
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
    const evaluation = parseStrictStoredResultRevision(row, state.startCheckinDns?.source);
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
    externalId: schema.classes.externalId,
    courseName: schema.courses.name,
    lengthMeters: schema.courses.lengthMeters,
    climbMeters: schema.courses.climbMeters
  }).from(schema.classes)
    .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
    .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId)).where(and(
    eq(schema.classes.raceId, race.id),
    inArray(schema.classes.id, classIds)
  ));
  if (classRows.length !== classIds.length) {
    throw new StoredResultListConflict("Historisk resultatklass saknas i loppet");
  }

  const versionRows = courseVersionIds.length === 0 ? [] : await tx.select({
    id: schema.courseVersions.id,
    raceId: schema.courses.raceId,
    courseName: schema.courses.name,
    lengthMeters: schema.courses.lengthMeters,
    climbMeters: schema.courses.climbMeters
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
  const courseByVersion = new Map(versionRows.map((row) => [row.id, row]));
  // Brickan (ControlCard) bara i arbetsytans export; den publika exporten bär inga bricknummer eller Eventor-id.
  const cardRows = !options.externalIds ? [] : await tx.select({ entryId: schema.cardAssignments.entryId, cardNumber: schema.cardAssignments.cardNumber })
    .from(schema.cardAssignments).where(and(eq(schema.cardAssignments.raceId, race.id), eq(schema.cardAssignments.active, true)));
  const cardByEntry = new Map(cardRows.map((row) => [row.entryId, row.cardNumber]));
  const outOfOrder = await loadControlCodesOutOfOrder(tx, race.id);
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
    // Rogaining (ADR-0170 beslut 5): de räknade kontrollerna i stämplingsordning är löparens "bana" i exporten.
    const rogaining = "rogaining" in row.evaluation ? row.evaluation.rogaining : undefined;
    const projection = row.evaluation.status === "DNS" || row.evaluation.status === "DNF"
      ? { expected: [], splitKeyMap: new Map<string, { controlCode: number; occurrence: number }>() }
      : rogaining ? rogainingProjection(rogaining.controls)
      : expectedControlsForRevision(revisionControls(row), outOfOrder);
    const expected = projection.expected;
    const expectedKeys = new Set(expected.map((control) => `${control.controlCode}:${control.occurrence}`));
    const splitKeys = new Set<string>();
    // En äldre revision (t.ex. manuellt rättad tid) kan ha tid vid en kontroll som nu är ur funktion; den exporteras inte.
    const rawEvaluationSplits = ("splits" in row.evaluation ? row.evaluation.splits : [])
      .filter((split) => rogaining || !outOfOrder.has(split.controlCode));
    const evaluationSplits = rawEvaluationSplits.map((split) => {
      if (row.evaluation.status === "DNS" || row.evaluation.status === "DNF") return split;
      const projected = projection.splitKeyMap.get(`${split.controlCode}:${split.occurrence}`);
      if (!projected) throw new StoredResultListConflict("Evaluationens split saknar kontroll i banan");
      return { ...split, controlCode: projected.controlCode, occurrence: projected.occurrence };
    });
    for (const split of evaluationSplits) {
      const key = `${split.controlCode}:${split.occurrence}`;
      if (!expectedKeys.has(key) || splitKeys.has(key)) {
        throw new StoredResultListConflict("Evaluationens splits motsäger den historiska banan");
      }
      splitKeys.add(key);
    }
    const untimed = row.evaluation.status === "DNS" || row.evaluation.status === "DNF" ? []
      : untimedControls(expected, evaluationSplits, "missingControls" in row.evaluation ? row.evaluation.missingControls : []);
    const entryExternalId = optionalIofId(row.entryExternalSource, row.entryExternalId);
    const card = cardByEntry.get(row.entryId);
    const variantCode = variantsByVersion.has(row.courseVersionId)
      ? storedResultCourseVariant(variantsByVersion.get(row.courseVersionId)!, row.courseVariantCode,
        ("splits" in row.evaluation ? row.evaluation.splits : []).map((split) => split.controlCode))?.code : undefined;
    const course = variantCode ? iofCourse(courseByVersion.get(row.courseVersionId), variantCode) : undefined;
    const shared = {
      internalEntryId: row.entryId,
      internalCourseVersionId: row.courseVersionId,
      givenName: row.givenName,
      familyName: row.familyName,
      ...(entryExternalId === undefined ? {} : { entryExternalId }),
      ...(options.externalIds && row.eventorPersonId ? { personEventorId: row.eventorPersonId } : {}),
      ...(options.externalIds && row.eventorOrganisationId ? { organisationEventorId: row.eventorOrganisationId } : {}),
      ...(row.organisationName === null ? {} : { organisationName: row.organisationName }),
      ...(card && /^[1-9][0-9]{0,31}$/.test(card) ? { cardNumber: card } : {}),
      // Gafflad klass: löparens variant som egen bana ("Lång-AC") med banans längd och stigning.
      ...(course ? { course } : {})
    };
    const result: IofResultListPersonResult & typeof shared = row.evaluation.status === "DNF"
      ? { ...shared, status: "DNF" }
      : row.evaluation.status === "OOC"
        ? {
          ...shared,
          status: "OOC",
          expectedControls: expected,
          ...(untimed.length === 0 ? {} : { untimedControls: untimed }),
          splits: evaluationSplits.map((split) => ({
            controlCode: split.controlCode,
            occurrence: split.occurrence,
            elapsedMs: split.elapsedMs
          })),
          ...("startTime" in row.evaluation ? { startTime: row.evaluation.startTime } : {}),
          ...("finishTime" in row.evaluation ? { finishTime: row.evaluation.finishTime } : {}),
          ...("elapsedMs" in row.evaluation ? { elapsedMs: row.evaluation.elapsedMs } : {}),
          ...(rogaining ? { scores: rogainingScores(rogaining) } : {})
        }
        : {
        ...shared,
        status: row.evaluation.status,
        expectedControls: expected,
        ...(untimed.length === 0 ? {} : { untimedControls: untimed }),
        splits: evaluationSplits.map((split) => ({
          controlCode: split.controlCode,
          occurrence: split.occurrence,
          elapsedMs: split.elapsedMs
        })),
        ...("startTime" in row.evaluation ? { startTime: row.evaluation.startTime } : {}),
        ...("finishTime" in row.evaluation ? { finishTime: row.evaluation.finishTime } : {}),
        ...("elapsedMs" in row.evaluation ? { elapsedMs: row.evaluation.elapsedMs } : {}),
        ...(rogaining ? { scores: rogainingScores(rogaining) } : {}),
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
    const classCourse = iofCourse(raceClass, undefined);
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
      ...(result.scores === undefined ? {} : { score: result.scores[0]!.value }),
      courseVersionId: result.internalCourseVersionId
    }))).map((ranking) => [ranking.key, ranking]));
    results.sort((left, right) =>
      compareResultStatuses(left.status, right.status) ||
      ((right.scores?.[0]?.value ?? -1) - (left.scores?.[0]?.value ?? -1)) ||
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
      ...(classCourse ? { course: classCourse } : {}),
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
    sha256: sha256Hex(bytes)
  });
  return { status: "ok", bytes, metadata } as const;
}

/** Fastställandets underlag: allt som läses ur databasen för ett lopp, i en transaktion (delat från result-finalization-basis.ts). */
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import { resolveStoredResultHeadStates } from "./result-revision-state";
import { loadResultBasisHashes } from "./result-basis";
import { loadCourseVersionVariants } from "./course-variants";
import { FinalizationTooLarge, StoredFinalizationConflict, type ResultFinalizationRow } from "./result-finalization-projection";

const MAX_CLASSES = 1_000;
const MAX_RESULTS = 10_000;
const MAX_EXPECTED_CONTROLS = 256;

export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface LockedRace {
  readonly id: string;
  readonly eventId: string;
  readonly snapshotVersion: number;
}

/** Loppets klasser, anmälningar, senaste resultat, banor, brickor och tidigare fastställanden. */
export async function loadFinalizationSources(tx: DatabaseTransaction, race: LockedRace) {
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
      courseVariantCode: schema.entries.courseVariantCode,
      // Steg 47: stafettsträckans egen bana (null = klassens).
      legCourseVersionId: schema.relayLegs.courseVersionId
    }).from(schema.entries)
      .leftJoin(schema.relayLegs, and(eq(schema.relayLegs.classId, schema.entries.classId), eq(schema.relayLegs.leg, schema.entries.relayLeg)))
      .where(and(eq(schema.entries.raceId, race.id), isNull(schema.entries.struckAt)))
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

  const legCourseIds = [...new Set(entryRows.flatMap((entry) => entry.legCourseVersionId ? [entry.legCourseVersionId] : []))];
  const courseVersionIds = [...new Set([...classRows.map((raceClass) => raceClass.courseVersionId), ...legCourseIds])];
  const legCourses = new Map((legCourseIds.length === 0 ? [] : await tx.select({ id: schema.courseVersions.id, courseName: schema.courses.name,
    lengthMeters: schema.courses.lengthMeters, climbMeters: schema.courses.climbMeters }).from(schema.courseVersions)
    .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
    .where(and(inArray(schema.courseVersions.id, legCourseIds), eq(schema.courses.raceId, race.id)))).map((row) => [row.id, row]));
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

  return {
    eventName: eventRows[0].name, siblingRaces, classRows, entryRows, unresolvedRows, latestStateByEntry, basisHashes, legCourses,
    controlsByVersion, variantsByVersion, entriesByClass, latestByEntry, cardByEntry, latestClassFinalizationByClass, latestRaceFinalization
  };
}

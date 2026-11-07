/**
 * Fastställandets sammanställning: den frysta projektionen som IOF ResultList och metadata för en sparad fastställning, och
 * bitarna (bana, identitet, kontroller) som underlaget i `result-finalization-basis.ts` fryser.
 */
import {
  classResultFinalizationMetadataSchema,
  frozenClassFinalizationProjectionSchema,
  frozenRaceFinalizationProjectionSchema,
  raceResultFinalizationMetadataSchema,
  type ClassResultFinalizationMetadata,
  type FrozenIofPersonProjection,
  type RaceResultFinalizationMetadata
} from "@o-tid/contracts";
import type { schema } from "@o-tid/database";
import {
  type IofResultListClass, type IofResultListCourse,
  type IofResultListPersonResult
} from "@o-tid/iof-xml";
import { canonicalHash, sha256Hex as sha256Bytes } from "./serialization";

export class StoredFinalizationConflict extends Error {}
export class FinalizationTooLarge extends Error {}

export type ResultFinalizationRow = typeof schema.resultFinalizations.$inferSelect;

/** Banan i den fastställda filen: variantens namn i en gafflad klass ("Lång-AC"), längd och stigning. */
export function frozenCourse(raceClass: { courseName: string; lengthMeters: number | null; climbMeters: number | null }, variantCode: string | undefined) {
  return { name: variantCode ? `${raceClass.courseName}-${variantCode}` : raceClass.courseName,
    ...(raceClass.lengthMeters === null ? {} : { lengthMeters: raceClass.lengthMeters }),
    ...(raceClass.climbMeters === null ? {} : { climbMeters: raceClass.climbMeters }) };
}

/** Eventors person- och klubb-id, brickan och löparens bana för IOF-filen (PLAN.md steg 25). */
export function iofIdentity(entry: { eventorPersonId: string | null; eventorOrganisationId: string | null }, cardNumber: string | undefined,
  course: ReturnType<typeof frozenCourse> | undefined) {
  return { ...(entry.eventorPersonId ? { personEventorId: entry.eventorPersonId } : {}),
    ...(entry.eventorOrganisationId ? { organisationEventorId: entry.eventorOrganisationId } : {}),
    ...(cardNumber ? { cardNumber } : {}), ...(course ? { course } : {}) };
}

export function expectedControls(rows: readonly { sequence: number; controlCode: number }[]) {
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
  // Steg 38: brutit med avläsning har starten och sträcktiderna fram till sista stämplade kontrollen, aldrig tid.
  const partial = { expectedControls: result.expectedControls, splits: result.splits,
    ...(result.startTime === null ? {} : { startTime: result.startTime }) };
  if (result.status === "DNF") return result.splits.length === 0 ? { ...identity, status: "DNF" } : { ...identity, status: "DNF", ...partial };
  // Steg 35: "Deltog utan tid" har ingen egen IOF 3.0-status och skrivs som NotCompeting utan tid (steg 38: med sträcktider).
  if (result.status === "NT") return { ...identity, status: "OOC", ...(result.splits.length === 0 ? { expectedControls: [], splits: [] } : partial) };
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

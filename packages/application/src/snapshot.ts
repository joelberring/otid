import { asc, eq } from "drizzle-orm";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import type { RaceSnapshot } from "@o-tid/domain";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbExecutor = Database | Transaction;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortRaceSnapshotForPackage(snapshot: RaceSnapshot) {
  return {
    race: snapshot.race,
    classes: [...snapshot.classes].sort((left, right) => compareText(left.id, right.id)),
    courses: [...snapshot.courses]
      .sort((left, right) => compareText(left.id, right.id))
      .map((course) => ({
        ...course,
        versions: [...course.versions]
          .sort((left, right) => left.version - right.version || compareText(left.id, right.id))
          .map((version) => ({
            ...version,
            controls: [...version.controls]
              .sort((left, right) => left.sequence - right.sequence || compareText(left.id, right.id))
          }))
      })),
    entries: [...snapshot.entries].sort((left, right) => compareText(left.id, right.id)),
    cardAssignments: [...snapshot.cardAssignments].sort((left, right) => compareText(left.id, right.id)),
    classControlNeutralizations: [...snapshot.classControlNeutralizations]
      .sort((left, right) => compareText(left.classId, right.classId) ||
        compareText(left.courseVersionId, right.courseVersionId) || left.sequence - right.sequence ||
        compareText(left.id, right.id))
  };
}

export async function loadRaceSnapshot(db: DbExecutor, raceId: string): Promise<RaceSnapshot> {
  const [raceRow] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
  if (!raceRow) throw new Error("Loppet finns inte");
  const [eventRow] = await db.select().from(schema.events).where(eq(schema.events.id, raceRow.eventId));
  if (!eventRow) throw new Error("Evenemanget finns inte");

  const classRows = await db.select().from(schema.classes)
    .where(eq(schema.classes.raceId, raceId))
    .orderBy(asc(schema.classes.id));
  const courseRows = await db.select().from(schema.courses)
    .where(eq(schema.courses.raceId, raceId))
    .orderBy(asc(schema.courses.id));
  const versionRows = await db.select({
    id: schema.courseVersions.id,
    courseId: schema.courseVersions.courseId,
    version: schema.courseVersions.version,
    createdAt: schema.courseVersions.createdAt
  }).from(schema.courseVersions)
    .innerJoin(schema.courses, eq(schema.courseVersions.courseId, schema.courses.id))
    .where(eq(schema.courses.raceId, raceId))
    .orderBy(
      asc(schema.courseVersions.courseId),
      asc(schema.courseVersions.version),
      asc(schema.courseVersions.id)
    );
  const courseControlRows = await db.select({
    id: schema.courseControls.id,
    courseVersionId: schema.courseControls.courseVersionId,
    controlId: schema.courseControls.controlId,
    sequence: schema.courseControls.sequence,
    controlCode: schema.controls.code
  }).from(schema.courseControls)
    .innerJoin(schema.controls, eq(schema.courseControls.controlId, schema.controls.id))
    .innerJoin(schema.courseVersions, eq(schema.courseControls.courseVersionId, schema.courseVersions.id))
    .innerJoin(schema.courses, eq(schema.courseVersions.courseId, schema.courses.id))
    .where(eq(schema.courses.raceId, raceId))
    .orderBy(
      asc(schema.courseControls.courseVersionId),
      asc(schema.courseControls.sequence),
      asc(schema.courseControls.id)
    );
  const entryRows = await db.select().from(schema.entries)
    .where(eq(schema.entries.raceId, raceId))
    .orderBy(asc(schema.entries.id));
  const assignmentRows = await db.select().from(schema.cardAssignments)
    .where(eq(schema.cardAssignments.raceId, raceId))
    .orderBy(asc(schema.cardAssignments.id));
  const neutralizationRows = await db.select().from(schema.classControlNeutralizations)
    .where(eq(schema.classControlNeutralizations.raceId, raceId))
    .orderBy(asc(schema.classControlNeutralizations.classId), asc(schema.classControlNeutralizations.courseVersionId),
      asc(schema.classControlNeutralizations.sequence), asc(schema.classControlNeutralizations.id));

  return sortRaceSnapshotForPackage({
    race: {
      id: raceRow.id,
      eventId: raceRow.eventId,
      name: raceRow.name,
      raceDate: raceRow.raceDate,
      snapshotVersion: raceRow.snapshotVersion
    },
    classes: classRows.map((row) => ({
      id: row.id,
      raceId: row.raceId,
      name: row.name,
      courseVersionId: row.courseVersionId,
      startRule: row.startRule,
      ...(row.externalId ? { externalIdentity: { source: "iof" as const, externalId: row.externalId } } : {})
    })),
    courses: courseRows.map((course) => ({
      id: course.id,
      raceId: course.raceId,
      name: course.name,
      ...(course.externalId ? { externalIdentity: { source: "iof" as const, externalId: course.externalId } } : {}),
      versions: versionRows.filter((version) => version.courseId === course.id).map((version) => ({
        id: version.id,
        courseId: version.courseId,
        version: version.version,
        createdAt: version.createdAt.toISOString(),
        controls: courseControlRows.filter((control) => control.courseVersionId === version.id)
      }))
    })),
    entries: entryRows.map((row) => ({
      id: row.id,
      raceId: row.raceId,
      classId: row.classId,
      givenName: row.givenName,
      familyName: row.familyName,
      ...(row.organisationName ? { organisationName: row.organisationName } : {}),
      ...(row.fixedStartTime ? { fixedStartTime: row.fixedStartTime.toISOString() } : {}),
      ...(row.externalId ? { externalIdentity: { source: "iof" as const, externalId: row.externalId } } : {})
    })),
    cardAssignments: assignmentRows.map((row) => ({
      id: row.id,
      raceId: row.raceId,
      entryId: row.entryId,
      cardNumber: row.cardNumber,
      active: row.active
    })),
    classControlNeutralizations: neutralizationRows.map((row) => ({
      id: row.id,
      classId: row.classId,
      courseVersionId: row.courseVersionId,
      courseControlId: row.courseControlId,
      sequence: row.sequence,
      controlCode: row.controlCode
    }))
  });
}

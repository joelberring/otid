import { and, asc, desc, eq } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { loadCourseVersionVariants } from "./course-variants";
import type { CurrentState } from "./source-sync-model";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Tävlingens nuvarande klasser, deltagare, lag och banor (gällande versioner) för skillnaderna. */
export async function loadCurrentState(tx: Transaction, raceId: string): Promise<CurrentState> {
  const [race] = await tx.select({ raceDate: schema.races.raceDate, timeZone: schema.events.timeZone }).from(schema.races)
    .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(eq(schema.races.id, raceId));
  if (!race) throw new Error("Loppet saknas");
  const courseRows = await tx.select({ id: schema.courses.id, name: schema.courses.name, externalSource: schema.courses.externalSource,
    externalId: schema.courses.externalId }).from(schema.courses).where(eq(schema.courses.raceId, raceId)).orderBy(asc(schema.courses.name));
  const versions = await tx.selectDistinctOn([schema.courseVersions.courseId], { id: schema.courseVersions.id,
    courseId: schema.courseVersions.courseId, version: schema.courseVersions.version }).from(schema.courseVersions)
    .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId)).where(eq(schema.courses.raceId, raceId))
    .orderBy(asc(schema.courseVersions.courseId), desc(schema.courseVersions.version));
  const versionByCourse = new Map(versions.map(row => [row.courseId, row]));
  const controls = await tx.select({ courseVersionId: schema.courseControls.courseVersionId, code: schema.controls.code })
    .from(schema.courseControls).innerJoin(schema.controls, eq(schema.controls.id, schema.courseControls.controlId))
    .where(eq(schema.controls.raceId, raceId)).orderBy(asc(schema.courseControls.courseVersionId), asc(schema.courseControls.sequence));
  const variants = await loadCourseVersionVariants(tx, versions.map(row => row.id));
  const courses = courseRows.flatMap(course => {
    const version = versionByCourse.get(course.id);
    return version ? [{ ...course, versionId: version.id, version: version.version,
      controlCodes: controls.filter(row => row.courseVersionId === version.id).map(row => row.code),
      variants: variants.get(version.id) ?? [] }] : [];
  });
  const versionToCourse = new Map<string, string>();
  for (const row of await tx.select({ id: schema.courseVersions.id, courseId: schema.courseVersions.courseId }).from(schema.courseVersions)
    .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId)).where(eq(schema.courses.raceId, raceId))) {
    versionToCourse.set(row.id, row.courseId);
  }
  const legs = await tx.select({ classId: schema.relayLegs.classId, leg: schema.relayLegs.leg }).from(schema.relayLegs)
    .where(eq(schema.relayLegs.raceId, raceId));
  const classes = (await tx.select({ id: schema.classes.id, name: schema.classes.name, externalSource: schema.classes.externalSource,
    externalId: schema.classes.externalId, courseVersionId: schema.classes.courseVersionId, startRule: schema.classes.startRule })
    .from(schema.classes).where(eq(schema.classes.raceId, raceId)).orderBy(asc(schema.classes.name), asc(schema.classes.id)))
    .map(row => ({ ...row, courseId: versionToCourse.get(row.courseVersionId)!, legCount: legs.filter(leg => leg.classId === row.id).length }));

  const entryRows = await tx.select({ id: schema.entries.id, classId: schema.entries.classId, givenName: schema.entries.givenName,
    familyName: schema.entries.familyName, organisationName: schema.entries.organisationName, externalSource: schema.entries.externalSource,
    externalId: schema.entries.externalId, teamId: schema.entries.teamId, relayLeg: schema.entries.relayLeg, version: schema.entries.version })
    .from(schema.entries).where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.familyName), asc(schema.entries.givenName));
  const cards = await tx.select({ entryId: schema.cardAssignments.entryId, cardNumber: schema.cardAssignments.cardNumber })
    .from(schema.cardAssignments).where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.active, true)));
  const readCards = new Set((await tx.selectDistinct({ cardNumber: schema.cardReadouts.cardNumber }).from(schema.cardReadouts)
    .where(eq(schema.cardReadouts.raceId, raceId))).map(row => row.cardNumber));
  const heads = await tx.selectDistinctOn([schema.resultRevisions.entryId], { entryId: schema.resultRevisions.entryId,
    status: schema.resultRevisions.status }).from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId))
    .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id));
  const headByEntry = new Map(heads.map(row => [row.entryId, row.status]));
  const entries = entryRows.map(entry => {
    const active = cards.filter(row => row.entryId === entry.id);
    const cardNumber = active.length === 1 ? active[0]!.cardNumber : null;
    return { ...entry, cardNumber, readOut: cardNumber !== null && readCards.has(cardNumber), hasResult: headByEntry.has(entry.id),
      didNotStart: headByEntry.get(entry.id) === "DNS" };
  });
  const teams = await tx.select({ id: schema.teams.id, classId: schema.teams.classId, name: schema.teams.name,
    organisationName: schema.teams.organisationName, externalSource: schema.teams.externalSource, externalId: schema.teams.externalId })
    .from(schema.teams).where(eq(schema.teams.raceId, raceId)).orderBy(asc(schema.teams.number));
  return { timeZone: race.timeZone, raceDate: race.raceDate, classes, entries, teams, courses };
}

/** Avlästa löpare per klass (för om en ändring av klassens bana påverkar resultat). */
export function readOutByClass(state: CurrentState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of state.entries) if (entry.readOut) counts.set(entry.classId, (counts.get(entry.classId) ?? 0) + 1);
  return counts;
}

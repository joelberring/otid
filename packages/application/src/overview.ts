import { and, asc, count, eq, max } from "drizzle-orm";
import { raceOverviewResponseSchema, type RaceOverviewResponse } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import {
  authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";

export interface PublicRaceSummary {
  id: string;
  eventName: string;
  name: string;
  raceDate: string;
  /** Kort adress till tävlingssidan (/t/{kod}), som de publika sidorna länkar tillbaka till. */
  shortCode: string;
}

export async function publicRaceSummary(db: Database, raceId: string): Promise<PublicRaceSummary> {
  const [race] = await db.select({
    id: schema.races.id,
    eventName: schema.events.name,
    name: schema.races.name,
    raceDate: schema.races.raceDate,
    shortCode: schema.races.shortCode
  }).from(schema.races)
    .innerJoin(schema.events, eq(schema.races.eventId, schema.events.id))
    .where(eq(schema.races.id, raceId));
  if (!race) throw new Error("Loppet finns inte");
  return race;
}

export type RaceOverviewAdminResult =
  | { status: "unauthorized" | "forbidden" | "not-found" }
  | { status: "ok"; response: RaceOverviewResponse };

export async function getRaceOverviewAsAdmin(
  db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf">,
  now = new Date()
): Promise<RaceOverviewAdminResult> {
  return db.transaction(async (tx) => {
    const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
      sessionToken: input.sessionToken,
      raceId: input.raceId,
      capability: "VIEW_RACE_OVERVIEW"
    }, now);
    if (authorization.status !== "authenticated") return authorization;

    const [lockedRace] = await tx.select({
      id: schema.races.id,
      eventId: schema.races.eventId,
      name: schema.races.name,
      raceDate: schema.races.raceDate,
      snapshotVersion: schema.races.snapshotVersion
    }).from(schema.races)
      .where(eq(schema.races.id, authorization.principal.raceId))
      .for("share");
    if (!lockedRace) return { status: "not-found" };

    const [event] = await tx.select({
      eventName: schema.events.name,
      timeZone: schema.events.timeZone
    }).from(schema.events).where(eq(schema.events.id, lockedRace.eventId));
    if (!event) return { status: "not-found" };

    const classes = await tx.select({
      id: schema.classes.id,
      name: schema.classes.name,
      startRule: schema.classes.startRule,
      entryCount: count(schema.entries.id)
    }).from(schema.classes)
      .leftJoin(schema.entries, and(
        eq(schema.entries.classId, schema.classes.id),
        eq(schema.entries.raceId, authorization.principal.raceId)
      ))
      .where(eq(schema.classes.raceId, authorization.principal.raceId))
      .groupBy(schema.classes.id, schema.classes.name, schema.classes.startRule)
      .orderBy(asc(schema.classes.name), asc(schema.classes.id));
    const courses = await tx.select({
      id: schema.courses.id,
      name: schema.courses.name
    }).from(schema.courses)
      .where(eq(schema.courses.raceId, authorization.principal.raceId))
      .orderBy(asc(schema.courses.name), asc(schema.courses.id));

    const [activeAssignments] = await tx.select({
      value: count(schema.cardAssignments.id)
    }).from(schema.cardAssignments).where(and(
      eq(schema.cardAssignments.raceId, authorization.principal.raceId),
      eq(schema.cardAssignments.active, true)
    ));
    const [readoutActivity] = await tx.select({
      value: count(schema.cardReadouts.id),
      latestAt: max(schema.cardReadouts.readAt)
    }).from(schema.cardReadouts).where(eq(
      schema.cardReadouts.raceId,
      authorization.principal.raceId
    ));
    const [resultActivity] = await tx.select({
      value: count(schema.resultRevisions.id),
      latestAt: max(schema.resultRevisions.createdAt)
    }).from(schema.resultRevisions).where(eq(
      schema.resultRevisions.raceId,
      authorization.principal.raceId
    ));
    const [importActivity] = await tx.select({
      value: count(schema.importFiles.id),
      latestAt: max(schema.importFiles.createdAt)
    }).from(schema.importFiles).where(eq(
      schema.importFiles.raceId,
      authorization.principal.raceId
    ));

    const entryCount = classes.reduce((sum, raceClass) => sum + raceClass.entryCount, 0);
    const response = raceOverviewResponseSchema.parse({
      formatVersion: 1,
      race: {
        id: lockedRace.id,
        eventName: event.eventName,
        name: lockedRace.name,
        raceDate: lockedRace.raceDate,
        timeZone: event.timeZone,
        snapshotVersion: lockedRace.snapshotVersion
      },
      classes,
      courses,
      counts: {
        classes: classes.length,
        courses: courses.length,
        entries: entryCount,
        activeCardAssignments: activeAssignments?.value ?? 0,
        readouts: readoutActivity?.value ?? 0,
        resultRevisions: resultActivity?.value ?? 0,
        imports: importActivity?.value ?? 0
      },
      latestActivity: {
        readoutAt: readoutActivity?.latestAt?.toISOString() ?? null,
        resultRevisionAt: resultActivity?.latestAt?.toISOString() ?? null,
        importAt: importActivity?.latestAt?.toISOString() ?? null
      }
    });
    return { status: "ok", response };
  });
}

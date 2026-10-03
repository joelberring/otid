import { and, eq } from "drizzle-orm";
import { startListAdminListResponseSchema, type StartListAdminListResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";

const MAX_CLASSES = 1_000;
const MAX_ENTRIES = 10_000;
const MAX_ACTIVE_ASSIGNMENTS = 20_000;

export type StartListAdminResult =
  | { status: "unauthorized" | "forbidden" | "not-found" }
  | { status: "ok"; response: StartListAdminListResponse };

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function listStartListAsAdmin(
  db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability">,
  now = new Date()
): Promise<StartListAdminResult> {
  if (!Number.isFinite(now.getTime())) throw new Error("Lästiden är ogiltig");
  return db.transaction(async (tx) => {
    const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
      ...input,
      capability: "VIEW_START_LIST"
    }, now);
    if (authorization.status !== "authenticated") return authorization;

    const [race] = await tx.select({
      id: schema.races.id,
      eventId: schema.races.eventId,
      snapshotVersion: schema.races.snapshotVersion
    }).from(schema.races)
      .where(eq(schema.races.id, authorization.principal.raceId))
      .for("share");
    if (!race) return { status: "not-found" };

    const [event] = await tx.select({ timeZone: schema.events.timeZone })
      .from(schema.events).where(eq(schema.events.id, race.eventId));
    if (!event) return { status: "not-found" };

    const classes = await tx.select({
      id: schema.classes.id,
      name: schema.classes.name,
      startRule: schema.classes.startRule
    }).from(schema.classes)
      .where(eq(schema.classes.raceId, race.id))
      .limit(MAX_CLASSES + 1);
    if (classes.length > MAX_CLASSES) throw new Error("För många klasser i startlistan");

    const entries = await tx.select({
      id: schema.entries.id,
      raceId: schema.entries.raceId,
      classId: schema.entries.classId,
      givenName: schema.entries.givenName,
      familyName: schema.entries.familyName,
      organisationName: schema.entries.organisationName,
      fixedStartTime: schema.entries.fixedStartTime
    }).from(schema.entries)
      .where(eq(schema.entries.raceId, race.id))
      .limit(MAX_ENTRIES + 1);
    if (entries.length > MAX_ENTRIES) throw new Error("För många deltagare i startlistan");

    const assignments = await tx.select({
      id: schema.cardAssignments.id,
      raceId: schema.cardAssignments.raceId,
      entryId: schema.cardAssignments.entryId,
      cardNumber: schema.cardAssignments.cardNumber
    }).from(schema.cardAssignments)
      .where(and(eq(schema.cardAssignments.raceId, race.id), eq(schema.cardAssignments.active, true)))
      .limit(MAX_ACTIVE_ASSIGNMENTS + 1);
    if (assignments.length > MAX_ACTIVE_ASSIGNMENTS) throw new Error("För många aktiva brickkopplingar i startlistan");

    const classesById = new Map(classes.map((raceClass) => [raceClass.id, raceClass]));
    const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
    for (const entry of entries) {
      if (entry.raceId !== race.id || !classesById.has(entry.classId)) {
        throw new Error("Startlistan innehåller en deltagare med korrupt lopprelation");
      }
    }
    for (const assignment of assignments) {
      const entry = entriesById.get(assignment.entryId);
      if (assignment.raceId !== race.id || !entry || entry.raceId !== race.id) {
        throw new Error("Startlistan innehåller en brickkoppling med korrupt lopprelation");
      }
    }

    const assignmentsByEntry = new Map<string, typeof assignments>();
    for (const assignment of assignments) {
      const rows = assignmentsByEntry.get(assignment.entryId) ?? [];
      rows.push(assignment);
      assignmentsByEntry.set(assignment.entryId, rows);
    }
    const entriesByClass = new Map<string, typeof entries>();
    for (const entry of entries) {
      const rows = entriesByClass.get(entry.classId) ?? [];
      rows.push(entry);
      entriesByClass.set(entry.classId, rows);
    }

    const response = startListAdminListResponseSchema.parse({
      formatVersion: 1,
      raceId: race.id,
      snapshotVersion: race.snapshotVersion,
      timeZone: event.timeZone,
      generatedAt: now.toISOString(),
      classes: [...classes].sort((left, right) => compareText(left.name, right.name) || compareText(left.id, right.id))
        .map((raceClass) => {
          const classEntries = (entriesByClass.get(raceClass.id) ?? []).map((entry) => {
            const activeAssignments = assignmentsByEntry.get(entry.id) ?? [];
            const activeAssignment = activeAssignments.length === 1 ? activeAssignments[0] : undefined;
            return {
              id: entry.id,
              displayName: `${entry.givenName} ${entry.familyName}`,
              organisationName: entry.organisationName,
              fixedStartTime: raceClass.startRule === "FIXED" ? entry.fixedStartTime?.toISOString() ?? null : null,
              cardNumber: activeAssignment?.cardNumber ?? null,
              multipleActiveAssignments: activeAssignments.length > 1,
              familyName: entry.familyName,
              givenName: entry.givenName
            };
          }).sort((left, right) => {
            if (raceClass.startRule === "FIXED") {
              const leftTime = left.fixedStartTime === null ? Number.POSITIVE_INFINITY : Date.parse(left.fixedStartTime);
              const rightTime = right.fixedStartTime === null ? Number.POSITIVE_INFINITY : Date.parse(right.fixedStartTime);
              if (leftTime !== rightTime) return leftTime - rightTime;
            }
            return compareText(left.displayName, right.displayName) || compareText(left.familyName, right.familyName) ||
              compareText(left.givenName, right.givenName) || compareText(left.id, right.id);
          }).map((entry) => ({
            id: entry.id,
            displayName: entry.displayName,
            organisationName: entry.organisationName,
            fixedStartTime: entry.fixedStartTime,
            cardNumber: entry.cardNumber,
            multipleActiveAssignments: entry.multipleActiveAssignments
          }));
          return { ...raceClass, entries: classEntries };
        })
    });
    return { status: "ok", response };
  });
}

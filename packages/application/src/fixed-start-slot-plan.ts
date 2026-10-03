import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { fixedStartSlotPlanResponseSchema, type FixedStartSlotPlanResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { lockRaceForSnapshot } from "./concurrency";

type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
const capability = "MANAGE_RACE" as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_CLASSES = 1_000;
const MAX_ENTRIES = 10_000;
const MAX_DRAWS = 10_000;

export type FixedStartSlotPlanResult =
  | { status: "ok"; response: FixedStartSlotPlanResponse }
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" };

type CurrentEntry = { id: string; classId: string; displayName: string; fixedStartTime: Date | null; exactTime: boolean };

function milliseconds(value: Date): number {
  const result = value.getTime();
  if (!Number.isFinite(result) || value.getMilliseconds() !== result % 1_000) throw new Error("Ogiltig starttid i lagrat underlag");
  return result;
}

function unavailable(reason: "NO_SAVED_DRAW" | "PLAN_CHANGED") {
  return { status: "UNAVAILABLE" as const, reason };
}

/**
 * Projects only slots frozen by the latest immutable class draw. It deliberately
 * refuses manual/ambiguous clock values instead of treating them as vacancies.
 */
export async function listFixedStartSlotPlansAsAdministrator(
  db: Database, input: Authentication, now = new Date()
): Promise<FixedStartSlotPlanResult> {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async (tx) => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    const race = await lockRaceForSnapshot(tx, input.raceId);
    const [metadata] = await tx.select({ timeZone: schema.events.timeZone }).from(schema.races)
      .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(eq(schema.races.id, input.raceId));
    if (!metadata) return { status: "not-found" };
    const classes = await tx.select({ id: schema.classes.id, name: schema.classes.name, maxEntries: schema.classes.maxEntries })
      .from(schema.classes).where(and(eq(schema.classes.raceId, input.raceId), eq(schema.classes.startRule, "FIXED")))
      .orderBy(asc(schema.classes.name), asc(schema.classes.id)).limit(MAX_CLASSES + 1);
    if (classes.length > MAX_CLASSES) throw new Error("För många fasta startklasser");
    const entries = await tx.select({ id: schema.entries.id, classId: schema.entries.classId, givenName: schema.entries.givenName,
      familyName: schema.entries.familyName, fixedStartTime: schema.entries.fixedStartTime,
      exactTime: sql<boolean>`${schema.entries.fixedStartTime} IS NULL OR date_trunc('milliseconds', ${schema.entries.fixedStartTime}) = ${schema.entries.fixedStartTime}`
    }).from(schema.entries).where(eq(schema.entries.raceId, input.raceId)).limit(MAX_ENTRIES + 1);
    if (entries.length > MAX_ENTRIES) throw new Error("För många deltagare i startplansunderlaget");
    const byClass = new Map<string, CurrentEntry[]>();
    for (const entry of entries) {
      const list = byClass.get(entry.classId) ?? [];
      list.push({ id: entry.id, classId: entry.classId, displayName: `${entry.givenName} ${entry.familyName}`,
        fixedStartTime: entry.fixedStartTime, exactTime: entry.exactTime });
      byClass.set(entry.classId, list);
    }
    const headers = classes.length === 0 ? [] : await tx.select({ id: schema.classStartDrawRequests.id, classId: schema.classStartDrawRequests.classId,
      firstStartTime: schema.classStartDrawRequests.firstStartTime, intervalSeconds: schema.classStartDrawRequests.intervalSeconds,
      entryCount: schema.classStartDrawRequests.entryCount, snapshotVersionAfter: schema.classStartDrawRequests.snapshotVersionAfter,
      changedAt: schema.classStartDrawRequests.changedAt }).from(schema.classStartDrawRequests)
      .where(and(eq(schema.classStartDrawRequests.raceId, input.raceId), inArray(schema.classStartDrawRequests.classId, classes.map(item => item.id))))
      .orderBy(desc(schema.classStartDrawRequests.snapshotVersionAfter), desc(schema.classStartDrawRequests.changedAt), desc(schema.classStartDrawRequests.id))
      .limit(MAX_DRAWS + 1);
    if (headers.length > MAX_DRAWS) throw new Error("För många sparade startlottningar");
    const latestByClass = new Map<string, typeof headers[number]>();
    for (const header of headers) if (!latestByClass.has(header.classId)) latestByClass.set(header.classId, header);
    const latest = [...latestByClass.values()];
    const items = latest.length === 0 ? [] : await tx.select({ drawRequestId: schema.classStartDrawItems.drawRequestId,
      entryId: schema.classStartDrawItems.entryId, fixedStartTime: schema.classStartDrawItems.fixedStartTime })
      .from(schema.classStartDrawItems).where(inArray(schema.classStartDrawItems.drawRequestId, latest.map(item => item.id))).limit(MAX_ENTRIES + 1);
    if (items.length > MAX_ENTRIES) throw new Error("För många sparade starttider");
    const itemsByDraw = new Map<string, typeof items>();
    for (const item of items) {
      const list = itemsByDraw.get(item.drawRequestId) ?? [];
      list.push(item); itemsByDraw.set(item.drawRequestId, list);
    }
    const response = fixedStartSlotPlanResponseSchema.parse({ formatVersion: 1, raceId: input.raceId,
      snapshotVersion: race.snapshotVersion, timeZone: metadata.timeZone,
      classes: classes.map((raceClass) => {
        const roster = byClass.get(raceClass.id) ?? [];
        const header = latestByClass.get(raceClass.id);
        const capacityRemaining = raceClass.maxEntries === null ? null : raceClass.maxEntries - roster.length;
        if (!header) return { classId: raceClass.id, className: raceClass.name, entryCount: roster.length,
          maxEntries: raceClass.maxEntries, capacityRemaining, plan: unavailable("NO_SAVED_DRAW") };
        const source = itemsByDraw.get(header.id) ?? [];
        const slots = [...source].sort((a, b) => milliseconds(a.fixedStartTime) - milliseconds(b.fixedStartTime));
        if (slots.length !== header.entryCount || new Set(slots.map(item => item.entryId)).size !== slots.length ||
          new Set(slots.map(item => milliseconds(item.fixedStartTime))).size !== slots.length ||
          slots.some((item, index) => milliseconds(item.fixedStartTime) !== milliseconds(header.firstStartTime) + index * header.intervalSeconds * 1_000)) {
          throw new Error("Den sparade startlottningen är inkonsekvent");
        }
        const byTime = new Map(slots.map(item => [milliseconds(item.fixedStartTime), item]));
        const occupied = new Map<number, CurrentEntry>();
        const unassigned: CurrentEntry[] = [];
        let changed = false;
        for (const entry of roster) {
          if (!entry.exactTime) { changed = true; continue; }
          if (entry.fixedStartTime === null) { unassigned.push(entry); continue; }
          const time = milliseconds(entry.fixedStartTime);
          if (!byTime.has(time) || occupied.has(time)) { changed = true; continue; }
          occupied.set(time, entry);
        }
        if (changed) return { classId: raceClass.id, className: raceClass.name, entryCount: roster.length,
          maxEntries: raceClass.maxEntries, capacityRemaining, plan: unavailable("PLAN_CHANGED") };
        unassigned.sort((a, b) => a.displayName.localeCompare(b.displayName, "sv-SE") || a.id.localeCompare(b.id));
        return { classId: raceClass.id, className: raceClass.name, entryCount: roster.length,
          maxEntries: raceClass.maxEntries, capacityRemaining,
          plan: { status: "AVAILABLE" as const, firstStartTime: header.firstStartTime.toISOString(), intervalSeconds: header.intervalSeconds,
            drawnAt: header.changedAt.toISOString(), slots: slots.map((slot) => {
              const entry = occupied.get(milliseconds(slot.fixedStartTime));
              return entry ? { state: "OCCUPIED" as const, fixedStartTime: slot.fixedStartTime.toISOString(), entry: { id: entry.id, displayName: entry.displayName } }
                : { state: "VACANT" as const, fixedStartTime: slot.fixedStartTime.toISOString() };
            }), unassignedEntries: unassigned.map(entry => ({ id: entry.id, displayName: entry.displayName })) }
        };
      })
    });
    return { status: "ok", response };
  }, { isolationLevel: "repeatable read" });
}

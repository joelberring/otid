import { and, desc, eq, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type VerifiedFixedStartSlotPlan = { status: "AVAILABLE"; drawRequestId: string; sourceHash: string; slots: string[] } |
  { status: "UNAVAILABLE"; reason: "NO_SAVED_DRAW" | "PLAN_CHANGED" | "NO_FUTURE_SLOT" };

/**
 * Resolves a saved draw only when every current class member is still either a
 * draw item or an immutable, matching late-slot assignment. The caller holds
 * the race mutation/snapshot lock; this function locks the target roster.
 */
export async function resolveVerifiedFixedStartSlotPlan(tx: Transaction, raceId: string,
  targetClassId: string, now: Date): Promise<VerifiedFixedStartSlotPlan> {
  const [draw] = await tx.select({ id: schema.classStartDrawRequests.id, sourceHash: schema.classStartDrawRequests.sourceHash,
    entryCount: schema.classStartDrawRequests.entryCount, snapshotVersionAfter: schema.classStartDrawRequests.snapshotVersionAfter,
    changedAt: schema.classStartDrawRequests.changedAt }).from(schema.classStartDrawRequests).where(and(
      eq(schema.classStartDrawRequests.raceId, raceId), eq(schema.classStartDrawRequests.classId, targetClassId)
    )).orderBy(desc(schema.classStartDrawRequests.snapshotVersionAfter), desc(schema.classStartDrawRequests.changedAt),
      desc(schema.classStartDrawRequests.id)).limit(1);
  if (!draw) return { status: "UNAVAILABLE", reason: "NO_SAVED_DRAW" };
  const items = await tx.select({ entryId: schema.classStartDrawItems.entryId, fixedStartTime: schema.classStartDrawItems.fixedStartTime,
    exactTime: sql<boolean>`date_trunc('milliseconds', ${schema.classStartDrawItems.fixedStartTime}) = ${schema.classStartDrawItems.fixedStartTime}` })
    .from(schema.classStartDrawItems).where(eq(schema.classStartDrawItems.drawRequestId, draw.id)).limit(10_001);
  if (items.length !== draw.entryCount || items.some(item => !item.exactTime) ||
    new Set(items.map(item => item.entryId)).size !== items.length || new Set(items.map(item => item.fixedStartTime.toISOString())).size !== items.length) {
    return { status: "UNAVAILABLE", reason: "PLAN_CHANGED" };
  }
  const roster = await tx.select({ id: schema.entries.id, fixedStartTime: schema.entries.fixedStartTime,
    exactTime: sql<boolean>`${schema.entries.fixedStartTime} IS NOT NULL AND date_trunc('milliseconds', ${schema.entries.fixedStartTime}) = ${schema.entries.fixedStartTime}`
  }).from(schema.entries).where(and(eq(schema.entries.raceId, raceId), eq(schema.entries.classId, targetClassId))).for("update");
  const [transferAssignments, registrationAssignments] = await Promise.all([
    tx.select({ entryId: schema.entryStartSlotAssignments.entryId, fixedStartTime: schema.entryStartSlotAssignments.fixedStartTime })
      .from(schema.entryStartSlotAssignments).where(and(eq(schema.entryStartSlotAssignments.raceId, raceId),
        eq(schema.entryStartSlotAssignments.targetClassId, targetClassId), eq(schema.entryStartSlotAssignments.drawRequestId, draw.id),
        eq(schema.entryStartSlotAssignments.sourceHash, draw.sourceHash))).limit(10_001),
    tx.select({ entryId: schema.entryRegistrationStartSlotAssignments.entryId, fixedStartTime: schema.entryRegistrationStartSlotAssignments.fixedStartTime })
      .from(schema.entryRegistrationStartSlotAssignments).where(and(eq(schema.entryRegistrationStartSlotAssignments.raceId, raceId),
        eq(schema.entryRegistrationStartSlotAssignments.targetClassId, targetClassId), eq(schema.entryRegistrationStartSlotAssignments.drawRequestId, draw.id),
        eq(schema.entryRegistrationStartSlotAssignments.sourceHash, draw.sourceHash))).limit(10_001)
  ]);
  const itemTimeByEntry = new Map(items.map(item => [item.entryId, item.fixedStartTime.toISOString()]));
  const assignmentTimeByEntry = new Map<string, string>();
  for (const assignment of [...transferAssignments, ...registrationAssignments]) {
    if (assignmentTimeByEntry.has(assignment.entryId)) return { status: "UNAVAILABLE", reason: "PLAN_CHANGED" };
    assignmentTimeByEntry.set(assignment.entryId, assignment.fixedStartTime.toISOString());
  }
  const itemTimes = new Set(items.map(item => item.fixedStartTime.toISOString())), occupied = new Set<string>();
  for (const entry of roster) {
    const time = entry.fixedStartTime?.toISOString();
    if (!entry.exactTime || !time || !itemTimes.has(time) || occupied.has(time) ||
      (itemTimeByEntry.get(entry.id) !== time && assignmentTimeByEntry.get(entry.id) !== time)) {
      return { status: "UNAVAILABLE", reason: "PLAN_CHANGED" };
    }
    occupied.add(time);
  }
  const slots = items.map(item => item.fixedStartTime.toISOString()).filter(time => !occupied.has(time) && new Date(time) > now);
  return slots.length > 0 ? { status: "AVAILABLE", drawRequestId: draw.id, sourceHash: draw.sourceHash, slots }
    : { status: "UNAVAILABLE", reason: "NO_FUTURE_SLOT" };
}

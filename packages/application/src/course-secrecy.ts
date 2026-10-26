import { and, desc, eq, isNull } from "drizzle-orm";
import { courseSecrecyResponseSchema, type CourseSecrecyResponse, type CourseSecrecyState } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { courseSecrecy, type CourseSecrecy } from "@o-tid/domain";
import { lockRaceForMutation } from "./concurrency";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import type { DbExecutor } from "./snapshot";

/**
 * Steg 52 (ADR-0176): banhemlighet. Allt publikt som visar banorna (gafflingsbilden i resultatlistan och på deltagarsidan,
 * banan på vägvalskartan och kontrollkartan) frågar här. Ett beslut som tagits bort (`MANUAL_RESULT_REMOVED`) räknas inte
 * som ett resultat. Arrangörens val "Visa banorna publikt nu" sparas på loppet och går att ångra (auditpost).
 */
export interface LoadedCourseSecrecy extends CourseSecrecy {
  readonly revealedAt: Date | null;
}

export async function loadCourseSecrecy(tx: DbExecutor, raceId: string): Promise<LoadedCourseSecrecy> {
  const [race] = await tx.select({ revealedAt: schema.races.coursesPublicAt, finalization: schema.races.officialResultFinalizationId })
    .from(schema.races).where(eq(schema.races.id, raceId));
  if (!race) return { public: false, reason: null, remaining: 0, revealedAt: null };
  const entries = await tx.select({ id: schema.entries.id }).from(schema.entries)
    .where(and(eq(schema.entries.raceId, raceId), isNull(schema.entries.struckAt)));
  const heads = await tx.selectDistinctOn([schema.resultRevisions.entryId], { entryId: schema.resultRevisions.entryId,
    cause: schema.resultRevisions.cause }).from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId))
    .orderBy(schema.resultRevisions.entryId, desc(schema.resultRevisions.revision));
  const withResult = new Set(heads.filter(head => head.cause !== "MANUAL_RESULT_REMOVED").map(head => head.entryId));
  const secrecy = courseSecrecy({ entries: entries.map(entry => ({ hasResult: withResult.has(entry.id) })),
    finalized: race.finalization !== null, revealed: race.revealedAt !== null });
  return { ...secrecy, revealedAt: race.revealedAt };
}

/** Banorna publikt: när ett publikt svar får visa gafflingsbilden, kontrollägena och kontrollkartan. */
export async function coursesArePublic(tx: DbExecutor, raceId: string): Promise<boolean> {
  return (await loadCourseSecrecy(tx, raceId)).public;
}

export function courseSecrecyState(secrecy: LoadedCourseSecrecy): CourseSecrecyState {
  return { public: secrecy.public, reason: secrecy.reason, remaining: secrecy.remaining, revealedAt: secrecy.revealedAt?.toISOString() ?? null };
}

export type CourseSecrecyResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" }
  | { status: "saved"; response: CourseSecrecyResponse };

/** "Visa banorna publikt nu" (reveal = true) eller ångra valet (false). Samma val igen ändrar inget. */
export async function setCoursesPublicAsAdmin(db: Database, input: RaceSessionProof & { reveal: boolean }, now = new Date())
  : Promise<CourseSecrecyResult> {
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    await lockRaceForMutation(tx, raceId);
    const [race] = await tx.select({ revealedAt: schema.races.coursesPublicAt }).from(schema.races).where(eq(schema.races.id, raceId));
    if (!race) return { status: "not-found" } as const;
    const revealedAt = input.reveal ? race.revealedAt ?? now : null;
    if ((revealedAt?.getTime() ?? null) !== (race.revealedAt?.getTime() ?? null)) {
      await tx.update(schema.races).set({ coursesPublicAt: revealedAt }).where(eq(schema.races.id, raceId));
      await tx.insert(schema.auditEvents).values({ raceId, entityType: "race", entityId: raceId,
        action: input.reveal ? "COURSES_REVEALED_BY_ADMIN" : "COURSES_REVEAL_WITHDRAWN_BY_ADMIN", actorKind: "USER_ACCOUNT",
        actorId: auth.principal.accountId, before: { coursesPublicAt: race.revealedAt?.toISOString() ?? null },
        after: { coursesPublicAt: revealedAt?.toISOString() ?? null }, createdAt: now });
    }
    const secrecy = await loadCourseSecrecy(tx, raceId);
    return { status: "saved", response: courseSecrecyResponseSchema.parse({ formatVersion: 1, raceId,
      courseSecrecy: courseSecrecyState(secrecy) }) } as const;
  });
}

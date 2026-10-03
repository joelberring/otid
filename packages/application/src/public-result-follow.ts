import { and, asc, desc, eq } from "drizzle-orm";
import {
  publicResultFollowIdempotencyKey,
  publicResultFollowListResponseSchema,
  publicResultFollowSetRequestSchema,
  publicResultFollowSetResponseSchema,
  publicResultListResponseV7Schema,
  type PublicResultFollowListResponse,
  type PublicResultFollowSetResponse,
  type PublicResultListResponseV7
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  authenticateUserAccountSessionForMutation,
  authenticateUserAccountSessionForProtectedRead,
  type UserAccountSessionProof
} from "./user-account";
import { publicResultDetail, publicResults } from "./results";

type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "conflict" | "not-found" };
type SetInput = UserAccountSessionProof & { idempotencyKey: string | null; request: unknown };
const maxActiveFollows = 1_000;

function validNow(now: Date): boolean { return Number.isFinite(now.getTime()); }

function setResponse(
  row: typeof schema.userPublicResultFollowEvents.$inferSelect, replayed: boolean
): PublicResultFollowSetResponse {
  return publicResultFollowSetResponseSchema.parse({
    formatVersion: 1, requestId: row.requestId, raceId: row.raceId,
    publicResultId: row.publicResultId, followed: row.followed, replayed
  });
}

/** A public-result follow is an account preference, never an ownership claim. */
export async function setPublicResultFollow(
  db: Database, input: SetInput, now = new Date()
): Promise<Failure | { status: "ok"; response: PublicResultFollowSetResponse }> {
  const parsed = publicResultFollowSetRequestSchema.safeParse(input.request);
  if (!validNow(now) || !parsed.success ||
    input.idempotencyKey !== publicResultFollowIdempotencyKey(parsed.data.requestId)) {
    return { status: "invalid-request" };
  }
  const request = parsed.data;
  return db.transaction(async (tx) => {
    // The existing account UPDATE lock serializes commands from different
    // sessions of this account before the journal sequence is allocated.
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const [replayed] = await tx.select().from(schema.userPublicResultFollowEvents)
      .where(eq(schema.userPublicResultFollowEvents.requestId, request.requestId));
    if (replayed) {
      if (replayed.accountId !== auth.principal.accountId || replayed.raceId !== request.raceId ||
        replayed.publicResultId !== request.publicResultId || replayed.followed !== request.followed) {
        return { status: "conflict" } as const;
      }
      return { status: "ok", response: setResponse(replayed, true) } as const;
    }

    const prior = await tx.select({ followed: schema.userPublicResultFollowEvents.followed })
      .from(schema.userPublicResultFollowEvents)
      .where(and(
        eq(schema.userPublicResultFollowEvents.accountId, auth.principal.accountId),
        eq(schema.userPublicResultFollowEvents.raceId, request.raceId),
        eq(schema.userPublicResultFollowEvents.publicResultId, request.publicResultId)
      )).orderBy(desc(schema.userPublicResultFollowEvents.eventSequence)).limit(1);
    if (request.followed) {
      // The link is public, but the preference endpoint must never preserve
      // a newly selected unpublished/unknown result as if it were visible.
      const [race] = await tx.select({ id: schema.races.id }).from(schema.races)
        .where(eq(schema.races.id, request.raceId));
      if (!race) return { status: "not-found" } as const;
      const current = await publicResultDetail(db, request.raceId, request.publicResultId);
      if (current.status !== "ok") return { status: "not-found" } as const;
      if (!prior[0]?.followed) {
        const heads = await tx.selectDistinctOn([
          schema.userPublicResultFollowEvents.raceId,
          schema.userPublicResultFollowEvents.publicResultId
        ], { followed: schema.userPublicResultFollowEvents.followed })
          .from(schema.userPublicResultFollowEvents)
          .where(eq(schema.userPublicResultFollowEvents.accountId, auth.principal.accountId))
          .orderBy(
            asc(schema.userPublicResultFollowEvents.raceId),
            asc(schema.userPublicResultFollowEvents.publicResultId),
            desc(schema.userPublicResultFollowEvents.eventSequence)
          );
        if (heads.filter((head) => head.followed).length >= maxActiveFollows) {
          return { status: "conflict" } as const;
        }
      }
    } else if (prior.length === 0) {
      // Do not turn this private endpoint into a target-discovery oracle.
      return { status: "not-found" } as const;
    }
    const [inserted] = await tx.insert(schema.userPublicResultFollowEvents).values({
      requestId: request.requestId, accountId: auth.principal.accountId,
      raceId: request.raceId, publicResultId: request.publicResultId,
      followed: request.followed, createdAt: now
    }).onConflictDoNothing().returning();
    if (!inserted) {
      const [conflicting] = await tx.select().from(schema.userPublicResultFollowEvents)
        .where(eq(schema.userPublicResultFollowEvents.requestId, request.requestId));
      if (conflicting && conflicting.accountId === auth.principal.accountId &&
        conflicting.raceId === request.raceId && conflicting.publicResultId === request.publicResultId &&
        conflicting.followed === request.followed) {
        return { status: "ok", response: setResponse(conflicting, true) } as const;
      }
      return { status: "conflict" } as const;
    }
    return { status: "ok", response: setResponse(inserted, false) } as const;
  });
}

/** Resolves account choices through today's anonymous V7 projection on every read. */
export async function listMyPublicResultFollows(
  db: Database, proof: UserAccountSessionProof, now = new Date()
): Promise<Failure | { status: "ok"; response: PublicResultFollowListResponse }> {
  if (!validNow(now)) return { status: "invalid-request" };
  const linked = await db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, proof, now);
    if (auth.status !== "authenticated") return auth;
    const heads = tx.selectDistinctOn([
      schema.userPublicResultFollowEvents.raceId,
      schema.userPublicResultFollowEvents.publicResultId
    ], {
      raceId: schema.userPublicResultFollowEvents.raceId,
      publicResultId: schema.userPublicResultFollowEvents.publicResultId,
      followed: schema.userPublicResultFollowEvents.followed
    }).from(schema.userPublicResultFollowEvents)
      .where(eq(schema.userPublicResultFollowEvents.accountId, auth.principal.accountId))
      .orderBy(
        asc(schema.userPublicResultFollowEvents.raceId),
        asc(schema.userPublicResultFollowEvents.publicResultId),
        desc(schema.userPublicResultFollowEvents.eventSequence)
      ).as("latest_account_public_result_follows");
    const active = await tx.select({
      raceId: heads.raceId, publicResultId: heads.publicResultId,
      eventName: schema.events.name, raceName: schema.races.name
    }).from(heads)
      .innerJoin(schema.races, eq(schema.races.id, heads.raceId))
      .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
      .where(eq(heads.followed, true))
      .orderBy(asc(heads.raceId), asc(heads.publicResultId))
      .limit(maxActiveFollows + 1);
    if (active.length > maxActiveFollows) throw new Error("För många kontobundna följningar");
    return { status: "ok", active } as const;
  });
  if (linked.status !== "ok") return linked;
  const lists = new Map<string, PublicResultListResponseV7>();
  const items: PublicResultFollowListResponse["items"] = [];
  for (const follow of linked.active) {
    let list = lists.get(follow.raceId);
    if (!list) {
      list = publicResultListResponseV7Schema.parse(await publicResults(db, follow.raceId));
      lists.set(follow.raceId, list);
    }
    const result = list.results.find((row) => "publicResultId" in row &&
      row.publicResultId === follow.publicResultId) ?? null;
    items.push({ ...follow, result });
  }
  return { status: "ok", response: publicResultFollowListResponseSchema.parse({ formatVersion: 1, items }) };
}

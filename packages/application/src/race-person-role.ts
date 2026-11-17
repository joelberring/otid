import { randomUUID } from "node:crypto";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { racePersonRoleIdempotencyKeySchema, racePersonRoleRequestSchema, racePersonRoleResponseSchema,
  type RaceInvitationRole, type RacePersonRoleResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { actorOf, eventOf, readBody, type Actor } from "./race-people";
import { COURSE_LEVELS, alreadyGranted, hasOpenInvitation, invitationKind, isCourseRole, lockInvitationEmail } from "./race-person-invitations";
import { requireRaceRole, type RaceSessionProof } from "./race-session";

/**
 * Ägaren 2026-11-17: byta roll på en rad under Personer med behörighet. Reglerna är de som gäller för Lägg till och Ta bort
 * (ADR-0172 beslut 3, steg 66): administratörer byter mellan funktionär och banläggningens roller; bara ägaren gör någon
 * till administratör eller tar ifrån någon den rollen. Ägaren och den egna raden byts aldrig.
 *
 * - En väntande inbjudan får den nya rollen (inget nytt mejl).
 * - En nivå i banläggningen ändras på sin rad.
 * - En behörighet på eventet går inte att ändra (raderna är oföränderliga): den gamla återkallas och en ny skapas, i samma
 *   transaktion. Byte mellan eventet och banläggningen flyttar behörigheten till den andra tabellen på samma sätt.
 * - Har personen redan en behörighet av det nya slaget blir det konflikt: ta bort den här raden i stället.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" };
export type RacePersonRoleResult = Failure | { status: "changed"; response: RacePersonRoleResponse };

const REASON = "Rollen byttes under Inställningar";
const ACTION = "RACE_PERSON_ROLE_CHANGED";
const courseRole = (level: string) => `COURSE_${level}` as RaceInvitationRole;

function receipt(requestId: string, grantId: string, role: RaceInvitationRole, changedAt: Date, replayed: boolean) {
  return { status: "changed", response: racePersonRoleResponseSchema.parse({ formatVersion: 1, replayed, requestId, grantId, role,
    changedAt: changedAt.toISOString() }) } as const;
}

async function journal(tx: Transaction, actor: Actor, input: { requestId: string; entityType: string; grantId: string; previousGrantId: string;
  from: string; to: string; targetAccountId?: string }, now: Date) {
  await tx.insert(schema.auditEvents).values({ raceId: actor.raceId, entityType: input.entityType, entityId: input.grantId, action: ACTION,
    actorKind: "USER_ACCOUNT", actorId: actor.accountId, requestId: input.requestId, createdAt: now,
    after: { grantId: input.grantId, previousGrantId: input.previousGrantId, from: input.from, to: input.to,
      ...(input.targetAccountId ? { targetAccountId: input.targetAccountId } : {}), changedAt: now.toISOString() } });
}

/** Kontots gällande behörigheter på eventet (ägare, administratör, funktionär). */
async function activeEventGrants(tx: Transaction, accountId: string, eventId: string) {
  return tx.select({ id: schema.eventAdministrationGrants.id, role: schema.eventAdministrationGrants.role })
    .from(schema.eventAdministrationGrants)
    .leftJoin(schema.eventAdministrationGrantRevocations, eq(schema.eventAdministrationGrantRevocations.grantId, schema.eventAdministrationGrants.id))
    .where(and(eq(schema.eventAdministrationGrants.accountId, accountId), eq(schema.eventAdministrationGrants.eventId, eventId),
      isNull(schema.eventAdministrationGrantRevocations.id)));
}

async function revokeEventGrant(tx: Transaction, actor: Actor, eventId: string, grant: { id: string; accountId: string; role: string },
  requestId: string, now: Date) {
  await tx.insert(schema.eventAdministrationGrantRevocations).values({ id: randomUUID(), grantId: grant.id, revokedAt: now, reason: REASON });
  await tx.insert(schema.eventAdministrationAccessRequests).values({ requestId, action: grant.role === "ADMIN" ? "REVOKE_ADMIN" : "REVOKE_FUNCTIONARY",
    actorAccountId: actor.accountId, eventId, targetAccountId: grant.accountId, grantId: grant.id, reason: REASON, createdAt: now });
}

export async function changeRacePersonRoleAsAdmin(db: Database,
  input: RaceSessionProof & { idempotencyKey: string | null; readBody: () => Promise<unknown> }, now = new Date()): Promise<RacePersonRoleResult> {
  const key = racePersonRoleIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const request = racePersonRoleRequestSchema.safeParse(await readBody(input.readBody));
  if (!key.success || !request.success || key.data !== `race-person-role:${request.data.requestId}`) return { status: "invalid-request" };
  const intent = request.data, to = intent.role;
  return db.transaction(async (tx): Promise<RacePersonRoleResult> => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    const actor = actorOf(auth.principal);
    if (!actor) return { status: "forbidden" };
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${intent.requestId}, 0))`);
    const event = await eventOf(tx, actor.raceId, "update");
    if (!event) return { status: "not-found" };
    const [prior] = await tx.select({ after: schema.auditEvents.after, actorId: schema.auditEvents.actorId, createdAt: schema.auditEvents.createdAt })
      .from(schema.auditEvents).where(and(eq(schema.auditEvents.requestId, intent.requestId), eq(schema.auditEvents.action, ACTION),
        eq(schema.auditEvents.raceId, actor.raceId)));
    if (prior) {
      const after = prior.after as { grantId?: string; previousGrantId?: string; to?: string } | null;
      if (prior.actorId !== actor.accountId || after?.previousGrantId !== intent.grantId || after.to !== to || !after.grantId) return { status: "conflict" };
      return receipt(intent.requestId, after.grantId, to, prior.createdAt, true);
    }
    const ownerOnly = (from: string) => (from === "ADMIN" || to === "ADMIN") && actor.role !== "OWNER";

    // 1. En väntande inbjudan.
    const invitations = schema.racePersonInvitations;
    const [open] = await tx.select().from(invitations).where(and(eq(invitations.id, intent.grantId), eq(invitations.raceId, actor.raceId),
      isNull(invitations.acceptedAt), isNull(invitations.revokedAt))).for("update");
    if (open) {
      if (ownerOnly(open.role)) return { status: "forbidden" };
      if (open.role === to) return { status: "conflict" };
      await lockInvitationEmail(tx, actor.raceId, open.email);
      const kind = invitationKind(to);
      if (kind !== invitationKind(open.role) && (await hasOpenInvitation(tx, actor.raceId, open.email, kind) ||
        await alreadyGranted(tx, { eventId: event.id, raceId: actor.raceId, email: open.email, kind }))) return { status: "conflict" };
      await tx.update(invitations).set({ role: to }).where(eq(invitations.id, open.id));
      await journal(tx, actor, { requestId: intent.requestId, entityType: "race_person_invitation", grantId: open.id, previousGrantId: open.id,
        from: open.role, to }, now);
      return receipt(intent.requestId, open.id, to, now, false);
    }

    // 2. En behörighet på eventet (administratör eller funktionär).
    const [grant] = await tx.select().from(schema.eventAdministrationGrants).where(and(
      eq(schema.eventAdministrationGrants.id, intent.grantId), eq(schema.eventAdministrationGrants.eventId, event.id))).for("update");
    if (grant) {
      const active = await activeEventGrants(tx, grant.accountId, event.id);
      if (!active.some(row => row.id === grant.id)) return { status: "conflict" };
      if (grant.role === "OWNER" || grant.accountId === actor.accountId || ownerOnly(grant.role)) return { status: "forbidden" };
      if (grant.role === to) return { status: "conflict" };
      let grantId: string;
      if (isCourseRole(to)) {
        const [course] = await tx.select({ id: schema.courseSettingGrants.id }).from(schema.courseSettingGrants)
          .where(and(eq(schema.courseSettingGrants.raceId, actor.raceId), eq(schema.courseSettingGrants.accountId, grant.accountId)));
        if (course) return { status: "conflict" };
        grantId = randomUUID();
        await tx.insert(schema.courseSettingGrants).values({ id: grantId, raceId: actor.raceId, accountId: grant.accountId, level: COURSE_LEVELS[to],
          grantedAt: now, grantedBy: actor.accountId, requestId: intent.requestId });
      } else {
        // Har kontot redan en annan gällande rad med den nya rollen räcker det att den här tas bort.
        const same = active.find(row => row.id !== grant.id && row.role === to);
        if (same) grantId = same.id;
        else {
          const [created] = await tx.insert(schema.eventAdministrationGrants).values({ eventId: event.id, accountId: grant.accountId, role: to, grantedAt: now })
            .returning({ id: schema.eventAdministrationGrants.id });
          if (!created) throw new Error("Behörigheten kunde inte sparas");
          grantId = created.id;
        }
      }
      await revokeEventGrant(tx, actor, event.id, grant, intent.requestId, now);
      await journal(tx, actor, { requestId: intent.requestId, entityType: isCourseRole(to) ? "course_setting_grant" : "event_administration_grant",
        grantId, previousGrantId: grant.id, from: grant.role, to, targetAccountId: grant.accountId }, now);
      return receipt(intent.requestId, grantId, to, now, false);
    }

    // 3. En behörighet i banläggningen.
    const grants = schema.courseSettingGrants;
    const [course] = await tx.select().from(grants).where(and(eq(grants.id, intent.grantId), eq(grants.raceId, actor.raceId))).for("update");
    if (!course) return { status: "not-found" };
    const from = courseRole(course.level);
    if (course.accountId === actor.accountId || ownerOnly(from)) return { status: "forbidden" };
    if (from === to) return { status: "conflict" };
    if (isCourseRole(to)) {
      await tx.update(grants).set({ level: COURSE_LEVELS[to] }).where(eq(grants.id, course.id));
      await journal(tx, actor, { requestId: intent.requestId, entityType: "course_setting_grant", grantId: course.id, previousGrantId: course.id,
        from, to, targetAccountId: course.accountId }, now);
      return receipt(intent.requestId, course.id, to, now, false);
    }
    if ((await activeEventGrants(tx, course.accountId, event.id)).length > 0) return { status: "conflict" };
    const [created] = await tx.insert(schema.eventAdministrationGrants).values({ eventId: event.id, accountId: course.accountId, role: to, grantedAt: now })
      .returning({ id: schema.eventAdministrationGrants.id });
    if (!created) throw new Error("Behörigheten kunde inte sparas");
    await tx.delete(grants).where(and(eq(grants.id, course.id), ne(grants.accountId, actor.accountId)));
    await journal(tx, actor, { requestId: intent.requestId, entityType: "event_administration_grant", grantId: created.id, previousGrantId: course.id,
      from, to, targetAccountId: course.accountId }, now);
    return receipt(intent.requestId, created.id, to, now, false);
  });
}

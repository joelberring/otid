import { desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import {
  normalizeAccountEmail,
  SUPERADMIN_LIST_LIMIT,
  superadminActionRequestSchema,
  superadminOverviewSchema,
  type SuperadminActionKind,
  type SuperadminOverview
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { deleteAccountWithOwnedEvents } from "./account-self-service";
import { createPasswordResetToken } from "./password-reset";
import { purgeRows } from "./purge";
import {
  authenticateUserAccountSessionForMutation,
  authenticateUserAccountSessionForProtectedRead,
  revokeAllUserAccountSessions,
  type UserAccountAuthenticationResult,
  type UserAccountSessionProof
} from "./user-account";

/**
 * Superadmin (ADR-0172 beslut 2): en systemroll som bara sätts med kommando på servern
 * (`pnpm account:superadmin grant <e-post>`). Superadmin ser alla konton och tävlingar och kan dölja eller
 * ta bort en tävling, spärra eller ta bort ett konto och skapa en återställningslänk. Varje åtgärd loggas i
 * `superadmin_action` med vem, vad, mot vad, varför och när.
 */
type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export const SERVER_COMMAND_ACTOR = "Serverkommando";

/** Den enda kontrollen av superadmin, bredvid tävlingens admin-kontroll. */
export async function requireSuperadmin(
  tx: DatabaseTransaction,
  proof: UserAccountSessionProof,
  now: Date,
  mode: "read" | "mutation"
): Promise<UserAccountAuthenticationResult> {
  const auth = mode === "read"
    ? await authenticateUserAccountSessionForProtectedRead(tx, proof, now)
    : await authenticateUserAccountSessionForMutation(tx, { ...proof, requireCsrf: true }, now);
  if (auth.status !== "authenticated") return auth;
  return auth.principal.superadmin ? auth : { status: "forbidden" };
}

async function logAction(tx: DbExecutor, entry: {
  actorAccountId: string | null; actorLabel: string; action: SuperadminActionKind;
  targetType: "ACCOUNT" | "EVENT" | "RACE"; targetId: string; targetLabel: string; reason: string;
}, now: Date): Promise<void> {
  await tx.insert(schema.superadminActions).values({ ...entry, targetLabel: entry.targetLabel.slice(0, 320), createdAt: now });
}

const pattern = (query: string) => `%${query.trim().replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;

export async function readSuperadminOverview(
  db: Database,
  proof: UserAccountSessionProof,
  query: { accounts?: string; races?: string },
  now = new Date()
): Promise<{ status: "unauthorized" | "forbidden" } | { status: "ok"; response: SuperadminOverview }> {
  return db.transaction(async (tx) => {
    const auth = await requireSuperadmin(tx, proof, now, "read");
    if (auth.status !== "authenticated") return auth;
    const accountFilter: SQL | undefined = query.accounts?.trim()
      ? or(ilike(schema.userAccounts.email, pattern(query.accounts)), ilike(schema.userAccounts.displayName, pattern(query.accounts)))
      : undefined;
    // Uttryckligt tabellnamn: i en fråga mot en tabell skriver drizzle kolumnen utan tabell, och g har också "id".
    const eventCount = sql<number>`(select count(*)::int from ${schema.eventAdministrationGrants} g
      where g.account_id = "user_account"."id" and g.role = 'OWNER')`;
    const accounts = await tx.select({ account: schema.userAccounts, eventCount }).from(schema.userAccounts)
      .where(accountFilter).orderBy(desc(schema.userAccounts.createdAt)).limit(SUPERADMIN_LIST_LIMIT);
    const [accountTotal] = await tx.select({ count: sql<number>`count(*)::int` }).from(schema.userAccounts).where(accountFilter);

    const ownerEmail = sql<string | null>`(select a.email from ${schema.eventAdministrationGrants} g
      join ${schema.userAccounts} a on a.id = g.account_id
      where g.event_id = ${schema.events.id} and g.role = 'OWNER' order by g.granted_at limit 1)`;
    const raceFilter: SQL | undefined = query.races?.trim()
      ? or(ilike(schema.events.name, pattern(query.races)), ilike(schema.races.name, pattern(query.races)),
        sql`${ownerEmail} ilike ${pattern(query.races)}`)
      : undefined;
    const races = await tx.select({ race: schema.races, eventName: schema.events.name, ownerEmail })
      .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
      .where(raceFilter).orderBy(desc(schema.races.createdAt)).limit(SUPERADMIN_LIST_LIMIT);
    const [raceTotal] = await tx.select({ count: sql<number>`count(*)::int` })
      .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(raceFilter);
    const log = await tx.select().from(schema.superadminActions)
      .orderBy(desc(schema.superadminActions.createdAt)).limit(SUPERADMIN_LIST_LIMIT);

    return { status: "ok", response: superadminOverviewSchema.parse({
      formatVersion: 1,
      accounts: accounts.map(({ account, eventCount: count }) => ({
        accountId: account.id, email: account.email, displayName: account.displayName,
        createdAt: account.createdAt.toISOString(), lastLoginAt: account.lastLoginAt?.toISOString() ?? null,
        eventCount: count, blocked: account.blockedAt !== null, superadmin: account.isSuperadmin
      })),
      accountTotal: accountTotal?.count ?? 0,
      races: races.map(({ race, eventName, ownerEmail: owner }) => ({
        raceId: race.id, eventId: race.eventId, eventName, raceName: race.name, raceDate: race.raceDate,
        raceType: race.raceType, ownerEmail: owner, createdAt: race.createdAt.toISOString(), hidden: race.hiddenBySuperadmin
      })),
      raceTotal: raceTotal?.count ?? 0,
      log: log.map((entry) => ({ id: entry.id, createdAt: entry.createdAt.toISOString(), actorLabel: entry.actorLabel,
        action: entry.action, targetType: entry.targetType, targetLabel: entry.targetLabel, reason: entry.reason }))
    }) } as const;
  });
}

export type SuperadminActionResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "confirmation-mismatch" }
  | { status: "done"; action: SuperadminActionKind; reset?: { token: string; expiresAt: Date } };

export async function performSuperadminAction(
  db: Database,
  proof: UserAccountSessionProof,
  request: unknown,
  now = new Date()
): Promise<SuperadminActionResult> {
  const parsed = superadminActionRequestSchema.safeParse(request);
  if (!parsed.success) return { status: "invalid-request" };
  const action = parsed.data;
  return db.transaction(async (tx): Promise<SuperadminActionResult> => {
    const auth = await requireSuperadmin(tx, proof, now, "mutation");
    if (auth.status !== "authenticated") return auth;
    const actor = { actorAccountId: auth.principal.accountId, actorLabel: auth.principal.email, reason: action.reason };

    if ("raceId" in action) {
      const [race] = await tx.select({ race: schema.races, eventName: schema.events.name }).from(schema.races)
        .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(eq(schema.races.id, action.raceId)).for("update");
      if (!race) return { status: "not-found" };
      await tx.update(schema.races).set({ hiddenBySuperadmin: action.action === "HIDE_RACE" }).where(eq(schema.races.id, race.race.id));
      await logAction(tx, { ...actor, action: action.action, targetType: "RACE", targetId: race.race.id,
        targetLabel: `${race.eventName} – ${race.race.name}` }, now);
      return { status: "done", action: action.action };
    }

    if ("eventId" in action) {
      const [event] = await tx.select().from(schema.events).where(eq(schema.events.id, action.eventId)).for("update");
      if (!event) return { status: "not-found" };
      if (action.confirmation.trim() !== event.name.trim()) return { status: "confirmation-mismatch" };
      await purgeRows(tx, "event", [event.id]);
      await logAction(tx, { ...actor, action: "DELETE_EVENT", targetType: "EVENT", targetId: event.id, targetLabel: event.name }, now);
      return { status: "done", action: "DELETE_EVENT" };
    }

    const [account] = await tx.select().from(schema.userAccounts).where(eq(schema.userAccounts.id, action.accountId)).for("update");
    if (!account) return { status: "not-found" };
    // Det egna kontot spärras eller tas bort under Mitt konto, inte här.
    if (account.id === auth.principal.accountId && action.action !== "CREATE_RESET_LINK") return { status: "invalid-request" };
    const target = { targetType: "ACCOUNT" as const, targetId: account.id, targetLabel: account.email };
    switch (action.action) {
      case "BLOCK_ACCOUNT":
        await tx.update(schema.userAccounts).set({ blockedAt: account.blockedAt ?? now }).where(eq(schema.userAccounts.id, account.id));
        await revokeAllUserAccountSessions(tx, account.id, now, "ACCOUNT_BLOCKED");
        break;
      case "UNBLOCK_ACCOUNT":
        await tx.update(schema.userAccounts).set({ blockedAt: null }).where(eq(schema.userAccounts.id, account.id));
        break;
      case "DELETE_ACCOUNT":
        if (normalizeAccountEmail(action.confirmation) !== account.email) return { status: "confirmation-mismatch" };
        await deleteAccountWithOwnedEvents(tx, account.id, now);
        break;
      case "CREATE_RESET_LINK": {
        if (account.blockedAt) return { status: "invalid-request" };
        const reset = await createPasswordResetToken(tx, { accountId: account.id, bySuperadmin: true }, now);
        await logAction(tx, { ...actor, ...target, action: action.action }, now);
        return { status: "done", action: action.action, reset };
      }
    }
    await logAction(tx, { ...actor, ...target, action: action.action }, now);
    return { status: "done", action: action.action };
  });
}

/** Serverkommandot: ger eller tar bort superadmin för kontot med adressen. Loggas som "Serverkommando". */
export async function setSuperadmin(
  db: Database,
  input: { email: string; superadmin: boolean; reason?: string },
  now = new Date()
): Promise<{ status: "not-found" | "unchanged" | "changed"; accountId?: string }> {
  const email = normalizeAccountEmail(input.email);
  if (!email) return { status: "not-found" };
  return db.transaction(async (tx) => {
    const [account] = await tx.select().from(schema.userAccounts).where(eq(schema.userAccounts.email, email)).for("update");
    if (!account) return { status: "not-found" } as const;
    if (account.isSuperadmin === input.superadmin) return { status: "unchanged", accountId: account.id } as const;
    await tx.update(schema.userAccounts).set({ isSuperadmin: input.superadmin }).where(eq(schema.userAccounts.id, account.id));
    await logAction(tx, { actorAccountId: null, actorLabel: SERVER_COMMAND_ACTOR,
      action: input.superadmin ? "GRANT_SUPERADMIN" : "REVOKE_SUPERADMIN", targetType: "ACCOUNT", targetId: account.id,
      targetLabel: account.email, reason: input.reason?.trim() || "Satt med serverkommando" }, now);
    return { status: "changed", accountId: account.id } as const;
  });
}


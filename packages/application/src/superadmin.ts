import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import {
  normalizeAccountEmail,
  SUPERADMIN_LIST_LIMIT,
  SUPERADMIN_NEAR_LIMIT_SHARE,
  superadminActionRequestSchema,
  superadminOverviewSchema,
  type SuperadminActionKind,
  type SuperadminOverview
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { raceTitle } from "@o-tid/domain";
import { schema } from "@o-tid/database";
import { deleteAccountWithOwnedEvents } from "./account-self-service";
import { createPasswordResetToken } from "./password-reset";
import { markAccountEmailVerified } from "./email-verification";
import { logAction, SERVER_COMMAND_ACTOR } from "./superadmin-log";
import { purgeRows } from "./purge";
import { mapStorageQuota, mapStorageUsage } from "./map-content";
import { GEO_JOB_COUNTS, geoTilesPerMonth } from "./map-project-geo-jobs";
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
 * ta bort en tävling, spärra eller ta bort ett konto, skapa en återställningslänk och bekräfta en e-postadress (tillägg
 * 2026-11-12). Varje åtgärd loggas i `superadmin_action` med vem, vad, mot vad, varför och när.
 */
type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

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

const pattern = (query: string) => `%${query.trim().replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;

export async function readSuperadminOverview(
  db: Database,
  proof: UserAccountSessionProof,
  query: { accounts?: string; races?: string },
  now = new Date(),
  environment: Record<string, string | undefined> = process.env
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

    // Förbrukning mot gränserna (ägaren 2026-11-13): kartlagring per uppladdare och månadens laserrutor, räknade som i
    // storeMapContent och createGeoJob. Listan tar konton som nått SUPERADMIN_NEAR_LIMIT_SHARE av en gräns eller har egna gränser.
    const quota = mapStorageQuota(environment);
    const defaultTiles = geoTilesPerMonth(environment);
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const MB = 1024 * 1024;
    const usage = (await tx.execute<{ id: string; email: string; display_name: string; map_quota_mb: number | null;
      geo_tiles_per_month: number | null; bytes: string; tiles: number }>(sql`
      with u as (
        select a.id, a.email, a.display_name, a.map_quota_mb, a.geo_tiles_per_month,
          coalesce(m.bytes, 0) as bytes, coalesce(g.tiles, 0)::int as tiles,
          coalesce(a.map_quota_mb::numeric * ${MB}, ${quota.accountBytes}::numeric) as map_limit,
          coalesce(a.geo_tiles_per_month, ${defaultTiles}::int) as tile_limit
        from user_account a
        left join (select uploaded_by, sum(byte_length) as bytes from map_content where uploaded_by is not null group by uploaded_by) m
          on m.uploaded_by = a.id
        left join (select account_id, sum(jsonb_array_length(request->'tiles')) as tiles from map_project_geo_job
          where created_at >= ${month.toISOString()}::timestamptz and (status = 'QUEUED' or started_at is not null) and ${GEO_JOB_COUNTS}
          group by account_id) g
          on g.account_id = a.id
      ), s as (
        select u.*, greatest(case when map_limit > 0 then bytes / map_limit else 0 end,
          case when tile_limit > 0 then tiles::numeric / tile_limit when tiles > 0 then 1 else 0 end) as share from u
      )
      select id, email, display_name, map_quota_mb, geo_tiles_per_month, bytes::text as bytes, tiles from s
      where share >= ${SUPERADMIN_NEAR_LIMIT_SHARE} or map_quota_mb is not null or geo_tiles_per_month is not null
      order by share desc, email limit ${SUPERADMIN_LIST_LIMIT}`)).rows;
    const total = await mapStorageUsage(tx, null);

    return { status: "ok", response: superadminOverviewSchema.parse({
      formatVersion: 1,
      accounts: accounts.map(({ account, eventCount: count }) => ({
        accountId: account.id, email: account.email, displayName: account.displayName,
        createdAt: account.createdAt.toISOString(), lastLoginAt: account.lastLoginAt?.toISOString() ?? null,
        eventCount: count, blocked: account.blockedAt !== null, superadmin: account.isSuperadmin,
        emailVerified: account.emailVerifiedAt !== null,
        mapQuotaMb: account.mapQuotaMb, geoTilesPerMonth: account.geoTilesPerMonth
      })),
      accountTotal: accountTotal?.count ?? 0,
      races: races.map(({ race, eventName, ownerEmail: owner }) => ({
        raceId: race.id, eventId: race.eventId, eventName, raceName: race.name, raceDate: race.raceDate,
        raceType: race.raceType, ownerEmail: owner, createdAt: race.createdAt.toISOString(), hidden: race.hiddenBySuperadmin
      })),
      raceTotal: raceTotal?.count ?? 0,
      log: log.map((entry) => ({ id: entry.id, createdAt: entry.createdAt.toISOString(), actorLabel: entry.actorLabel,
        action: entry.action, targetType: entry.targetType, targetLabel: entry.targetLabel, reason: entry.reason })),
      limits: {
        defaultMapQuotaMb: quota.accountBytes === null ? null : Math.round(quota.accountBytes / MB),
        defaultGeoTilesPerMonth: defaultTiles,
        totalUsedBytes: total.totalBytes, totalLimitBytes: quota.totalBytes,
        accounts: usage.map(row => ({
          accountId: row.id, email: row.email, displayName: row.display_name, mapUsedBytes: Number(row.bytes),
          mapLimitBytes: row.map_quota_mb != null ? row.map_quota_mb * MB : quota.accountBytes, mapQuotaMb: row.map_quota_mb,
          geoTilesUsed: row.tiles, geoTilesLimit: row.geo_tiles_per_month ?? defaultTiles, geoTilesPerMonth: row.geo_tiles_per_month
        }))
      }
    }) } as const;
  });
}

export type SuperadminActionResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "confirmation-mismatch" | "already-verified" }
  | { status: "done"; action: SuperadminActionKind; reset?: { token: string; expiresAt: Date } };

export async function performSuperadminAction(
  db: Database,
  proof: UserAccountSessionProof,
  request: unknown,
  now = new Date()
): Promise<SuperadminActionResult> {
  const parsed = superadminActionRequestSchema.safeParse(request);
  return db.transaction(async (tx): Promise<SuperadminActionResult> => {
    const auth = await requireSuperadmin(tx, proof, now, "mutation");
    if (auth.status !== "authenticated") return auth;
    // Inloggningen och behörigheten prövas före kroppen (städrundan 2026-11-07): utloggad får 401, inte 400.
    if (!parsed.success) return { status: "invalid-request" } as const;
    const action = parsed.data;
    const actor = { actorAccountId: auth.principal.accountId, actorLabel: auth.principal.email, reason: action.reason };

    if ("raceId" in action) {
      const [race] = await tx.select({ race: schema.races, eventName: schema.events.name }).from(schema.races)
        .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(eq(schema.races.id, action.raceId)).for("update");
      if (!race) return { status: "not-found" };
      await tx.update(schema.races).set({ hiddenBySuperadmin: action.action === "HIDE_RACE" }).where(eq(schema.races.id, race.race.id));
      await logAction(tx, { ...actor, action: action.action, targetType: "RACE", targetId: race.race.id,
        targetLabel: raceTitle(race.eventName, race.race.name, " – ") }, now);
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
    // Det egna kontot spärras eller tas bort under Mitt konto, inte här. Gränserna får superadmin sätta också på sitt eget.
    if (account.id === auth.principal.accountId && action.action !== "CREATE_RESET_LINK" && action.action !== "VERIFY_EMAIL"
      && action.action !== "SET_ACCOUNT_LIMITS") {
      return { status: "invalid-request" };
    }
    const target = { targetType: "ACCOUNT" as const, targetId: account.id, targetLabel: account.email };
    switch (action.action) {
      case "BLOCK_ACCOUNT":
        await tx.update(schema.userAccounts).set({ blockedAt: account.blockedAt ?? now }).where(eq(schema.userAccounts.id, account.id));
        await revokeAllUserAccountSessions(tx, account.id, now, "ACCOUNT_BLOCKED");
        // Översynen A2: AI-kopplingarna återkallas också (de gäller inte igen när spärren hävs).
        await tx.update(schema.oauthGrants).set({ revokedAt: now })
          .where(and(eq(schema.oauthGrants.accountId, account.id), isNull(schema.oauthGrants.revokedAt)));
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
      case "SET_ACCOUNT_LIMITS": {
        // Ägaren 2026-11-13: egna gränser för kartlagring och laserrutor; null = installationens förval. Loggen säger från och till.
        const shown = (value: number | null, unit: string) => value === null ? "förval" : `${value} ${unit}`;
        await tx.update(schema.userAccounts).set({ mapQuotaMb: action.mapQuotaMb, geoTilesPerMonth: action.geoTilesPerMonth })
          .where(eq(schema.userAccounts.id, account.id));
        const change = `Lagring ${shown(account.mapQuotaMb, "MB")} → ${shown(action.mapQuotaMb, "MB")}, laserrutor ${shown(account.geoTilesPerMonth, "per månad")} → ${shown(action.geoTilesPerMonth, "per månad")}`;
        await logAction(tx, { ...actor, ...target, action: action.action, reason: `${action.reason} (${change})`.slice(0, 500) }, now);
        return { status: "done", action: action.action };
      }
      case "VERIFY_EMAIL":
        // Som serverkommandot (ADR-0186 beslut 9): superadmin intygar att personen har adressen. Lösenordet ändras inte.
        if (account.emailVerifiedAt) return { status: "already-verified" };
        await markAccountEmailVerified(tx, account.id, now);
        break;
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


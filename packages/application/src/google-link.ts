import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { normalizeAccountEmail } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import type { GoogleIdentity } from "./google-oidc";
import { accountHasKnownPassword } from "./google-login";
import { deleteAccountWithOwnedEvents } from "./account-self-service";
import { throttleSecret } from "./account-throttle";
import { logAction, SERVER_COMMAND_ACTOR } from "./superadmin";
import {
  authenticateUserAccountSessionForMutation, authenticateUserAccountSessionForProtectedRead, currentUserAccountVerifier, sessionIssuedAt,
  userAccountPasswordMatches, type UserAccountSessionProof
} from "./user-account";

/**
 * ADR-0205 tillägg: "Koppla Google-konto" under Mitt konto. Ägaren loggade in med Google med en Gmail-adress som skiljer sig från
 * kontots adress och fick ett andra konto. Inloggad kopplas Google-kontot (`sub`) till det aktuella kontot, oavsett Googles
 * adress; kontots egen adress ändras inte, Googles visas bara som kopplingen.
 *
 * - Googles adress måste vara bekräftad (`email_verified`), som vid inloggningen.
 * - Är Google-kontot redan kopplat till ett annat konto som är tomt (`accountUsage`), flyttas kopplingen efter en bekräftelse
 *   med lösenordet (eller en inloggning nyss) och det tomma kontot tas bort som dubblett. Det loggas i superadmins logg.
 * - Används det andra kontot vägras kopplingen; personen tar bort den där, eller superadmin flyttar den med kommandot
 *   `superadmin.mjs google move`.
 * - Kopplingen tas bort under Mitt konto, men inte om kontot då saknar sätt att logga in (inget känt lösenord).
 */
const SUB = /^[A-Za-z0-9_-]{1,255}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Hur nyss en inloggning ska vara för att räcka som bekräftelse när kontot saknar känt lösenord. */
export const GOOGLE_MOVE_RECENT_LOGIN_MS = 10 * 60 * 1000;
/** Hur länge en påbörjad flytt (kakan efter återkomsten från Google) gäller. */
export const GOOGLE_MOVE_LIFETIME_MS = 10 * 60 * 1000;

type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" };

/**
 * Tabeller som pekar på ett konto utan att kontot "används": inloggningens egna rader, länkar som bara gäller kontot och svaret
 * på "Vilken klubb tillhör du?" (utan klubb). Allt annat som pekar på kontot (tävlingar, behörigheter, klubbar, grupper,
 * arkivinnehåll, banläggningens ändringar, anmälningar …) gör att det används. Nya tabeller räknas därför med automatiskt.
 */
const IGNORED_TABLES = new Set(["user_account", "user_account_auth_guard", "user_account_password_verifier", "user_account_session",
  "user_account_session_revocation", "user_account_google_identity", "password_reset_token", "email_verification_token",
  "account_club_prompt", "superadmin_action", "user_account_login_throttle"]);

/** Hur mycket som hänger på kontot: rader i andra tabeller som pekar på det (kolumner `…account_id` och `…_by`). */
export async function accountUsage(tx: DbExecutor, accountId: string): Promise<{ rows: number; tables: number; superadmin: boolean; blocked: boolean }> {
  if (!UUID.test(accountId)) throw new Error("Ogiltigt konto-id");
  const columns = await tx.execute<{ table_name: string; column_name: string }>(sql`
    select c.table_name, c.column_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = current_schema() and c.data_type = 'uuid'
      and (c.column_name ~ '(^|_)account_id$' or c.column_name ~ '_by$')
    order by c.table_name, c.column_name`);
  const quote = (identifier: string) => `"${identifier.replaceAll("\"", "\"\"")}"`;
  let rows = 0;
  const tables = new Set<string>();
  for (const { table_name: table, column_name: column } of columns.rows) {
    if (IGNORED_TABLES.has(table)) continue;
    const result = await tx.execute<{ count: string }>(sql.raw(
      `select count(*)::text as count from ${quote(table)} where ${quote(column)} = '${accountId}'::uuid`));
    const count = Number(result.rows[0]?.count ?? 0);
    if (count > 0) { rows += count; tables.add(table); }
  }
  const [account] = await tx.select({ superadmin: schema.userAccounts.isSuperadmin, blockedAt: schema.userAccounts.blockedAt })
    .from(schema.userAccounts).where(eq(schema.userAccounts.id, accountId));
  return { rows, tables: tables.size, superadmin: account?.superadmin ?? false, blocked: !!account?.blockedAt };
}

const isEmpty = (usage: Awaited<ReturnType<typeof accountUsage>>) => usage.rows === 0 && !usage.superadmin && !usage.blocked;

/** Kopplar `sub` till kontot (ersätter kontots tidigare koppling; `linkedAt` står kvar för en befintlig rad). */
async function attach(tx: DbExecutor, accountId: string, sub: string, googleEmail: string | null, now: Date): Promise<void> {
  const identities = schema.userAccountGoogleIdentities;
  await tx.insert(identities).values({ accountId, googleSub: sub, linkedAt: now, googleEmail })
    .onConflictDoUpdate({ target: identities.accountId, set: { googleSub: sub, googleEmail } });
}

/** Den påbörjade flytten mellan återkomsten från Google och bekräftelsen, signerad med serverns hemlighet (HttpOnly-kaka). */
export interface GoogleMovePending {
  sub: string;
  googleEmail: string;
  sourceAccountId: string;
  /** Sessionen som började kopplingen; flytten gäller bara den. */
  sessionId: string;
  expiresAt: number;
}

function moveSignature(payload: string, secret: string | Buffer): Buffer {
  return createHmac("sha256", secret).update(`otid-google-move-v1\u0000${payload}`).digest();
}

export function serializeGoogleMovePending(pending: GoogleMovePending, secret: string | Buffer = throttleSecret()): string {
  const payload = Buffer.from(JSON.stringify([pending.sub, pending.googleEmail, pending.sourceAccountId, pending.sessionId, pending.expiresAt]))
    .toString("base64url");
  return `${payload}.${moveSignature(payload, secret).toString("base64url")}`;
}

export function parseGoogleMovePending(value: string | null | undefined, now = new Date(), secret: string | Buffer = throttleSecret())
  : GoogleMovePending | undefined {
  if (!value || value.length > 1200 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) return undefined;
  const [payload, signature] = value.split(".") as [string, string];
  const expected = moveSignature(payload, secret);
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return undefined; }
  if (!Array.isArray(parsed) || parsed.length !== 5) return undefined;
  const [sub, googleEmail, sourceAccountId, sessionId, expiresAt] = parsed as unknown[];
  if (typeof sub !== "string" || !SUB.test(sub) || typeof googleEmail !== "string" || typeof sourceAccountId !== "string"
    || !UUID.test(sourceAccountId) || typeof sessionId !== "string" || !UUID.test(sessionId) || typeof expiresAt !== "number") return undefined;
  if (expiresAt <= now.getTime() || expiresAt > now.getTime() + GOOGLE_MOVE_LIFETIME_MS + 60_000) return undefined;
  return { sub, googleEmail, sourceAccountId, sessionId, expiresAt };
}

export type GoogleLinkResult =
  | Failure
  /** Sessionen är inte den som började kopplingen (en annan inloggning i webbläsaren, eller en länk från någon annan). */
  | { status: "session-mismatch" | "email-not-verified" | "invalid-identity" }
  | { status: "linked"; googleEmail: string }
  | { status: "in-use"; googleEmail: string }
  | { status: "move-needed"; pending: GoogleMovePending };

/**
 * Återkomsten från Google i läget "link". `boundSessionId` kommer ur kakan som skapades när kopplingen började och måste vara
 * den inloggade sessionen. Ingen CSRF-kontroll här (återkomsten är en navigering); bindningen till sessionen och `state`
 * (kontrollerat av anroparen) skyddar i stället.
 */
export async function linkGoogleToAccount(db: Database, input: { proof: UserAccountSessionProof; boundSessionId: string; identity: GoogleIdentity },
  now = new Date()): Promise<GoogleLinkResult> {
  const { identity } = input;
  if (!identity.emailVerified) return { status: "email-not-verified" };
  const googleEmail = normalizeAccountEmail(identity.email);
  if (!googleEmail || !SUB.test(identity.sub)) return { status: "invalid-identity" };
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input.proof, requireCsrf: false }, now);
    if (auth.status !== "authenticated") return auth;
    if (auth.principal.sessionId !== input.boundSessionId) return { status: "session-mismatch" } as const;
    const accountId = auth.principal.accountId;
    const identities = schema.userAccountGoogleIdentities;
    const [link] = await tx.select().from(identities).where(eq(identities.googleSub, identity.sub)).for("update");
    if (!link || link.accountId === accountId) {
      await attach(tx, accountId, identity.sub, googleEmail, now);
      return { status: "linked", googleEmail } as const;
    }
    const usage = await accountUsage(tx, link.accountId);
    if (!isEmpty(usage)) return { status: "in-use", googleEmail } as const;
    return { status: "move-needed", pending: { sub: identity.sub, googleEmail, sourceAccountId: link.accountId,
      sessionId: auth.principal.sessionId, expiresAt: now.getTime() + GOOGLE_MOVE_LIFETIME_MS } } as const;
  });
}

export interface GoogleMoveDetails {
  googleEmail: string;
  sourceEmail: string;
  sourceCreatedAt: string;
  /** Kontot har ett känt lösenord: flytten bekräftas med det. Annars räcker en inloggning nyss (`recentLogin`). */
  needsPassword: boolean;
  recentLogin: boolean;
}

type MoveCheck = Failure | { status: "session-mismatch" | "expired" | "in-use" }
  | { status: "ready"; details: GoogleMoveDetails; accountId: string; accountEmail: string };

async function checkMove(tx: DbExecutor, auth: Awaited<ReturnType<typeof authenticateUserAccountSessionForMutation>>, pending: GoogleMovePending,
  now: Date): Promise<MoveCheck> {
  if (auth.status !== "authenticated") return auth;
  if (auth.principal.sessionId !== pending.sessionId) return { status: "session-mismatch" };
  const identities = schema.userAccountGoogleIdentities;
  const [link] = await tx.select().from(identities).where(eq(identities.googleSub, pending.sub)).for("update");
  // Kopplingen har ändrats sedan återkomsten (flyttad, borttagen eller kopplad hit): börja om.
  if (!link || link.accountId !== pending.sourceAccountId || link.accountId === auth.principal.accountId) return { status: "expired" };
  const [source] = await tx.select().from(schema.userAccounts).where(eq(schema.userAccounts.id, link.accountId)).for("update");
  if (!source || !isEmpty(await accountUsage(tx, source.id))) return { status: "in-use" };
  const issuedAt = await sessionIssuedAt(tx, auth.principal.sessionId);
  return { status: "ready", accountId: auth.principal.accountId, accountEmail: auth.principal.email, details: {
    googleEmail: pending.googleEmail, sourceEmail: source.email, sourceCreatedAt: source.createdAt.toISOString(),
    needsPassword: await accountHasKnownPassword(tx, auth.principal.accountId),
    recentLogin: !!issuedAt && now.getTime() - issuedAt.getTime() <= GOOGLE_MOVE_RECENT_LOGIN_MS } };
}

/** Sidan som bekräftar flytten: vad som kommer att hända (Googles adress, det tomma kontots adress) och hur det bekräftas. */
export async function readGoogleMove(db: Database, proof: UserAccountSessionProof, pending: GoogleMovePending, now = new Date())
  : Promise<Exclude<MoveCheck, { status: "ready" }> | { status: "ready"; details: GoogleMoveDetails }> {
  return db.transaction(async tx => {
    const result = await checkMove(tx, await authenticateUserAccountSessionForProtectedRead(tx, proof, now), pending, now);
    return result.status === "ready" ? { status: "ready", details: result.details } as const : result;
  });
}

/**
 * Flytten: kopplingen tas från det tomma kontot och sätts på det inloggade, och det tomma kontot tas bort som dubblett (som när
 * kontot själv tas bort: sessionerna spärras och raderna följer främmande nycklar). Öppna inbjudningar till det tomma kontots
 * adress lämnas som de är; de gäller adressen. Kräver lösenordet, eller en inloggning nyss för ett konto utan känt lösenord.
 */
export async function moveGoogleLinkToAccount(db: Database, input: { proof: UserAccountSessionProof; pending: GoogleMovePending; password?: string },
  now = new Date()): Promise<Exclude<MoveCheck, { status: "ready" }> | { status: "wrong-password" | "login-again" }
    | { status: "moved"; googleEmail: string; sourceEmail: string }> {
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input.proof, requireCsrf: true }, now);
    const check = await checkMove(tx, auth, input.pending, now);
    if (check.status !== "ready") return check;
    if (check.details.needsPassword) {
      const verifier = await currentUserAccountVerifier(tx, check.accountId);
      if (!input.password || !await userAccountPasswordMatches(verifier, input.password)) return { status: "wrong-password" } as const;
    } else if (!check.details.recentLogin) return { status: "login-again" } as const;
    const sourceId = input.pending.sourceAccountId;
    await tx.delete(schema.userAccountGoogleIdentities).where(eq(schema.userAccountGoogleIdentities.accountId, sourceId));
    await attach(tx, check.accountId, input.pending.sub, input.pending.googleEmail, now);
    await deleteAccountWithOwnedEvents(tx, sourceId, now);
    await logAction(tx, { actorAccountId: check.accountId, actorLabel: check.accountEmail, action: "DELETE_ACCOUNT", targetType: "ACCOUNT",
      targetId: sourceId, targetLabel: check.details.sourceEmail,
      reason: `Dubblett utan innehåll: Google-kopplingen flyttades till ${check.accountEmail} (Koppla Google-konto under Mitt konto)` }, now);
    return { status: "moved", googleEmail: input.pending.googleEmail, sourceEmail: check.details.sourceEmail } as const;
  });
}

/** Kopplingen som Mitt konto visar: Googles adress (tom för en koppling från före migration 0082) och om lösenordet är känt. */
export async function readGoogleLink(tx: DbExecutor, accountId: string, accountEmail: string)
  : Promise<{ google?: { email: string | null; linkedAt: string }; hasPassword: boolean }> {
  const [link] = await tx.select().from(schema.userAccountGoogleIdentities).where(eq(schema.userAccountGoogleIdentities.accountId, accountId));
  const hasPassword = await accountHasKnownPassword(tx, accountId);
  if (!link) return { hasPassword };
  // Före 0082 sparades inte Googles adress; ett konto som Google skapade har samma adress som Google.
  const email = link.googleEmail ?? (!hasPassword ? accountEmail : null);
  return { google: { email, linkedAt: link.linkedAt.toISOString() }, hasPassword };
}

/** "Ta bort kopplingen": vägras om kontot då saknar sätt att logga in (inget känt lösenord och ingen annan koppling). */
export async function unlinkGoogleFromAccount(db: Database, proof: UserAccountSessionProof, now = new Date())
  : Promise<Failure | { status: "not-linked" | "last-login-method" | "unlinked" }> {
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...proof, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const identities = schema.userAccountGoogleIdentities;
    const [link] = await tx.select().from(identities).where(eq(identities.accountId, auth.principal.accountId)).for("update");
    if (!link) return { status: "not-linked" } as const;
    if (!await accountHasKnownPassword(tx, auth.principal.accountId)) return { status: "last-login-method" } as const;
    await tx.delete(identities).where(eq(identities.accountId, auth.principal.accountId));
    return { status: "unlinked" } as const;
  });
}

export type GoogleMoveCommandResult =
  | { status: "source-not-found" | "target-not-found" | "same-account" }
  | { status: "moved"; googleEmail: string | null; sourceEmail: string; targetEmail: string; replacedTargetLink: boolean;
    sourceDeleted: boolean; sourceUsage: { rows: number; tables: number } };

/**
 * Superadmin (`node superadmin.mjs google move <källa> <mål> [--delete-source-if-empty]`): flyttar Google-kopplingen från ett konto
 * till ett annat. Källan hittas på Googles adress eller på kontots adress. Med `deleteSourceIfEmpty` tas källkontot bort om det är
 * tomt (loggas som "Serverkommando"); annars står det kvar utan koppling.
 */
export async function moveGoogleLinkByCommand(db: Database, input: { source: string; target: string; deleteSourceIfEmpty: boolean },
  now = new Date()): Promise<GoogleMoveCommandResult> {
  const sourceEmail = normalizeAccountEmail(input.source);
  const targetEmail = normalizeAccountEmail(input.target);
  if (!sourceEmail) return { status: "source-not-found" };
  if (!targetEmail) return { status: "target-not-found" };
  return db.transaction(async tx => {
    const identities = schema.userAccountGoogleIdentities;
    let [link] = await tx.select().from(identities).where(eq(identities.googleEmail, sourceEmail)).for("update");
    if (!link) {
      const [account] = await tx.select({ id: schema.userAccounts.id }).from(schema.userAccounts).where(eq(schema.userAccounts.email, sourceEmail));
      if (account) [link] = await tx.select().from(identities).where(eq(identities.accountId, account.id)).for("update");
    }
    if (!link) return { status: "source-not-found" } as const;
    const [source] = await tx.select().from(schema.userAccounts).where(eq(schema.userAccounts.id, link.accountId)).for("update");
    const [target] = await tx.select().from(schema.userAccounts).where(eq(schema.userAccounts.email, targetEmail)).for("update");
    if (!source) return { status: "source-not-found" } as const;
    if (!target) return { status: "target-not-found" } as const;
    if (source.id === target.id) return { status: "same-account" } as const;
    const [previous] = await tx.select({ sub: identities.googleSub }).from(identities).where(eq(identities.accountId, target.id));
    const usage = await accountUsage(tx, source.id);
    // Före migration 0082 saknas Googles adress; ett konto som Google skapade har Googles adress.
    const googleEmail = link.googleEmail ?? (await accountHasKnownPassword(tx, source.id) ? null : source.email);
    await tx.delete(identities).where(eq(identities.accountId, source.id));
    await attach(tx, target.id, link.googleSub, googleEmail, now);
    const sourceDeleted = input.deleteSourceIfEmpty && isEmpty(usage);
    if (sourceDeleted) {
      await deleteAccountWithOwnedEvents(tx, source.id, now);
      await logAction(tx, { actorAccountId: null, actorLabel: SERVER_COMMAND_ACTOR, action: "DELETE_ACCOUNT", targetType: "ACCOUNT",
        targetId: source.id, targetLabel: source.email, reason: `Dubblett utan innehåll: Google-kopplingen flyttades till ${target.email}` }, now);
    }
    return { status: "moved", googleEmail, sourceEmail: source.email, targetEmail: target.email,
      replacedTargetLink: !!previous, sourceDeleted, sourceUsage: { rows: usage.rows, tables: usage.tables } } as const;
  });
}

import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import {
  organizerAccountLoginRequestSchema,
  organizerAccountLoginResponseSchema,
  organizerAccountRegistrationRequestSchema,
  type OrganizerAccountLoginRequest,
  type OrganizerAccountLoginResponse
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { consumeAccountRequestAllowance, DEFAULT_REGISTRATIONS_PER_HOUR } from "./account-throttle";

const TOKEN_PREFIX = "otid_user_session_v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const DUMMY_ID = "00000000-0000-4000-8000-000000000000";
const DUMMY_SALT = Buffer.alloc(16);
const DUMMY_HASH = Buffer.alloc(32);
// ADR-0168: en inloggning ska räcka en hel tävlingshelg.
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const SCRYPT_OPTIONS = { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 } as const;

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
interface ParsedToken { id: string; secret: Buffer }

export interface UserAccountPrincipal {
  accountId: string;
  sessionId: string;
  email: string;
  displayName: string;
  superadmin: boolean;
  expiresAt: string;
}

export interface UserAccountSessionProof {
  sessionToken: string | null;
  csrfCookie?: string | null;
  csrfHeader?: string | null;
  requireCsrf?: boolean;
}

export type UserAccountAuthenticationResult =
  | { status: "unauthorized" | "forbidden" }
  | { status: "authenticated"; principal: UserAccountPrincipal };

export type UserAccountLoginResult =
  | { status: "unauthorized" | "rate-limited" | "blocked" }
  | { status: "authenticated"; response: OrganizerAccountLoginResponse; sessionToken: string; csrfToken: string };

export interface UserAccountRuntimeOptions {
  now?: Date;
  accountId?: string;
  saltBytes?: Uint8Array;
  sessionId?: string;
  sessionSecretBytes?: Uint8Array;
  csrfSecretBytes?: Uint8Array;
}

function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new Error("Ogiltig tidpunkt");
  return value;
}

function validUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error("Ogiltigt id");
  return value;
}

function bytes(value: Uint8Array | undefined, length: number): Buffer {
  const result = value === undefined ? randomBytes(length) : Buffer.from(value);
  if (result.length !== length) throw new Error("Ogiltig hemlighetslängd");
  return result;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Lösenordets verifierare (scrypt). */
export async function scryptVerifier(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, SCRYPT_OPTIONS, (error, derived) => {
      if (error) reject(error);
      else resolve(Buffer.from(derived));
    });
  });
}

function token(id: string, secret: Buffer): string {
  return `${TOKEN_PREFIX}.${id}.${secret.toString("base64url")}`;
}

function parseToken(value: string | null): ParsedToken | undefined {
  if (value === null || value.length > 128) return undefined;
  const match = /^otid_user_session_v1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match?.[1] || !match[2] || !UUID_PATTERN.test(match[1]) || !SECRET_PATTERN.test(match[2])) return undefined;
  const decoded = Buffer.from(match[2], "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== match[2]) return undefined;
  return { id: match[1], secret: decoded };
}

function hashMatches(secret: Buffer, storedHash: string | undefined): boolean {
  const actual = Buffer.from(sha256(secret), "hex");
  const expected = storedHash && HASH_PATTERN.test(storedHash) ? Buffer.from(storedHash, "hex") : DUMMY_HASH;
  return timingSafeEqual(actual, expected);
}

function csrfMatches(cookie: string | null | undefined, header: string | null | undefined, storedHash: string): boolean {
  const cookieBytes = cookie && SECRET_PATTERN.test(cookie) ? Buffer.from(cookie, "base64url") : Buffer.alloc(32);
  const headerBytes = header && SECRET_PATTERN.test(header) ? Buffer.from(header, "base64url") : Buffer.alloc(32);
  const expected = HASH_PATTERN.test(storedHash) ? Buffer.from(storedHash, "hex") : DUMMY_HASH;
  return timingSafeEqual(Buffer.from(sha256(cookieBytes), "hex"), expected) &&
    timingSafeEqual(Buffer.from(sha256(headerBytes), "hex"), expected) &&
    timingSafeEqual(cookieBytes, headerBytes);
}

type AccountRow = typeof schema.userAccounts.$inferSelect;

/** Lägger till en ny verifierarversion. Sessioner med äldre version slutar gälla (lösenordsbyte loggar ut). */
export async function appendUserAccountPasswordVerifier(
  tx: DbExecutor,
  input: { accountId: string; password: string; previousVersion: number },
  now: Date,
  saltBytes?: Uint8Array
): Promise<number> {
  if (input.previousVersion >= 2_147_483_647) throw new Error("Verifierarversionen är full");
  const salt = bytes(saltBytes, 16);
  const verifier = await scryptVerifier(input.password, salt);
  const version = input.previousVersion + 1;
  await tx.insert(schema.userAccountPasswordVerifiers).values({
    accountId: input.accountId, version, algorithm: "scrypt-v1", saltHex: salt.toString("hex"),
    verifierHex: verifier.toString("hex"), createdAt: now
  });
  return version;
}

export async function currentUserAccountVerifier(tx: DbExecutor, accountId: string) {
  const [verifier] = await tx.select().from(schema.userAccountPasswordVerifiers)
    .where(eq(schema.userAccountPasswordVerifiers.accountId, accountId))
    .orderBy(desc(schema.userAccountPasswordVerifiers.version)).limit(1);
  return verifier;
}

/** Jämför lösenordet med kontots senaste verifierare i konstant tid (även när kontot saknas). */
export async function userAccountPasswordMatches(
  verifier: { saltHex: string; verifierHex: string } | undefined,
  password: string
): Promise<boolean> {
  const derived = await scryptVerifier(password, verifier?.saltHex ? Buffer.from(verifier.saltHex, "hex") : DUMMY_SALT);
  const expected = verifier?.verifierHex && HASH_PATTERN.test(verifier.verifierHex)
    ? Buffer.from(verifier.verifierHex, "hex") : DUMMY_HASH;
  return timingSafeEqual(derived, expected) && !!verifier;
}

/** Ny session för kontot på den här enheten. */
export async function issueUserAccountSession(
  tx: DbExecutor,
  account: AccountRow,
  passwordVersion: number,
  now: Date,
  options: UserAccountRuntimeOptions = {}
): Promise<Extract<UserAccountLoginResult, { status: "authenticated" }>> {
  const sessionId = validUuid(options.sessionId ?? randomUUID());
  const sessionSecret = bytes(options.sessionSecretBytes, 32);
  const csrfSecret = bytes(options.csrfSecretBytes, 32);
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
  await tx.insert(schema.userAccountSessions).values({
    id: sessionId, accountId: account.id, passwordVersion,
    sessionSecretHash: sha256(sessionSecret), csrfSecretHash: sha256(csrfSecret), issuedAt: now, expiresAt
  });
  return {
    status: "authenticated",
    response: organizerAccountLoginResponseSchema.parse({
      formatVersion: 1, accountId: account.id, email: account.email, displayName: account.displayName,
      superadmin: account.isSuperadmin, expiresAt: expiresAt.toISOString()
    }),
    sessionToken: token(sessionId, sessionSecret),
    csrfToken: csrfSecret.toString("base64url")
  };
}

/** Spärrar alla kontots giltiga sessioner (spärr av kontot, borttagning, återställning). */
export async function revokeAllUserAccountSessions(tx: DbExecutor, accountId: string, now: Date, reason: string): Promise<number> {
  const sessions = await tx.select({ id: schema.userAccountSessions.id }).from(schema.userAccountSessions)
    .leftJoin(schema.userAccountSessionRevocations,
      eq(schema.userAccountSessionRevocations.sessionId, schema.userAccountSessions.id))
    .where(and(eq(schema.userAccountSessions.accountId, accountId), gt(schema.userAccountSessions.expiresAt, now),
      isNull(schema.userAccountSessionRevocations.id)));
  for (const session of sessions) {
    await tx.insert(schema.userAccountSessionRevocations).values({ sessionId: session.id, revokedAt: now, reason });
  }
  return sessions.length;
}

export type UserAccountRegistrationResult =
  | { status: "invalid-request" | "conflict" | "rate-limited" }
  | Extract<UserAccountLoginResult, { status: "authenticated" }>;

export interface UserAccountRegistrationOptions extends UserAccountRuntimeOptions {
  /** Klientens adress (IP). Med adress räknas försöket mot `registrationsPerHour`. */
  clientKey?: string;
  registrationsPerHour?: number;
}

/**
 * Öppen registrering (ADR-0172 beslut 1). Skapar kontot och loggar in. Upptagen adress ger `conflict`,
 * för många försök från samma adress inom en timme ger `rate-limited`.
 */
export async function registerUserAccount(
  db: Database,
  request: unknown,
  options: UserAccountRegistrationOptions = {}
): Promise<UserAccountRegistrationResult> {
  const now = validDate(options.now ?? new Date());
  if (options.clientKey !== undefined) {
    const allowed = await db.transaction((tx) => consumeAccountRequestAllowance(tx, {
      scope: "REGISTER_IP", key: options.clientKey!, limit: options.registrationsPerHour ?? DEFAULT_REGISTRATIONS_PER_HOUR
    }, now));
    if (!allowed) return { status: "rate-limited" };
  }
  const parsed = organizerAccountRegistrationRequestSchema.safeParse(request);
  if (!parsed.success) return { status: "invalid-request" };
  const accountId = validUuid(options.accountId ?? randomUUID());
  const salt = bytes(options.saltBytes, 16);
  const verifier = await scryptVerifier(parsed.data.password, salt);
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(schema.userAccounts)
      .values({ id: accountId, email: parsed.data.email, displayName: parsed.data.displayName, createdAt: now, lastLoginAt: now })
      .onConflictDoNothing().returning();
    const account = inserted[0];
    if (!account) return { status: "conflict" } as const;
    await tx.insert(schema.userAccountPasswordVerifiers).values({
      accountId, version: 1, algorithm: "scrypt-v1", saltHex: salt.toString("hex"),
      verifierHex: verifier.toString("hex"), createdAt: now
    });
    return issueUserAccountSession(tx, account, 1, now, options);
  });
}

export async function loginUserAccount(
  db: Database,
  request: OrganizerAccountLoginRequest,
  options: UserAccountRuntimeOptions = {}
): Promise<UserAccountLoginResult> {
  const parsed = organizerAccountLoginRequestSchema.safeParse(request);
  if (!parsed.success) return { status: "unauthorized" };
  const now = validDate(options.now ?? new Date());
  const loginKeyHash = loginThrottleKey(parsed.data.email);
  return db.transaction(async (tx) => {
    await tx.insert(schema.userAccountLoginThrottles).values({
      loginKeyHash, windowStartedAt: now, failedAttempts: 0
    }).onConflictDoNothing();
    const [throttle] = await tx.select().from(schema.userAccountLoginThrottles)
      .where(eq(schema.userAccountLoginThrottles.loginKeyHash, loginKeyHash)).for("update");
    if (!throttle) throw new Error("Inloggningsspärr saknas");
    if (throttle.blockedUntil && throttle.blockedUntil.getTime() > now.getTime()) {
      return { status: "rate-limited" } as const;
    }
    const [account] = await tx.select().from(schema.userAccounts)
      .where(eq(schema.userAccounts.email, parsed.data.email)).for("update");
    const verifier = account ? await currentUserAccountVerifier(tx, account.id) : undefined;
    const passwordMatches = await userAccountPasswordMatches(verifier, parsed.data.password);
    if (!account || !verifier || !passwordMatches) {
      const inWindow = now.getTime() - throttle.windowStartedAt.getTime() < LOGIN_WINDOW_MS;
      const failedAttempts = inWindow ? throttle.failedAttempts + 1 : 1;
      await tx.update(schema.userAccountLoginThrottles).set({
        windowStartedAt: inWindow ? throttle.windowStartedAt : now,
        failedAttempts,
        blockedUntil: failedAttempts >= MAX_FAILED_ATTEMPTS ? new Date(now.getTime() + LOGIN_WINDOW_MS) : null
      }).where(eq(schema.userAccountLoginThrottles.loginKeyHash, loginKeyHash));
      return { status: "unauthorized" } as const;
    }
    await clearUserAccountLoginThrottle(tx, account.email, now);
    // Ett spärrat konto får veta det först när lösenordet stämmer.
    if (account.blockedAt) return { status: "blocked" } as const;
    await tx.update(schema.userAccounts).set({ lastLoginAt: now }).where(eq(schema.userAccounts.id, account.id));
    return issueUserAccountSession(tx, account, verifier.version, now, options);
  });
}

function loginThrottleKey(email: string): string {
  return sha256(`login\u0000${email}`);
}

/** Nollställer inloggningsspärren för adressen (lyckad inloggning eller nytt lösenord). */
export async function clearUserAccountLoginThrottle(tx: DbExecutor, email: string, now: Date): Promise<void> {
  await tx.update(schema.userAccountLoginThrottles).set({ windowStartedAt: now, failedAttempts: 0, blockedUntil: null })
    .where(eq(schema.userAccountLoginThrottles.loginKeyHash, loginThrottleKey(email)));
}

async function authorize(
  tx: DbExecutor,
  proof: UserAccountSessionProof,
  now: Date,
  lock: "none" | "share" | "update"
): Promise<UserAccountAuthenticationResult> {
  const parsed = parseToken(proof.sessionToken);
  const sessionQuery = tx.select().from(schema.userAccountSessions)
    .where(eq(schema.userAccountSessions.id, parsed?.id ?? DUMMY_ID));
  const [session] = lock === "share" ? await sessionQuery.for("share") :
    lock === "update" ? await sessionQuery.for("update") : await sessionQuery;
  if (!session || !parsed || !hashMatches(parsed.secret, session.sessionSecretHash)) return { status: "unauthorized" };
  const accountQuery = tx.select().from(schema.userAccounts).where(eq(schema.userAccounts.id, session.accountId));
  const [account] = lock === "share" ? await accountQuery.for("share") :
    lock === "update" ? await accountQuery.for("update") : await accountQuery;
  if (lock !== "none") {
    const guardQuery = tx.select({ accountId: schema.userAccountAuthGuards.accountId })
      .from(schema.userAccountAuthGuards).where(eq(schema.userAccountAuthGuards.accountId, session.accountId));
    const [guard] = lock === "share" ? await guardQuery.for("share") : await guardQuery.for("update");
    if (!guard) return { status: "unauthorized" };
  }
  const [currentVerifier] = await tx.select({ version: schema.userAccountPasswordVerifiers.version })
    .from(schema.userAccountPasswordVerifiers)
    .where(eq(schema.userAccountPasswordVerifiers.accountId, session.accountId))
    .orderBy(desc(schema.userAccountPasswordVerifiers.version)).limit(1);
  const [sessionRevocation] = await tx.select({ id: schema.userAccountSessionRevocations.id })
    .from(schema.userAccountSessionRevocations).where(eq(schema.userAccountSessionRevocations.sessionId, session.id)).limit(1);
  if (!account || !currentVerifier || account.blockedAt || sessionRevocation ||
    session.passwordVersion !== currentVerifier.version ||
    session.issuedAt.getTime() > now.getTime() || session.expiresAt.getTime() <= now.getTime()) {
    return { status: "unauthorized" };
  }
  if (proof.requireCsrf && !csrfMatches(proof.csrfCookie, proof.csrfHeader, session.csrfSecretHash)) {
    return { status: "forbidden" };
  }
  return { status: "authenticated", principal: {
    accountId: account.id, sessionId: session.id, email: account.email, displayName: account.displayName,
    superadmin: account.isSuperadmin, expiresAt: session.expiresAt.toISOString()
  } };
}

export async function authenticateUserAccountSession(
  db: Database,
  proof: UserAccountSessionProof,
  now = new Date()
): Promise<UserAccountAuthenticationResult> {
  return db.transaction((tx) => authorize(tx, proof, validDate(now), "share"));
}

export async function authenticateUserAccountSessionForMutation(
  tx: DatabaseTransaction,
  proof: UserAccountSessionProof,
  now = new Date()
): Promise<UserAccountAuthenticationResult> {
  return authorize(tx, proof, validDate(now), "update");
}

export async function authenticateUserAccountSessionForProtectedRead(
  tx: DatabaseTransaction,
  proof: UserAccountSessionProof,
  now = new Date()
): Promise<UserAccountAuthenticationResult> {
  return authorize(tx, proof, validDate(now), "share");
}

export async function logoutUserAccountSession(
  db: Database,
  proof: UserAccountSessionProof,
  now = new Date()
): Promise<{ status: "unauthorized" | "forbidden" | "logged-out" | "already-logged-out" }> {
  const loggedOutAt = validDate(now);
  return db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...proof, requireCsrf: true }, loggedOutAt);
    if (auth.status !== "authenticated") return auth;
    const [existing] = await tx.select({ id: schema.userAccountSessionRevocations.id })
      .from(schema.userAccountSessionRevocations)
      .where(eq(schema.userAccountSessionRevocations.sessionId, auth.principal.sessionId));
    if (existing) return { status: "already-logged-out" } as const;
    await tx.insert(schema.userAccountSessionRevocations).values({
      sessionId: auth.principal.sessionId, revokedAt: loggedOutAt, reason: "USER_LOGOUT"
    });
    return { status: "logged-out" } as const;
  });
}

/** Used by delegated race auth after its credential/session locks. */
export async function activeUserAccountParentSession(
  tx: DbExecutor,
  input: { accountId: string; sessionId: string },
  now: Date,
  lock: "none" | "share" | "update"
): Promise<boolean> {
  const sessionQuery = tx.select().from(schema.userAccountSessions)
    .where(and(eq(schema.userAccountSessions.id, input.sessionId),
      eq(schema.userAccountSessions.accountId, input.accountId)));
  const [session] = lock === "share" ? await sessionQuery.for("share") :
    lock === "update" ? await sessionQuery.for("update") : await sessionQuery;
  if (!session) return false;
  const guardQuery = tx.select({ accountId: schema.userAccountAuthGuards.accountId })
    .from(schema.userAccountAuthGuards).where(eq(schema.userAccountAuthGuards.accountId, input.accountId));
  if (lock !== "none") {
    const [guard] = lock === "share" ? await guardQuery.for("share") : await guardQuery.for("update");
    if (!guard) return false;
  }
  const [currentVerifier] = await tx.select({ version: schema.userAccountPasswordVerifiers.version })
    .from(schema.userAccountPasswordVerifiers)
    .where(eq(schema.userAccountPasswordVerifiers.accountId, input.accountId))
    .orderBy(desc(schema.userAccountPasswordVerifiers.version)).limit(1);
  const [account] = await tx.select({ blockedAt: schema.userAccounts.blockedAt }).from(schema.userAccounts)
    .where(eq(schema.userAccounts.id, input.accountId));
  const [revokedSession] = await tx.select({ id: schema.userAccountSessionRevocations.id })
    .from(schema.userAccountSessionRevocations).where(eq(schema.userAccountSessionRevocations.sessionId, input.sessionId));
  return Boolean(currentVerifier && currentVerifier.version === session.passwordVersion &&
    account && !account.blockedAt && !revokedSession &&
    session.issuedAt.getTime() <= now.getTime() && session.expiresAt.getTime() > now.getTime());
}

import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  organizerAccountLoginRequestSchema,
  organizerAccountLoginResponseSchema,
  type OrganizerAccountLoginRequest,
  type OrganizerAccountLoginResponse
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";

const TOKEN_PREFIX = "otid_user_session_v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const LOGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,79}$/;
const DUMMY_ID = "00000000-0000-4000-8000-000000000000";
const DUMMY_SALT = Buffer.alloc(16);
const DUMMY_HASH = Buffer.alloc(32);
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const SCRYPT_OPTIONS = { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 } as const;

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
interface ParsedToken { id: string; secret: Buffer }

export interface UserAccountPrincipal {
  accountId: string;
  sessionId: string;
  displayName: string;
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
  | { status: "unauthorized" }
  | { status: "authenticated"; response: OrganizerAccountLoginResponse; sessionToken: string; csrfToken: string };

export interface UserAccountRuntimeOptions {
  now?: Date;
  accountId?: string;
  passwordBytes?: Uint8Array;
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

/** Shared verifier policy for trusted provisioning and invitation activation. */
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

function normalizedLoginName(value: string): string {
  const result = value.trim().toLowerCase();
  if (!LOGIN_NAME_PATTERN.test(result)) throw new Error("Ogiltigt inloggningsnamn");
  return result;
}

/** Trusted provisioning only. Never return this plaintext secret to a browser route. */
export async function provisionUserAccount(
  db: Database,
  input: { loginName: string; displayName: string },
  options: UserAccountRuntimeOptions = {}
): Promise<{ accountId: string; loginName: string; initialPassword: string }> {
  const loginName = normalizedLoginName(input.loginName);
  const displayName = input.displayName.trim();
  if (displayName.length < 1 || displayName.length > 120) throw new Error("Ogiltigt visningsnamn");
  const accountId = validUuid(options.accountId ?? randomUUID());
  const now = validDate(options.now ?? new Date());
  const initialPassword = bytes(options.passwordBytes, 32).toString("base64url");
  const salt = bytes(options.saltBytes, 16);
  const verifier = await scryptVerifier(initialPassword, salt);
  await db.transaction(async (tx) => {
    await tx.insert(schema.userAccounts).values({ id: accountId, loginName, displayName, createdAt: now });
    await tx.insert(schema.userAccountPasswordVerifiers).values({
      accountId, version: 1, algorithm: "scrypt-v1", saltHex: salt.toString("hex"),
      verifierHex: verifier.toString("hex"), createdAt: now
    });
  });
  return { accountId, loginName, initialPassword };
}

/** Rotation invalidates all older sessions by advancing the verifier version. */
export async function rotateUserAccountPassword(
  db: Database,
  accountIdInput: string,
  options: UserAccountRuntimeOptions = {}
): Promise<{ accountId: string; password: string; version: number }> {
  const accountId = validUuid(accountIdInput);
  const now = validDate(options.now ?? new Date());
  const password = bytes(options.passwordBytes, 32).toString("base64url");
  const salt = bytes(options.saltBytes, 16);
  const verifier = await scryptVerifier(password, salt);
  const version = await db.transaction(async (tx) => {
    const [account] = await tx.select({ id: schema.userAccounts.id }).from(schema.userAccounts)
      .where(eq(schema.userAccounts.id, accountId)).for("update");
    if (!account) throw new Error("Kontot finns inte");
    const [revocation] = await tx.select({ id: schema.userAccountRevocations.id })
      .from(schema.userAccountRevocations).where(eq(schema.userAccountRevocations.accountId, accountId));
    if (revocation) throw new Error("Kontot är spärrat");
    const [current] = await tx.select({ version: schema.userAccountPasswordVerifiers.version })
      .from(schema.userAccountPasswordVerifiers).where(eq(schema.userAccountPasswordVerifiers.accountId, accountId))
      .orderBy(desc(schema.userAccountPasswordVerifiers.version)).limit(1);
    if (!current || current.version >= 2_147_483_647) throw new Error("Verifierarversion saknas eller är full");
    const next = current.version + 1;
    await tx.insert(schema.userAccountPasswordVerifiers).values({
      accountId, version: next, algorithm: "scrypt-v1", saltHex: salt.toString("hex"),
      verifierHex: verifier.toString("hex"), createdAt: now
    });
    return next;
  });
  return { accountId, password, version };
}

export async function loginUserAccount(
  db: Database,
  request: OrganizerAccountLoginRequest,
  options: UserAccountRuntimeOptions = {}
): Promise<UserAccountLoginResult> {
  const parsed = organizerAccountLoginRequestSchema.safeParse(request);
  if (!parsed.success) return { status: "unauthorized" };
  const now = validDate(options.now ?? new Date());
  const loginKeyHash = sha256(parsed.data.loginName);
  return db.transaction(async (tx) => {
    await tx.insert(schema.userAccountLoginThrottles).values({
      loginKeyHash, windowStartedAt: now, failedAttempts: 0
    }).onConflictDoNothing();
    const [throttle] = await tx.select().from(schema.userAccountLoginThrottles)
      .where(eq(schema.userAccountLoginThrottles.loginKeyHash, loginKeyHash)).for("update");
    if (!throttle) throw new Error("Inloggningsspärr saknas");
    if (throttle.blockedUntil && throttle.blockedUntil.getTime() > now.getTime()) {
      return { status: "unauthorized" } as const;
    }
    const [account] = await tx.select().from(schema.userAccounts)
      .where(eq(schema.userAccounts.loginName, parsed.data.loginName)).for("share");
    const [verifier] = account ? await tx.select().from(schema.userAccountPasswordVerifiers)
      .where(eq(schema.userAccountPasswordVerifiers.accountId, account.id))
      .orderBy(desc(schema.userAccountPasswordVerifiers.version)).limit(1) : [];
    const derived = await scryptVerifier(parsed.data.password,
      verifier?.saltHex ? Buffer.from(verifier.saltHex, "hex") : DUMMY_SALT);
    const expected = verifier?.verifierHex && HASH_PATTERN.test(verifier.verifierHex)
      ? Buffer.from(verifier.verifierHex, "hex") : DUMMY_HASH;
    const passwordMatches = timingSafeEqual(derived, expected);
    const [revocation] = account ? await tx.select({ id: schema.userAccountRevocations.id })
      .from(schema.userAccountRevocations).where(eq(schema.userAccountRevocations.accountId, account.id)) : [];
    if (!account || !verifier || !passwordMatches || revocation) {
      const inWindow = now.getTime() - throttle.windowStartedAt.getTime() < LOGIN_WINDOW_MS;
      const failedAttempts = inWindow ? throttle.failedAttempts + 1 : 1;
      await tx.update(schema.userAccountLoginThrottles).set({
        windowStartedAt: inWindow ? throttle.windowStartedAt : now,
        failedAttempts,
        blockedUntil: failedAttempts >= MAX_FAILED_ATTEMPTS ? new Date(now.getTime() + LOGIN_WINDOW_MS) : null
      }).where(eq(schema.userAccountLoginThrottles.loginKeyHash, loginKeyHash));
      return { status: "unauthorized" } as const;
    }
    await tx.update(schema.userAccountLoginThrottles).set({
      windowStartedAt: now, failedAttempts: 0, blockedUntil: null
    }).where(eq(schema.userAccountLoginThrottles.loginKeyHash, loginKeyHash));
    const sessionId = validUuid(options.sessionId ?? randomUUID());
    const sessionSecret = bytes(options.sessionSecretBytes, 32);
    const csrfSecret = bytes(options.csrfSecretBytes, 32);
    const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
    await tx.insert(schema.userAccountSessions).values({
      id: sessionId, accountId: account.id, passwordVersion: verifier.version,
      sessionSecretHash: sha256(sessionSecret), csrfSecretHash: sha256(csrfSecret), issuedAt: now, expiresAt
    });
    return {
      status: "authenticated" as const,
      response: organizerAccountLoginResponseSchema.parse({
        formatVersion: 1, accountId: account.id,
        displayName: account.displayName, expiresAt: expiresAt.toISOString()
      }),
      sessionToken: token(sessionId, sessionSecret),
      csrfToken: csrfSecret.toString("base64url")
    };
  });
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
  const [accountRevocation] = await tx.select({ id: schema.userAccountRevocations.id })
    .from(schema.userAccountRevocations).where(eq(schema.userAccountRevocations.accountId, session.accountId)).limit(1);
  const [sessionRevocation] = await tx.select({ id: schema.userAccountSessionRevocations.id })
    .from(schema.userAccountSessionRevocations).where(eq(schema.userAccountSessionRevocations.sessionId, session.id)).limit(1);
  if (!account || !currentVerifier || accountRevocation || sessionRevocation ||
    session.passwordVersion !== currentVerifier.version ||
    session.issuedAt.getTime() > now.getTime() || session.expiresAt.getTime() <= now.getTime()) {
    return { status: "unauthorized" };
  }
  if (proof.requireCsrf && !csrfMatches(proof.csrfCookie, proof.csrfHeader, session.csrfSecretHash)) {
    return { status: "forbidden" };
  }
  return { status: "authenticated", principal: {
    accountId: account.id, sessionId: session.id, displayName: account.displayName,
    expiresAt: session.expiresAt.toISOString()
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
  const [revokedAccount] = await tx.select({ id: schema.userAccountRevocations.id })
    .from(schema.userAccountRevocations).where(eq(schema.userAccountRevocations.accountId, input.accountId));
  const [revokedSession] = await tx.select({ id: schema.userAccountSessionRevocations.id })
    .from(schema.userAccountSessionRevocations).where(eq(schema.userAccountSessionRevocations.sessionId, input.sessionId));
  return Boolean(currentVerifier && currentVerifier.version === session.passwordVersion &&
    !revokedAccount && !revokedSession &&
    session.issuedAt.getTime() <= now.getTime() && session.expiresAt.getTime() > now.getTime());
}

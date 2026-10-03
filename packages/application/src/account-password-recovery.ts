import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  accountPasswordRecoveryIssueInputSchema,
  accountPasswordRecoveryIssueResponseSchema,
  accountPasswordRecoveryRedeemRequestSchema,
  accountPasswordRecoveryRedeemResponseSchema,
  accountPasswordRecoveryRevokeInputSchema,
  accountPasswordRecoveryRevokeResponseSchema,
  accountPasswordRecoveryStatusResponseSchema,
  type AccountPasswordRecoveryIssueResponse,
  type AccountPasswordRecoveryRedeemResponse,
  type AccountPasswordRecoveryRevokeResponse,
  type AccountPasswordRecoveryStatusResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { scryptVerifier } from "./user-account";

const MAX_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1_000;
const MAX_FAILED_ATTEMPTS = 5;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type TrustedFailure = { status: "invalid-request" | "conflict" | "not-found" };
type RedeemFailure = { status: "invalid-request" | "invalid" | "conflict" };

export interface PasswordRecoveryRedeemOptions {
  now?: Date;
  redemptionId?: string;
  saltBytes?: Uint8Array;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function validNow(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

async function lockRequest(tx: Tx, requestId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
}

async function failedAttempt(
  tx: Tx, throttle: typeof schema.accountPasswordRecoveryThrottles.$inferSelect, now: Date
): Promise<void> {
  const inWindow = now.getTime() - throttle.windowStartedAt.getTime() < ATTEMPT_WINDOW_MS;
  const failedAttempts = inWindow ? throttle.failedAttempts + 1 : 1;
  await tx.update(schema.accountPasswordRecoveryThrottles).set({
    windowStartedAt: inWindow ? throttle.windowStartedAt : now,
    failedAttempts,
    blockedUntil: failedAttempts >= MAX_FAILED_ATTEMPTS
      ? new Date(now.getTime() + ATTEMPT_WINDOW_MS) : null
  }).where(eq(schema.accountPasswordRecoveryThrottles.loginKeyHash, throttle.loginKeyHash));
}

function issueResponse(
  issue: typeof schema.accountPasswordRecoveryIssues.$inferSelect
): AccountPasswordRecoveryIssueResponse {
  return accountPasswordRecoveryIssueResponseSchema.parse({
    formatVersion: 1, recoveryId: issue.id, accountId: issue.accountId,
    loginName: issue.loginName, expiresAt: issue.expiresAt.toISOString()
  });
}

function revokeResponse(recoveryId: string): AccountPasswordRecoveryRevokeResponse {
  return accountPasswordRecoveryRevokeResponseSchema.parse({
    formatVersion: 1, recoveryId, status: "REVOKED"
  });
}

function redeemResponse(
  issue: typeof schema.accountPasswordRecoveryIssues.$inferSelect, passwordVersion: number
): AccountPasswordRecoveryRedeemResponse {
  return accountPasswordRecoveryRedeemResponseSchema.parse({
    formatVersion: 1, accountId: issue.accountId,
    loginName: issue.loginName, passwordVersion
  });
}

/** Trusted server operation only; never accepts or returns the plaintext code. */
export async function issueAccountPasswordRecovery(
  db: Database, input: unknown, now = new Date()
): Promise<TrustedFailure | { status: "issued"; response: AccountPasswordRecoveryIssueResponse }> {
  const parsed = accountPasswordRecoveryIssueInputSchema.safeParse(input);
  if (!parsed.success || !validNow(now)) return { status: "invalid-request" };
  const request = parsed.data;
  const expiresAt = new Date(request.expiresAt);
  if (!validNow(expiresAt)) return { status: "invalid-request" };
  return db.transaction(async (tx) => {
    await lockRequest(tx, request.requestId);
    const [replayed] = await tx.select().from(schema.accountPasswordRecoveryIssues)
      .where(eq(schema.accountPasswordRecoveryIssues.requestId, request.requestId));
    if (replayed) {
      if (replayed.accountId !== request.accountId || replayed.loginName !== request.loginName ||
        replayed.operatorLabel !== request.operatorLabel || replayed.reason !== request.reason ||
        replayed.codeHash !== request.codeHash || replayed.expiresAt.getTime() !== expiresAt.getTime()) {
        return { status: "conflict" } as const;
      }
      return { status: "issued", response: issueResponse(replayed) } as const;
    }
    if (expiresAt.getTime() <= now.getTime() ||
      expiresAt.getTime() > now.getTime() + MAX_LIFETIME_MS) return { status: "invalid-request" } as const;
    const [account] = await tx.select().from(schema.userAccounts)
      .where(eq(schema.userAccounts.id, request.accountId)).for("update");
    if (!account || account.loginName !== request.loginName) return { status: "not-found" } as const;
    const [revoked] = await tx.select({ id: schema.userAccountRevocations.id })
      .from(schema.userAccountRevocations)
      .where(eq(schema.userAccountRevocations.accountId, account.id));
    if (revoked) return { status: "not-found" } as const;
    const [verifier] = await tx.select({ version: schema.userAccountPasswordVerifiers.version })
      .from(schema.userAccountPasswordVerifiers)
      .where(eq(schema.userAccountPasswordVerifiers.accountId, account.id))
      .orderBy(desc(schema.userAccountPasswordVerifiers.version)).limit(1);
    if (!verifier || verifier.version >= 2_147_483_647) return { status: "conflict" } as const;
    const [active] = await tx.select({ id: schema.accountPasswordRecoveryIssues.id })
      .from(schema.accountPasswordRecoveryIssues)
      .leftJoin(schema.accountPasswordRecoveryRevocations,
        eq(schema.accountPasswordRecoveryRevocations.recoveryId, schema.accountPasswordRecoveryIssues.id))
      .leftJoin(schema.accountPasswordRecoveryRedemptions,
        eq(schema.accountPasswordRecoveryRedemptions.recoveryId, schema.accountPasswordRecoveryIssues.id))
      .where(and(eq(schema.accountPasswordRecoveryIssues.accountId, account.id),
        gt(schema.accountPasswordRecoveryIssues.expiresAt, now),
        isNull(schema.accountPasswordRecoveryRevocations.id),
        isNull(schema.accountPasswordRecoveryRedemptions.id))).limit(1);
    if (active) return { status: "conflict" } as const;
    const [issue] = await tx.insert(schema.accountPasswordRecoveryIssues).values({
      id: randomUUID(), requestId: request.requestId, accountId: account.id,
      loginName: account.loginName, operatorLabel: request.operatorLabel,
      reason: request.reason, codeHash: request.codeHash,
      expectedPasswordVersion: verifier.version, issuedAt: now, expiresAt
    }).returning();
    if (!issue) throw new Error("Återställningsutfärdande saknas efter skrivning");
    return { status: "issued", response: issueResponse(issue) } as const;
  });
}

/** Trusted metadata only; this must never be put on an unauthenticated route. */
export async function accountPasswordRecoveryStatus(
  db: Database, recoveryId: string, now = new Date()
): Promise<TrustedFailure | { status: "ok"; response: AccountPasswordRecoveryStatusResponse }> {
  if (!UUID_PATTERN.test(recoveryId) || !validNow(now)) return { status: "invalid-request" };
  const [row] = await db.select({ issue: schema.accountPasswordRecoveryIssues,
    revocationId: schema.accountPasswordRecoveryRevocations.id,
    redemptionId: schema.accountPasswordRecoveryRedemptions.id })
    .from(schema.accountPasswordRecoveryIssues)
    .leftJoin(schema.accountPasswordRecoveryRevocations,
      eq(schema.accountPasswordRecoveryRevocations.recoveryId, schema.accountPasswordRecoveryIssues.id))
    .leftJoin(schema.accountPasswordRecoveryRedemptions,
      eq(schema.accountPasswordRecoveryRedemptions.recoveryId, schema.accountPasswordRecoveryIssues.id))
    .where(eq(schema.accountPasswordRecoveryIssues.id, recoveryId));
  if (!row) return { status: "not-found" };
  const status = row.redemptionId ? "REDEEMED" : row.revocationId ? "REVOKED" :
    row.issue.expiresAt.getTime() <= now.getTime() ? "EXPIRED" : "PENDING";
  return { status: "ok", response: accountPasswordRecoveryStatusResponseSchema.parse({
    formatVersion: 1, recoveryId: row.issue.id, accountId: row.issue.accountId,
    loginName: row.issue.loginName, issuedAt: row.issue.issuedAt.toISOString(),
    expiresAt: row.issue.expiresAt.toISOString(), status
  }) };
}

/** Trusted revocation only; redemption cannot be undone by deleting history. */
export async function revokeAccountPasswordRecovery(
  db: Database, input: unknown, now = new Date()
): Promise<TrustedFailure | { status: "revoked"; response: AccountPasswordRecoveryRevokeResponse }> {
  const parsed = accountPasswordRecoveryRevokeInputSchema.safeParse(input);
  if (!parsed.success || !validNow(now)) return { status: "invalid-request" };
  const request = parsed.data;
  return db.transaction(async (tx) => {
    await lockRequest(tx, request.requestId);
    const [replayed] = await tx.select().from(schema.accountPasswordRecoveryRevocations)
      .where(eq(schema.accountPasswordRecoveryRevocations.requestId, request.requestId));
    if (replayed) {
      if (replayed.recoveryId !== request.recoveryId || replayed.operatorLabel !== request.operatorLabel ||
        replayed.reason !== request.reason) return { status: "conflict" } as const;
      return { status: "revoked", response: revokeResponse(replayed.recoveryId) } as const;
    }
    const [issue] = await tx.select().from(schema.accountPasswordRecoveryIssues)
      .where(eq(schema.accountPasswordRecoveryIssues.id, request.recoveryId));
    if (!issue) return { status: "not-found" } as const;
    const [account] = await tx.select({ id: schema.userAccounts.id }).from(schema.userAccounts)
      .where(eq(schema.userAccounts.id, issue.accountId)).for("update");
    if (!account) return { status: "not-found" } as const;
    const [redeemed] = await tx.select({ id: schema.accountPasswordRecoveryRedemptions.id })
      .from(schema.accountPasswordRecoveryRedemptions)
      .where(eq(schema.accountPasswordRecoveryRedemptions.recoveryId, issue.id));
    const [revoked] = await tx.select({ id: schema.accountPasswordRecoveryRevocations.id })
      .from(schema.accountPasswordRecoveryRevocations)
      .where(eq(schema.accountPasswordRecoveryRevocations.recoveryId, issue.id));
    if (redeemed || revoked) return { status: "conflict" } as const;
    await tx.insert(schema.accountPasswordRecoveryRevocations).values({
      id: randomUUID(), requestId: request.requestId, recoveryId: issue.id,
      operatorLabel: request.operatorLabel, reason: request.reason, revokedAt: now
    });
    return { status: "revoked", response: revokeResponse(issue.id) } as const;
  });
}

/** Public redemption of a pre-issued code; no current account session required. */
export async function redeemAccountPasswordRecovery(
  db: Database, input: unknown, options: PasswordRecoveryRedeemOptions = {}
): Promise<RedeemFailure | { status: "recovered"; response: AccountPasswordRecoveryRedeemResponse }> {
  const parsed = accountPasswordRecoveryRedeemRequestSchema.safeParse(input);
  const now = options.now ?? new Date();
  if (!parsed.success || !validNow(now)) return { status: "invalid-request" };
  const request = parsed.data;
  const codeBytes = Buffer.from(request.code, "base64url");
  const codeHash = sha256(codeBytes);
  const intentHash = sha256(`${request.loginName}\u0000${request.password}`);
  const loginKeyHash = sha256(request.loginName);
  const redemptionId = options.redemptionId ?? randomUUID();
  const salt = options.saltBytes === undefined ? randomBytes(16) : Buffer.from(options.saltBytes);
  if (!UUID_PATTERN.test(redemptionId) || salt.length !== 16) return { status: "invalid-request" };
  return db.transaction(async (tx) => {
    await lockRequest(tx, request.requestId);
    const [replayed] = await tx.select({ redemption: schema.accountPasswordRecoveryRedemptions,
      issue: schema.accountPasswordRecoveryIssues })
      .from(schema.accountPasswordRecoveryRedemptions)
      .innerJoin(schema.accountPasswordRecoveryIssues,
        eq(schema.accountPasswordRecoveryIssues.id, schema.accountPasswordRecoveryRedemptions.recoveryId))
      .where(eq(schema.accountPasswordRecoveryRedemptions.requestId, request.requestId));
    if (replayed) {
      if (replayed.issue.loginName !== request.loginName || replayed.issue.codeHash !== codeHash ||
        replayed.redemption.intentHash !== intentHash) return { status: "conflict" } as const;
      return { status: "recovered", response: redeemResponse(replayed.issue,
        replayed.redemption.passwordVersion) } as const;
    }
    await tx.insert(schema.accountPasswordRecoveryThrottles).values({
      loginKeyHash, windowStartedAt: now, failedAttempts: 0
    }).onConflictDoNothing();
    const [throttle] = await tx.select().from(schema.accountPasswordRecoveryThrottles)
      .where(eq(schema.accountPasswordRecoveryThrottles.loginKeyHash, loginKeyHash)).for("update");
    if (!throttle) throw new Error("Återställningsspärr saknas");
    if (throttle.blockedUntil && throttle.blockedUntil.getTime() > now.getTime()) {
      return { status: "invalid" } as const;
    }
    const [issue] = await tx.select().from(schema.accountPasswordRecoveryIssues)
      .where(eq(schema.accountPasswordRecoveryIssues.codeHash, codeHash));
    if (!issue || issue.loginName !== request.loginName) {
      await failedAttempt(tx, throttle, now);
      return { status: "invalid" } as const;
    }
    const [account] = await tx.select().from(schema.userAccounts)
      .where(eq(schema.userAccounts.id, issue.accountId)).for("update");
    const [revocation] = await tx.select({ id: schema.accountPasswordRecoveryRevocations.id })
      .from(schema.accountPasswordRecoveryRevocations)
      .where(eq(schema.accountPasswordRecoveryRevocations.recoveryId, issue.id));
    const [redemption] = await tx.select({ id: schema.accountPasswordRecoveryRedemptions.id })
      .from(schema.accountPasswordRecoveryRedemptions)
      .where(eq(schema.accountPasswordRecoveryRedemptions.recoveryId, issue.id));
    const [accountRevocation] = account ? await tx.select({ id: schema.userAccountRevocations.id })
      .from(schema.userAccountRevocations)
      .where(eq(schema.userAccountRevocations.accountId, account.id)) : [];
    const [currentVerifier] = account ? await tx.select({ version: schema.userAccountPasswordVerifiers.version })
      .from(schema.userAccountPasswordVerifiers)
      .where(eq(schema.userAccountPasswordVerifiers.accountId, account.id))
      .orderBy(desc(schema.userAccountPasswordVerifiers.version)).limit(1) : [];
    if (!account || account.loginName !== issue.loginName || accountRevocation || revocation || redemption ||
      issue.expiresAt.getTime() <= now.getTime() || issue.issuedAt.getTime() > now.getTime() ||
      !currentVerifier || currentVerifier.version !== issue.expectedPasswordVersion ||
      currentVerifier.version >= 2_147_483_647) {
      await failedAttempt(tx, throttle, now);
      return { status: "invalid" } as const;
    }
    const nextVersion = currentVerifier.version + 1;
    const verifier = await scryptVerifier(request.password, salt);
    await tx.insert(schema.userAccountPasswordVerifiers).values({
      accountId: account.id, version: nextVersion, algorithm: "scrypt-v1",
      saltHex: salt.toString("hex"), verifierHex: verifier.toString("hex"), createdAt: now
    });
    await tx.insert(schema.accountPasswordRecoveryRedemptions).values({
      id: redemptionId, requestId: request.requestId, recoveryId: issue.id,
      accountId: account.id, passwordVersion: nextVersion, intentHash, redeemedAt: now
    });
    await tx.update(schema.accountPasswordRecoveryThrottles).set({
      windowStartedAt: now, failedAttempts: 0, blockedUntil: null
    }).where(eq(schema.accountPasswordRecoveryThrottles.loginKeyHash, loginKeyHash));
    return { status: "recovered", response: redeemResponse(issue, nextVersion) } as const;
  });
}

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  accountInvitationActivationRequestSchema,
  accountInvitationActivationResponseSchema,
  accountInvitationIssueInputSchema,
  accountInvitationIssueResponseSchema,
  accountInvitationRevokeInputSchema,
  accountInvitationRevokeResponseSchema,
  accountInvitationStatusResponseSchema,
  type AccountInvitationActivationResponse,
  type AccountInvitationIssueInput,
  type AccountInvitationIssueResponse,
  type AccountInvitationRevokeInput,
  type AccountInvitationRevokeResponse,
  type AccountInvitationStatusResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { scryptVerifier } from "./user-account";

const MAX_LIFETIME_MS = 48 * 60 * 60 * 1_000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1_000;
const MAX_FAILED_ATTEMPTS = 5;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type AccountInvitationTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DatabaseTransaction = AccountInvitationTransaction;

type TrustedFailure = { status: "invalid-request" | "conflict" | "not-found" };
type ActivationFailure = { status: "invalid-request" | "invalid" | "conflict" };

export interface InvitationActivationOptions {
  now?: Date;
  accountId?: string;
  saltBytes?: Uint8Array;
  redemptionId?: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function validNow(now: Date): boolean {
  return Number.isFinite(now.getTime());
}

function issueResponse(issue: typeof schema.accountInvitationIssues.$inferSelect): AccountInvitationIssueResponse {
  return accountInvitationIssueResponseSchema.parse({
    formatVersion: 1, invitationId: issue.id,
    loginName: issue.loginName, expiresAt: issue.expiresAt.toISOString()
  });
}

function activationResponse(
  issue: typeof schema.accountInvitationIssues.$inferSelect,
  accountId: string
): AccountInvitationActivationResponse {
  return accountInvitationActivationResponseSchema.parse({
    formatVersion: 1, accountId, loginName: issue.loginName
  });
}

async function lockSubject(tx: DatabaseTransaction, loginName: string): Promise<void> {
  const [subject] = await tx.select({ loginName: schema.accountInvitationSubjects.loginName })
    .from(schema.accountInvitationSubjects)
    .where(eq(schema.accountInvitationSubjects.loginName, loginName)).for("update");
  if (!subject) throw new Error("Kontoinbjudningens namnreservation saknas");
}

async function lockRequest(tx: DatabaseTransaction, requestId: string): Promise<void> {
  // The durable request-id constraints remain authoritative; this serializes
  // two retries before either can observe the other's journal row.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
}

async function failedAttempt(
  tx: DatabaseTransaction,
  throttle: typeof schema.accountInvitationThrottles.$inferSelect,
  now: Date
): Promise<void> {
  const inWindow = now.getTime() - throttle.windowStartedAt.getTime() < ATTEMPT_WINDOW_MS;
  const failedAttempts = inWindow ? throttle.failedAttempts + 1 : 1;
  await tx.update(schema.accountInvitationThrottles).set({
    windowStartedAt: inWindow ? throttle.windowStartedAt : now,
    failedAttempts,
    blockedUntil: failedAttempts >= MAX_FAILED_ATTEMPTS
      ? new Date(now.getTime() + ATTEMPT_WINDOW_MS) : null
  }).where(eq(schema.accountInvitationThrottles.loginKeyHash, throttle.loginKeyHash));
}

/** Internal transaction primitive; callers must authorize their own issuer. */
export async function issueAccountInvitationInTransaction(
  tx: AccountInvitationTransaction, request: AccountInvitationIssueInput, now: Date
): Promise<TrustedFailure | { status: "issued"; response: AccountInvitationIssueResponse }> {
  if (!validNow(now)) return { status: "invalid-request" };
  const expiresAt = new Date(request.expiresAt);
  if (!Number.isFinite(expiresAt.getTime())) return { status: "invalid-request" };
    await lockRequest(tx, request.requestId);
    const [existing] = await tx.select().from(schema.accountInvitationIssues)
      .where(eq(schema.accountInvitationIssues.requestId, request.requestId));
    if (existing) {
      if (existing.loginName !== request.loginName || existing.displayName !== request.displayName ||
        existing.operatorLabel !== request.operatorLabel || existing.codeHash !== request.codeHash ||
        existing.expiresAt.getTime() !== expiresAt.getTime()) return { status: "conflict" } as const;
      return { status: "issued", response: issueResponse(existing) } as const;
    }
    if (expiresAt.getTime() <= now.getTime() ||
      expiresAt.getTime() > now.getTime() + MAX_LIFETIME_MS) return { status: "invalid-request" } as const;
    await tx.insert(schema.accountInvitationSubjects).values({
      loginName: request.loginName, generation: 0n, createdAt: now
    }).onConflictDoNothing();
    await lockSubject(tx, request.loginName);
    const [account] = await tx.select({ id: schema.userAccounts.id }).from(schema.userAccounts)
      .where(eq(schema.userAccounts.loginName, request.loginName)).limit(1);
    if (account) return { status: "conflict" } as const;
    const [active] = await tx.select({ id: schema.accountInvitationIssues.id })
      .from(schema.accountInvitationIssues)
      .leftJoin(schema.accountInvitationRevocations,
        eq(schema.accountInvitationRevocations.invitationId, schema.accountInvitationIssues.id))
      .leftJoin(schema.accountInvitationRedemptions,
        eq(schema.accountInvitationRedemptions.invitationId, schema.accountInvitationIssues.id))
      .where(and(
        eq(schema.accountInvitationIssues.loginName, request.loginName),
        gt(schema.accountInvitationIssues.expiresAt, now),
        isNull(schema.accountInvitationRevocations.id),
        isNull(schema.accountInvitationRedemptions.id)
      )).limit(1);
    if (active) return { status: "conflict" } as const;
    const [issue] = await tx.insert(schema.accountInvitationIssues).values({
      id: randomUUID(), requestId: request.requestId, codeHash: request.codeHash,
      loginName: request.loginName, displayName: request.displayName,
      operatorLabel: request.operatorLabel, issuedAt: now, expiresAt
    }).returning();
    if (!issue) throw new Error("Kontoinbjudan kunde inte sparas");
    return { status: "issued", response: issueResponse(issue) } as const;
}

/** Trusted server environment only; this operation never sees the plaintext code. */
export async function issueAccountInvitation(
  db: Database, input: unknown, now = new Date()
): Promise<TrustedFailure | { status: "issued"; response: AccountInvitationIssueResponse }> {
  const parsed = accountInvitationIssueInputSchema.safeParse(input);
  if (!parsed.success || !validNow(now)) return { status: "invalid-request" };
  return db.transaction(tx => issueAccountInvitationInTransaction(tx, parsed.data, now));
}

/** Trusted status view with no code/hash; never expose this through a public route. */
export async function accountInvitationStatus(
  db: Database, invitationId: string, now = new Date()
): Promise<TrustedFailure | { status: "ok"; response: AccountInvitationStatusResponse }> {
  if (!UUID_PATTERN.test(invitationId) || !validNow(now)) return { status: "invalid-request" };
  const [row] = await db.select({
    issue: schema.accountInvitationIssues,
    revocationId: schema.accountInvitationRevocations.id,
    redemptionId: schema.accountInvitationRedemptions.id
  }).from(schema.accountInvitationIssues)
    .leftJoin(schema.accountInvitationRevocations,
      eq(schema.accountInvitationRevocations.invitationId, schema.accountInvitationIssues.id))
    .leftJoin(schema.accountInvitationRedemptions,
      eq(schema.accountInvitationRedemptions.invitationId, schema.accountInvitationIssues.id))
    .where(eq(schema.accountInvitationIssues.id, invitationId));
  if (!row) return { status: "not-found" };
  const status = row.redemptionId ? "REDEEMED" : row.revocationId ? "REVOKED" :
    row.issue.expiresAt.getTime() <= now.getTime() ? "EXPIRED" : "PENDING";
  return { status: "ok", response: accountInvitationStatusResponseSchema.parse({
    formatVersion: 1, invitationId: row.issue.id,
    loginName: row.issue.loginName, displayName: row.issue.displayName,
    issuedAt: row.issue.issuedAt.toISOString(), expiresAt: row.issue.expiresAt.toISOString(), status
  }) };
}

/** Internal transaction primitive; caller must authorize revocation scope. */
export async function revokeAccountInvitationInTransaction(
  tx: AccountInvitationTransaction, request: AccountInvitationRevokeInput, now: Date
): Promise<TrustedFailure | { status: "revoked"; response: AccountInvitationRevokeResponse }> {
    if (!validNow(now)) return { status: "invalid-request" };
    await lockRequest(tx, request.requestId);
    const [replayed] = await tx.select().from(schema.accountInvitationRevocations)
      .where(eq(schema.accountInvitationRevocations.requestId, request.requestId));
    if (replayed) {
      if (replayed.invitationId !== request.invitationId || replayed.operatorLabel !== request.operatorLabel ||
        replayed.reason !== request.reason) return { status: "conflict" } as const;
      return { status: "revoked", response: accountInvitationRevokeResponseSchema.parse({
        formatVersion: 1, invitationId: replayed.invitationId, status: "REVOKED"
      }) } as const;
    }
    const [issue] = await tx.select().from(schema.accountInvitationIssues)
      .where(eq(schema.accountInvitationIssues.id, request.invitationId));
    if (!issue) return { status: "not-found" } as const;
    await lockSubject(tx, issue.loginName);
    const [redeemed] = await tx.select({ id: schema.accountInvitationRedemptions.id })
      .from(schema.accountInvitationRedemptions)
      .where(eq(schema.accountInvitationRedemptions.invitationId, issue.id));
    const [revoked] = await tx.select({ id: schema.accountInvitationRevocations.id })
      .from(schema.accountInvitationRevocations)
      .where(eq(schema.accountInvitationRevocations.invitationId, issue.id));
    if (redeemed || revoked) return { status: "conflict" } as const;
    await tx.insert(schema.accountInvitationRevocations).values({
      id: randomUUID(), requestId: request.requestId, invitationId: issue.id,
      operatorLabel: request.operatorLabel, reason: request.reason, revokedAt: now
    });
    return { status: "revoked", response: accountInvitationRevokeResponseSchema.parse({
      formatVersion: 1, invitationId: issue.id, status: "REVOKED"
    }) } as const;
}

/** Trusted revocation only; an already activated account requires account revocation instead. */
export async function revokeAccountInvitation(
  db: Database, input: unknown, now = new Date()
): Promise<TrustedFailure | { status: "revoked"; response: AccountInvitationRevokeResponse }> {
  const parsed = accountInvitationRevokeInputSchema.safeParse(input);
  if (!parsed.success || !validNow(now)) return { status: "invalid-request" };
  return db.transaction(tx => revokeAccountInvitationInTransaction(tx, parsed.data, now));
}

/** Unauthenticated but narrowly scoped to creating the invited account. */
export async function activateAccountInvitation(
  db: Database, input: unknown, options: InvitationActivationOptions = {}
): Promise<ActivationFailure | { status: "activated"; response: AccountInvitationActivationResponse }> {
  const parsed = accountInvitationActivationRequestSchema.safeParse(input);
  const now = options.now ?? new Date();
  if (!parsed.success || !validNow(now)) return { status: "invalid-request" };
  const request = parsed.data;
  const codeBytes = Buffer.from(request.code, "base64url");
  const codeHash = sha256(codeBytes);
  const intentHash = sha256(`${request.loginName}\u0000${request.password}`);
  const loginKeyHash = sha256(request.loginName);
  const accountId = options.accountId ?? randomUUID();
  const redemptionId = options.redemptionId ?? randomUUID();
  const salt = options.saltBytes === undefined ? randomBytes(16) : Buffer.from(options.saltBytes);
  if (!UUID_PATTERN.test(accountId) || !UUID_PATTERN.test(redemptionId) || salt.length !== 16) {
    return { status: "invalid-request" };
  }

  return db.transaction(async (tx) => {
    await lockRequest(tx, request.requestId);
    const [replayed] = await tx.select({
      redemption: schema.accountInvitationRedemptions,
      issue: schema.accountInvitationIssues
    }).from(schema.accountInvitationRedemptions)
      .innerJoin(schema.accountInvitationIssues,
        eq(schema.accountInvitationIssues.id, schema.accountInvitationRedemptions.invitationId))
      .where(eq(schema.accountInvitationRedemptions.requestId, request.requestId));
    if (replayed) {
      if (replayed.issue.loginName !== request.loginName || replayed.issue.codeHash !== codeHash ||
        replayed.redemption.intentHash !== intentHash) return { status: "conflict" } as const;
      return { status: "activated", response: activationResponse(replayed.issue, replayed.redemption.accountId) } as const;
    }

    await tx.insert(schema.accountInvitationThrottles).values({
      loginKeyHash, windowStartedAt: now, failedAttempts: 0
    }).onConflictDoNothing();
    const [throttle] = await tx.select().from(schema.accountInvitationThrottles)
      .where(eq(schema.accountInvitationThrottles.loginKeyHash, loginKeyHash)).for("update");
    if (!throttle) throw new Error("Aktiveringsspärr saknas");
    if (throttle.blockedUntil && throttle.blockedUntil.getTime() > now.getTime()) {
      return { status: "invalid" } as const;
    }
    const [issue] = await tx.select().from(schema.accountInvitationIssues)
      .where(eq(schema.accountInvitationIssues.codeHash, codeHash));
    if (!issue || issue.loginName !== request.loginName) {
      await failedAttempt(tx, throttle, now);
      return { status: "invalid" } as const;
    }
    await lockSubject(tx, issue.loginName);
    const [revocation] = await tx.select({ id: schema.accountInvitationRevocations.id })
      .from(schema.accountInvitationRevocations)
      .where(eq(schema.accountInvitationRevocations.invitationId, issue.id));
    const [redemption] = await tx.select({ id: schema.accountInvitationRedemptions.id })
      .from(schema.accountInvitationRedemptions)
      .where(eq(schema.accountInvitationRedemptions.invitationId, issue.id));
    const [existingAccount] = await tx.select({ id: schema.userAccounts.id })
      .from(schema.userAccounts).where(eq(schema.userAccounts.loginName, issue.loginName));
    if (revocation || redemption || existingAccount || issue.expiresAt.getTime() <= now.getTime()) {
      await failedAttempt(tx, throttle, now);
      return { status: "invalid" } as const;
    }
    const verifier = await scryptVerifier(request.password, salt);
    await tx.insert(schema.userAccounts).values({
      id: accountId, loginName: issue.loginName, displayName: issue.displayName, createdAt: now
    });
    await tx.insert(schema.userAccountPasswordVerifiers).values({
      accountId, version: 1, algorithm: "scrypt-v1", saltHex: salt.toString("hex"),
      verifierHex: verifier.toString("hex"), createdAt: now
    });
    await tx.insert(schema.accountInvitationRedemptions).values({
      id: redemptionId, requestId: request.requestId, invitationId: issue.id,
      accountId, intentHash, redeemedAt: now
    });
    await tx.update(schema.accountInvitationThrottles).set({
      windowStartedAt: now, failedAttempts: 0, blockedUntil: null
    }).where(eq(schema.accountInvitationThrottles.loginKeyHash, loginKeyHash));
    return { status: "activated", response: activationResponse(issue, accountId) } as const;
  });
}

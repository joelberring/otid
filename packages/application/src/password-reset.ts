import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { passwordResetCompleteRequestSchema, passwordResetRequestSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import {
  consumeAccountRequestAllowance,
  RESET_REQUESTS_PER_EMAIL_AND_HOUR,
  RESET_REQUESTS_PER_IP_AND_HOUR
} from "./account-throttle";
import {
  appendUserAccountPasswordVerifier,
  clearUserAccountLoginThrottle,
  currentUserAccountVerifier,
  revokeAllUserAccountSessions
} from "./user-account";

/**
 * Glömt lösenord (ADR-0172 beslut 1). En återställningslänk bär en slumpad engångsnyckel; bara dess hash
 * sparas. Länken gäller en timme och en gång. När lösenordet byts slutar alla kontots sessioner gälla.
 */
export const PASSWORD_RESET_LIFETIME_MS = 60 * 60 * 1000;

export interface PasswordResetDelivery {
  accountId: string;
  email: string;
  displayName: string;
  token: string;
  expiresAt: Date;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Ny engångsnyckel för kontot. Anroparen visar eller skickar den; den sparas aldrig i klartext. */
export async function createPasswordResetToken(
  tx: DbExecutor,
  input: { accountId: string; bySuperadmin: boolean },
  now: Date
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_LIFETIME_MS);
  await tx.insert(schema.passwordResetTokens).values({
    accountId: input.accountId, tokenHash: sha256(token), createdAt: now, expiresAt,
    createdBySuperadmin: input.bySuperadmin
  });
  return { token, expiresAt };
}

/**
 * Begäran från sidan "Glömt lösenord". Svaret är detsamma oavsett om adressen har ett konto; bara när
 * kontot finns, inte är spärrat och spärren mot upprepade försök tillåter finns `delivery` att skicka.
 */
export async function requestPasswordReset(
  db: Database,
  request: unknown,
  options: { clientKey?: string; now?: Date } = {}
): Promise<{ status: "invalid-request" } | { status: "accepted"; delivery?: PasswordResetDelivery }> {
  const parsed = passwordResetRequestSchema.safeParse(request);
  if (!parsed.success) return { status: "invalid-request" };
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const ipAllowed = options.clientKey === undefined || await consumeAccountRequestAllowance(tx,
      { scope: "RESET_IP", key: options.clientKey, limit: RESET_REQUESTS_PER_IP_AND_HOUR }, now);
    const emailAllowed = ipAllowed && await consumeAccountRequestAllowance(tx,
      { scope: "RESET_EMAIL", key: parsed.data.email, limit: RESET_REQUESTS_PER_EMAIL_AND_HOUR }, now);
    if (!emailAllowed) return { status: "accepted" } as const;
    const [account] = await tx.select().from(schema.userAccounts)
      .where(eq(schema.userAccounts.email, parsed.data.email)).for("update");
    if (!account || account.blockedAt) return { status: "accepted" } as const;
    const { token, expiresAt } = await createPasswordResetToken(tx, { accountId: account.id, bySuperadmin: false }, now);
    return { status: "accepted", delivery: {
      accountId: account.id, email: account.email, displayName: account.displayName, token, expiresAt
    } } as const;
  });
}

/** Sätter nytt lösenord med en giltig länk. Alla länkar för kontot förbrukas och alla sessioner spärras. */
export async function completePasswordReset(
  db: Database,
  request: unknown,
  now = new Date()
): Promise<{ status: "invalid-request" | "invalid-token" | "reset" }> {
  const parsed = passwordResetCompleteRequestSchema.safeParse(request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async (tx) => {
    const [reset] = await tx.select().from(schema.passwordResetTokens)
      .where(eq(schema.passwordResetTokens.tokenHash, sha256(parsed.data.token))).for("update");
    if (!reset || reset.usedAt || reset.expiresAt.getTime() <= now.getTime()) return { status: "invalid-token" } as const;
    const [account] = await tx.select().from(schema.userAccounts)
      .where(eq(schema.userAccounts.id, reset.accountId)).for("update");
    const verifier = account ? await currentUserAccountVerifier(tx, account.id) : undefined;
    if (!account || account.blockedAt || !verifier) return { status: "invalid-token" } as const;
    await appendUserAccountPasswordVerifier(tx, {
      accountId: account.id, password: parsed.data.password, previousVersion: verifier.version
    }, now);
    await tx.update(schema.passwordResetTokens).set({ usedAt: now })
      .where(and(eq(schema.passwordResetTokens.accountId, account.id), isNull(schema.passwordResetTokens.usedAt)));
    await revokeAllUserAccountSessions(tx, account.id, now, "PASSWORD_RESET");
    await clearUserAccountLoginThrottle(tx, account.email, now);
    return { status: "reset" } as const;
  });
}

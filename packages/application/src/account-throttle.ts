import { and, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { sha256Hex } from "./serialization";

/**
 * Spärr mot upprepade försök (ADR-0172 beslut 1): registreringar per IP och återställningsförfrågningar per
 * IP och e-post, räknade i ett fast fönster om en timme. Nyckeln lagras bara som hash.
 */
export type AccountThrottleScope = "REGISTER_IP" | "RESET_IP" | "RESET_EMAIL" | "SELF_REGISTRATION_IP" | "SELF_REGISTRATION_RACE";
export const ACCOUNT_THROTTLE_WINDOW_MS = 60 * 60 * 1000;
export const DEFAULT_REGISTRATIONS_PER_HOUR = 10;
export const RESET_REQUESTS_PER_IP_AND_HOUR = 10;
export const RESET_REQUESTS_PER_EMAIL_AND_HOUR = 3;

export function throttleKeyHash(scope: AccountThrottleScope, key: string): string {
  return sha256Hex(`${scope}\u0000${key}`);
}

/** Räknar ett försök och svarar om det ryms inom gränsen (fönstret är en timme om inget annat anges). Körs i anroparens transaktion. */
export async function consumeAccountRequestAllowance(
  tx: DbExecutor,
  input: { scope: AccountThrottleScope; key: string; limit: number; windowMs?: number },
  now: Date
): Promise<boolean> {
  if (!Number.isInteger(input.limit) || input.limit < 1) throw new Error("Ogiltig gräns för försök");
  const keyHash = throttleKeyHash(input.scope, input.key);
  const where = and(eq(schema.accountRequestThrottles.scope, input.scope), eq(schema.accountRequestThrottles.keyHash, keyHash));
  await tx.insert(schema.accountRequestThrottles)
    .values({ scope: input.scope, keyHash, windowStartedAt: now, attempts: 0 }).onConflictDoNothing();
  const [row] = await tx.select().from(schema.accountRequestThrottles).where(where).for("update");
  if (!row) throw new Error("Spärren saknas");
  const inWindow = now.getTime() - row.windowStartedAt.getTime() < (input.windowMs ?? ACCOUNT_THROTTLE_WINDOW_MS);
  if (inWindow && row.attempts >= input.limit) return false;
  await tx.update(schema.accountRequestThrottles)
    .set(inWindow ? { attempts: row.attempts + 1 } : { windowStartedAt: now, attempts: 1 }).where(where);
  return true;
}

import { createHmac, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";

/**
 * Spärr mot upprepade försök (ADR-0172 beslut 1): registreringar per IP och återställningsförfrågningar per
 * IP och e-post, räknade i ett fast fönster om en timme. Nyckeln lagras bara som HMAC med en serverhemlighet (steg 46),
 * så att en adress inte kan räknas fram ur databasen eller en backup. Rader äldre än två dygn tas bort vid nästa skrivning.
 */
export type AccountThrottleScope = "REGISTER_IP" | "RESET_IP" | "RESET_EMAIL" | "SELF_REGISTRATION_IP" | "SELF_REGISTRATION_RACE";
export const ACCOUNT_THROTTLE_WINDOW_MS = 60 * 60 * 1000;
export const DEFAULT_REGISTRATIONS_PER_HOUR = 10;
export const RESET_REQUESTS_PER_IP_AND_HOUR = 10;
export const RESET_REQUESTS_PER_EMAIL_AND_HOUR = 3;

/** Rader som inte använts på två dygn behövs inte längre (längsta fönstret är ett dygn). */
export const THROTTLE_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

let processSecret: Buffer | undefined;
/**
 * Hemligheten för spärrens hash: OTID_THROTTLE_SECRET om den finns, annars databasens anslutning (som innehåller
 * databasens lösenord och alltid finns i drift), annars en slumpad hemlighet för processen (räknarna börjar då om
 * vid omstart). Ett byte av hemlighet nollställer bara räknarna.
 */
export function throttleSecret(env: Partial<Record<string, string | undefined>> = process.env): string | Buffer {
  const own = env.OTID_THROTTLE_SECRET?.trim();
  if (own) return own;
  const database = env.DATABASE_URL?.trim();
  if (database) return `otid-throttle\u0000${database}`;
  return processSecret ??= randomBytes(32);
}

/** HMAC-SHA-256 (hex) av texten med spärrens hemlighet. Används också för inloggningsspärren. */
export function throttleHmac(text: string, secret: string | Buffer = throttleSecret()): string {
  return createHmac("sha256", secret).update(text).digest("hex");
}

export function throttleKeyHash(scope: AccountThrottleScope, key: string, secret?: string | Buffer): string {
  return throttleHmac(`${scope}\u0000${key}`, secret);
}

/** Tar bort gamla rader i spärrarna. Rader som en annan transaktion håller hoppas över, så att ingen väntar. */
export async function purgeStaleThrottles(tx: DbExecutor, now: Date): Promise<void> {
  const before = new Date(now.getTime() - THROTTLE_RETENTION_MS);
  await tx.execute(sql`delete from account_request_throttle where ctid in (select ctid from account_request_throttle
    where window_started_at < ${before} limit 200 for update skip locked)`);
  await tx.execute(sql`delete from user_account_login_throttle where ctid in (select ctid from user_account_login_throttle
    where window_started_at < ${before} and (blocked_until is null or blocked_until < ${now}) limit 200 for update skip locked)`);
}

/** Räknar ett försök och svarar om det ryms inom gränsen (fönstret är en timme om inget annat anges). Körs i anroparens transaktion. */
export async function consumeAccountRequestAllowance(
  tx: DbExecutor,
  input: { scope: AccountThrottleScope; key: string; limit: number; windowMs?: number },
  now: Date
): Promise<boolean> {
  if (!Number.isInteger(input.limit) || input.limit < 1) throw new Error("Ogiltig gräns för försök");
  await purgeStaleThrottles(tx, now);
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

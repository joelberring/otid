import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, isNotNull, lte } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { consumeAccountRequestAllowance } from "./account-throttle";
import { deleteAccountWithOwnedEvents } from "./account-self-service";
import { seedDemoRace, type DemoRaceTexts } from "./demo-race";
import { issueUserAccountSession, scryptVerifier } from "./user-account";

/**
 * Demoläget del 2 (ägaren 2026-11-09): "Prova arbetsytan" på startsidan skapar ett tillfälligt gästkonto (migration 0108)
 * med en egen övningstävling och påhittade löpare, och loggar in det. Gästen släpps bara in på sin tävling (rollkontrollen
 * tillåter gäster, kontots sidor gör det inte), kan inte publicera, dela kartlänken eller mejla, och underhållet tar bort
 * kontot med tävlingen när tiden gått ut. Spärr per IP och timme.
 */
export const GUEST_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_GUESTS_PER_HOUR = 5;
const SWEEP_BATCH = 20;

export type GuestDemoResult =
  | { status: "rate-limited" | "failed" }
  | { status: "created"; raceId: string; sessionToken: string; csrfToken: string; expiresAt: Date; sessionExpiresAt: string };

export async function startGuestDemo(db: Database, options: { clientKey: string; guestsPerHour?: number; now?: Date;
  displayName?: string; texts?: DemoRaceTexts }): Promise<GuestDemoResult> {
  const now = options.now ?? new Date();
  const allowed = await db.transaction(tx => consumeAccountRequestAllowance(tx, {
    scope: "GUEST_DEMO_IP", key: options.clientKey, limit: options.guestsPerHour ?? DEFAULT_GUESTS_PER_HOUR }, now));
  if (!allowed) return { status: "rate-limited" };
  const accountId = randomUUID();
  const expiresAt = new Date(now.getTime() + GUEST_LIFETIME_MS);
  // Ingen kan logga in med lösenord (adressen finns inte och lösenordet lämnas aldrig ut); verifieraren behövs för sessionen.
  const salt = randomBytes(16);
  const verifier = await scryptVerifier(randomBytes(32).toString("base64url"), salt);
  const session = await db.transaction(async tx => {
    const [account] = await tx.insert(schema.userAccounts).values({ id: accountId, email: `gast-${accountId}@gast.o-tid.invalid`,
      displayName: options.displayName ?? "Gäst", guestExpiresAt: expiresAt, createdAt: now, lastLoginAt: now }).returning();
    if (!account) throw new Error("Gästkontot kunde inte skapas");
    await tx.insert(schema.userAccountPasswordVerifiers).values({ accountId, version: 1, algorithm: "scrypt-v1",
      saltHex: salt.toString("hex"), verifierHex: verifier.toString("hex"), createdAt: now });
    return issueUserAccountSession(tx, account, 1, now);
  });
  const seeded = await seedDemoRace(db, { sessionToken: session.sessionToken, csrfToken: session.csrfToken, guest: true },
    { now, ...(options.texts ? { texts: options.texts } : {}) });
  if (seeded.status !== "created") {
    await db.transaction(tx => deleteAccountWithOwnedEvents(tx, accountId, now));
    return { status: "failed" };
  }
  return { status: "created", raceId: seeded.raceId, sessionToken: session.sessionToken, csrfToken: session.csrfToken, expiresAt,
    sessionExpiresAt: session.response.expiresAt };
}

/** Underhållet: gästkonton vars tid gått ut tas bort med sina tävlingar, några per varv och ett per transaktion. */
export async function sweepGuestAccounts(db: Database, now = new Date()): Promise<number> {
  const expired = await db.select({ id: schema.userAccounts.id }).from(schema.userAccounts)
    .where(and(isNotNull(schema.userAccounts.guestExpiresAt), lte(schema.userAccounts.guestExpiresAt, now)))
    .orderBy(asc(schema.userAccounts.guestExpiresAt)).limit(SWEEP_BATCH);
  let removed = 0;
  for (const { id } of expired) {
    await db.transaction(tx => deleteAccountWithOwnedEvents(tx, id, now));
    removed += 1;
  }
  return removed;
}

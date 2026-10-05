import { and, asc, eq, inArray } from "drizzle-orm";
import {
  accountDeleteRequestSchema,
  accountDisplayNameChangeSchema,
  accountPasswordChangeSchema,
  accountProfileSchema,
  eventDeleteRequestSchema,
  type AccountProfile
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { activeEventAdministrationGrant } from "./organizer-events";
import { purgeRows } from "./purge";
import {
  appendUserAccountPasswordVerifier,
  authenticateUserAccountSessionForMutation,
  authenticateUserAccountSessionForProtectedRead,
  currentUserAccountVerifier,
  issueUserAccountSession,
  revokeAllUserAccountSessions,
  userAccountPasswordMatches,
  type UserAccountLoginResult,
  type UserAccountSessionProof
} from "./user-account";

/**
 * Mitt konto (ADR-0172 beslut 2): byta namn och lösenord, ta bort kontot och ta bort en egen tävling.
 * Ett konto äger bara tävlingar det själv har skapat, så det är alltid ensam ägare. När kontot tas bort
 * tas därför dess tävlingar bort i samma transaktion; sidan visar vilka innan man bekräftar.
 */
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" };

/** Event där kontot har en aktiv OWNER-grant. */
export async function ownedEvents(tx: DbExecutor, accountId: string) {
  const grants = await tx.select({ id: schema.eventAdministrationGrants.id, eventId: schema.eventAdministrationGrants.eventId })
    .from(schema.eventAdministrationGrants)
    .where(and(eq(schema.eventAdministrationGrants.accountId, accountId), eq(schema.eventAdministrationGrants.role, "OWNER")));
  const active: string[] = [];
  for (const grant of grants) {
    const [revocation] = await tx.select({ id: schema.eventAdministrationGrantRevocations.id })
      .from(schema.eventAdministrationGrantRevocations).where(eq(schema.eventAdministrationGrantRevocations.grantId, grant.id));
    if (!revocation) active.push(grant.eventId);
  }
  if (active.length === 0) return [];
  return tx.select({ eventId: schema.events.id, eventName: schema.events.name, startsOn: schema.events.startsOn })
    .from(schema.events).where(inArray(schema.events.id, active)).orderBy(asc(schema.events.startsOn), asc(schema.events.name));
}

/** Tar bort kontot och tävlingarna det äger. Används både av användaren och av superadmin. */
export async function deleteAccountWithOwnedEvents(tx: DbExecutor, accountId: string, now: Date): Promise<{ eventIds: string[] }> {
  const events = await ownedEvents(tx, accountId);
  await revokeAllUserAccountSessions(tx, accountId, now, "ACCOUNT_DELETED");
  await purgeRows(tx, "event", events.map((event) => event.eventId));
  await purgeRows(tx, "user_account", [accountId]);
  return { eventIds: events.map((event) => event.eventId) };
}

export async function readAccountProfile(
  db: Database, proof: UserAccountSessionProof, now = new Date()
): Promise<Failure | { status: "ok"; response: AccountProfile }> {
  return db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, proof, now);
    if (auth.status !== "authenticated") return auth;
    const [account] = await tx.select().from(schema.userAccounts).where(eq(schema.userAccounts.id, auth.principal.accountId));
    if (!account) return { status: "unauthorized" } as const;
    const events = await ownedEvents(tx, account.id);
    return { status: "ok", response: accountProfileSchema.parse({
      formatVersion: 1, accountId: account.id, email: account.email, displayName: account.displayName,
      superadmin: account.isSuperadmin, createdAt: account.createdAt.toISOString(), ownedEvents: events
    }) } as const;
  });
}

export async function changeAccountDisplayName(
  db: Database, proof: UserAccountSessionProof, request: unknown, now = new Date()
): Promise<Failure | { status: "changed"; displayName: string }> {
  const parsed = accountDisplayNameChangeSchema.safeParse(request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...proof, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    await tx.update(schema.userAccounts).set({ displayName: parsed.data.displayName })
      .where(eq(schema.userAccounts.id, auth.principal.accountId));
    return { status: "changed", displayName: parsed.data.displayName } as const;
  });
}

/** Nytt lösenord: alla sessioner spärras och den här enheten får en ny inloggning. */
export async function changeAccountPassword(
  db: Database, proof: UserAccountSessionProof, request: unknown, now = new Date()
): Promise<Failure | { status: "wrong-password" } | Extract<UserAccountLoginResult, { status: "authenticated" }>> {
  const parsed = accountPasswordChangeSchema.safeParse(request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...proof, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const [account] = await tx.select().from(schema.userAccounts).where(eq(schema.userAccounts.id, auth.principal.accountId));
    const verifier = await currentUserAccountVerifier(tx, auth.principal.accountId);
    if (!account || !verifier) return { status: "unauthorized" } as const;
    if (!await userAccountPasswordMatches(verifier, parsed.data.currentPassword)) return { status: "wrong-password" } as const;
    const version = await appendUserAccountPasswordVerifier(tx, {
      accountId: account.id, password: parsed.data.newPassword, previousVersion: verifier.version
    }, now);
    await revokeAllUserAccountSessions(tx, account.id, now, "PASSWORD_CHANGED");
    return issueUserAccountSession(tx, account, version, now);
  });
}

export async function deleteOwnAccount(
  db: Database, proof: UserAccountSessionProof, request: unknown, now = new Date()
): Promise<Failure | { status: "wrong-password" | "deleted" }> {
  const parsed = accountDeleteRequestSchema.safeParse(request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...proof, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const verifier = await currentUserAccountVerifier(tx, auth.principal.accountId);
    if (!await userAccountPasswordMatches(verifier, parsed.data.password)) return { status: "wrong-password" } as const;
    await deleteAccountWithOwnedEvents(tx, auth.principal.accountId, now);
    return { status: "deleted" } as const;
  });
}

/** Ägaren tar bort sin tävling (eventet med alla lopp och all data) genom att skriva tävlingens namn. */
export async function deleteEventAsOwner(
  db: Database, proof: UserAccountSessionProof & { raceId: string }, request: unknown, now = new Date()
): Promise<Failure | { status: "not-found" | "confirmation-mismatch" | "deleted"; eventId?: string }> {
  const parsed = eventDeleteRequestSchema.safeParse(request);
  if (!parsed.success || !/^[0-9a-f-]{36}$/.test(proof.raceId)) return { status: "invalid-request" };
  return db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...proof, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const [race] = await tx.select({ eventId: schema.races.eventId, eventName: schema.events.name })
      .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
      .where(eq(schema.races.id, proof.raceId));
    if (!race) return { status: "not-found" } as const;
    const owner = await activeEventAdministrationGrant(tx, {
      accountId: auth.principal.accountId, eventId: race.eventId, ownerOnly: true
    }, "update");
    if (!owner) return { status: "not-found" } as const;
    if (parsed.data.confirmation.trim() !== race.eventName.trim()) return { status: "confirmation-mismatch" } as const;
    await purgeRows(tx, "event", [race.eventId]);
    return { status: "deleted", eventId: race.eventId } as const;
  });
}

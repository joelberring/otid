import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { registerUserAccount } from "../../src/user-account";
import { grantRacePersonAsAdmin } from "../../src/race-people";
import { setRacePublicationAsAdmin } from "../../src/race-publication";
import { requireRaceRole } from "../../src/race-session";

export const TEST_PASSWORD = "hemligt-lösen";

/** Registrerar ett testkonto med e-post `<namn>@test.o-tid.se` (unikt namn om inget anges). */
export async function registerTestAccount(db: Database, name = `konto.${randomUUID().slice(0, 8)}`, now?: Date) {
  const email = `${name}@test.o-tid.se`;
  const login = await registerUserAccount(db, { formatVersion: 1, email, displayName: `Arrangör ${name}`, password: TEST_PASSWORD },
    now ? { now } : {});
  if (login.status !== "authenticated") throw new Error(`Testkontot kunde inte skapas: ${login.status}`);
  return {
    accountId: login.response.accountId, email, password: TEST_PASSWORD, login,
    proof: { sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken }
  };
}

type AccountProof = { sessionToken: string; csrfCookie: string; csrfHeader: string };

/**
 * Ger ett befintligt konto (e-post) en roll på tävlingen som ägaren eller en administratör gör under
 * Inställningar → Personer med behörighet (ADR-0172 beslut 3). Returnerar tjänstens svar.
 */
export async function grantRacePerson(db: Database, actor: AccountProof, raceId: string, email: string,
  role: "ADMIN" | "FUNCTIONARY", now?: Date) {
  const requestId = randomUUID();
  return grantRacePersonAsAdmin(db, { ...actor, raceId, idempotencyKey: `race-person-grant:${requestId}`,
    readBody: async () => ({ formatVersion: 1, requestId, email, role }) }, now);
}

/** Publicerar tävlingen (eller slutar publicera den) som admin gör i arbetsytan (ADR-0172 beslut 4). */
export async function setRacePublished(db: Database, actor: AccountProof, raceId: string, published = true, now?: Date) {
  return setRacePublicationAsAdmin(db, { ...actor, raceId, published }, now);
}

/**
 * Ett nytt konto med rollen på tävlingens event (ADR-0172 beslut 3): administratör (ADMIN) eller funktionär.
 * Ger det som tjänsterna tar emot: tävlingen, kontots session och CSRF-paret, samt kontots id (`actorId`).
 */
export async function raceAuth(db: Database, raceId: string, role: "ADMIN" | "FUNCTIONARY" = "ADMIN", now = new Date()) {
  const [race] = await db.select({ eventId: schema.races.eventId }).from(schema.races).where(eq(schema.races.id, raceId));
  if (!race) throw new Error("Tävlingen saknas");
  const account = await registerTestAccount(db, undefined, now);
  await db.insert(schema.eventAdministrationGrants).values({ eventId: race.eventId, accountId: account.accountId, role,
    grantedAt: now });
  return { raceId, ...account.proof, actorId: account.accountId, email: account.email };
}

/** Som `raceAuth`, men med inloggningens fält (`sessionToken`, `csrfToken`) för tester som behandlar dem var för sig. */
export async function raceLogin(db: Database, raceId: string, role: "ADMIN" | "FUNCTIONARY" = "ADMIN", now = new Date()) {
  const auth = await raceAuth(db, raceId, role, now);
  return { status: "authenticated" as const, sessionToken: auth.sessionToken, csrfToken: auth.csrfCookie, accountId: auth.actorId };
}

/**
 * Kontots roll på tävlingen, prövad som en adminförfrågan (ADR-0173 beslut 4). Kontots session och CSRF-par
 * gäller direkt för tävlingens adminförfrågningar; det finns ingen separat tävlingssession.
 */
export async function accountOnRace(db: Database, input: AccountProof & { raceId: string }, now?: Date) {
  const auth = await requireRaceRole(db, { ...input, role: "FUNCTIONARY" }, now);
  if (auth.status !== "authenticated") return { status: auth.status };
  return { status: "authenticated" as const, role: auth.principal.role, sessionToken: input.sessionToken, csrfToken: input.csrfCookie };
}

/** Tar bort kontots behörigheter på tävlingarnas event, som en borttagning under Inställningar gör. */
export async function revokeRaceGrants(db: Database, accountId: string, now = new Date()) {
  const grants = await db.select({ id: schema.eventAdministrationGrants.id }).from(schema.eventAdministrationGrants)
    .where(eq(schema.eventAdministrationGrants.accountId, accountId));
  if (grants.length === 0) throw new Error("Kontot har ingen behörighet");
  await db.insert(schema.eventAdministrationGrantRevocations).values(grants.map((grant) => ({ grantId: grant.id, revokedAt: now,
    reason: "Borttagen i test" })));
}

/** Ett inloggat konto utan behörighet på tävlingens event. */
export async function withoutRaceAccess(db: Database, raceId: string, now?: Date) {
  const account = await registerTestAccount(db, undefined, now);
  return { raceId, ...account.proof };
}

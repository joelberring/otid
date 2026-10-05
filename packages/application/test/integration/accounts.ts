import { randomUUID } from "node:crypto";
import type { Database } from "@o-tid/database";
import { registerUserAccount } from "../../src/user-account";
import { enterRaceAsUserAccount } from "../../src/organizer-events";
import { grantRacePersonAsAdministrator } from "../../src/race-people";

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
  const entered = await enterRaceAsUserAccount(db, { ...actor, raceId }, now);
  if (entered.status !== "entered") throw new Error(`Kontot kom inte in i tävlingen: ${entered.status}`);
  const requestId = randomUUID();
  return grantRacePersonAsAdministrator(db, { sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken,
    csrfHeader: entered.csrfToken, raceId, idempotencyKey: `race-person-grant:${requestId}`,
    readBody: async () => ({ formatVersion: 1, requestId, email, role }) }, now);
}

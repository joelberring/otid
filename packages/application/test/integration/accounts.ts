import { randomUUID } from "node:crypto";
import type { Database } from "@o-tid/database";
import { registerUserAccount } from "../../src/user-account";

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

import { authenticateUserAccountSession } from "@o-tid/application";
import { db } from "../../lib/db";
import { accountSessionToken } from "../../lib/public-race-gate";
import { AppTabBar } from "./app-tab-bar";

/**
 * Förslag B (ADR-0227 tillägg): flikraden i arrangemangets layout för den som saknar roll där (t.ex. bara banläggningen).
 * Inne i ett arrangemang finns ingen vänstermeny (steg F1); de övriga inloggade sidorna har hela skalet (`SignedInShell`).
 */
export async function SignedInTabBar() {
  const token = await accountSessionToken();
  if (!token) return null;
  const account = await authenticateUserAccountSession(db, { sessionToken: token });
  return account.status === "authenticated" ? <AppTabBar /> : null;
}

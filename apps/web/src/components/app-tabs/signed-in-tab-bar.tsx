import { authenticateUserAccountSession } from "@o-tid/application";
import { db } from "../../lib/db";
import { accountSessionToken } from "../../lib/public-race-gate";
import { AppTabBar } from "./app-tab-bar";

/**
 * Förslag B (ADR-0227 tillägg): flikraden i de inloggade delarnas layouter (Mitt O-Tid med kartprojekt, klubbar och grupper,
 * arbetsytan, Mitt konto och superadmin). Bara när kontot är inloggat; inloggningssidan och publika sidor får ingen rad.
 * Inloggningen i Mitt O-Tid sker i klienten, som därefter ritar om layouten (`router.refresh`).
 */
export async function SignedInTabBar() {
  const token = await accountSessionToken();
  if (!token) return null;
  const account = await authenticateUserAccountSession(db, { sessionToken: token });
  return account.status === "authenticated" ? <AppTabBar /> : null;
}

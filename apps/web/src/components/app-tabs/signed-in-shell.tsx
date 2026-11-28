import { authenticateUserAccountSession } from "@o-tid/application";
import { db } from "../../lib/db";
import { currentLanguage } from "../../lib/language-server";
import { accountSessionToken } from "../../lib/public-race-gate";
import { SiteFooter } from "../about/site-footer";
import { AppShell } from "./app-shell";

/**
 * Steg F1 (ADR-0170 tillägg 2026-11-28): det inloggade skalet i layouterna för Mitt O-Tid (med kartprojekt, klubbar och
 * grupper), Mitt konto och superadmin. Bara när kontot är inloggat (också i gästläget, som har kontomenyn med Avsluta provet);
 * inloggningssidan och publika sidor får inget skal. Inloggningen i Mitt O-Tid sker i klienten, som därefter ritar om
 * layouten (`router.refresh`).
 */
export async function SignedInShell({ children }: { children: React.ReactNode }) {
  const token = await accountSessionToken();
  const result = token ? await authenticateUserAccountSession(db, { sessionToken: token, allowGuest: true }) : undefined;
  if (result?.status !== "authenticated") return <>{children}</>;
  const { displayName, email, superadmin, guestExpiresAt } = result.principal;
  return <AppShell account={{ displayName, email, superadmin, ...(guestExpiresAt ? { guestExpiresAt } : {}) }}
    footer={<SiteFooter language={await currentLanguage()} />}>{children}</AppShell>;
}

"use client";

import { usePathname } from "next/navigation";
import { appTabsHidden } from "../../lib/app-tabs";
import { AppRail } from "./app-rail";
import { AppTabBar } from "./app-tab-bar";
import { AppTopBar } from "./app-top-bar";
import { ShellHelpProvider } from "./shell-help";
import styles from "./app-shell.module.css";

export type ShellAccount = { displayName: string; email: string; superadmin: boolean; guestExpiresAt?: string | undefined };

/**
 * Steg F1 (ADR-0170 tillägg 2026-11-28): ramen runt de vanliga inloggade sidorna. Datorn: vänstermenyn och innehållet
 * bredvid (sidans `main` och sidfoten). Telefonen: sidhuvudet överst och flikraden nertill. Det globala sidhuvudet och
 * layoutens sidfot döljs (globals.css, `body:has(> [data-app-shell])`). Helskärmslägen och kioskvyer (`appTabsHidden`:
 * kartredigeraren, terminens utskrift) får ingen ram alls.
 */
export function AppShell({ account, footer, children }: { account: ShellAccount; footer: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  if (appTabsHidden(pathname)) return <>{children}</>;
  return <ShellHelpProvider>
    <div className={styles.shell} data-app-shell>
      <AppRail account={account} />
      <div className={styles.column}>
        <AppTopBar account={account} />
        <div className={styles.content}>{children}</div>
        <div className={styles.footer}>{footer}</div>
      </div>
    </div>
    <AppTabBar />
  </ShellHelpProvider>;
}

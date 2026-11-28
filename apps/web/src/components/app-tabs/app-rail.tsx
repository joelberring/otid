"use client";

import Link from "next/link";
import { appTabsEn } from "../../i18n/app-tabs-en";
import { appTabsSv } from "../../i18n/app-tabs-sv";
import { APP_TAB_LINKS } from "../../lib/app-tabs";
import { AccountMenu } from "../account-menu";
import { Logo } from "../brand/logo";
import { LanguageSwitch } from "../language-switch";
import { useLanguage, useTexts } from "../language-provider";
import { AppIcon } from "./app-icons";
import type { ShellAccount } from "./app-shell";
import { ShellHelpButton } from "./shell-help";
import { APP_TAB_ICONS, useActiveAppTab } from "./use-active-app-tab";
import styles from "./app-rail.module.css";

/**
 * Steg F1 (ADR-0170 tillägg 2026-11-28): datorns vänstermeny i det inloggade skalet. Samma fem länkar, ikoner och aktiva flik
 * som telefonens flikrad; överst loggan, nederst Hjälp, språket och kontot. I mellanbredd (641–1100 px) en ikonremsa där
 * namnen bara finns för skärmläsare och som `title`. I telefonen och på papper syns den inte (CSS:en).
 */
export function AppRail({ account }: { account: ShellAccount }) {
  const text = useTexts(appTabsSv, appTabsEn);
  const language = useLanguage();
  const { pathname, active, follow } = useActiveAppTab();
  return <div className={styles.rail} data-testid="app-rail">
    <Link className={styles.brand} href="/" title={text.start} aria-label={text.start}>
      <Logo size={30} className={styles.logo} /><span className={styles.brandName} aria-hidden="true">O-Tid</span>
    </Link>
    <nav aria-label={text.label}>
      <ul className={styles.links}>{APP_TAB_LINKS.map(link => <li key={link.tab}>
        <Link className={styles.link} href={link.href} title={text.tabs[link.tab]} aria-current={link.tab === active ? "page" : undefined}
          data-tab={link.tab} onClick={follow(link)}>
          <span className={styles.ring}><AppIcon name={APP_TAB_ICONS[link.tab]} size={22} /></span>
          <span className={styles.label}>{text.tabs[link.tab]}</span>
        </Link>
      </li>)}</ul>
    </nav>
    <div className={styles.foot}>
      <div className={styles.help}><ShellHelpButton pathname={pathname} /></div>
      <LanguageSwitch language={language} className={styles.language} />
      <AccountMenu who={account} superadmin={account.superadmin} place="rail" language={language} />
    </div>
  </div>;
}

"use client";

import Link from "next/link";
import { appTabsEn } from "../../i18n/app-tabs-en";
import { appTabsSv } from "../../i18n/app-tabs-sv";
import { appTabParent, appTopTitle } from "../../lib/app-tabs";
import { AccountMenu } from "../account-menu";
import { Logo } from "../brand/logo";
import { useLanguage, useTexts } from "../language-provider";
import { BackIcon } from "./app-icons";
import type { ShellAccount } from "./app-shell";
import { ShellHelpButton } from "./shell-help";
import { useActiveAppTab } from "./use-active-app-tab";
import styles from "./app-top-bar.module.css";

/**
 * Steg F1 (ADR-0170 tillägg 2026-11-28): telefonens sidhuvud i det inloggade skalet, i stället för det globala sidhuvudet och
 * sidornas egna rader med hjälp och konto. Vänster loggan på huvudsidorna och annars «‹» till sidans förälder; mitten «Mitt
 * O-Tid» eller flikens namn (sidans egen rubrik står kvar i innehållet); höger Hjälp och kontot (språket står i kontomenyn).
 * Syns bara i telefonbredd (CSS:en).
 */
export function AppTopBar({ account }: { account: ShellAccount }) {
  const text = useTexts(appTabsSv, appTabsEn);
  const language = useLanguage();
  const { pathname } = useActiveAppTab();
  const parent = appTabParent(pathname);
  const title = appTopTitle(pathname);
  return <header className={styles.bar} data-testid="app-top">
    {parent ? <Link className={styles.side} href={parent} aria-label={text.back} title={text.back} data-testid="app-top-back">
      <BackIcon className={styles.back} /></Link>
      : <Link className={styles.side} href="/" aria-label={text.start} title={text.start}><Logo size={30} className={styles.logo} /></Link>}
    <p className={styles.title}>{title === "hub" || title === "account" || title === "superadmin" ? text.titles[title] : text.tabs[title]}</p>
    <div className={styles.tools}>
      <ShellHelpButton pathname={pathname} compact />
      <AccountMenu who={account} superadmin={account.superadmin} place="top" language={language} />
    </div>
  </header>;
}

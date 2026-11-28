"use client";

import Link from "next/link";
import { appTabsEn } from "../../i18n/app-tabs-en";
import { appTabsSv } from "../../i18n/app-tabs-sv";
import { APP_TAB_LINKS, appTabsHidden } from "../../lib/app-tabs";
import { useTexts } from "../language-provider";
import { AppIcon } from "./app-icons";
import { APP_TAB_ICONS, useActiveAppTab } from "./use-active-app-tab";
import styles from "./app-tab-bar.module.css";

/**
 * Förslag B (ägaren 2026-11-18, ADR-0227 tillägg): flikraden nertill för inloggade, bara i telefonbredd (CSS:en; på datorn
 * syns den inte). Raden ger en väg tillbaka till huvuddelarna från alla vanliga inloggade sidor, också i appen (D3). Den
 * ritas av det inloggade skalet (`SignedInShell`) och av arrangemangets layout för den som saknar roll där (`SignedInTabBar`),
 * och visas inte i helskärmslägen och kioskvyer (`appTabsHidden`). Steg F1: den aktiva flikens ikon har samma ring som
 * datorns vänstermeny.
 */
export function AppTabBar() {
  const text = useTexts(appTabsSv, appTabsEn);
  const { pathname, active, follow } = useActiveAppTab();
  if (appTabsHidden(pathname)) return null;
  return <nav className={styles.bar} aria-label={text.label} data-app-tabs data-testid="app-tabs">
    {APP_TAB_LINKS.map(link => <Link key={link.tab} className={styles.tab} href={link.href}
      aria-current={link.tab === active ? "page" : undefined} data-tab={link.tab} onClick={follow(link)}>
      <span className={styles.ring}><AppIcon name={APP_TAB_ICONS[link.tab]} size={22} /></span><span>{text.tabs[link.tab]}</span>
    </Link>)}
  </nav>;
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { appTabsEn } from "../../i18n/app-tabs-en";
import { appTabsSv } from "../../i18n/app-tabs-sv";
import { activeAppTab, APP_TAB_LINKS, appTabsHidden, type AppTab } from "../../lib/app-tabs";
import { useTexts } from "../language-provider";
import { AppIcon, type AppIconName } from "./app-icons";
import styles from "./app-tab-bar.module.css";

const ICONS: Record<AppTab, AppIconName> = { home: "home", maps: "map", courses: "course", events: "event", club: "club" };

/**
 * Förslag B (ägaren 2026-11-18, ADR-0227 tillägg): flikraden nertill för inloggade, bara i telefonbredd (CSS:en; på datorn
 * syns den inte). Raden ger en väg tillbaka till huvuddelarna från alla vanliga inloggade sidor, också i appen (D3). Den
 * ritas av `SignedInTabBar` och visas inte i helskärmslägen och kioskvyer (`appTabsHidden`).
 */
export function AppTabBar() {
  const text = useTexts(appTabsSv, appTabsEn);
  const pathname = usePathname() ?? "";
  if (appTabsHidden(pathname)) return null;
  const active = activeAppTab(pathname);
  return <nav className={styles.bar} aria-label={text.label} data-app-tabs data-testid="app-tabs">
    {APP_TAB_LINKS.map(link => {
      const current = link.tab === active;
      const body = <><AppIcon name={ICONS[link.tab]} /><span>{text.tabs[link.tab]}</span></>;
      const props = { className: styles.tab, href: link.href, "aria-current": current ? "page" as const : undefined, "data-tab": link.tab };
      return link.plain ? <a key={link.tab} {...props}>{body}</a> : <Link key={link.tab} {...props}>{body}</Link>;
    })}
  </nav>;
}

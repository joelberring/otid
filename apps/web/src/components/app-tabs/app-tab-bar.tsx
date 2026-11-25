"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { appTabsEn } from "../../i18n/app-tabs-en";
import { appTabsSv } from "../../i18n/app-tabs-sv";
import { activeAppTab, APP_TAB_LINKS, appTabsHidden, COURSE_TAB_HASH, OPEN_COURSE_EVENT, type AppTab } from "../../lib/app-tabs";
import { useTexts } from "../language-provider";
import { AppIcon, type AppIconName } from "./app-icons";
import styles from "./app-tab-bar.module.css";

const ICONS: Record<AppTab, AppIconName> = { home: "home", maps: "map", courses: "course", events: "event", club: "club" };

function hashOf(href: string): string {
  const index = href.indexOf("#");
  return index >= 0 ? href.slice(index) : "";
}

/**
 * Förslag B (ägaren 2026-11-18, ADR-0227 tillägg): flikraden nertill för inloggade, bara i telefonbredd (CSS:en; på datorn
 * syns den inte). Raden ger en väg tillbaka till huvuddelarna från alla vanliga inloggade sidor, också i appen (D3). Den
 * ritas av `SignedInTabBar` och visas inte i helskärmslägen och kioskvyer (`appTabsHidden`).
 */
export function AppTabBar() {
  const text = useTexts(appTabsSv, appTabsEn);
  const pathname = usePathname() ?? "";
  const [hash, setHash] = useState("");

  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [pathname]);

  if (appTabsHidden(pathname)) return null;
  const active = activeAppTab(pathname, hash);
  return <nav className={styles.bar} aria-label={text.label} data-app-tabs data-testid="app-tabs">
    {APP_TAB_LINKS.map(link => {
      const current = link.tab === active;
      const targetHash = hashOf(link.href);
      return <Link key={link.tab} className={styles.tab} href={link.href} aria-current={current ? "page" : undefined} data-tab={link.tab}
        onClick={() => {
          setHash(targetHash);
          if (pathname === "/organizer" && targetHash === COURSE_TAB_HASH) {
            window.dispatchEvent(new Event(OPEN_COURSE_EVENT));
          }
        }}>
        <AppIcon name={ICONS[link.tab]} /><span>{text.tabs[link.tab]}</span>
      </Link>;
    })}
  </nav>;
}

"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { activeAppTab, COURSE_TAB_HASH, OPEN_COURSE_EVENT, type AppTab, type AppTabLink } from "../../lib/app-tabs";
import type { AppIconName } from "./app-icons";

export const APP_TAB_ICONS: Record<AppTab, AppIconName> = { home: "home", maps: "map", courses: "course", events: "event", club: "club" };

function hashOf(href: string): string {
  const index = href.indexOf("#");
  return index >= 0 ? href.slice(index) : "";
}

/**
 * Flikraden och vänstermenyn (steg F1) markerar samma flik: sökvägen och ankaret i Mitt O-Tid, som följs när det byts.
 * `follow` ger klickhanteraren för en länk: ankaret sätts direkt, och Banor öppnar Lägg banor när navet redan är öppet.
 */
export function useActiveAppTab(): { pathname: string; active: AppTab | null; follow: (link: AppTabLink) => () => void } {
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
  const follow = (link: AppTabLink) => () => {
    const target = hashOf(link.href);
    setHash(target);
    if (pathname === "/organizer" && target === COURSE_TAB_HASH) window.dispatchEvent(new Event(OPEN_COURSE_EVENT));
  };
  return { pathname, active: activeAppTab(pathname, hash), follow };
}

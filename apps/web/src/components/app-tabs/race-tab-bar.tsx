"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { shownRaceName } from "@o-tid/domain";
import { raceTabsEn } from "../../i18n/race-tabs-en";
import { raceTabsSv } from "../../i18n/race-tabs-sv";
import { activeRaceNavKey, raceNavigation, raceNavPlacement, type RaceMode, type RaceNavItem } from "../../lib/race-tabs";
import { useTexts } from "../language-provider";
import { AppIcon, BackIcon } from "./app-icons";
import { useRaceNav } from "./race-nav";
import { RACE_ICONS, RaceNarrowBar, RaceSheet } from "./race-sheet";
import styles from "./race-tab-bar.module.css";

const MODES: readonly RaceMode[] = ["PREPARE", "RACE_DAY"];

/** Följer en rad: i arbetsytan byts delen utan omladdning, och osparat stoppar som när man byter del i sidopanelen. */
function useFollow() {
  const nav = useRaceNav();
  return (item: RaceNavItem, event: React.MouseEvent<HTMLAnchorElement>) => {
    const workspace = nav?.workspace.current;
    if (!workspace) return;
    if (item.section) { event.preventDefault(); workspace.navigate(item.section); return; }
    if (!workspace.mayLeave()) event.preventDefault();
  };
}

/** Växeln Förbereda | Tävlingsdag (bara telefonbredd). */
export function RaceModeSwitch({ inline = false }: { inline?: boolean }) {
  const text = useTexts(raceTabsSv, raceTabsEn);
  const nav = useRaceNav();
  if (!nav) return null;
  return <div className={`${styles.modeSwitch}${inline ? ` ${styles.modeSwitchInline}` : ""}`} role="group" aria-label={text.mode} data-testid="race-mode-switch">
    {MODES.map(mode => <button key={mode} type="button" aria-pressed={nav.mode === mode} data-mode={mode}
      onClick={() => nav.setMode(mode)}>{text.modes[mode]}</button>)}
  </div>;
}

/** Överraden på arrangemangets egna sidor i telefonbredd: «‹ Mitt O-Tid», namnet och växeln. Arbetsytan har sin egen toppbalk. */
export function RaceTopBar() {
  const text = useTexts(raceTabsSv, raceTabsEn);
  const nav = useRaceNav();
  const pathname = usePathname() ?? "";
  if (!nav || raceNavPlacement(pathname) !== "page") return null;
  const { context } = nav;
  const name = shownRaceName(context.eventName, context.raceName);
  return <div className={styles.top} data-race-top data-testid="race-top">
    <header className={styles.topRow}>
      <Link className={styles.back} href="/organizer" aria-label={text.backLabel}><BackIcon /><span>{text.back}</span></Link>
      <div className={styles.topName}><strong>{context.eventName}</strong>
        <span>{name ? `${name} · ` : ""}{context.raceDate} · {text.modes[nav.mode]}</span></div>
    </header>
    <RaceModeSwitch />
  </div>;
}

/**
 * Raden nertill inne i arrangemanget i telefonbredd (ersätter flikraden Hem, Kartor …): flikarna för läget och Mer, eller på
 * speakern den smala raden. Ingenting här ger behörighet; listan följer rollen och servern prövar varje anrop.
 */
export function RaceTabBar() {
  const text = useTexts(raceTabsSv, raceTabsEn);
  const nav = useRaceNav();
  const pathname = usePathname() ?? "";
  const follow = useFollow();
  const [moreOpen, setMoreOpen] = useState(false);
  if (!nav) return null;
  const placement = raceNavPlacement(pathname);
  if (placement === "none") return null;
  const { tabs, more, all } = raceNavigation(nav.context, nav.mode);
  const active = activeRaceNavKey(pathname, nav.section);
  if (placement === "narrow") {
    const current = all.find(item => item.key === active);
    // Byt funktion: samma val som raden, lägets flikar först.
    return current ? <RaceNarrowBar current={current} items={[...tabs, ...more]} onSelect={follow} /> : null;
  }
  const moreActive = more.some(item => item.key === active);
  const workspace = placement === "workspace";
  return <>
    <nav className={styles.bar} aria-label={text.label} data-race-tabs data-testid="race-tabs" data-mode={nav.mode}>
      {tabs.map(item => <Link key={item.key} className={styles.tab} href={item.href} data-tab={item.key} prefetch={false}
        aria-current={item.key === active ? "page" : undefined} onClick={event => follow(item, event)}>
        <AppIcon name={RACE_ICONS[item.key]} /><span>{text.tabs[item.label]}</span></Link>)}
      <button type="button" className={styles.tab} data-tab="more" data-active={moreActive || undefined} aria-haspopup="dialog"
        aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}>
        <AppIcon name="more" /><span>{text.more}</span></button>
    </nav>
    <RaceSheet open={moreOpen} onClose={() => setMoreOpen(false)} title={text.moreTitle} items={more} active={active} onSelect={follow}
      testId="race-more" footer={workspace ? <button type="button" className={styles.sheetButton}
        onClick={() => { setMoreOpen(false); nav.workspace.current?.refresh(); }}>{text.refresh}</button> : null} />
  </>;
}

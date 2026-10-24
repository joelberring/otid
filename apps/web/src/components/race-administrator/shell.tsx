"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import styles from "./shell.module.css";
import { raceTypeSv as typeText } from "../../i18n/race-type-sv";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { checklistFacts, inForest, sectionStatus, type SectionFacts } from "../../lib/section-status";
import type { Section } from "../../lib/race-sections";
import type { Workspace } from "./workspace-state";
import { HelpButton } from "../help/help-panel";

function facts(ws: Workspace): SectionFacts | undefined {
  const { courseList, data, forestData, unknownReadoutCandidate } = ws;
  if (!data) return undefined;
  return checklistFacts(data, {
    courseCount: courseList && courseList.snapshotVersion >= data.snapshotVersion ? courseList.courses.length : undefined,
    inForest: forestData ? inForest(forestData.entries, forestData).length : undefined,
    unknownCards: unknownReadoutCandidate?.readouts.length
  });
}

/**
 * Fast toppbalk (ADR-0170 beslut 2): tillbaka till Mina tävlingar, tävlingen, läget just nu (avlästa, kvar i skogen,
 * okända brickor) och genvägar till avläsningen och speakern i egna flikar. På smal skärm (PLAN.md steg 24) ligger
 * genvägarna och Logga ut i en meny, så att tillbakalänken och räknarna alltid syns.
 */
export function TopBar({ ws }: { ws: Workspace }) {
  const { data, functionary, mayLeave, profile, raceId, refresh, logout, saving, section } = ws;
  const current = facts(ws);
  const shortcuts = (menu: boolean) => <>
    <a href={`/admin/${raceId}/readout`} target="_blank" rel="noopener">{data?.raceType === "PARTY" ? typeText.openPartyDesk : typeText.openReadout}
      <span className={styles.hidden}> ({typeText.newTab})</span></a>
    {profile.features.speaker && <a href={`/admin/${raceId}/speaker`} target="_blank" rel="noopener">{typeText.openSpeaker}
      <span className={styles.hidden}> ({typeText.newTab})</span></a>}
    <button type="button" className={menu ? styles.menuButton : styles.quiet} disabled={saving} onClick={() => void refresh()}>
      {text.refreshOverview}</button>
    <button type="button" className={menu ? styles.menuButton : styles.quiet} onClick={() => void logout()}>{text.logout}</button>
  </>;
  return <header className={styles.topBar}>
    <Link className={styles.back} href="/organizer" prefetch={false}
      onClick={event => { if (!mayLeave()) event.preventDefault(); }}>‹ {navigationText.backToEvents}</Link>
    {data && <div className={styles.race}>
      <h2>{data.eventName}</h2>
      <p>{data.raceName} · <time dateTime={data.raceDate}>{data.raceDate}</time> · {typeText.types[data.raceType].name}
        {functionary && <> · <strong className={styles.role}>{typeText.functionary}</strong></>}</p>
    </div>}
    {current && <p className={styles.live} aria-label={typeText.liveState}>
      <span><strong>{current.readOut}</strong> {typeText.live.readOut}</span>
      <span><strong>{current.inForest}</strong> {typeText.live.inForest}</span>
      {!!current.unknownCards && <span className={styles.liveAttention}><span aria-hidden="true">!</span>
        <strong>{current.unknownCards}</strong> {typeText.live.unknown(current.unknownCards)}</span>}
    </p>}
    <nav className={styles.actions} aria-label={typeText.shortcuts}>{shortcuts(false)}</nav>
    <details className={styles.menu}>
      <summary>{typeText.menu}</summary>
      <nav className={styles.menuItems} aria-label={typeText.shortcuts}>{shortcuts(true)}</nav>
    </details>
    {/* PLAN.md steg 37: hjälpen för steget man står i, alltid synlig (även på mobil). */}
    <div className={styles.help}><HelpButton view={section.id} /></div>
  </header>;
}

/**
 * Sidopanelen ritad som en bana (ADR-0170 beslut 2): starttriangel, en kontrollring per del med status i ord
 * och en målring. Bara den valda delen får accentfärgen. Inställningar ligger utanför banan.
 * På mobil blir den en remsa överst som går att rulla i sidled.
 */
export function Sidebar({ ws }: { ws: Workspace }) {
  const { data, navigateStep, profile, raceId, section: active } = ws;
  const current = facts(ws);
  const activeButton = useRef<HTMLButtonElement | null>(null);
  // Mobil: remsan rullar så att den valda delen syns.
  useEffect(() => { activeButton.current?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [active.id]);
  if (!data || !current) return null;
  const item = (section: Section, settings = false) => {
    const status = sectionStatus(section, current, data.raceType);
    const statusId = `section-${raceId}-${section.id}`;
    const selected = section.id === active.id;
    return <li key={section.id} className={settings ? styles.settingsItem : undefined}>
      <button type="button" ref={selected ? activeButton : undefined} aria-label={typeText.sections[section.label]} aria-describedby={statusId}
        aria-current={selected ? "step" : undefined} data-tone={status.tone}
        onClick={() => navigateStep(section.id)}>
        <span className={settings ? styles.square : styles.control} aria-hidden="true" />
        <span className={styles.name} aria-hidden="true">{typeText.sections[section.label]}</span>
        <span className={styles.status} id={statusId}>
          {status.tone === "ATTENTION" && <span className={styles.mark} aria-hidden="true">!</span>}{status.text}
        </span>
      </button>
    </li>;
  };
  return <nav className={styles.sidebar} aria-label={typeText.navigation}>
    <ol className={styles.course}>
      <li className={styles.start} aria-hidden="true"><svg viewBox="0 0 20 18" width="20" height="18"><path d="M10 1.5 18.5 16.5H1.5Z" /></svg>
        <span>{typeText.start}</span></li>
      {profile.course.map(section => item(section))}
      <li className={styles.finish} aria-hidden="true"><svg viewBox="0 0 22 22" width="22" height="22">
        <circle cx="11" cy="11" r="9.5" /><circle cx="11" cy="11" r="5.5" /></svg></li>
    </ol>
    {profile.settings && <ol className={styles.after}>{item(profile.settings, true)}</ol>}
  </nav>;
}

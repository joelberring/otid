"use client";

import { useEffect, useRef, useState } from "react";
import { raceTabsEn } from "../../i18n/race-tabs-en";
import { raceTabsSv } from "../../i18n/race-tabs-sv";
import type { RaceNavItem, RaceNavKey } from "../../lib/race-tabs";
import { useTexts } from "../language-provider";
import { AppIcon, ChevronIcon, type AppIconName } from "./app-icons";
import styles from "./race-tab-bar.module.css";

/**
 * Listan under Mer och Byt funktion (ADR-0227 tillägg 2026-11-18): en modal `<dialog>` med arrangemangets sidor, en rad per
 * sida med namn och vad som finns där. Används också av avläsningens statiska skal, så den har inga Next-beroenden.
 */
export function RaceSheet({ open, onClose, title, items, active, onSelect, newTab, footer, testId }: {
  open: boolean; onClose: () => void; title: string; items: readonly RaceNavItem[]; active?: RaceNavKey | undefined;
  /** Kallas före länken följs; `preventDefault` stoppar den (arbetsytan byter del själv eller har osparat). */
  onSelect?: ((item: RaceNavItem, event: React.MouseEvent<HTMLAnchorElement>) => void) | undefined;
  newTab?: boolean | undefined; footer?: React.ReactNode; testId: string;
}) {
  const text = useTexts(raceTabsSv, raceTabsEn);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  const titleId = `${testId}-title`;
  return <dialog ref={dialog} className={styles.sheet} aria-labelledby={titleId} data-testid={testId} onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={styles.sheetHead}>
      <h2 id={titleId}>{title}</h2>
      <button type="button" className={styles.sheetClose} onClick={onClose}>{text.close}</button>
    </div>
    {newTab && <p className={styles.sheetNote}>{text.newTab}</p>}
    <ul className={styles.sheetList}>
      {items.map(item => {
        const [name, hint] = text.items[item.label];
        return <li key={item.key}>
          <a href={item.href} data-item={item.key} aria-current={item.key === active ? "page" : undefined}
            {...(newTab ? { target: "_blank", rel: "noopener" } : {})}
            onClick={event => { onSelect?.(item, event); onClose(); }}>
            <span><strong>{name}</strong><small>{hint}</small></span><ChevronIcon className={styles.chevron} />
          </a>
        </li>;
      })}
    </ul>
    {footer}
  </dialog>;
}

/** Ikonen för en rad i tävlingsraden. */
export const RACE_ICONS: Record<RaceNavKey, AppIconName> = { courses: "course", classes: "classes", entries: "entries", start: "event",
  publish: "publish", secretariat: "secretariat", results: "results", party: "party", people: "club", settings: "more", readout: "readout",
  speaker: "speaker", exercise: "exercise", courseSetting: "map" };

/**
 * Avläsningen och speakern (byggda för stress) har ingen flikrad i telefonbredd, bara en smal rad nertill med funktionens namn
 * och Byt funktion, som öppnar samma val som raden (alla sidor rollen får använda) och vägen till Mitt O-Tid.
 */
export function RaceNarrowBar({ current, items, onSelect, newTab, backHref = "/organizer" }: {
  current: RaceNavItem; items: readonly RaceNavItem[]; onSelect?: ((item: RaceNavItem, event: React.MouseEvent<HTMLAnchorElement>) => void) | undefined;
  newTab?: boolean | undefined; backHref?: string;
}) {
  const text = useTexts(raceTabsSv, raceTabsEn);
  const [open, setOpen] = useState(false);
  return <>
    <nav className={styles.narrow} aria-label={text.label} data-race-tabs data-testid="race-narrow-bar">
      <span className={styles.narrowName}><AppIcon name={RACE_ICONS[current.key]} size={22} /><span>{text.tabs[current.label]}</span></span>
      <button type="button" className={styles.switchFunction} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen(true)}>{text.switchFunction}</button>
    </nav>
    <RaceSheet open={open} onClose={() => setOpen(false)} title={text.switchTitle} items={items} active={current.key} onSelect={onSelect}
      newTab={newTab} testId="race-switch-sheet"
      footer={<a className={styles.sheetBack} href={backHref} {...(newTab ? { target: "_blank", rel: "noopener" } : {})}>‹ {text.back}</a>} />
  </>;
}

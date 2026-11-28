"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { listEn } from "../../i18n/list-en";
import { listSv } from "../../i18n/list-sv";
import { dateTileParts } from "../../lib/human-date";
import { useLanguage, useTexts } from "../language-provider";
import styles from "./list-row.module.css";

/**
 * Steg F2 (ADR-0170 tillägg 2026-11-28): den täta raden i listorna. Hela raden är en länk som omsluter innehållet: datumbricka,
 * bildruta, namn och en rad uppgifter, och till höger små märken eller en status. Åtgärder som måste finnas på raden står
 * bredvid länken (aldrig i den). Linje under, ingen ruta och ingen skugga.
 */
export function RowList({ children, label, testId, className }: { children: ReactNode; label?: string | undefined;
  testId?: string | undefined; className?: string | undefined }) {
  return <ul className={`${styles.list}${className ? ` ${className}` : ""}`} aria-label={label} data-testid={testId}>{children}</ul>;
}

/**
 * En rad. `thumb`: utelämnad = ingen bildkolumn (ingen rad i listan har bild); `null` = raden saknar bild men behåller bildens
 * bredd tom, så att namnen linjerar med raderna som har bild.
 */
export function ListRow({ href, date, thumb, title, meta, end, actions, testId }: {
  href: string; date?: ReactNode; thumb?: ReactNode; title: ReactNode; meta?: ReactNode; end?: ReactNode; actions?: ReactNode;
  testId?: string | undefined;
}) {
  return <li className={styles.row} data-testid={testId}>
    <Link href={href} className={styles.link}>
      {date}
      {thumb !== undefined && (thumb ?? <span className={styles.thumbSlot} aria-hidden="true" data-testid="row-thumb-empty" />)}
      <span className={styles.body}>
        <span className={styles.title}>{title}</span>
        {meta && <span className={styles.meta}>{meta}</span>}
      </span>
      {end && <span className={styles.end}>{end}</span>}
    </Link>
    {actions && <span className={styles.actions}>{actions}</span>}
  </li>;
}

/**
 * Datumbrickan: veckodag, dag och (valfritt) månad. Odaterat ger ett streck; `endDate` ger flera dagar («9–11»). Skärmläsare
 * får hela datumet i klartext; brickans förkortningar är dolda för dem.
 */
export function DateTile({ date, endDate, month = true }: { date: string | null; endDate?: string | null | undefined; month?: boolean }) {
  const language = useLanguage();
  const text = useTexts(listSv, listEn);
  const start = date ? dateTileParts(date, language) : null;
  if (!date || !start) {
    return <span className={styles.tile} data-testid="date-tile">
      <span className={styles.tileDay} aria-hidden="true">–</span><span className="visually-hidden">{text.undated}</span>
    </span>;
  }
  const last = endDate && endDate !== date ? dateTileParts(endDate, language) : null;
  const span = (first: string, second: string | undefined) => second && second !== first ? `${first}–${second}` : first;
  return <time className={styles.tile} dateTime={date} data-testid="date-tile">
    <span aria-hidden="true" className={styles.tileWeekday}>{span(start.weekday, last?.weekday)}</span>{" "}
    <span aria-hidden="true" className={styles.tileDay}>{span(start.day, last?.day)}</span>{" "}
    {month && <><span aria-hidden="true" className={styles.tileMonth}>{span(start.month, last?.month)}</span>{" "}</>}
    <span className="visually-hidden">{last ? `${start.full} – ${last.full}` : start.full}</span>
  </time>;
}

/** Bildrutan: fast format 4:3 och fast storlek, beskuren (`cover`), laddas när den syns. */
export function Thumb({ src, alt, testId }: { src: string; alt: string; testId?: string | undefined }) {
  return <img className={styles.thumb} src={src} alt={alt} loading="lazy" decoding="async" data-testid={testId} />;
}

/** Rubriken för en grupp i en lista («November 2026», «2024», «Utan datum»). */
export function ListHeading({ children, level = 2, id }: { children: ReactNode; level?: 2 | 3; id?: string | undefined }) {
  const Heading = level === 2 ? "h2" : "h3";
  return <Heading className={styles.heading} id={id}>{children}</Heading>;
}

/** Ett litet märke till höger på raden (egna ord). */
export function RowBadge({ children }: { children: ReactNode }) {
  return <span className={styles.badge}>{children}</span>;
}

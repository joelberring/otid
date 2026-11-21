import Link from "next/link";
import type { NewsItem } from "@o-tid/contracts";
import { isInternalNewsLink } from "@o-tid/domain";
import { newsEn } from "../../i18n/news-en";
import { newsSv } from "../../i18n/news-sv";
import { LOCALE, type Language } from "../../lib/language";
import styles from "./start.module.css";

/**
 * Startsidans högerspalt (skissen F3 2026-11-21, ADR-0230): Nytt i O-Tid (högst tre, nyast först; klubbens nyheter märkta med
 * klubbens namn) och länkarna till filmerna. Spalten «Nytt» döljs när det inte finns några nyheter att visa (`homeNews`); bilden
 * är liten, 16:9 och laddas först när den syns. Ingen film spelar av sig själv.
 */
export function HomeNews({ items, language }: { items: readonly NewsItem[]; language: Language }) {
  const text = language === "en" ? newsEn : newsSv;
  if (items.length === 0) return null;
  const date = (value: string) => new Intl.DateTimeFormat(LOCALE[language], { timeZone: "Europe/Stockholm", day: "numeric", month: "short" })
    .format(new Date(value));
  return <section className={styles.news} aria-labelledby="nytt-rubrik" data-testid="home-news">
    <h2 id="nytt-rubrik" className={styles.label}>{text.title}</h2>
    <ul>
      {items.map(item => <li key={item.newsId} className={styles.newsItem}>
        {item.imageUrl && <img src={item.imageUrl} alt={text.imageAlt(item.title)} loading="lazy" decoding="async" width={item.imageWidth ?? 16}
          height={item.imageHeight ?? 9} />}
        <span className={styles.newsMeta}>{[item.clubName, date(item.publishedAt)].filter(Boolean).join(" · ")}</span>
        <h3>{!item.link ? item.title : isInternalNewsLink(item.link) ? <Link href={item.link}>{item.title}</Link>
          : <a href={item.link} rel="noopener">{item.title}</a>}</h3>
        {item.body && <p>{item.body}</p>}
      </li>)}
    </ul>
  </section>;
}

/** Filmerna (introduktionen och kartritningen), när adresserna är satta (docs/drift.md). */
export function HomeFilms({ film, mapFilm, labels, language }: { film?: string | undefined; mapFilm?: string | undefined;
  labels: { intro: string; map: string }; language: Language }) {
  if (!film && !mapFilm) return null;
  const text = language === "en" ? newsEn : newsSv;
  return <section className={styles.films} aria-labelledby="filmer-rubrik" data-testid="home-films">
    <h2 id="filmer-rubrik" className={styles.label}>{text.films}</h2>
    {film && <a href={film}>{labels.intro}</a>}
    {mapFilm && <a href={mapFilm}>{labels.map}</a>}
  </section>;
}

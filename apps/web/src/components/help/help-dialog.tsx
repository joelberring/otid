"use client";

import { useEffect, useRef, useState } from "react";
import type { HelpArticle, HelpView, helpSv } from "../../i18n/help-sv";
import type { Texts } from "../../lib/language";
import { PROGRAM_CONTACT_EMAIL } from "../../lib/contact";
import { helpTextParts, listHelpArticles } from "../../lib/help-search";
import styles from "./help-panel.module.css";

export type HelpViews = HelpView | readonly HelpView[];

export type HelpData = {
  readonly text: Texts<typeof helpSv>;
  readonly articles: readonly HelpArticle[];
  readonly synonyms: readonly (readonly string[])[];
  /** Engelska artikel-id när språket är engelska; saknas ett id visas svensk fallback med `lang="sv"`. */
  readonly englishIds?: ReadonlyMap<string, HelpArticle> | undefined;
};

export type HelpDialogBodyProps = {
  data: HelpData;
  views: HelpViews;
  first?: string | undefined;
  titleId: string;
  onRequestClose: () => void;
};

/**
 * Innehållet i hjälppanelen (laddas dynamiskt först när användaren öppnar Hjälp). Bevarar exakt sökning,
 * artikelordning, fokusflytt, interna länkar och filmlänkar från `help-panel.tsx`.
 */
export function HelpDialogBody({ data, views, first: initialFirst, titleId, onRequestClose }: HelpDialogBodyProps) {
  const { text, articles, synonyms, englishIds } = data;
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  // Artikeln som står först och är utfälld; räknaren gör att samma länk fäller ut artikeln igen.
  const [target, setTarget] = useState<{ id: string; count: number } | undefined>(initialFirst ? { id: initialFirst, count: 1 } : undefined);
  const [film, setFilm] = useState<string>();
  const [mapFilm, setMapFilm] = useState<string>();
  useEffect(() => {
    // Filmerna: layouten sätter adresserna på body när variablerna finns (läses vid förfrågan, inte bygget).
    setFilm(document.body.dataset.introFilm || undefined);
    setMapFilm(document.body.dataset.mapFilm || undefined);
    // Sökfältet först (showModal ger annars fokus till Stäng); från ett "?" artikeln som efterfrågades.
    if (initialFirst) list.current?.querySelector<HTMLElement>(`[data-help-article='${initialFirst}'] > summary`)?.focus();
    else input.current?.focus();
  }, [initialFirst]);
  useEffect(() => {
    if (!target || target.count === 1) return;
    list.current?.scrollTo({ top: 0 });
    list.current?.querySelector<HTMLElement>(`[data-help-article='${target.id}'] > summary`)?.focus();
  }, [target]);
  const searching = query.trim() !== "";
  const first = searching ? undefined : target?.id;
  const { here, rest } = listHelpArticles(articles, views, query, { first, synonyms });
  const count = here.length + rest.length;
  const follow = (id: string) => { setQuery(""); setTarget(current => ({ id, count: (current?.count ?? 1) + 1 })); };
  const article = (row: HelpArticle) => <Article key={`${row.id}-${searching}-${row.id === first ? target?.count : 0}`} article={row}
    open={searching || row.id === first} lang={englishIds && !englishIds.has(row.id) ? "sv" : undefined} onFollow={follow} />;
  return <div className={styles.panel}>
    <header className={styles.head}>
      <h2 id={titleId}>{text.title}</h2>
      <button type="button" className={styles.close} onClick={onRequestClose}>{text.close}</button>
    </header>
    <div className={styles.search} role="search">
      <label>{text.search}
        <input ref={input} type="search" value={query} autoComplete="off" placeholder={text.searchPlaceholder}
          onChange={event => setQuery(event.target.value)} />
      </label>
      {searching && <p role="status" className={styles.hits}>{text.hits(count)}{count === 0 ? <> {text.noHits}</> : null}</p>}
    </div>
    <div className={styles.articles} ref={list}>
      {here.length > 0 && <section aria-label={text.here}>
        <h3>{text.here}</h3>
        {here.map(article)}
      </section>}
      {rest.length > 0 && <section aria-label={here.length > 0 ? text.more : text.all}>
        <h3>{here.length > 0 ? text.more : text.all}</h3>
        {rest.map(article)}
      </section>}
    </div>
    <footer className={styles.foot}>
      <span className={styles.footLinks}>
        <a href="/om" target="_blank" rel="noopener">{text.about}<span className={styles.hidden}> ({text.newTab})</span></a>
        {film && <a href={film} target="_blank" rel="noopener">{text.film}<span className={styles.hidden}> ({text.newTab})</span></a>}
        {mapFilm && <a href={mapFilm} target="_blank" rel="noopener">{text.mapFilm}<span className={styles.hidden}> ({text.newTab})</span></a>}
      </span>
      <span>{text.contact} <a href={`mailto:${PROGRAM_CONTACT_EMAIL}`}>{PROGRAM_CONTACT_EMAIL}</a></span>
    </footer>
  </div>;
}

/** En text med länkar till andra artiklar (`[text](#id)`). */
function Text({ value, onFollow }: { value: string; onFollow: (id: string) => void }) {
  return <>{helpTextParts(value).map((part, index) => part.article
    ? <a key={index} href={`#hjalp-${part.article}`} className={styles.link} data-help-target={part.article}
      onClick={event => { event.preventDefault(); onFollow(part.article!); }}>{part.text}</a>
    : <span key={index}>{part.text}</span>)}</>;
}

/** En artikel som går att fälla ut. Vid sökning är träffarna utfällda, och en efterfrågad artikel också. */
function Article({ article, open, lang, onFollow }: { article: HelpArticle; open: boolean; lang?: string | undefined; onFollow: (id: string) => void }) {
  return <details className={styles.article} open={open} lang={lang} data-help-article={article.id} id={`hjalp-${article.id}`}>
    <summary>{article.title}</summary>
    <div className={styles.body}>
      {article.body.map((block, index) => typeof block === "string"
        ? <p key={index}><Text value={block} onFollow={onFollow} /></p>
        : "steps" in block
          ? <ol key={index}>{block.steps.map(item => <li key={item}><Text value={item} onFollow={onFollow} /></li>)}</ol>
          : <ul key={index}>{block.map(item => <li key={item}><Text value={item} onFollow={onFollow} /></li>)}</ul>)}
    </div>
  </details>;
}

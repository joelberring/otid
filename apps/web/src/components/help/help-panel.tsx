"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { helpArticles, helpSv, helpSynonyms, type HelpArticle, type HelpView } from "../../i18n/help-sv";
import { helpArticlesFor, helpEn, helpSynonymsEn } from "../../i18n/help-en";
import { useLanguage } from "../language-provider";
import { PROGRAM_CONTACT_EMAIL } from "../../lib/contact";
import { helpTextParts, listHelpArticles } from "../../lib/help-search";
import styles from "./help-panel.module.css";
import { inLanguage } from "../../lib/in-language";

type Views = HelpView | readonly HelpView[];

/** Panelens texter, artiklarna och synonymerna på sidans språk (engelska artiklar där de finns, annars svenska). */
function useHelp() {
  const en = useLanguage() === "en";
  return en ? { text: helpEn, articles: englishArticles, synonyms: helpSynonymsEn }
    : { text: helpSv, articles: helpArticles, synonyms: helpSynonyms };
}
const englishArticles = helpArticlesFor(helpArticles);

/**
 * Knappen Hjälp och hjälppanelen (PLAN.md steg 37, grenen hjalp-banlaggning). Panelen är en modal `<dialog>` vid sidans
 * högra kant (hela bredden på mobil): Esc och Stäng stänger, fokus stannar i panelen och går tillbaka till knappen
 * efteråt. Den visar först artiklarna för vyerna man står i (i vyernas ordning), sedan alla, och söker lokalt med
 * synonymer. Artiklarna länkar till varandra. Används i arbetsytan, Mina tävlingar, banläggningen, utskriftssidan,
 * klubbarkivet, kontrollkartan och på avläsningssidan (som byggs utan Next, därför vanliga länkar och inga inline-stilar:
 * avläsningens CSP tillåter dem inte).
 *
 * `compact`: bara frågetecknet på smal skärm (banläggningens rad överst).
 */
export function HelpButton({ view, large = false, compact = false }: { view: Views; large?: boolean; compact?: boolean }) {
  const { text } = useHelp();
  const [open, setOpen] = useState(false);
  const className = [styles.button, large ? styles.large : "", compact ? styles.compact : ""].filter(Boolean).join(" ");
  return <>
    <button type="button" className={className} aria-haspopup="dialog" aria-expanded={open} aria-label={compact ? text.button : undefined}
      title={compact ? text.button : undefined} onClick={() => setOpen(true)} data-testid="help-button">
      <span className={styles.mark} aria-hidden="true">?</span><span className={styles.label}>{text.button}</span>
    </button>
    {open && createPortal(<HelpDialog views={view} onClose={() => setOpen(false)} />, document.body)}
  </>;
}

/**
 * Ett litet "?" vid en knapp eller ruta som är svår att förstå. Öppnar panelen med artikeln först och utfälld; resten
 * av listan följer artikelns vyer (eller `view`).
 */
export function HelpLink({ article, view, label: shownLabel }: { article: string; view?: Views | undefined;
  /** En textlänk i stället för "?" (t.ex. "Hur lägger man en gul bana?"). */
  label?: string | undefined }) {
  const [open, setOpen] = useState(false);
  const { text, articles } = useHelp();
  const found = articles.find(row => row.id === article);
  if (!found) throw new Error(inLanguage(`Hjälpartikeln ${article} finns inte`, `The help article ${article} does not exist`));
  const label = text.link(found.title);
  return <>
    {shownLabel
      ? <button type="button" className={styles.textLink} aria-haspopup="dialog" aria-expanded={open} title={label} data-help-link={article}
        onClick={() => setOpen(true)}>{shownLabel}</button>
      : <button type="button" className={styles.inline} aria-haspopup="dialog" aria-expanded={open} aria-label={label} title={label}
        data-help-link={article} onClick={() => setOpen(true)}><span aria-hidden="true">?</span></button>}
    {open && createPortal(<HelpDialog views={view ?? found.views} first={article} onClose={() => setOpen(false)} />, document.body)}
  </>;
}

function HelpDialog({ views, first: initialFirst, onClose }: { views: Views; first?: string | undefined; onClose: () => void }) {
  const { text, articles, synonyms } = useHelp();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  // Artikeln som står först och är utfälld; räknaren gör att samma länk fäller ut artikeln igen.
  const [target, setTarget] = useState<{ id: string; count: number } | undefined>(initialFirst ? { id: initialFirst, count: 1 } : undefined);
  const [film, setFilm] = useState<string>();
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    // Introfilmen: layouten sätter adressen på body när NEXT_PUBLIC_INTRO_FILM_URL finns (läses vid förfrågan, inte bygget).
    setFilm(document.body.dataset.introFilm || undefined);
    // Sökfältet först (showModal ger annars fokus till Stäng); från ett "?" artikeln som efterfrågades.
    if (initialFirst) list.current?.querySelector<HTMLElement>(`[data-help-article='${initialFirst}'] > summary`)?.focus();
    else input.current?.focus();
  }, []);
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
    open={searching || row.id === first} onFollow={follow} />;
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} data-testid="help-panel"
    onClose={onClose} onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
    // Esc stänger direkt, även när sökfältet har text (annars tömmer det första Esc bara fältet).
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.currentTarget.close(); } }}>
    <div className={styles.panel}>
      <header className={styles.head}>
        <h2 id={titleId}>{text.title}</h2>
        <button type="button" className={styles.close} onClick={() => dialog.current?.close()}>{text.close}</button>
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
        </span>
        <span>{text.contact} <a href={`mailto:${PROGRAM_CONTACT_EMAIL}`}>{PROGRAM_CONTACT_EMAIL}</a></span>
      </footer>
    </div>
  </dialog>;
}

/** En text med länkar till andra artiklar (`[text](#id)`). */
function Text({ value, onFollow }: { value: string; onFollow: (id: string) => void }) {
  return <>{helpTextParts(value).map((part, index) => part.article
    ? <a key={index} href={`#hjalp-${part.article}`} className={styles.link} data-help-target={part.article}
      onClick={event => { event.preventDefault(); onFollow(part.article!); }}>{part.text}</a>
    : <span key={index}>{part.text}</span>)}</>;
}

/** En artikel som går att fälla ut. Vid sökning är träffarna utfällda, och en efterfrågad artikel också. */
function Article({ article, open, onFollow }: { article: HelpArticle; open: boolean; onFollow: (id: string) => void }) {
  return <details className={styles.article} open={open} data-help-article={article.id} id={`hjalp-${article.id}`}>
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

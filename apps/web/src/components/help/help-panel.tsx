"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { helpArticles, helpSv as text, type HelpArticle, type HelpView } from "../../i18n/help-sv";
import { PROGRAM_CONTACT_EMAIL } from "../../lib/contact";
import { listHelpArticles } from "../../lib/help-search";
import styles from "./help-panel.module.css";

/**
 * Knappen Hjälp och hjälppanelen (PLAN.md steg 37). Panelen är en modal `<dialog>` vid sidans högra kant (hela
 * bredden på mobil): Esc och Stäng stänger, fokus stannar i panelen och går tillbaka till knappen efteråt. Den visar
 * först artiklarna för vyn man står i, sedan alla, och söker lokalt. Används i arbetsytan, Mina tävlingar och på
 * avläsningssidan (som byggs utan Next, därför vanliga länkar och inga inline-stilar: avläsningens CSP tillåter dem inte).
 */
export function HelpButton({ view, large = false }: { view: HelpView; large?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={large ? `${styles.button} ${styles.large}` : styles.button} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(true)}>
      <span className={styles.mark} aria-hidden="true">?</span>{text.button}
    </button>
    {open && createPortal(<HelpDialog view={view} onClose={() => setOpen(false)} />, document.body)}
  </>;
}

function HelpDialog({ view, onClose }: { view: HelpView; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    // Sökfältet först: showModal ger annars fokus till Stäng.
    input.current?.focus();
  }, []);
  const searching = query.trim() !== "";
  const { here, rest } = listHelpArticles(helpArticles, view, query);
  const count = here.length + rest.length;
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
      <div className={styles.articles}>
        {here.length > 0 && <section aria-label={text.here}>
          <h3>{text.here}</h3>
          {here.map(article => <Article key={`${article.id}-${searching}`} article={article} open={searching} />)}
        </section>}
        {rest.length > 0 && <section aria-label={here.length > 0 ? text.more : text.all}>
          <h3>{here.length > 0 ? text.more : text.all}</h3>
          {rest.map(article => <Article key={`${article.id}-${searching}`} article={article} open={searching} />)}
        </section>}
      </div>
      <footer className={styles.foot}>
        <a href="/om" target="_blank" rel="noopener">{text.about}<span className={styles.hidden}> ({text.newTab})</span></a>
        <span>{text.contact} <a href={`mailto:${PROGRAM_CONTACT_EMAIL}`}>{PROGRAM_CONTACT_EMAIL}</a></span>
      </footer>
    </div>
  </dialog>;
}

/** En artikel som går att fälla ut. Vid sökning är träffarna utfällda. */
function Article({ article, open }: { article: HelpArticle; open: boolean }) {
  return <details className={styles.article} open={open} data-help-article={article.id}>
    <summary>{article.title}</summary>
    <div className={styles.body}>
      {article.body.map((block, index) => typeof block === "string"
        ? <p key={index}>{block}</p>
        : <ul key={index}>{block.map(item => <li key={item}>{item}</li>)}</ul>)}
    </div>
  </details>;
}

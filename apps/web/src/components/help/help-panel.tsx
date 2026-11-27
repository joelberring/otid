"use client";

import { useEffect, useId, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import type { HelpArticle } from "../../i18n/help-sv";
import { useLanguage } from "../language-provider";
import { inLanguage } from "../../lib/in-language";
import type { HelpData, HelpDialogBodyProps, HelpViews } from "./help-dialog";
import { findHelpMeta, HELP_ARTICLE_META, helpMetaText } from "./help-meta";
import styles from "./help-panel.module.css";

type HelpLang = "sv" | "en";
type LoadedHelp = { Body: ComponentType<HelpDialogBodyProps>; data: HelpData };

let cachedBody: ComponentType<HelpDialogBodyProps> | undefined;
let bodyPromise: Promise<ComponentType<HelpDialogBodyProps>> | undefined;
const cachedData: Partial<Record<HelpLang, HelpData>> = {};
const dataPromises: Partial<Record<HelpLang, Promise<HelpData>>> = {};

function loadDialogBody(): Promise<ComponentType<HelpDialogBodyProps>> {
  if (cachedBody) return Promise.resolve(cachedBody);
  if (!bodyPromise) {
    bodyPromise = import("./help-dialog")
      .then(mod => { cachedBody = mod.HelpDialogBody; return mod.HelpDialogBody; })
      .catch(error => { bodyPromise = undefined; throw error; });
  }
  return bodyPromise;
}

/** Laddar enbart aktivt språks hjälpartiklar (`help-sv` eller `help-en`) dynamiskt först när hjälpen öppnas. */
export function loadHelpData(en: boolean): Promise<HelpData> {
  const lang: HelpLang = en ? "en" : "sv";
  const existing = cachedData[lang];
  if (existing) return Promise.resolve(existing);
  if (!dataPromises[lang]) {
    const promise: Promise<HelpData> = en ? (async () => {
      const enMod = await import("../../i18n/help-en");
      const ordered = HELP_ARTICLE_META.map(meta => enMod.helpArticlesEnById.get(meta.id));
      if (ordered.every((article): article is HelpArticle => article !== undefined)) {
        return { text: enMod.helpEn, articles: ordered, synonyms: enMod.helpSynonymsEn, englishIds: enMod.helpArticlesEnById };
      }
      const svMod = await import("../../i18n/help-sv");
      return { text: enMod.helpEn, articles: enMod.helpArticlesFor(svMod.helpArticles), synonyms: enMod.helpSynonymsEn, englishIds: enMod.helpArticlesEnById };
    })() : (async () => {
      const svMod = await import("../../i18n/help-sv");
      return { text: svMod.helpSv, articles: svMod.helpArticles, synonyms: svMod.helpSynonyms };
    })();
    dataPromises[lang] = promise
      .then(data => { cachedData[lang] = data; return data; })
      .catch(error => { delete dataPromises[lang]; throw error; });
  }
  return dataPromises[lang];
}

function getCachedHelp(en: boolean): LoadedHelp | undefined {
  const data = cachedData[en ? "en" : "sv"];
  return cachedBody && data ? { Body: cachedBody, data } : undefined;
}

function loadHelpBundle(en: boolean): Promise<LoadedHelp> {
  return Promise.all([loadDialogBody(), loadHelpData(en)]).then(([Body, data]) => ({ Body, data }));
}

/**
 * Knappen Hjälp och hjälppanelen (PLAN.md steg 37, grenen hjalp-banlaggning). Panelen är en modal `<dialog>` vid sidans
 * högra kant (hela bredden på mobil): Esc och Stäng stänger, fokus stannar i panelen och går tillbaka till knappen
 * efteråt. Själva dialoginnehållet och aktivt språks hjälpartiklar laddas dynamiskt först när användaren öppnar panelen;
 * används också på avläsningssidan (byggs utan Next av esbuild, därför ren `import()` och inga inline-stilar).
 *
 * `compact`: bara frågetecknet på smal skärm (banläggningens rad överst).
 */
export function HelpButton({ view, large = false, compact = false }: { view: HelpViews; large?: boolean; compact?: boolean }) {
  const text = helpMetaText[useLanguage() === "en" ? "en" : "sv"];
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
export function HelpLink({ article, view, label: shownLabel }: { article: string; view?: HelpViews | undefined;
  /** En textlänk i stället för "?" (t.ex. "Hur lägger man en gul bana?"). */
  label?: string | undefined }) {
  const [open, setOpen] = useState(false);
  const en = useLanguage() === "en";
  const text = helpMetaText[en ? "en" : "sv"];
  const found = findHelpMeta(article);
  if (!found) throw new Error(inLanguage(`Hjälpartikeln ${article} finns inte`, `The help article ${article} does not exist`));
  const label = text.link(en ? found.en : found.sv);
  return <>
    {shownLabel
      ? <button type="button" className={styles.textLink} aria-haspopup="dialog" aria-expanded={open} title={label} data-help-link={article}
        onClick={() => setOpen(true)}>{shownLabel}</button>
      : <button type="button" className={styles.inline} aria-haspopup="dialog" aria-expanded={open} aria-label={label} title={label}
        data-help-link={article} onClick={() => setOpen(true)}><span aria-hidden="true">?</span></button>}
    {open && createPortal(<HelpDialog views={view ?? found.views} first={article} onClose={() => setOpen(false)} />, document.body)}
  </>;
}

function HelpDialog({ views, first, onClose }: { views: HelpViews; first?: string | undefined; onClose: () => void }) {
  const en = useLanguage() === "en";
  const metaText = helpMetaText[en ? "en" : "sv"];
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [loaded, setLoaded] = useState<LoadedHelp | undefined>(() => getCachedHelp(en));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  useEffect(() => {
    const ready = getCachedHelp(en);
    if (ready) { setLoaded(ready); setFailed(false); return; }
    let cancelled = false;
    setFailed(false);
    void loadHelpBundle(en).then(
      bundle => { if (!cancelled) setLoaded(bundle); },
      () => { if (!cancelled) setFailed(true); }
    );
    return () => { cancelled = true; };
  }, [en, attempt]);

  const requestClose = () => {
    if (dialog.current?.open) dialog.current.close();
    else onClose();
  };

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} data-testid="help-panel"
    onClose={onClose} onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
    // Esc stänger direkt, även när sökfältet har text (annars tömmer det första Esc bara fältet).
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.currentTarget.close(); } }}>
    {loaded
      ? <loaded.Body data={loaded.data} views={views} first={first} titleId={titleId} onRequestClose={requestClose} />
      : <div className={styles.panel}>
        <header className={styles.head}>
          <h2 id={titleId}>{metaText.title}</h2>
          <button type="button" className={styles.close} onClick={requestClose}>{metaText.close}</button>
        </header>
        <div className={styles.status}>
          {failed ? <>
            <p role="alert">{metaText.failed}</p>
            <div><button type="button" className={styles.close} onClick={() => setAttempt(count => count + 1)}>{metaText.retry}</button></div>
          </> : <p role="status">{metaText.loading}</p>}
        </div>
      </div>}
  </dialog>;
}

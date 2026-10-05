"use client";

import React, { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { listsSv as text } from "../../i18n/lists-sv";
import styles from "./lists.module.css";

/** IOF XML-export: en länk (publika sidor) eller en åtgärd (arbetsytan). Saknas när listan inte har någon IOF-fil. */
export type IofExport = { href: string } | { onSelect: () => void; disabled?: boolean };

export type ListToolbarProps<View extends string> = {
  views: readonly { id: View; label: string }[];
  view: View; onView: (view: View) => void;
  query: string; onQuery: (query: string) => void; searchPlaceholder: string;
  classes: readonly string[]; className: string; onClass: (className: string) => void;
  count: string;
  iof?: IofExport | undefined;
  onCsv: () => void;
};

const printTime = () => new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short" }).format(new Date());

/** Sparar en textfil i webbläsaren. */
export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * Listans ram (PLAN.md steg 13): verktygsraden med vy, sök, klass, utskrift och export, som står kvar under
 * toppbalken när man rullar, samt utskriftsrubriken (tävling, listans namn och utskriftstid) som bara syns på papper.
 * Tabellernas rubrikrader fäster under verktygsraden.
 */
export function ListFrame<View extends string>({ toolbar, title, race, children }: {
  toolbar: ListToolbarProps<View>; title: string; race: string; children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null), bar = useRef<HTMLDivElement>(null), menu = useRef<HTMLDetailsElement>(null);
  const [printedAt, setPrintedAt] = useState("");
  useEffect(() => {
    setPrintedAt(printTime());
    const before = () => setPrintedAt(printTime());
    window.addEventListener("beforeprint", before);
    return () => window.removeEventListener("beforeprint", before);
  }, []);
  // Verktygsraden fäster där sidans fasta rubrik slutar; tabellrubrikerna fäster under verktygsraden.
  useLayoutEffect(() => {
    const element = root.current, toolbarElement = bar.current;
    if (!element || !toolbarElement || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const outer = Number.parseFloat(getComputedStyle(element.parentElement ?? element).getPropertyValue("--sticky-top")) || 0;
      element.style.setProperty("--list-toolbar-top", `${outer}px`);
      element.style.setProperty("--sticky-top", `${outer + toolbarElement.offsetHeight}px`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(toolbarElement);
    window.addEventListener("resize", update);
    update();
    return () => { observer.disconnect(); window.removeEventListener("resize", update); };
  }, []);
  const close = () => { if (menu.current) menu.current.open = false; };
  const { views, view, onView, query, onQuery, searchPlaceholder, classes, className, onClass, count, iof, onCsv } = toolbar;
  return <div className={styles.lists} ref={root} data-list="">
    <div className={styles.toolbar} ref={bar} role="toolbar" aria-label={text.toolbar}>
      <div className={styles.segmented} role="group" aria-label={text.view}>
        {views.map(item => <button key={item.id} type="button" aria-pressed={item.id === view} onClick={() => onView(item.id)}>{item.label}</button>)}
      </div>
      <div className={styles.filters}>
        <label className={styles.search}><span className={styles.hiddenLabel}>{text.search}</span>
          <input type="search" autoComplete="off" placeholder={searchPlaceholder} value={query} onChange={event => onQuery(event.target.value)} /></label>
        <label className={styles.classFilter}><span className={styles.hiddenLabel}>{text.classFilter}</span>
          <select value={className} onChange={event => onClass(event.target.value)}>
            <option value="">{text.allClasses}</option>
            {classes.map(name => <option key={name} value={name}>{name}</option>)}
          </select></label>
      </div>
      <p className={styles.count} aria-live="polite">{count}</p>
      <div className={styles.tools}>
        <button type="button" onClick={() => { setPrintedAt(printTime()); window.print(); }}>{text.print}</button>
        <details className={styles.menu} ref={menu}>
          <summary>{text.export}</summary>
          <div className={styles.menuItems}>
            {!iof ? <span>{text.exportIofUnavailable}</span> : "href" in iof
              ? <a href={iof.href} download onClick={close}>{text.exportIof}</a>
              : <button type="button" disabled={iof.disabled} onClick={() => { close(); iof.onSelect(); }}>{text.exportIof}</button>}
            <button type="button" onClick={() => { close(); onCsv(); }}>{text.exportCsv}</button>
          </div>
        </details>
      </div>
    </div>
    <header className={styles.printHeader}>
      <h2>{title}</h2>
      <p>{race}</p>
      <p>{printedAt && text.printedAt(printedAt)}</p>
    </header>
    <div className={styles.body}>{children}</div>
  </div>;
}

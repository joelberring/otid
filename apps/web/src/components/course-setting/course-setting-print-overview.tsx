"use client";

import { useState, type ReactNode } from "react";
import { printOverviewEn } from "../../i18n/course-setting-print-en";
import { useTexts } from "../language-provider";
import type { PaperTemplate } from "@o-tid/course-setting";
import { printOverviewSv } from "../../i18n/course-setting-print-overview-sv";
import type { SheetCard } from "../../lib/course-setting-print-overview";
import { Button } from "../ui";
import styles from "./course-setting-print-overview.module.css";

const thousands = (value: number) => Math.round(value).toLocaleString("sv-SE").replace(/\s/g, " ");

/**
 * ADR-0211 beslut 7: översikten över alla ark, sidans huvudvy. Ett kort per ark med en liten bild, bana, skala, papper och
 * mall, märken ("Följer mallen …", "Ändrad för banan") och varningar. Ett klick öppnar arket i redigeringen nedanför;
 * kryssrutorna markerar kort för "Använd mallen …" och "Skriv ut markerade". På telefonen en lista.
 */
export function PrintOverview({ cards, thumb, selected, onOpen, templates, readOnly, onApplyTemplate, onPrintMarked }: {
  cards: readonly SheetCard[]; thumb: (card: SheetCard) => ReactNode; selected: string | undefined; onOpen: (card: SheetCard) => void;
  templates: readonly PaperTemplate[]; readOnly: boolean;
  /** Mallen på banorna (id), eller på alla banor när listan saknas. */
  onApplyTemplate: (template: PaperTemplate, courses: readonly string[] | "ALL") => void;
  onPrintMarked: (keys: readonly string[]) => void;
}) {
  const text = useTexts(printOverviewSv, printOverviewEn);
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const [templateId, setTemplateId] = useState("");
  const template = templates.find(item => item.id === templateId) ?? templates[0];
  const markedCourses = [...new Set(cards.filter(card => marked.has(card.key) && card.course && card.course !== "ALL_CONTROLS").map(card => card.course!))];
  const toggle = (key: string, on: boolean) => setMarked(current => { const next = new Set(current); if (on) next.add(key); else next.delete(key); return next; });
  if (cards.length === 0) return null;
  return <section className={styles.overview} aria-labelledby="print-overview" data-testid="print-overview">
    <div className={styles.head}>
      <h2 id="print-overview">{text.heading(cards.length)}</h2>
      <p className={styles.muted}>{text.help}</p>
    </div>
    <div className={styles.toolbar} role="group" aria-label={text.tools}>
      <label className={styles.check}><input type="checkbox" checked={marked.size === cards.length && cards.length > 0} data-testid="print-overview-mark-all"
        onChange={event => setMarked(event.target.checked ? new Set(cards.map(card => card.key)) : new Set())} />{text.markAll}</label>
      <span className={styles.muted} data-testid="print-overview-marked">{text.marked(marked.size)}</span>
      <Button variant="secondary" disabled={marked.size === 0} onClick={() => onPrintMarked([...marked])} data-testid="print-overview-print">{text.printMarked}</Button>
      {!readOnly && templates.length > 0 && <>
        <label className={styles.field}>{text.template}
          <select value={template?.id ?? ""} onChange={event => setTemplateId(event.target.value)} data-testid="print-overview-template">
            {templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <Button variant="secondary" disabled={!template || markedCourses.length === 0} data-testid="print-overview-apply"
          onClick={() => template && onApplyTemplate(template, markedCourses)}>{text.applyMarked(markedCourses.length)}</Button>
        <Button disabled={!template} data-testid="print-overview-apply-all" onClick={() => template && onApplyTemplate(template, "ALL")}>{text.applyAll}</Button>
      </>}
    </div>
    <ul className={styles.grid}>
      {cards.map(card => <li key={card.key} className={styles.card} data-testid="print-card" data-course={card.course ?? ""} data-selected={selected === card.key ? "" : undefined}
        data-warnings={card.warnings.join(" ")}>
        <button type="button" className={styles.open} onClick={() => onOpen(card)} aria-label={text.open(card.label)} data-testid="print-card-open">
          <span className={styles.thumb} aria-hidden="true">{thumb(card)}</span>
          <span className={styles.title}>{card.label}</span>
          <span className={styles.facts}>{[card.scale ? `1:${thousands(card.scale)}` : "", card.paper, card.sheetLayout ? text.layout(card.sheetLayout) : ""]
            .filter(Boolean).join(" · ")}</span>
          <span className={styles.badges}>
            {card.paperTemplate && <span className={styles.badge} data-testid="print-card-template">{text.follows(card.paperTemplate)}</span>}
            {card.changed && <span className={styles.badge} data-testid="print-card-changed">{text.changed}</span>}
            {card.back && <span className={styles.badge}>{text.back}</span>}
            {card.warnings.map(warning => <span key={warning} className={styles.warning} data-testid="print-card-warning">⚠ {text.warnings[warning]}</span>)}
          </span>
        </button>
        <label className={styles.mark}><input type="checkbox" checked={marked.has(card.key)} onChange={event => toggle(card.key, event.target.checked)}
          aria-label={text.mark(card.label)} data-testid="print-card-mark" /></label>
      </li>)}
    </ul>
  </section>;
}

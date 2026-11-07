"use client";

import Link from "next/link";
import type { LayoutEntry } from "@o-tid/course-setting";
import { printWhatSv as text } from "../../i18n/course-setting-layout-sv";
import type { PrintCount } from "../../lib/course-setting-print-what";
import styles from "./course-setting-print-page.module.css";

/**
 * ADR-0217 beslut 8: Utskrift-flikens urval. Layouten för "alla ark i en layout", klasserna och antalet (anmälda + reserver
 * eller eget). Papperet redigeras i Layout (länken).
 */
export function PrintWhat({ raceId, mode, entries, layout, onLayout, count, onCount, classes, chosenClasses, onClasses }: {
  raceId: string; mode: "COURSES" | "CLASSES" | "PROOF"; entries: readonly LayoutEntry[]; layout: string; onLayout: (layout: string) => void;
  count: PrintCount; onCount: (count: PrintCount) => void; classes: readonly string[]; chosenClasses: readonly string[]; onClasses: (classes: string[]) => void;
}) {
  const toggle = (name: string, on: boolean) => onClasses(on ? [...chosenClasses, name] : chosenClasses.filter(item => item !== name));
  return <div className={styles.stack} data-testid="print-what">
    {mode === "COURSES" && <label className={styles.field}>{text.layout}
      <select value={layout} onChange={event => onLayout(event.target.value)} data-testid="print-layout">
        {entries.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
    {mode === "CLASSES" && (classes.length === 0 ? <p className={styles.muted}>{text.noClasses}</p> : <fieldset className={styles.courses} data-testid="print-classes">
      <legend>{text.classes}</legend>
      <label><input type="checkbox" checked={classes.every(name => chosenClasses.includes(name))} onChange={event => onClasses(event.target.checked ? [...classes] : [])} />
        {text.allClasses}</label>
      {classes.map(name => <label key={name}><input type="checkbox" checked={chosenClasses.includes(name)} onChange={event => toggle(name, event.target.checked)} />{name}</label>)}
    </fieldset>)}
    {mode !== "PROOF" && <div className={styles.row} role="radiogroup" aria-label={text.count}>
      <span>{text.count}:</span>
      <label className={styles.check}><input type="radio" name="print-count" checked={count.kind === "ENTERED"} data-testid="print-count-entered"
        onChange={() => onCount({ kind: "ENTERED" })} />{text.entered}</label>
      <label className={styles.check}><input type="radio" name="print-count" checked={count.kind === "OWN"} data-testid="print-count-own"
        onChange={() => onCount({ kind: "OWN", copies: 1 })} />{text.own}</label>
      {count.kind === "OWN" && <label className={styles.field}>{text.copies}<input type="number" min={1} max={500} value={count.copies} size={4}
        data-testid="print-copies" onChange={event => onCount({ kind: "OWN", copies: Math.max(1, Math.min(500, Number(event.target.value) || 1)) })} /></label>}
    </div>}
    <Link href={`/admin/${raceId}/course-setting/layout`} className={styles.muted}>{text.layoutLink}</Link>
  </div>;
}

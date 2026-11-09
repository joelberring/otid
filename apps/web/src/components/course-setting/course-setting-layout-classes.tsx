"use client";

import { useState } from "react";
import { layoutEn } from "../../i18n/course-setting-layout-en";
import { useTexts } from "../language-provider";
import { MAIN_LAYOUT, type CourseSettingEdit, type LayoutEntry } from "@o-tid/course-setting";
import { layoutSv } from "../../i18n/course-setting-layout-sv";
import type { ClassRow } from "../../lib/course-setting-layouts";
import { Button } from "../ui";
import styles from "./course-setting-layout.module.css";

/**
 * ADR-0217 beslut 4: klasstabellen. En klass har en layout (reserverna följer klassen); banan kommer från tävlingen. Massval:
 * markera klasser och ge dem en layout.
 */
export function LayoutClasses({ rows, entries, readOnly, save }: { rows: readonly ClassRow[]; entries: readonly LayoutEntry[]; readOnly: boolean;
  save: (edits: CourseSettingEdit[]) => Promise<boolean> }) {
  const text = useTexts(layoutSv, layoutEn);
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const [target, setTarget] = useState<string>(MAIN_LAYOUT);
  const set = (names: readonly string[], layout: string) => save([{ type: "SET_CLASS_LAYOUTS",
    classes: Object.fromEntries(names.map(name => [name, layout === MAIN_LAYOUT ? null : layout])) }]);
  const all = rows.length > 0 && rows.every(row => marked.has(row.name));
  const choices = entries.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>);
  return <section className={styles.panel} aria-labelledby="layout-classes" data-testid="layout-classes">
    <h2 id="layout-classes">{text.classes.heading}</h2>
    <p className={styles.muted}>{text.classes.help}</p>
    {rows.length === 0 ? <p className={styles.muted}>{text.classes.none}</p> : <>
      {!readOnly && <div className={styles.row}>
        <span>{text.classes.marked(marked.size)}</span>
        <label className={styles.field}>{text.classes.setMarked}
          <select value={target} onChange={event => setTarget(event.target.value)} data-testid="layout-classes-target">{choices}</select></label>
        <Button variant="secondary" disabled={marked.size === 0} data-testid="layout-classes-apply"
          onClick={() => void set([...marked], target).then(ok => { if (ok) setMarked(new Set()); })}>{text.classes.apply}</Button>
      </div>}
      <div className={styles.matrixWrap}>
        <table className={styles.classTable} data-testid="layout-class-table">
          <thead><tr>
            <th scope="col"><input type="checkbox" aria-label={text.classes.markAll} checked={all} disabled={readOnly}
              onChange={event => setMarked(event.target.checked ? new Set(rows.map(row => row.name)) : new Set())} /></th>
            <th scope="col">{text.classes.name}</th><th scope="col">{text.classes.course}</th><th scope="col">{text.classes.layout}</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.name} data-testid="layout-class-row" data-class={row.name} data-layout={row.layout}>
            <td><input type="checkbox" aria-label={text.classes.mark(row.name)} checked={marked.has(row.name)} disabled={readOnly}
              onChange={event => setMarked(current => { const next = new Set(current); if (event.target.checked) next.add(row.name); else next.delete(row.name); return next; })} /></td>
            <th scope="row">{row.name}</th><td>{row.courseNames.join(", ")}</td>
            <td><select value={row.layout} disabled={readOnly} aria-label={`${text.classes.layout} ${row.name}`} data-testid="layout-class-select"
              onChange={event => void set([row.name], event.target.value)}>{choices}</select></td>
          </tr>)}</tbody>
        </table>
      </div>
    </>}
  </section>;
}

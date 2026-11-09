"use client";

import { useState } from "react";
import { layoutEn } from "../../i18n/course-setting-layout-en";
import { useTexts } from "../language-provider";
import { compareLayoutState, MAIN_LAYOUT, type CourseSettingDocument, type CourseSettingEdit, type LayoutStateDifference } from "@o-tid/course-setting";
import { layoutSv } from "../../i18n/course-setting-layout-sv";
import { Button } from "../ui";
import styles from "./course-setting-layout.module.css";

/**
 * ADR-0217 beslut 8: sparade lägen. "Spara läge" (namn), och per läge "Jämför" (vad som skiljer mot nu), "Återställ" (kan
 * ångras) och "Ta bort". "Från Purple Pen" görs automatiskt när en .ppen läses in.
 */
export function LayoutStates({ document, readOnly, save, layoutName, courseName }: { document: CourseSettingDocument; readOnly: boolean;
  save: (edits: CourseSettingEdit[]) => Promise<boolean>; layoutName: (id: string) => string; courseName: (id: string) => string }) {
  const text = useTexts(layoutSv, layoutEn);
  const [name, setName] = useState("");
  const [compared, setCompared] = useState<string>();
  const states = [...(document.event.layoutStates ?? [])].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const describe = (row: LayoutStateDifference) => {
    switch (row.kind) {
      case "LAYOUT": return text.states.differences.LAYOUT(row.layout === MAIN_LAYOUT ? layoutName(MAIN_LAYOUT) : row.name, row.change);
      case "SHEET": return text.states.differences.SHEET(courseName(row.course), layoutName(row.layout));
      case "CLASS": return text.states.differences.CLASS(row.className, layoutName(row.from), layoutName(row.to));
      case "TEMPLATES": return text.states.differences.TEMPLATES;
      case "PROFILE": return text.states.differences.PROFILE;
    }
  };
  const when = (iso: string) => new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
  return <section className={styles.panel} aria-labelledby="layout-states" data-testid="layout-states">
    <h2 id="layout-states">{text.states.heading}</h2>
    <p className={styles.muted}>{text.states.help}</p>
    {!readOnly && <div className={styles.row}>
      <label className={styles.field}>{text.states.name}<input value={name} onChange={event => setName(event.target.value)} data-testid="layout-state-name" /></label>
      <Button disabled={name.trim() === ""} data-testid="layout-state-save" onClick={() => void save([{ type: "SAVE_LAYOUT_STATE",
        id: `s-${crypto.randomUUID().slice(0, 8)}`, name: name.trim(), savedAt: new Date().toISOString() }]).then(ok => { if (ok) setName(""); })}>{text.states.save}</Button>
    </div>}
    {states.length === 0 ? <p className={styles.muted}>{text.states.none}</p> : <ul className={styles.list}>{states.map(state => {
      const differences = compared === state.id ? compareLayoutState(document, state) : undefined;
      return <li key={state.id} data-testid="layout-state" data-state={state.name}>
        <div className={styles.row}>
          <strong>{state.name}</strong><span className={styles.muted}>{when(state.savedAt)}{state.source === "PPEN" ? ` · ${text.states.ppen}` : ""}</span>
          <Button variant="secondary" data-testid="layout-state-compare" onClick={() => setCompared(compared === state.id ? undefined : state.id)}>{text.states.compare}</Button>
          {!readOnly && <Button variant="secondary" data-testid="layout-state-restore"
            onClick={() => { if (window.confirm(text.states.restoreConfirm(state.name))) void save([{ type: "RESTORE_LAYOUT_STATE", id: state.id }]); }}>{text.states.restore}</Button>}
          {!readOnly && <Button variant="quiet" onClick={() => void save([{ type: "DELETE_LAYOUT_STATE", id: state.id }])}>{text.states.remove}</Button>}
        </div>
        {differences && (differences.length === 0 ? <p className={styles.muted} data-testid="layout-state-differences">{text.states.same}</p>
          : <ul data-testid="layout-state-differences">{differences.map((row, index) => <li key={index}>{describe(row)}</li>)}</ul>)}
      </li>;
    })}</ul>}
  </section>;
}

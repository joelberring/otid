"use client";

import { useState } from "react";
import { paperSpaceEn } from "../../i18n/course-setting-paper-en";
import { useTexts } from "../language-provider";
import { applyEdit, RUNNER_BACK, type CourseSettingDocument, type CourseSettingEdit, type PaperItem } from "@o-tid/course-setting";
import { paperSpaceSv } from "../../i18n/course-setting-paper-sv";
import { newItemIdFor, paperItemEdit } from "../../lib/course-setting-paper";
import { Button } from "../ui";
import styles from "./course-setting-print-page.module.css";

/**
 * Ändringarna som kopierar elementen (t.ex. logotyperna) till de valda banornas papper, med nya id:n och samma plats. Banorna
 * får egna kopior: ändras originalet följer kopiorna inte med (en mall gör det).
 */
export function copyPaperItemsEdits(document: CourseSettingDocument, items: readonly PaperItem[], targets: readonly string[]): CourseSettingEdit[] {
  let current = document;
  // En ändring per bana räcker: den sista sätter hela banans papper.
  const edits = new Map<string, CourseSettingEdit>();
  for (const course of targets) {
    for (const item of items) {
      const id = newItemIdFor(current, course);
      const edit = paperItemEdit(current, course, id, { ...item, id, locked: undefined });
      current = applyEdit(current, edit).document;
      edits.set(course, edit);
    }
  }
  return [...edits.values()];
}

/** "Kopiera till banor": de markerade elementen till de banor som bockas i. */
export function PaperCopy({ document, course, courses, items, onSave }: {
  document: CourseSettingDocument; course: string; courses: readonly { id: string; name: string }[]; items: readonly PaperItem[];
  onSave: (edits: CourseSettingEdit[], done?: string) => Promise<boolean>;
}) {
  const text = useTexts(paperSpaceSv, paperSpaceEn);
  const [targets, setTargets] = useState<ReadonlySet<string>>(new Set());
  const others = courses.filter(row => row.id !== course && row.id !== RUNNER_BACK);
  if (others.length === 0 || items.length === 0) return null;
  return <details className={styles.stack} data-testid="paper-copy">
    <summary>{text.copy.title(items.length)}</summary>
    <p className={styles.muted}>{text.copy.help}</p>
    <div className={styles.row}>
      {others.map(row => <label key={row.id} className={styles.check}><input type="checkbox" checked={targets.has(row.id)}
        onChange={event => setTargets(current => { const next = new Set(current); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next; })}
        data-testid="paper-copy-course" data-course={row.id} />{row.name}</label>)}
      <Button variant="quiet" onClick={() => setTargets(new Set(others.map(row => row.id)))}>{text.copy.all}</Button>
    </div>
    <Button disabled={targets.size === 0} data-testid="paper-copy-save" onClick={() => {
      const chosen = others.filter(row => targets.has(row.id)).map(row => row.id);
      void onSave(copyPaperItemsEdits(document, items, chosen), text.copy.done(items.length, chosen.length)).then(ok => { if (ok) setTargets(new Set()); });
    }}>{text.copy.save(targets.size)}</Button>
  </details>;
}

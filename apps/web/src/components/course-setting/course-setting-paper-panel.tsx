"use client";

import { useState } from "react";
import {
  descriptionShown, paperLayoutOf, type CourseSettingDocument, type CourseSettingEdit, type PaperDescriptions, type SheetDescription
} from "@o-tid/course-setting";
import { coursePrintSv as text } from "../../i18n/course-setting-print-sv";
import { ALL_CONTROLS } from "../../lib/course-setting-hit";
import { Button } from "../ui";
import styles from "./course-setting-print-page.module.css";

const BOXES = [4, 5, 5.5, 6, 7];

/** Ändringen som sätter banans beskrivning (resten av banans papper står kvar). */
export function paperDescriptionEdit(document: CourseSettingDocument, course: string, change: PaperDescriptions | null): CourseSettingEdit {
  const layout = paperLayoutOf(document, course);
  return { type: "SET_PAPER_LAYOUT", course, layout: change === null ? (Object.keys(layout).filter(key => key !== "descriptions").length > 0
    ? { ...layout, descriptions: undefined } : null) : { ...layout, descriptions: change } };
}

/**
 * Papperet per bana (ägaren 2026-11-03): "Kontrollbeskrivning på kartan" på eller av, spalter och rutans storlek, var den står
 * (automatiskt i ett hörn, utplacerad, ur .ppen-filen) och en varning när den ligger över banan. Platsen dras på arket.
 */
export function PaperDescriptionsPanel({ document, courses, placed, readOnly, onSave }: {
  document: CourseSettingDocument; courses: readonly { id: string; name: string }[];
  /** Första beskrivningen per bana i förhandsvisningen. */
  placed: ReadonlyMap<string, SheetDescription>;
  readOnly: boolean; onSave: (edits: CourseSettingEdit[]) => Promise<boolean>;
}) {
  const [message, setMessage] = useState<{ course: string; ok: boolean }>();
  async function save(course: string, change: PaperDescriptions | null) {
    const ok = await onSave([paperDescriptionEdit(document, course, change)]);
    setMessage({ course, ok });
  }
  return <section className={styles.panel} aria-labelledby="paper-descriptions" data-testid="paper-descriptions">
    <h2 id="paper-descriptions">{text.paper.heading}</h2>
    <p className={styles.muted}>{text.paper.help}</p>
    {readOnly && <p className={styles.muted}>{text.paper.readOnly}</p>}
    <ul className={styles.paperRows}>{courses.map(course => {
      const settings = paperLayoutOf(document, course.id).descriptions ?? {};
      const shown = descriptionShown(document, course.id);
      const here = placed.get(course.id);
      const overlaps = here?.overlaps ?? 0;
      const box = settings.boxMm ?? here?.boxMm ?? 5;
      const columns = settings.columns ?? here?.columns ?? 1;
      return <li key={course.id} data-course={course.id} data-warning={shown && overlaps > 0 ? "yes" : undefined} data-testid="paper-description-row">
        <label className={styles.check}><input type="checkbox" checked={shown} disabled={readOnly} aria-label={text.paper.showFor(course.name)}
          onChange={event => void save(course.id, { ...settings, show: event.target.checked })} />
          <strong>{course.name}</strong></label>
        {shown && <>
          <label className={styles.field}>{text.paper.columns}<select value={columns} disabled={readOnly}
            onChange={event => void save(course.id, { ...settings, columns: Number(event.target.value) })}>
            {[1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className={styles.field}>{text.paper.box}<select value={box} disabled={readOnly}
            onChange={event => void save(course.id, { ...settings, boxMm: Number(event.target.value) })}>
            {[...new Set([...BOXES, Math.round(box * 2) / 2])].sort((a, b) => a - b).map(value =>
              <option key={value} value={value}>{text.paper.boxOption(value)}</option>)}</select></label>
          <span className={styles.muted} data-testid="paper-description-source">{text.paper.source(here?.source, here?.corner ? text.paper.corners[here.corner] : undefined)}</span>
          {settings.at && !readOnly && <Button variant="quiet" onClick={() => void save(course.id, { ...settings, at: undefined })}>
            {text.paper.automatic}</Button>}
          {overlaps > 0 && <span className={styles.paperWarning} role="note" data-testid="paper-description-warning">⚠ {text.paper.overlaps(overlaps)}</span>}
        </>}
        {!shown && <span className={styles.muted}>{text.paper.off}</span>}
        {message?.course === course.id && <span role="status" className={message.ok ? styles.muted : styles.paperWarning}>
          {message.ok ? text.paper.saved : text.paper.failed}</span>}
      </li>;
    })}</ul>
  </section>;
}

/** Banornas namn för panelen, med Alla kontroller om den är vald. */
export function paperCourses(document: CourseSettingDocument, chosen: readonly string[]): { id: string; name: string }[] {
  const courses = [...document.courses].sort((a, b) => a.order - b.order).filter(course => chosen.includes(course.id))
    .map(course => ({ id: course.id, name: course.name }));
  return chosen.includes(ALL_CONTROLS) ? [{ id: ALL_CONTROLS, name: text.print.allControls }, ...courses] : courses;
}

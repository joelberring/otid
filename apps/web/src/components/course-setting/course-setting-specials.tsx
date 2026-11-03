"use client";

import { useEffect, useState } from "react";
import { specialVisible, type CourseSettingDocument, type CourseSettingEdit, type SpecialKind, type SpecialObject } from "@o-tid/course-setting";
import { coursePrintSv as text } from "../../i18n/course-setting-print-sv";
import type { EditorState } from "../../lib/course-setting-editor";
import { ALL_CONTROLS } from "../../lib/course-setting-hit";
import { paperToMap, SPECIAL_TOOL_KINDS } from "../../lib/course-setting-specials";
import { Button } from "../ui";
import { RotateControls } from "./course-setting-ux";
import styles from "./course-setting.module.css";

const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * Steg 64: fliken Objekt. Slaget att rita (förbjudet område, vit bakgrund, valfri passage, text …), ytan
 * som ritas (Klar/Avbryt), objekten som syns i vald bana och valt objekts egenskaper: vilka banor det syns på, text,
 * storlek, färg, spalter och vinkel. Ändringarna går som åtgärder (`UPDATE_SPECIAL`, `DELETE_SPECIAL`).
 */
export function SpecialsPanel({ document, state, readOnly, onKind, onFinish, onCancel, onSelect, onEdits, onAlong }: {
  document: CourseSettingDocument; state: EditorState; readOnly: boolean;
  onKind: (kind: SpecialKind) => void; onFinish: () => void; onCancel: () => void; onSelect: (id: string) => void;
  onEdits: (edits: readonly CourseSettingEdit[]) => void;
  /** ADR-0180 beslut 14: "Vrid efter sträckan" för en valfri passage. */
  onAlong?: (() => void) | undefined;
}) {
  const view = state.view;
  // Kontrollbeskrivningen (Purple Pens `descriptions`) är inget kartobjekt här; den placeras i utskriften.
  const shown = document.specialObjects.filter(special => special.kind !== "descriptions" && specialVisible(special, view));
  const selected = state.selection?.kind === "special" ? document.specialObjects.find(special => state.selection?.kind === "special" && special.id === state.selection.special) : undefined;
  const drawing = state.tool === "SPECIAL" ? state.drawing ?? [] : [];
  return <section className={styles.panel} aria-labelledby="course-setting-specials" data-testid="course-setting-specials">
    <h2 id="course-setting-specials">{text.objects.heading}</h2>
    <p className={styles.muted}>{text.objects.help}</p>
    {!readOnly && <div className={styles.specialKinds} role="group" aria-label={text.objects.heading}>
      {SPECIAL_TOOL_KINDS.filter(kind => kind !== "image").map(kind => <button key={kind} type="button" className={styles.specialKind}
        aria-pressed={state.tool === "SPECIAL" && state.specialKind === kind} onClick={() => onKind(kind)}>{text.kinds[kind]}</button>)}
    </div>}
    {drawing.length > 0 && <div className={styles.row} role="status">
      <span>{text.objects.drawing(drawing.length)}</span>
      <Button onClick={onFinish}>{text.objects.finish}</Button>
      <Button variant="secondary" onClick={onCancel}>{text.objects.cancel}</Button>
    </div>}
    {selected && <SpecialEditor key={selected.id} document={document} view={view} special={selected} readOnly={readOnly} onEdits={onEdits} onAlong={onAlong} />}
    <h3>{text.objects.onMap}</h3>
    {shown.length === 0 ? <p className={styles.muted}>{text.objects.none}</p>
      : <ul className={styles.specialList}>{shown.map(special => <li key={special.id}>
        <Button variant={selected?.id === special.id ? "secondary" : "quiet"} aria-pressed={selected?.id === special.id}
          aria-label={text.objects.select(`${text.kinds[special.kind] ?? special.kind} ${special.id}`)} onClick={() => onSelect(special.id)}>
          {text.kinds[special.kind] ?? special.kind}{special.kind === "text" && special.text ? `: ${special.text}` : ""}</Button>
      </li>)}</ul>}
  </section>;
}

function SpecialEditor({ document, view, special, readOnly, onEdits, onAlong }: {
  document: CourseSettingDocument; view: string; special: SpecialObject; readOnly: boolean; onEdits: (edits: readonly CourseSettingEdit[]) => void;
  onAlong?: (() => void) | undefined;
}) {
  const update = (changes: Extract<CourseSettingEdit, { type: "UPDATE_SPECIAL" }>["changes"]) =>
    onEdits([{ type: "UPDATE_SPECIAL", special: special.id, changes }]);
  const [draft, setDraft] = useState(special.text ?? "");
  useEffect(() => setDraft(special.text ?? ""), [special.text]);
  const courses = [...document.courses].sort((a, b) => a.order - b.order);
  const everywhere = special.courses.length === 0;
  const visibleOn = (id: string) => everywhere || special.courses.includes(id);
  const toggle = (id: string, on: boolean) => {
    const all = ["0", ...courses.map(course => course.id)];
    const current = everywhere ? all : special.courses;
    const next = on ? [...current, id] : current.filter(item => item !== id);
    // Alla banor och Alla kontroller = som Purple Pens "alla" (tom lista).
    const ordered = all.filter(item => next.includes(item));
    update({ courses: ordered.length === all.length ? [] : ordered.length === 0 ? [special.courses[0] ?? "0"] : ordered });
  };
  const toPaper = (mm: number) => round(mm / paperToMap(document, view, 1));
  const name = text.kinds[special.kind] ?? special.kind;
  return <div className={styles.stack} data-testid="course-setting-special" data-kind={special.kind}>
    <h3>{text.objects.selected}: {name}</h3>
    <fieldset className={styles.stack} disabled={readOnly}>
      <legend>{text.objects.courses}</legend>
      <label><input type="checkbox" checked={everywhere} onChange={event => update({ courses: event.target.checked ? []
        : [view === ALL_CONTROLS ? "0" : view] })} />{text.objects.allCourses}</label>
      <label><input type="checkbox" checked={visibleOn("0")} onChange={event => toggle("0", event.target.checked)} />{text.objects.allControls}</label>
      {courses.map(course => <label key={course.id}><input type="checkbox" checked={visibleOn(course.id)}
        onChange={event => toggle(course.id, event.target.checked)} />{course.name}</label>)}
    </fieldset>
    {special.kind === "text" && <>
      <label className={styles.stack}>{text.objects.text}
        <textarea rows={2} value={draft} disabled={readOnly} onChange={event => setDraft(event.target.value)}
          onBlur={() => { if (draft !== (special.text ?? "")) update({ text: draft }); }} /></label>
      <p className={styles.muted}>{text.objects.textHelp}</p>
      <label className={styles.stack}>{text.objects.height}
        <input type="number" min={0.5} max={50} step={0.5} disabled={readOnly} defaultValue={special.font?.height ? toPaper(special.font.height) : ""}
          onChange={event => {
            const value = Number(event.target.value);
            if (value > 0) update({ font: { ...(special.font ?? { name: "Arial", bold: false, italic: false }), height: paperToMap(document, view, value) } });
          }} /></label>
      <label><input type="checkbox" checked={special.font?.bold ?? false} disabled={readOnly}
        onChange={event => update({ font: { ...(special.font ?? { name: "Arial", italic: false }), bold: event.target.checked } })} />{text.objects.bold}</label>
    </>}
    {(special.kind === "text" || special.kind === "line" || special.kind === "rectangle" || special.kind === "ellipse") && <label className={styles.stack}>
      {text.objects.color}
      <select value={special.color ?? "purple"} disabled={readOnly} onChange={event => update({ color: event.target.value })}>
        {Object.entries(text.objects.colors).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        {special.color && !(special.color in text.objects.colors) && <option value={special.color}>{text.objects.custom}</option>}
      </select></label>}
    {special.line && <label className={styles.stack}>{text.objects.lineWidth}
      <input type="number" min={0.05} max={5} step={0.05} disabled={readOnly} defaultValue={special.line.width}
        onChange={event => { const value = Number(event.target.value); if (value > 0) update({ line: { ...special.line!, width: value } }); }} /></label>}
    {special.kind === "optional-crossing-point" && <RotateControls orientation={special.orientation ?? 0} readOnly={readOnly}
      onSet={value => update({ orientation: value })} onAlong={onAlong} />}
    {!readOnly && <div className={styles.row}><Button variant="secondary" onClick={() => onEdits([{ type: "DELETE_SPECIAL", special: special.id }])}>
      {text.objects.remove}</Button></div>}
  </div>;
}

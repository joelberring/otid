"use client";

import { useState } from "react";
import {
  appearanceOf, ITEM_SCALINGS, paperSizesFor, type Appearance, type Course, type CourseSettingDocument, type CourseSettingEdit, type ItemScaling
} from "@o-tid/course-setting";
import { appearanceSv as text, labelSv } from "../../i18n/course-setting-appearance-sv";
import {
  appearanceEdit, fieldBase, formatMm, formatRatio, labelExample, labelKindEdits, labelKindsFor, paperChange, parseDecimal,
  presetActive, presetsFor, ratioAllowed, referenceScale, relayCourses, scaleRows, type AppearanceField, type LabelKind
} from "../../lib/course-setting-appearance";
import { Button } from "../ui";
import own from "./course-setting-appearance.module.css";
import styles from "./course-setting.module.css";

const FIELDS: readonly AppearanceField[] = ["circleSize", "lineWidth", "numberSize"];

/**
 * Banans utseende för hela banläggningen (ADR-0180 beslut 12, som Purple Pens "Anpassa utseende"): snabbval, kvoterna
 * med vad de ger i mm på papperet, skalningen, avbrottet vid sträckor och varningar mot ISOM 2017-2/ISSprOM 2019-2.
 * Varje ändring är en `SET_APPEARANCE` och syns direkt på kartan och i förhandsvisningen.
 */
export function AppearancePanel({ document, view, readOnly, onEdits }: {
  document: CourseSettingDocument; view: string; readOnly: boolean; onEdits: (edits: readonly CourseSettingEdit[]) => void;
}) {
  const appearance = appearanceOf(document);
  const standard = document.event.overprintStandard;
  const scale = referenceScale(document, view);
  const rows = scaleRows(document);
  const warnings = rows.flatMap(row => row.warnings);
  const set = (changes: Partial<Appearance>) => {
    const edit = appearanceEdit(document, changes);
    if (edit) onEdits([edit]);
  };
  const notEnlarged = standard === "ISOM2017" && appearance.itemScaling === "None" && rows.some(row => row.printScale < 15000 && row.warnings.length > 0);
  return <section className={styles.panel} aria-labelledby="course-setting-appearance" data-testid="course-setting-appearance">
    <h2 id="course-setting-appearance">{text.heading}</h2>
    <p className={styles.muted}>{text.help}</p>
    <fieldset className={styles.stack} disabled={readOnly} style={{ border: 0, margin: 0, padding: 0 }}>
      <legend className={styles.muted}>{text.presets}</legend>
      <div className={own.presets}>
        {presetsFor(standard).map(preset => <button key={preset.id} type="button" aria-pressed={presetActive(appearance, preset)}
          title={text.presetHelp[preset.id]} data-testid={`appearance-preset-${preset.id}`} onClick={() => set(preset.changes)}>
          {preset.id === "standard" ? text.preset.standard(standard) : text.preset[preset.id]}
        </button>)}
      </div>
    </fieldset>
    <p className={styles.muted}>{text.at(scale)}</p>
    {FIELDS.map(field => <RatioField key={field} document={document} field={field} scale={scale} readOnly={readOnly}
      onSave={value => set({ [field]: value })} />)}
    <label className={styles.stack}>{text.scaling}
      <select value={appearance.itemScaling} disabled={readOnly} data-testid="appearance-scaling"
        onChange={event => set({ itemScaling: event.target.value as ItemScaling })}>
        {ITEM_SCALINGS.map(value => <option key={value} value={value}>{text.scalings[value]}</option>)}
      </select></label>
    <p className={styles.muted}>{text.scalingHelp[appearance.itemScaling]}</p>
    <GapField document={document} scale={scale} readOnly={readOnly} onSave={value => set({ autoLegGap: value })} />
    <label className={own.check}>
      <input type="checkbox" checked={appearance.circleGapsScaled} disabled={readOnly} onChange={event => set({ circleGapsScaled: event.target.checked })} />
      <span>{text.circleGapsScaled}<small>{text.circleGapsScaledHelp}</small></span>
    </label>
    <table className={own.table} data-testid="appearance-scales">
      <thead><tr><th>{text.table.scale}</th><th>{text.table.circle}</th><th>{text.table.line}</th><th>{text.table.number}</th><th>{text.table.courses}</th></tr></thead>
      <tbody>{rows.map(row => {
        const warn = (field: "circle" | "line" | "number") => row.warnings.some(item => item.field === field) ? "" : undefined;
        return <tr key={row.printScale}>
          <td>{text.scaleText(row.printScale)}</td>
          <td data-warn={warn("circle")}>{formatMm(row.circle)}</td>
          <td data-warn={warn("line")}>{formatMm(row.line)}</td>
          <td data-warn={warn("number")}>{formatMm(row.number)}</td>
          <td>{row.courses.join(", ")}</td>
        </tr>;
      })}</tbody>
    </table>
    {warnings.length === 0 ? <p className={styles.muted} data-testid="appearance-ok">{text.noWarnings(standard)}</p>
      : <div role="status" data-testid="appearance-warnings">
        <p className={styles.muted}><strong>{text.warningsHeading}</strong></p>
        <ul className={styles.warnings}>{warnings.map((item, index) => <li key={index}>
          {text.warning(item.field, item.printScale, formatMm(item.actual), formatMm(item.expected), standard)}</li>)}</ul>
        {notEnlarged && <p className={styles.muted}>{text.enlargementHint}</p>}
      </div>}
  </section>;
}

/** En kvot: fritt tal (punkt eller komma), sparas med Enter eller när fältet lämnas; mm på papperet bredvid. */
function RatioField({ document, field, scale, readOnly, onSave }: {
  document: CourseSettingDocument; field: AppearanceField; scale: number; readOnly: boolean; onSave: (value: number) => void;
}) {
  const value = appearanceOf(document)[field];
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState<string>();
  const standard = document.event.overprintStandard;
  const paper = paperChange(document, field, scale);
  const id = `appearance-${field}`;
  const commit = () => {
    if (draft === undefined) return;
    const parsed = parseDecimal(draft);
    if (parsed === undefined) { setError(text.notNumber); return; }
    const base = fieldBase(standard, field);
    if (!ratioAllowed(standard, field, parsed)) { setError(text.outside(base.min, base.max)); return; }
    setError(undefined);
    setDraft(undefined);
    onSave(parsed);
  };
  return <>
    <div className={own.field}>
      <span><label htmlFor={id}>{text.fields[field]}</label> <small className={styles.muted}>({text.ratio})</small></span>
      <input id={id} type="text" inputMode="decimal" value={draft ?? formatRatio(value)} disabled={readOnly} data-testid={id}
        aria-invalid={error ? true : undefined} aria-describedby={`${id}-paper`}
        onChange={event => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit(); } if (event.key === "Escape") { setDraft(undefined); setError(undefined); } }} />
      <span id={`${id}-paper`} className={own.paper} data-testid={`${id}-paper`}>
        {text.paper(text.paperLabel[field], formatMm(paper.standard), formatMm(paper.actual))}</span>
    </div>
    {error && <p role="alert" className={own.error}>{error}</p>}
  </>;
}

/** Det automatiska avbrottet vid sträckor i mm (Purple Pens "Storlek på automatiskt sträckgap"). */
function GapField({ document, scale, readOnly, onSave }: {
  document: CourseSettingDocument; scale: number; readOnly: boolean; onSave: (value: number) => void;
}) {
  const value = appearanceOf(document).autoLegGap;
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState<string>();
  const commit = () => {
    if (draft === undefined) return;
    const parsed = parseDecimal(draft);
    if (parsed === undefined || parsed < 0 || parsed > 50) { setError(text.outside(0, 50)); return; }
    setError(undefined);
    setDraft(undefined);
    onSave(parsed);
  };
  return <>
    <div className={own.field}>
      <span><label htmlFor="appearance-gap">{text.autoLegGap}</label></span>
      <input id="appearance-gap" type="text" inputMode="decimal" value={draft ?? formatRatio(value)} disabled={readOnly} data-testid="appearance-gap"
        aria-invalid={error ? true : undefined} onChange={event => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit(); } }} />
      <span className={own.paper}>{`${formatMm(paperSizesFor(document, scale).autoLegGap)} mm`}</span>
    </div>
    <p className={styles.muted}>{text.autoLegGapHelp}</p>
    {error && <p role="alert" className={own.error}>{error}</p>}
  </>;
}

/**
 * Etiketten vid kontrollen för vald bana: nummer, kod eller nummer och kod (som på stafetter), med ett exempel ur banan;
 * poängvarianterna bara för poängbanor. Valet kan göras för alla stafettbanor eller alla banor på en gång.
 */
export function LabelPanel({ document, course, readOnly, onEdits }: {
  document: CourseSettingDocument; course: Course; readOnly: boolean; onEdits: (edits: readonly CourseSettingEdit[]) => void;
}) {
  const [done, setDone] = useState<string>();
  const relays = relayCourses(document);
  const apply = (courses: readonly Course[]) => {
    const edits = labelKindEdits(courses, course.labelKind);
    if (edits.length > 0) onEdits(edits);
    setDone(labelSv.done(edits.length));
  };
  return <section className={styles.panel} aria-labelledby="course-setting-label" data-testid="course-setting-label">
    <h2 id="course-setting-label">{labelSv.heading}</h2>
    <p className={styles.muted}>{labelSv.help}</p>
    <fieldset className={own.kinds} disabled={readOnly}>
      <legend className={styles.srOnly}>{labelSv.heading}</legend>
      {labelKindsFor(course).map((kind: LabelKind) => <label key={kind} className={own.kind}>
        <input type="radio" name={`label-${course.id}`} value={kind} checked={course.labelKind === kind}
          onChange={() => { setDone(undefined); onEdits([{ type: "UPDATE_COURSE", course: course.id, changes: { labelKind: kind } }]); }} />
        <span>{labelSv.kinds[kind]}</span>
        <span className={own.example} aria-hidden="true">{labelExample(document, course, kind)}</span>
      </label>)}
    </fieldset>
    {!readOnly && document.courses.length > 1 && <div className={styles.row}>
      <span className={styles.muted}>{labelSv.sameFor}</span>
      {relays.length > 1 && <Button variant="secondary" onClick={() => apply(relays)}>{labelSv.relays(relays.length)}</Button>}
      <Button variant="secondary" onClick={() => apply(document.courses)}>{labelSv.all(document.courses.length)}</Button>
    </div>}
    {done && <p role="status" className={styles.muted}>{done}</p>}
  </section>;
}

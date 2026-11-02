"use client";

import { useState } from "react";
import {
  courseTrainingOf, DEFAULT_TINT, presetFilter, sectionLegs, sectionRange, controlSequences, type CourseSettingDocument, type CourseSettingEdit,
  type CourseTraining, type SectionForm, type SymbolCatalogEntry, type TrainingOutside, type TrainingSection
} from "@o-tid/course-setting";
import { trainingSv as text } from "../../i18n/course-setting-training-sv";
import { courseControlChoices, putCourseTraining, sectionLabel } from "../../lib/course-setting-training";
import { Button } from "../ui";
import { SymbolFilterEditor } from "./course-setting-training-filter";
import styles from "./course-setting-training.module.css";

const FORMS: readonly SectionForm[] = ["CORRIDOR", "BAND", "WINDOW", "NO_MAP"];

/** Ett tal i ett fält som sparas när fältet lämnas (eller Enter). */
function NumberField({ label, value, min, max, step = 1, disabled, onCommit, testId }: {
  label: string; value: number; min: number; max: number; step?: number; disabled: boolean; onCommit: (value: number) => void; testId?: string;
}) {
  const [draft, setDraft] = useState<string>();
  const commit = () => {
    if (draft === undefined) return;
    const parsed = Number(draft.replace(",", "."));
    setDraft(undefined);
    if (Number.isFinite(parsed) && parsed >= min && parsed <= max && parsed !== value) onCommit(parsed);
  };
  return <label className={styles.stack}>{label}
    <input type="number" inputMode="decimal" min={min} max={max} step={step} value={draft ?? String(value)} disabled={disabled} data-testid={testId}
      onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") commit(); }} /></label>;
}

/** Utanför avsnitten: hela kartan, vitt, tonat eller ett filter. */
export function OutsideBlock({ training, readOnly, symbols, onChange }: {
  training: CourseTraining; readOnly: boolean; symbols: readonly SymbolCatalogEntry[]; onChange: (outside: TrainingOutside) => void;
}) {
  const outside = training.outside;
  return <section className={styles.block} aria-labelledby="training-outside">
    <h3 id="training-outside">{text.outside.heading}</h3>
    <div className={styles.segmented} role="group" aria-label={text.outside.heading}>
      {(["FULL", "WHITE", "TINT", "FILTER"] as const).map(kind => <button key={kind} type="button" aria-pressed={outside.kind === kind} disabled={readOnly}
        data-testid={`training-outside-${kind}`}
        onClick={() => onChange(kind === "TINT" ? { kind, lighten: DEFAULT_TINT } : kind === "FILTER" ? { kind, filter: presetFilter("CONTOURS") } : { kind })}>
        {text.outside[kind]}</button>)}
    </div>
    {outside.kind === "TINT" && <NumberField label={`${text.outside.tint} (%)`} value={Math.round(outside.lighten * 100)} min={5} max={95} disabled={readOnly}
      onCommit={value => onChange({ kind: "TINT", lighten: value / 100 })} />}
    {outside.kind === "FILTER" && <SymbolFilterEditor label={text.outside.heading} filter={outside.filter} symbols={symbols} readOnly={readOnly}
      onChange={filter => onChange({ kind: "FILTER", filter })} />}
  </section>;
}

/** Avsnitten i banans ordning: från, till, form, formens mått, filtret och markeringen vid bytet. */
export function SectionsBlock({ document, view, readOnly, symbols, onEdits }: {
  document: CourseSettingDocument; view: string; readOnly: boolean; symbols: readonly SymbolCatalogEntry[];
  onEdits: (edits: readonly CourseSettingEdit[]) => void;
}) {
  const training = courseTrainingOf(document, view);
  const choices = courseControlChoices(document, view);
  const put = (sections: readonly TrainingSection[]) => onEdits([putCourseTraining(view, { ...training, sections })]);
  const update = (index: number, section: TrainingSection) => put(training.sections.map((item, i) => i === index ? section : item));
  const move = (index: number, by: number) => {
    const next = [...training.sections];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    put(next);
  };
  return <section className={styles.block} aria-labelledby="training-sections" data-testid="training-sections">
    <h3 id="training-sections">{text.sections.heading}</h3>
    {training.sections.length === 0 && <p className={styles.muted}>{text.sections.none}</p>}
    {training.sections.map((section, index) => {
      const label = sectionLabel(document, view, section);
      const sequence = controlSequences(document, view, undefined)[0] ?? [];
      const range = sectionRange(document, sequence, section);
      const legs = range ? sectionLegs(document, sequence, range) : [];
      const legName = (from: string, to: string) => `${choices.find(row => row.control === from)?.label ?? "?"}–${choices.find(row => row.control === to)?.label ?? "?"}`;
      return <details key={section.id} className={styles.item} open={index === training.sections.length - 1} data-testid="training-section">
        <summary>{text.sections.title(index + 1, text.sections.forms[section.form] ?? section.form, label.from, label.to)}</summary>
        <div className={styles.row}>
          <label className={styles.stack}>{text.sections.from}
            <select value={section.from ?? ""} disabled={readOnly} data-testid="training-section-from"
              onChange={event => update(index, { ...section, from: event.target.value || null })}>
              <option value="">{text.sections.start}</option>
              {choices.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
          <label className={styles.stack}>{text.sections.to}
            <select value={section.to ?? ""} disabled={readOnly} data-testid="training-section-to"
              onChange={event => update(index, { ...section, to: event.target.value || null })}>
              <option value="">{text.sections.finish}</option>
              {choices.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
          <label className={styles.stack}>{text.sections.form}
            <select value={section.form} disabled={readOnly} data-testid="training-section-form"
              onChange={event => update(index, { ...section, form: event.target.value as SectionForm,
                ...(event.target.value === "CORRIDOR" && !section.corridor ? { corridor: { shape: "ANGULAR", widthMeters: 60, smoothing: 0.5 } } : {}),
                ...(event.target.value === "WINDOW" && !section.window ? { window: { shape: "CIRCLE", radiusMeters: 60 } } : {}) })}>
              {FORMS.map(form => <option key={form} value={form}>{text.sections.forms[form]}</option>)}</select></label>
        </div>
        {section.form === "CORRIDOR" && section.corridor && <>
          <div className={styles.segmented} role="group" aria-label={text.sections.shape}>
            {(["ANGULAR", "SMOOTH"] as const).map(shape => <button key={shape} type="button" aria-pressed={section.corridor!.shape === shape} disabled={readOnly}
              data-testid={`training-corridor-${shape}`}
              onClick={() => update(index, { ...section, corridor: { ...section.corridor!, shape } })}>{shape === "ANGULAR" ? text.sections.angular : text.sections.smooth}</button>)}
          </div>
          <div className={styles.row}>
            <NumberField label={text.sections.width} value={section.corridor.widthMeters} min={1} max={2000} disabled={readOnly} testId="training-corridor-width"
              onCommit={value => update(index, { ...section, corridor: { ...section.corridor!, widthMeters: value } })} />
            {section.corridor.shape === "SMOOTH" && <label className={styles.stack}>{text.sections.smoothing}
              <input type="range" min={0} max={1} step={0.25} value={section.corridor.smoothing} disabled={readOnly}
                onChange={event => update(index, { ...section, corridor: { ...section.corridor!, smoothing: Number(event.target.value) } })} /></label>}
          </div>
          {legs.length > 1 && <details className={styles.details}><summary>{text.sections.legWidths}</summary>
            <div className={styles.row}>{legs.map(leg => {
              const key = `${leg.from}-${leg.to}`;
              return <NumberField key={key} label={text.sections.legWidth(legName(leg.from, leg.to))} min={1} max={2000} disabled={readOnly}
                value={section.corridor!.legWidths?.[key] ?? section.corridor!.widthMeters}
                onCommit={value => update(index, { ...section, corridor: { ...section.corridor!, legWidths: { ...section.corridor!.legWidths, [key]: value } } })} />;
            })}</div></details>}
        </>}
        {section.form === "WINDOW" && section.window && <div className={styles.row}>
          <label className={styles.stack}>{text.sections.windowShape}
            <select value={section.window.shape} disabled={readOnly}
              onChange={event => update(index, { ...section, window: { ...section.window!, shape: event.target.value as "CIRCLE" | "SQUARE" } })}>
              <option value="CIRCLE">{text.sections.circle}</option><option value="SQUARE">{text.sections.square}</option></select></label>
          <NumberField label={text.sections.radius} value={section.window.radiusMeters} min={1} max={2000} disabled={readOnly} testId="training-window-radius"
            onCommit={value => update(index, { ...section, window: { ...section.window!, radiusMeters: value } })} />
        </div>}
        {(section.form === "BAND" || section.form === "NO_MAP") && <NumberField label={text.sections.band} value={section.bandMeters ?? 300} min={1} max={5000}
          disabled={readOnly} onCommit={value => update(index, { ...section, bandMeters: value })} />}
        {section.form !== "NO_MAP" && <details className={styles.details} open={section.form === "BAND"}><summary>{text.sections.filter}</summary>
          <SymbolFilterEditor label={text.sections.filter} filter={section.filter} symbols={symbols} readOnly={readOnly}
            onChange={filter => update(index, { ...section, filter })} /></details>}
        <div className={styles.row}>
          <label className={styles.stack}>{text.sections.marker}
            <select value={section.marker.kind} disabled={readOnly} data-testid="training-section-marker"
              onChange={event => update(index, { ...section, marker: { ...section.marker, kind: event.target.value as "NONE" | "TEXT" | "BAR" } })}>
              {(["NONE", "TEXT", "BAR"] as const).map(kind => <option key={kind} value={kind}>{text.sections.markers[kind]}</option>)}</select></label>
          {section.marker.kind === "TEXT" && <label className={styles.stack}>{text.sections.markerText}
            <input type="text" maxLength={60} defaultValue={section.marker.text ?? ""} placeholder={label.marker} disabled={readOnly}
              onBlur={event => { const value = event.target.value.trim(); if (value !== (section.marker.text ?? "")) update(index, { ...section,
                marker: value ? { kind: "TEXT", text: value } : { kind: "TEXT" } }); }} /></label>}
        </div>
        {!readOnly && <div className={styles.row}>
          {index > 0 && <Button variant="quiet" onClick={() => move(index, -1)}>{text.sections.up}</Button>}
          {index < training.sections.length - 1 && <Button variant="quiet" onClick={() => move(index, 1)}>{text.sections.down}</Button>}
          <Button variant="quiet" onClick={() => put(training.sections.filter((_, i) => i !== index))}>{text.sections.remove}</Button>
        </div>}
      </details>;
    })}
  </section>;
}

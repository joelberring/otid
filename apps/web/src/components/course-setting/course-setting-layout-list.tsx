"use client";

import { useEffect, useState } from "react";
import {
  BUILT_IN_TEMPLATES, HUNDREDTH_INCH_MM, PAPER_SIZES, type CourseSettingDocument, type CourseSettingEdit, type LayoutEntry, type PaperName, type PrintPage
} from "@o-tid/course-setting";
import { layoutSv as text } from "../../i18n/course-setting-layout-sv";
import { newLayout, scaleText } from "../../lib/course-setting-layouts";
import { paperNameOf } from "../../lib/course-setting-sheet-frame";
import { Button } from "../ui";
import styles from "./course-setting-layout.module.css";

const PAPERS: readonly PaperName[] = ["A3", "A4", "A5"];

/**
 * ADR-0217 beslut 2: layouterna. Huvudlayouten (banornas skala och papper; namnet och "Kartor per ark" går att ändra) och de
 * andra med namn, skala, papper, riktning, marginal, mall för papperet och "Kartor per ark". "+ Ny layout" och "Ta bort".
 */
export function LayoutList({ document, entries, readOnly, save, sheetCount, onCreated }: {
  document: CourseSettingDocument; entries: readonly LayoutEntry[]; readOnly: boolean; save: (edits: CourseSettingEdit[]) => Promise<boolean>;
  sheetCount: (layout: string) => number; onCreated?: ((id: string) => void) | undefined;
}) {
  const templates = [...BUILT_IN_TEMPLATES, ...(document.event.layoutTemplates ?? [])];
  const paperTemplates = document.event.paperTemplates ?? [];
  const add = async () => {
    const layout = newLayout(document, `${text.layouts.newName} ${entries.length}`);
    if (await save([{ type: "ADD_LAYOUT", layout }])) onCreated?.(layout.id);
  };
  return <section className={styles.panel} aria-labelledby="layout-list" data-testid="layout-list">
    <h2 id="layout-list">{text.layouts.heading}</h2>
    <p className={styles.muted}>{text.layouts.help}</p>
    {entries.map(entry => <fieldset key={entry.id} className={styles.layoutRow} disabled={readOnly} data-testid="layout-entry" data-layout={entry.id}>
      <legend><strong>{entry.name}</strong> <span className={styles.muted}>{entry.main ? text.layouts.main : `${scaleText(entry.scale ?? 0)} · ${text.layouts.sheets(sheetCount(entry.id))}`}</span></legend>
      <div className={styles.row}>
        <TextField label={text.layouts.name} value={entry.name} testId="layout-name" onCommit={name => void save([{ type: "UPDATE_LAYOUT", layout: entry.id, changes: { name } }])} />
        {entry.main ? <span className={styles.muted}>{text.layouts.scale}{" "}{text.layouts.courseScale}</span>
          : <TextField label={text.layouts.scale} value={String(entry.scale ?? "")} inputMode="numeric" testId="layout-scale"
            onCommit={value => { const scale = Number(value.replace(/\s/g, "")); if (scale >= 500) void save([{ type: "UPDATE_LAYOUT", layout: entry.id, changes: { scale } }]); }} />}
        {!entry.main && entry.page && <PageFields page={entry.page} onChange={page => void save([{ type: "UPDATE_LAYOUT", layout: entry.id, changes: { page } }])} />}
        {!entry.main && <label className={styles.field}>{text.layouts.paperTemplate}
          <select value={entry.paperTemplate ?? ""} data-testid="layout-paper-template"
            onChange={event => void save([{ type: "UPDATE_LAYOUT", layout: entry.id, changes: { paperTemplate: event.target.value || null } }])}>
            <option value="">{text.layouts.noTemplate}</option>
            {paperTemplates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>}
        <label className={styles.field}>{text.layouts.perSheet}
          <select value={entry.layoutTemplate ?? ""} data-testid="layout-per-sheet"
            onChange={event => void save([{ type: "UPDATE_LAYOUT", layout: entry.id, changes: { layoutTemplate: event.target.value || null } }])}>
            <option value="">{text.layouts.onePerSheet}</option>
            {templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
      </div>
      {!entry.main && <div><Button variant="quiet" data-testid="layout-remove"
        onClick={() => { if (window.confirm(text.layouts.removeConfirm(entry.name))) void save([{ type: "DELETE_LAYOUT", layout: entry.id }]); }}>{text.layouts.remove}</Button></div>}
    </fieldset>)}
    {!readOnly && <div><Button onClick={() => void add()} data-testid="layout-add">{text.layouts.add}</Button></div>}
  </section>;
}

function PageFields({ page: saved, onChange: save }: { page: PrintPage; onChange: (page: PrintPage) => void }) {
  // Det senaste valet gäller direkt (ett nytt val innan det förra sparats bygger på det, inte på det sparade).
  const [page, setPage] = useState(saved);
  useEffect(() => setPage(saved), [saved]);
  const onChange = (next: PrintPage) => { setPage(next); save(next); };
  const name = paperNameOf(page);
  return <>
    <label className={styles.field}>{text.layouts.paper}
      <select value={name ?? ""} data-testid="layout-paper" onChange={event => onChange({ ...page, ...PAPER_SIZES[event.target.value as PaperName] })}>
        {!name && <option value="">{`${Math.round(page.width * HUNDREDTH_INCH_MM)} × ${Math.round(page.height * HUNDREDTH_INCH_MM)} mm`}</option>}
        {PAPERS.map(paper => <option key={paper} value={paper}>{paper}</option>)}</select></label>
    <label className={styles.field}>{text.layouts.orientation}
      <select value={page.landscape ? "landscape" : "portrait"} data-testid="layout-orientation" onChange={event => onChange({ ...page, landscape: event.target.value === "landscape" })}>
        <option value="portrait">{text.layouts.portrait}</option><option value="landscape">{text.layouts.landscape}</option></select></label>
    <TextField label={text.layouts.margin} value={String(Math.round(page.margins * HUNDREDTH_INCH_MM))} inputMode="numeric" testId="layout-margin"
      onCommit={value => { const mm = Number(value); if (Number.isFinite(mm) && mm >= 0 && mm <= 50) onChange({ ...page, margins: Math.round(mm / HUNDREDTH_INCH_MM) }); }} />
  </>;
}

/** Ett fält som sparas när det lämnas eller med Enter. */
function TextField({ label, value, onCommit, inputMode, testId }: { label: string; value: string; onCommit: (value: string) => void;
  inputMode?: "numeric" | undefined; testId?: string | undefined }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { if (draft.trim() !== "" && draft !== value) onCommit(draft.trim()); };
  return <label className={styles.field}>{label}<input value={draft} inputMode={inputMode} data-testid={testId} size={inputMode ? 7 : 18}
    onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") commit(); }} /></label>;
}

"use client";

import { useMemo, useState } from "react";
import {
  BUILT_IN_TEMPLATES, type CourseSettingEdit, type LayoutTemplate, type PaperName, type TemplateStrip, type TemplateText
} from "@o-tid/course-setting";
import { layoutTemplateSv as text } from "../../i18n/course-setting-print-profile-sv";
import { gridOf, regrid } from "../../lib/course-setting-print-settings";
import { Button, Notice } from "../ui";
import styles from "./course-setting-print-page.module.css";

const PAPERS: readonly PaperName[] = ["A3", "A4", "A5"];
const LOGO_MAX_BYTES = 300 * 1024;

/**
 * Steg 64 (ADR-0183): layoutmallen ("paperspace"). Välj en färdig eller sparad mall, kopiera den och ändra papper,
 * kartramar (rader × kolumner), texter med platshållare, logotyp, remsan för rullad karta och
 * skärmarker (kontrollbeskrivningen ställs in per bana, inte i mallen). Mallen sparas i tävlingens banläggning och kan kopieras.
 */
export function LayoutTemplatePanel({ saved, selectedId, readOnly, onSelect, onDraft, onSave }: {
  saved: readonly LayoutTemplate[]; selectedId: string; readOnly: boolean;
  onSelect: (id: string) => void; onDraft: (template: LayoutTemplate | undefined) => void; onSave: (edits: CourseSettingEdit[]) => Promise<boolean>;
}) {
  const all = useMemo(() => [...BUILT_IN_TEMPLATES, ...saved], [saved]);
  const active = all.find(template => template.id === selectedId);
  const [draft, setDraftState] = useState<LayoutTemplate>();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const setDraft = (next: LayoutTemplate | undefined) => { setDraftState(next); onDraft(next); };
  const template = draft ?? active;
  const isSaved = template ? saved.some(item => item.id === template.id) : false;
  const edit = (next: LayoutTemplate) => { if (!readOnly) setDraft(next); };
  const copy = () => { if (template) setDraft({ ...template, id: `mall-${Date.now()}`, name: `${template.name} (kopia)` }); };
  async function save(edits: CourseSettingEdit[], done: string) {
    const ok = await onSave(edits);
    setMessage(ok ? { tone: "ok", text: done } : { tone: "error", text: text.saveFailed });
    if (ok) setDraft(undefined);
    return ok;
  }
  const builtIn = template ? BUILT_IN_TEMPLATES.some(item => item.id === template.id) : false;
  const editable = Boolean(template && !readOnly && !builtIn);
  const grid = template ? gridOf(template) : { rows: 1, columns: 1 };
  const setText = (index: number, change: Partial<TemplateText>) => template && edit({ ...template, texts: template.texts.map((row, i) => i === index ? { ...row, ...change } : row) });
  const strip = template?.strips[0];
  const setStrip = (change: Partial<TemplateStrip> | null) => template && edit({ ...template, strips: change === null ? []
    : [{ edge: "bottom", depthMm: 14, text: "{löpare}  {klass}  {starttid}  nr {startnummer}  {variant}", sizeMm: 6, ...strip, ...change }] });
  async function logo(file: File | undefined) {
    if (!file || !template) return;
    if (file.size > LOGO_MAX_BYTES) { setMessage({ tone: "error", text: text.logoTooLarge }); return; }
    const data = btoa(Array.from(new Uint8Array(await file.arrayBuffer()), byte => String.fromCharCode(byte)).join(""));
    const paperWidth = template.paper.landscape ? template.paper.heightMm : template.paper.widthMm;
    edit({ ...template, images: [{ x: paperWidth - template.marginMm - 30, y: template.marginMm, width: 30, height: 15, mediaType: file.type || "image/png", data }] });
  }
  const number = (value: string, fallback: number) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
  return <section className={styles.panel} aria-labelledby="layout-template" data-testid="layout-template">
    <h2 id="layout-template">{text.heading}</h2>
    <p className={styles.muted}>{text.help}</p>
    <div className={styles.row}>
      <label className={styles.field}>{text.choose}
        <select value={draft ? "" : selectedId} onChange={event => { setDraft(undefined); onSelect(event.target.value); }} data-testid="layout-template-select">
          {draft && <option value="">{draft.name}</option>}
          <option value="NONE">{text.none}</option>
          {all.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
      {template && !readOnly && <Button variant="secondary" onClick={copy}>{text.copy}</Button>}
      {template && editable && draft && <Button onClick={() => void save([{ type: "PUT_LAYOUT_TEMPLATE", template: draft }], text.saved)}>{text.save}</Button>}
      {template && isSaved && !readOnly && !draft && <Button variant="quiet" onClick={() => void save([{ type: "DELETE_LAYOUT_TEMPLATE", id: template.id }], text.saved)
        .then(ok => { if (ok) onSelect("NONE"); })}>{text.remove}</Button>}
    </div>
    {message && <Notice tone={message.tone === "ok" ? "ok" : "error"}><p>{message.text}</p></Notice>}
    {template && <fieldset className={styles.stack} disabled={!editable} data-testid="layout-template-fields">
      <div className={styles.row}>
        <label className={styles.field}>{text.name}<input value={template.name} onChange={event => edit({ ...template, name: event.target.value })} /></label>
        <label className={styles.field}>{text.paper}<select value={template.paper.name} onChange={event => edit(regrid(template, { paper: event.target.value as PaperName }))}>
          {PAPERS.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
        <label className={styles.check}><input type="checkbox" checked={template.paper.landscape}
          onChange={event => edit(regrid(template, { landscape: event.target.checked }))} />{text.landscape}</label>
        <label className={styles.field}>{text.margin}<input type="number" min={0} max={30} className={styles.small} value={template.marginMm}
          onChange={event => edit(regrid(template, { marginMm: number(event.target.value, template.marginMm) }))} /></label>
        <label className={styles.field}>{text.rows}<input type="number" min={1} max={4} className={styles.small} value={grid.rows}
          onChange={event => edit(regrid(template, { rows: Math.max(1, Math.min(4, number(event.target.value, 1))) }))} /></label>
        <label className={styles.field}>{text.columns}<input type="number" min={1} max={4} className={styles.small} value={grid.columns}
          onChange={event => edit(regrid(template, { columns: Math.max(1, Math.min(4, number(event.target.value, 1))) }))} /></label>
        <span className={styles.muted}>{text.frames(template.frames.length)}</span>
        <label className={styles.check}><input type="checkbox" checked={template.cutMarks} onChange={event => edit({ ...template, cutMarks: event.target.checked })} />
          {text.cutMarks}</label>
      </div>
      <h3>{text.texts}</h3>
      <p className={styles.muted}>{text.textHelp}</p>
      {template.texts.map((row, index) => <div key={index} className={styles.row}>
        <label className={styles.field}>{text.textValue}<input className={styles.wide} value={row.text} onChange={event => setText(index, { text: event.target.value })} /></label>
        <label className={styles.field}>{text.x}<input type="number" className={styles.small} value={row.x} onChange={event => setText(index, { x: number(event.target.value, row.x) })} /></label>
        <label className={styles.field}>{text.y}<input type="number" className={styles.small} value={row.y} onChange={event => setText(index, { y: number(event.target.value, row.y) })} /></label>
        <label className={styles.field}>{text.size}<input type="number" min={1} max={40} className={styles.small} value={row.sizeMm}
          onChange={event => setText(index, { sizeMm: Math.max(1, number(event.target.value, row.sizeMm)) })} /></label>
        <Button variant="quiet" onClick={() => edit({ ...template, texts: template.texts.filter((_, i) => i !== index) })}>{text.removeText}</Button>
      </div>)}
      <div className={styles.row}><Button variant="secondary" onClick={() => edit({ ...template, texts: [...template.texts,
        { x: template.marginMm + 2, y: template.marginMm + 6, text: "{tävling} – {bana}", sizeMm: 5, bold: true }] })}>{text.addText}</Button></div>
      <div className={styles.row}>
        <label className={styles.field}>{text.logo}<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={event => void logo(event.target.files?.[0])} /></label>
        {template.images.length > 0 && <Button variant="quiet" onClick={() => edit({ ...template, images: [] })}>{text.removeLogo}</Button>}
      </div>
      {/* Kontrollbeskrivningen ställs in per bana (Kontrollbeskrivning på kartan); en äldre mall med plats för den används
          bara för banor som inte har en utplacerad. */}
      <p className={styles.muted}>{text.descriptionMoved}</p>
      <div className={styles.row}>
        <label className={styles.check}><input type="checkbox" checked={Boolean(strip)} onChange={event => setStrip(event.target.checked ? {} : null)} data-testid="layout-template-strip" />
          {text.strip}</label>
        {strip && <>
          <label className={styles.field}>{text.edge}<select value={strip.edge} onChange={event => setStrip({ edge: event.target.value as TemplateStrip["edge"] })}>
            {Object.entries(text.edges).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className={styles.field}>{text.depth}<input type="number" min={5} max={40} className={styles.small} value={strip.depthMm}
            onChange={event => setStrip({ depthMm: Math.max(5, number(event.target.value, 14)) })} /></label>
          <label className={styles.field}>{text.textValue}<input className={styles.wide} value={strip.text} onChange={event => setStrip({ text: event.target.value })} /></label>
        </>}
      </div>
    </fieldset>}
  </section>;
}

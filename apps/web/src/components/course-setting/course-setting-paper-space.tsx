"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  effectivePaper, newPaperItemId, paperClipPoints, paperLayoutOf, reanchor, resetPaperItem, withPaperItem, PAPER_CORNERS, PAPER_VARIABLES,
  type CourseSettingDocument, type CourseSettingEdit, type PaperAlign, type PaperClip, type PaperCorner, type PaperItem, type PaperItemKind,
  type PaperRect, type Sheet, type SheetPaperItem
} from "@o-tid/course-setting";
import { paperSpaceSv as text } from "../../i18n/course-setting-paper-sv";
import { anchorIn, anchorRect, newPaperItem, paperItemLabel, paperLayoutEdit } from "../../lib/course-setting-paper";
import { uploadPaperImage } from "../../lib/course-setting-paper-api";
import { Button } from "../ui";
import { CLIP_SELECTION, type PaperSelection } from "./course-setting-paper-items";
import { PaperTemplatesSection } from "./course-setting-paper-templates";
import { HelpLink } from "../help/help-panel";
import styles from "./course-setting-print-page.module.css";

/** Ett element som det står på ett ark (för hörnbyte och klippningens förval). */
export interface PlacedPaper { readonly sheet: Sheet; readonly item: SheetPaperItem }

/**
 * ADR-0197: papperet för en bana i förhandsvisningen: lägg till text, bild, skalstock och nordpil, listan med varifrån
 * elementen kommer, det markerade elementets fält (siffror räcker på telefonen), klippningen, uppgifterna för texterna och
 * mallarna. Arket ritar och drar elementen (`course-setting-paper-items.tsx`).
 */
export function PaperSpacePanel({ raceId, document, courses, course, onCourse, selected, onSelect, placed, frameOf, readOnly, onSave, onUndo, canUndo }: {
  raceId: string; document: CourseSettingDocument; courses: readonly { id: string; name: string }[];
  course: string | undefined; onCourse: (course: string) => void;
  selected: PaperSelection; onSelect: (selection: PaperSelection) => void;
  /** Det markerade elementet på arket (om banan visas). */
  placed: PlacedPaper | undefined;
  /** Banans första kartram på ett ark (klippningens förval). */
  frameOf: (course: string) => PaperRect | undefined;
  readOnly: boolean; onSave: (edits: CourseSettingEdit[]) => Promise<boolean>; onUndo: () => void; canUndo: boolean;
}) {
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  if (!course) return null;
  const effective = effectivePaper(document, course);
  const item = selected?.course === course ? effective.items.find(row => row.item.id === selected.id) : undefined;
  async function save(edits: CourseSettingEdit[], done?: string) {
    const ok = await onSave(edits);
    setMessage(ok ? (done ? { ok, text: done } : undefined) : { ok, text: text.failed });
    return ok;
  }
  const putItem = (id: string, next: PaperItem | null) => save([paperLayoutEdit(course, withPaperItem(document, course, id, next))]);
  async function add(kind: PaperItemKind) {
    if (kind === "IMAGE") { file.current?.click(); return; }
    const id = newPaperItemId(document, course!);
    if (await putItem(id, newPaperItem(kind, id))) onSelect({ course: course!, id });
  }
  async function upload(chosen: File | undefined) {
    if (!chosen) return;
    setBusy(true);
    try {
      const outcome = await uploadPaperImage(raceId, chosen);
      if (outcome.kind === "too-large") { setMessage({ ok: false, text: text.imageTooLarge }); return; }
      if (outcome.kind === "invalid") { setMessage({ ok: false, text: text.imageInvalid }); return; }
      const id = newPaperItemId(document, course!);
      if (await putItem(id, newPaperItem("IMAGE", id, outcome.image))) onSelect({ course: course!, id });
    } catch (error) { console.error("Bilden laddades inte upp", error); setMessage({ ok: false, text: text.imageFailed }); }
    finally { setBusy(false); if (file.current) file.current.value = ""; }
  }
  return <section className={styles.panel} aria-labelledby="paper-space" data-testid="paper-space">
    <h2 id="paper-space">{text.heading}</h2>
    <p className={styles.muted}>{text.help} <HelpLink article="papperet" view={["CS_PRINT_PAGE", "CS_PRINT", "COURSE_SETTING"]} /></p>
    {readOnly && <p className={styles.muted}>{text.readOnly}</p>}
    <div className={styles.row}>
      <label className={styles.field}>{text.course}<select value={course} onChange={event => { onCourse(event.target.value); onSelect(undefined); }}
        data-testid="paper-course">{courses.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      {!readOnly && <Button variant="quiet" onClick={onUndo} disabled={!canUndo} data-testid="paper-undo">{text.undo}</Button>}
    </div>
    {!readOnly && <div className={styles.row} data-testid="paper-add">
      {(["TEXT", "IMAGE", "SCALE_BAR", "NORTH_ARROW"] as const).map(kind => <Button key={kind} variant="secondary" disabled={busy}
        onClick={() => void add(kind)} data-testid={`paper-add-${kind}`}>{text.add[kind]}</Button>)}
      <input ref={file} type="file" accept="image/png,image/jpeg,image/svg+xml,.svg" hidden onChange={event => void upload(event.target.files?.[0])}
        data-testid="paper-image-file" aria-label={text.add.IMAGE} />
    </div>}
    {!readOnly && <p className={styles.muted}>{text.imageHelp}</p>}
    <h3>{text.items}</h3>
    {effective.items.length === 0 ? <p className={styles.muted}>{text.none}</p> : <ul className={styles.paperRows} data-testid="paper-items">
      {effective.items.map(row => <li key={row.item.id} data-id={row.item.id} data-source={row.source} data-testid="paper-item-row"
        data-selected={item?.item.id === row.item.id ? "" : undefined}>
        <Button variant="quiet" aria-pressed={item?.item.id === row.item.id} onClick={() => onSelect({ course, id: row.item.id })}
          aria-label={text.select(paperItemLabel(row.item))}><strong>{text.kinds[row.item.kind]}</strong>{row.item.kind === "TEXT" ? `: ${paperItemLabel(row.item)}` : ""}</Button>
        <span className={styles.muted}>{text.source[row.source]}</span>
      </li>)}
    </ul>}
    {item && <Inspector key={`${course}:${item.item.id}`} item={item.item} source={item.source} placed={placed} readOnly={readOnly}
      onChange={next => void putItem(item.item.id, next)} onRemove={() => { onSelect(undefined); void putItem(item.item.id, null); }}
      onReset={() => void save([paperLayoutEdit(course, resetPaperItem(document, course, item.item.id))])} onClose={() => onSelect(undefined)} />}
    <ClipSection document={document} course={course} frame={frameOf(course)} readOnly={readOnly} selected={selected} onSelect={onSelect} onSave={save} />
    <Values document={document} readOnly={readOnly} onSave={save} />
    <PaperTemplatesSection raceId={raceId} document={document} course={course} courses={courses} readOnly={readOnly} onSave={save} />
    <p className={styles.muted}>{text.ppenNote}</p>
    {message && <p role="status" className={message.ok ? styles.muted : styles.paperWarning} data-testid="paper-message">{message.text}</p>}
  </section>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className={styles.field}>{label}{children}</label>;
}

/** Ett tal som sparas när fältet lämnas (eller Enter). */
function NumberField({ label, value, min, max, step = 0.5, disabled, onCommit, testId }: { label: string; value: number; min: number; max: number; step?: number;
  disabled: boolean; onCommit: (value: number) => void; testId?: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(Math.round(value * 10) / 10)); }, [value]);
  const commit = () => {
    const next = Number(draft.replace(",", "."));
    if (Number.isFinite(next) && next !== value) onCommit(Math.max(min, Math.min(max, next)));
    else setDraft(String(Math.round(value * 10) / 10));
  };
  return <Field label={label}><input type="number" inputMode="decimal" className={styles.small} value={draft} min={min} max={max} step={step} disabled={disabled}
    onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") commit(); }} data-testid={testId} /></Field>;
}

function Inspector({ item, source, placed, readOnly, onChange, onRemove, onReset, onClose }: {
  item: PaperItem; source: string; placed: PlacedPaper | undefined; readOnly: boolean;
  onChange: (item: PaperItem) => void; onRemove: () => void; onReset: () => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(item.kind === "TEXT" ? item.text : "");
  useEffect(() => { if (item.kind === "TEXT") setDraft(item.text); }, [item]);
  const reference = placed ? anchorRect(placed.sheet, placed.item) : undefined;
  const setCorner = (corner: PaperCorner) => onChange({ ...item, at: placed && reference ? reanchor(item.at, corner, placed.item.rect, reference) : { ...item.at, corner } });
  const setRelative = (page: boolean) => {
    const next = { ...item, relativeTo: page ? "PAGE" as const : undefined };
    if (!placed) { onChange(next); return; }
    // Samma ställe på arket och samma hörn, förankrat i arket eller ramen.
    const sheet = placed.sheet;
    const rect = page ? { x: 0, y: 0, width: sheet.paper.widthMm, height: sheet.paper.heightMm } : sheet.frames[placed.item.frame]!.clip;
    onChange({ ...next, at: anchorIn(item.at.corner, placed.item.rect, rect) });
  };
  const commitText = () => { if (item.kind === "TEXT" && draft !== item.text) onChange({ ...item, text: draft }); };
  return <div className={styles.paperInspector} data-testid="paper-inspector" role="group" aria-label={text.inspector}>
    <div className={styles.row}>
      <strong>{text.inspector}: {text.kinds[item.kind]}</strong>
      <span className={styles.muted}>{text.source[source]}</span>
      <Button variant="quiet" onClick={onClose} data-testid="paper-deselect">{text.deselect}</Button>
    </div>
    {!placed && <p className={styles.muted}>{text.notOnSheet}</p>}
    <fieldset className={styles.stack} disabled={readOnly}>
      {item.kind === "TEXT" && <>
        <Field label={text.text}><textarea className={styles.wide} rows={2} value={draft} maxLength={400} onChange={event => setDraft(event.target.value)}
          onBlur={commitText} data-testid="paper-text" /></Field>
        <div className={styles.row}>
          <Field label={text.variables}><select value="" data-testid="paper-variable" onChange={event => {
            if (!event.target.value) return;
            const next = `${draft}${draft && !draft.endsWith(" ") && !draft.endsWith("\n") ? " " : ""}{${event.target.value}}`;
            setDraft(next); onChange({ ...item, text: next });
          }}><option value="">…</option>{PAPER_VARIABLES.map(name => <option key={name} value={name}>{`{${name}}`}</option>)}</select></Field>
          <NumberField label={text.size} value={item.sizeMm} min={1.5} max={40} disabled={readOnly} onCommit={sizeMm => onChange({ ...item, sizeMm })} testId="paper-size" />
          <NumberField label={text.width} value={item.widthMm} min={5} max={1000} step={1} disabled={readOnly} onCommit={widthMm => onChange({ ...item, widthMm })} testId="paper-width" />
        </div>
        <p className={styles.muted}>{text.variableHelp}</p>
        <div className={styles.row}>
          <label className={styles.check}><input type="checkbox" checked={item.bold === true} onChange={event => onChange({ ...item, bold: event.target.checked })}
            data-testid="paper-bold" />{text.bold}</label>
          <Field label={text.align}><select value={item.align ?? "left"} onChange={event => onChange({ ...item, align: event.target.value as PaperAlign })} data-testid="paper-align">
            {(["left", "center", "right"] as const).map(value => <option key={value} value={value}>{text.aligns[value]}</option>)}</select></Field>
          <label className={styles.check}><input type="checkbox" checked={item.background === true} onChange={event => onChange({ ...item, background: event.target.checked })}
            data-testid="paper-background" />{text.background}</label>
        </div>
      </>}
      {item.kind === "IMAGE" && <div className={styles.row}>
        <NumberField label={text.width} value={item.widthMm} min={2} max={1000} step={1} disabled={readOnly} onCommit={widthMm => onChange({ ...item, widthMm })} testId="paper-width" />
        <NumberField label={text.opacity} value={Math.round((item.opacity ?? 1) * 100)} min={5} max={100} step={5} disabled={readOnly}
          onCommit={value => onChange({ ...item, opacity: value / 100 })} testId="paper-opacity" />
      </div>}
      {item.kind === "SCALE_BAR" && <div className={styles.row}>
        <NumberField label={text.width} value={item.widthMm} min={10} max={300} step={1} disabled={readOnly} onCommit={widthMm => onChange({ ...item, widthMm })} testId="paper-width" />
        <label className={styles.check}><input type="checkbox" checked={item.background === true} onChange={event => onChange({ ...item, background: event.target.checked })} />
          {text.background}</label>
      </div>}
      {item.kind === "NORTH_ARROW" && <NumberField label={text.height} value={item.sizeMm} min={5} max={100} step={1} disabled={readOnly}
        onCommit={sizeMm => onChange({ ...item, sizeMm })} testId="paper-arrow-size" />}
      <div className={styles.row}>
        <Field label={text.relative}><select value={item.relativeTo ?? "FRAME"} onChange={event => setRelative(event.target.value === "PAGE")} data-testid="paper-relative">
          <option value="FRAME">{text.relatives.FRAME}</option><option value="PAGE">{text.relatives.PAGE}</option></select></Field>
        <Field label={text.corner}><select value={item.at.corner} onChange={event => setCorner(event.target.value as PaperCorner)} data-testid="paper-corner">
          {PAPER_CORNERS.map(corner => <option key={corner} value={corner}>{text.corners[corner]}</option>)}</select></Field>
        <NumberField label={text.x} value={item.at.x} min={-2000} max={2000} disabled={readOnly} onCommit={x => onChange({ ...item, at: { ...item.at, x } })} testId="paper-x" />
        <NumberField label={text.y} value={item.at.y} min={-2000} max={2000} disabled={readOnly} onCommit={y => onChange({ ...item, at: { ...item.at, y } })} testId="paper-y" />
      </div>
      {!readOnly && <div className={styles.row}>
        <Button variant="secondary" onClick={onRemove} data-testid="paper-remove">{text.remove}</Button>
        {source === "OVERRIDE" && <Button variant="quiet" onClick={onReset} data-testid="paper-reset">{text.reset}</Button>}
      </div>}
    </fieldset>
  </div>;
}

/** Förvalet för en ny klippning: 10 mm in från ramen (polygonen som en åttahörning i samma ruta). */
function defaultClip(shape: "RECT" | "POLYGON", frame: PaperRect | undefined, outside: "WHITE" | "FADED"): PaperClip {
  const w = frame?.width ?? 150, h = frame?.height ?? 150;
  const inset = Math.min(10, w / 6, h / 6);
  const rect = { x: inset, y: inset, width: Math.round((w - 2 * inset) * 10) / 10, height: Math.round((h - 2 * inset) * 10) / 10 };
  if (shape === "RECT") return { shape, rect, outside };
  const cx = w / 2, cy = h / 2, rx = rect.width / 2, ry = rect.height / 2;
  const points = Array.from({ length: 8 }, (_, i) => ({ x: Math.round((cx + rx * Math.cos((i + 0.5) * Math.PI / 4)) * 10) / 10,
    y: Math.round((cy + ry * Math.sin((i + 0.5) * Math.PI / 4)) * 10) / 10 }));
  return { shape, points, outside };
}

function ClipSection({ document, course, frame, readOnly, selected, onSelect, onSave }: {
  document: CourseSettingDocument; course: string; frame: PaperRect | undefined; readOnly: boolean; selected: PaperSelection;
  onSelect: (selection: PaperSelection) => void; onSave: (edits: CourseSettingEdit[]) => Promise<boolean>;
}) {
  const effective = effectivePaper(document, course);
  const clip = effective.clip;
  const layout = paperLayoutOf(document, course);
  const editing = selected?.course === course && selected.id === CLIP_SELECTION;
  const setClip = (next: PaperClip | "NONE" | undefined) => {
    const rest = { ...layout };
    delete rest.clip;
    // Ingen klippning: banans tas bort; har mallen en klippning stängs den av för banan.
    const value = next === undefined && effective.template?.clip ? "NONE" as const : next;
    return onSave([paperLayoutEdit(course, value === undefined ? rest : { ...rest, clip: value })]);
  };
  const shape = clip?.shape ?? "NONE";
  return <fieldset className={styles.stack} disabled={readOnly} data-testid="paper-clip">
    <legend><strong>{text.clip.heading}</strong></legend>
    <p className={styles.muted}>{text.clip.help}</p>
    <div className={styles.row} role="radiogroup" aria-label={text.clip.heading}>
      {([["NONE", text.clip.none], ["RECT", text.clip.rect], ["POLYGON", text.clip.polygon]] as const).map(([value, label]) =>
        <label key={value} className={styles.check}><input type="radio" name={`paper-clip-${course}`} checked={shape === value} data-testid={`paper-clip-${value}`}
          onChange={() => { void setClip(value === "NONE" ? undefined : defaultClip(value, frame, clip?.outside ?? "WHITE"));
            if (value !== "NONE") onSelect({ course, id: CLIP_SELECTION }); }} />{label}</label>)}
    </div>
    {clip && <>
      <div className={styles.row}>
        <Field label={text.clip.outside}><select value={clip.outside} data-testid="paper-clip-outside"
          onChange={event => void setClip({ ...clip, outside: event.target.value as "WHITE" | "FADED" })}>
          <option value="WHITE">{text.clip.white}</option><option value="FADED">{text.clip.faded}</option></select></Field>
        <label className={styles.check}><input type="checkbox" checked={editing} onChange={event => onSelect(event.target.checked ? { course, id: CLIP_SELECTION } : undefined)}
          data-testid="paper-clip-edit" />{text.clip.edit}</label>
        {clip.shape === "POLYGON" && <>
          <Button variant="quiet" disabled={clip.points.length >= 64} onClick={() => {
            // Mitt på den längsta sidan.
            const points = clip.points;
            let best = 0, length = -1;
            points.forEach((p, i) => { const q = points[(i + 1) % points.length]!; const d = Math.hypot(q.x - p.x, q.y - p.y); if (d > length) { length = d; best = i; } });
            const a = points[best]!, b = points[(best + 1) % points.length]!;
            void setClip({ ...clip, points: [...points.slice(0, best + 1), { x: Math.round((a.x + b.x) * 5) / 10, y: Math.round((a.y + b.y) * 5) / 10 }, ...points.slice(best + 1)] });
          }}>{text.clip.addPoint}</Button>
          <Button variant="quiet" disabled={clip.points.length <= 3} onClick={() => void setClip({ ...clip, points: clip.points.slice(0, -1) })}>{text.clip.removePoint}</Button>
        </>}
      </div>
      {effective.clipSource === "TEMPLATE" && <p className={styles.muted}>{text.clip.fromTemplate}</p>}
      {clip.shape === "RECT" && <div className={styles.row} aria-label={text.clip.rectFields} role="group">
        {(["x", "y", "width", "height"] as const).map(key => <NumberField key={key} label={key === "x" ? "X" : key === "y" ? "Y" : key === "width" ? text.width : text.height}
          value={clip.rect[key]} min={key === "width" || key === "height" ? 1 : -2000} max={2000} disabled={readOnly} testId={`paper-clip-${key}`}
          onCommit={value => void setClip({ ...clip, rect: { ...clip.rect, [key]: value } })} />)}
      </div>}
    </>}
  </fieldset>;
}

/** Klippningen med ett hörn flyttat (rektangeln: motstående hörn står kvar). */
export function clipWithPoint(clip: PaperClip, index: number, point: { x: number; y: number }): PaperClip {
  if (clip.shape === "POLYGON") return { ...clip, points: clip.points.map((p, i) => i === index ? point : p) };
  const corners = paperClipPoints(clip);
  const opposite = corners[(index + 2) % 4]!;
  const round = (value: number) => Math.round(value * 10) / 10;
  return { ...clip, rect: { x: round(Math.min(point.x, opposite.x)), y: round(Math.min(point.y, opposite.y)),
    width: round(Math.max(1, Math.abs(point.x - opposite.x))), height: round(Math.max(1, Math.abs(point.y - opposite.y))) } };
}

function Values({ document, readOnly, onSave }: { document: CourseSettingDocument; readOnly: boolean; onSave: (edits: CourseSettingEdit[]) => Promise<boolean> }) {
  const values = document.event.paperValues ?? {};
  const [date, setDate] = useState(values.date ?? "");
  const [contour, setContour] = useState(values.contourInterval ?? "");
  useEffect(() => { setDate(values.date ?? ""); setContour(values.contourInterval ?? ""); }, [values.date, values.contourInterval]);
  const commit = () => {
    if (date === (values.date ?? "") && contour === (values.contourInterval ?? "")) return;
    void onSave([{ type: "SET_EVENT", changes: { paperValues: { ...(date.trim() ? { date: date.trim() } : {}), ...(contour.trim() ? { contourInterval: contour.trim() } : {}) } } }]);
  };
  return <fieldset className={styles.stack} disabled={readOnly}>
    <legend><strong>{text.values}</strong></legend>
    <div className={styles.row}>
      <Field label={text.date}><input className={styles.medium} value={date} maxLength={40} onChange={event => setDate(event.target.value)} onBlur={commit}
        data-testid="paper-date" /></Field>
      <Field label={text.contour}><input className={styles.small} value={contour} maxLength={20} onChange={event => setContour(event.target.value)} onBlur={commit}
        data-testid="paper-contour" /></Field>
    </div>
  </fieldset>;
}

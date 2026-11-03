"use client";

import {
  descriptionShown, paperLayoutOf, partsForChooser, HUNDREDTH_INCH_MM, PAPER_SIZES, printAreaOf, type CoursePage, type CourseSettingDocument, type CourseSettingEdit,
  type PaperName, type PartOverlap, type PrintArea
} from "@o-tid/course-setting";
import { coursePrintSv as text } from "../../i18n/course-setting-print-sv";

const paperText = text.paper;
import { ALL_CONTROLS } from "../../lib/course-setting-hit";
import { Button } from "../ui";
import styles from "./course-setting.module.css";

const PAPERS: readonly PaperName[] = ["A3", "A4", "A5"];
const SCALES = [15000, 10000, 7500, 5000, 4000];
const thousands = (value: number) => Math.round(value).toLocaleString("sv-SE").replace(/\s/g, " ");

/** Papperets namn ur storleken (1/100 tum, stående). */
export function paperName(page: { width: number; height: number }): PaperName | undefined {
  return (Object.keys(PAPER_SIZES) as PaperName[]).find(name => PAPER_SIZES[name].width === page.width && PAPER_SIZES[name].height === page.height);
}

/**
 * Steg 64: fliken Utskrift för vald bana (eller Alla kontroller): papper, riktning, marginal, utskriftsskala och tryckyta
 * (automatisk som Purple Pen eller fast ram som dras på kartan). Allt sparas i dokumentet och skrivs till .ppen.
 */
export function PrintPanel({ document, view, page, readOnly, onEdits, onPreview, part, onPart }: {
  document: CourseSettingDocument; view: string; page: CoursePage | undefined; readOnly: boolean;
  onEdits: (edits: readonly CourseSettingEdit[]) => void; onPreview: () => void;
  /** Kartbyten (ADR-0203): vald del (undefined = hela banan) och väljaren. */
  part?: number | undefined; onPart?: ((part: number | undefined) => void) | undefined;
}) {
  const parts = partsForChooser(document, view);
  const partOwnArea = part !== undefined ? document.courses.find(item => item.id === view)?.partPrintAreas?.[String(part)] : undefined;
  const area = printAreaOf(document, view, part);
  const current = area.page ?? (page ? { width: Math.round((page.paper.landscape ? page.paper.heightMm : page.paper.widthMm) / HUNDREDTH_INCH_MM),
    height: Math.round((page.paper.landscape ? page.paper.widthMm : page.paper.heightMm) / HUNDREDTH_INCH_MM),
    margins: Math.round(page.paper.marginMm / HUNDREDTH_INCH_MM), landscape: page.paper.landscape } : { ...PAPER_SIZES.A4, margins: 28, landscape: false });
  const setArea = (next: PrintArea | null) => onEdits([{ type: "SET_PRINT_AREA", course: view, area: next, ...(part !== undefined ? { part } : {}) }]);
  const overlap: PartOverlap = paperLayoutOf(document, view).overlap ?? "LAST_LEG";
  const withPage = (changes: Partial<NonNullable<PrintArea["page"]>>) => setArea({ ...area, page: { ...current, ...changes } });
  const course = document.courses.find(item => item.id === view);
  const scale = view === ALL_CONTROLS ? document.event.allControlsPrintScale ?? document.event.mapScale : course?.printScale ?? document.event.mapScale;
  const scales = [...new Set([document.event.mapScale, ...SCALES, scale])].sort((a, b) => b - a);
  const setScale = (value: number) => onEdits([view === ALL_CONTROLS ? { type: "SET_EVENT", changes: { allControlsPrintScale: value } }
    : { type: "UPDATE_COURSE", course: view, changes: { printScale: value } }]);
  const manual = !area.automatic && area.rect !== undefined;
  return <section className={styles.panel} aria-labelledby="course-setting-print" data-testid="course-setting-print">
    <h2 id="course-setting-print">{text.print.heading}: {course?.name ?? text.print.allControls}</h2>
    <p className={styles.muted}>{text.print.help}</p>
    {parts > 1 && <fieldset className={styles.stack} data-testid="course-setting-parts">
      <legend>{text.print.parts}</legend>
      <label className={styles.stack}>{text.print.part}
        <select value={part === undefined ? "" : String(part)} data-testid="course-setting-part"
          onChange={event => onPart?.(event.target.value === "" ? undefined : Number(event.target.value))}>
          <option value="">{text.print.wholeCourse}</option>
          {Array.from({ length: parts }, (_, index) => <option key={index} value={index}>{text.print.partName(index + 1)}</option>)}
        </select></label>
      {part !== undefined && <p className={styles.muted} data-testid="course-setting-part-area">{partOwnArea ? text.print.partOwnArea : text.print.partInherits}</p>}
      <label className={styles.stack}>{text.print.overlap}
        <select value={overlap} disabled={readOnly} data-testid="course-setting-overlap" onChange={event => onEdits([{ type: "SET_PAPER_LAYOUT", course: view,
          layout: { ...paperLayoutOf(document, view), overlap: event.target.value as PartOverlap } }])}>
          <option value="NONE">{text.print.overlapNone}</option>
          <option value="LAST_LEG">{text.print.overlapLastLeg}</option>
          <option value="PREVIOUS_PART">{text.print.overlapPrevious}</option>
        </select></label>
    </fieldset>}
    <fieldset className={styles.stack} disabled={readOnly}>
      <label className={styles.stack}>{text.print.paper}
        <select value={paperName(current) ?? ""} onChange={event => withPage({ ...PAPER_SIZES[event.target.value as PaperName] })}>
          {!paperName(current) && <option value="">{`${Math.round(current.width * HUNDREDTH_INCH_MM)} × ${Math.round(current.height * HUNDREDTH_INCH_MM)} mm`}</option>}
          {PAPERS.map(name => <option key={name} value={name}>{name}</option>)}
        </select></label>
      <label className={styles.stack}>{text.print.orientation}
        <select value={current.landscape ? "landscape" : "portrait"} onChange={event => withPage({ landscape: event.target.value === "landscape" })}>
          <option value="portrait">{text.print.portrait}</option><option value="landscape">{text.print.landscape}</option>
        </select></label>
      <label className={styles.stack}>{text.print.margins}
        <input type="number" min={0} max={30} step={1} defaultValue={Math.round(current.margins * HUNDREDTH_INCH_MM)} key={`${view}-${current.margins}`}
          onChange={event => { const value = Number(event.target.value); if (value >= 0 && value <= 30) withPage({ margins: Math.round(value / HUNDREDTH_INCH_MM) }); }} />
      </label>
      <label className={styles.stack}>{text.print.scale}
        <select value={scale} onChange={event => setScale(Number(event.target.value))} data-testid="course-setting-print-scale">
          {scales.map(value => <option key={value} value={value}>{value === document.event.mapScale ? text.print.mapScale(thousands(value)) : `1:${thousands(value)}`}</option>)}
        </select></label>
      <fieldset className={styles.stack}>
        <legend>{text.print.area}</legend>
        <label><input type="radio" name="print-area" checked={!manual} onChange={() => setArea({ automatic: true, restrictToPageSize: true, page: current })} />
          {text.print.automatic}</label>
        <label><input type="radio" name="print-area" checked={manual} onChange={() => page && setArea({ automatic: false, restrictToPageSize: true,
          rect: page.mapArea, page: current })} />{text.print.manual}</label>
        {manual && <label><input type="checkbox" checked={area.restrictToPageSize} onChange={event => setArea({ ...area, restrictToPageSize: event.target.checked,
          ...(page ? { rect: page.mapArea } : {}) })} />{text.print.restrict}</label>}
      </fieldset>
      <p className={styles.muted}>{text.print.frameHelp}</p>
    </fieldset>
    {/* Papperet (ägaren 2026-11-03): beskrivningen är en del av utskriften, inte av kartan i editorn. */}
    <fieldset className={styles.stack} disabled={readOnly} data-testid="course-setting-print-description">
      <label><input type="checkbox" checked={descriptionShown(document, view)} onChange={event => onEdits([{ type: "SET_PAPER_LAYOUT", course: view,
        layout: { ...paperLayoutOf(document, view), descriptions: { ...paperLayoutOf(document, view).descriptions, show: event.target.checked } } }])} />
        {paperText.show}</label>
      {page?.description && <p className={styles.muted}>{paperText.source(page.description.source,
        page.description.corner ? paperText.corners[page.description.corner] : undefined)}.</p>}
      {(page?.description?.overlaps ?? 0) > 0 && <p role="note" className={styles.muted}><strong>⚠ {paperText.overlaps(page!.description!.overlaps!)}</strong></p>}
      <p className={styles.muted}>{paperText.editorHint}</p>
    </fieldset>
    <div className={styles.row}>
      <Button onClick={onPreview}>{text.print.preview}</Button>
      {!readOnly && (part !== undefined ? partOwnArea !== undefined : area.page || manual) && <Button variant="secondary" onClick={() => setArea(null)}
        data-testid="course-setting-print-reset">{part !== undefined ? text.print.partReset : text.print.reset}</Button>}
    </div>
  </section>;
}

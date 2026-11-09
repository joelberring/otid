"use client";

import { useEffect, useState } from "react";
import { sheetPaperEn } from "../../i18n/course-setting-print-en";
import { useTexts } from "../language-provider";
import Link from "next/link";
import {
  countCourseParts, paperLayoutOf, printAreaOf, HUNDREDTH_INCH_MM, PAPER_SIZES, type CourseSettingDocument, type CourseSettingEdit, type PaperName,
  type PartOverlap, type Sheet
} from "@o-tid/course-setting";
import { sheetPaperSv } from "../../i18n/course-setting-print-overview-sv";
import { ownPrintArea, pageOfSheet, paperNameOf, printAreaEdit, type PrintPage } from "../../lib/course-setting-sheet-frame";
import { Button } from "../ui";
import { HelpLink } from "../help/help-panel";
import styles from "./course-setting-print-page.module.css";

const PAPERS: readonly PaperName[] = ["A3", "A4", "A5"];
const thousands = (value: number) => Math.round(value).toLocaleString("sv-SE").replace(/\s/g, " ");

/** Arket som papperet och kartramen gäller: banan (eller Alla kontroller), kartbytets del och arket som det ser ut nu. */
export interface SheetTarget { readonly course: string; readonly part: number | undefined; readonly label: string; readonly sheet: Sheet }

/**
 * ADR-0211 tillägg: papper, riktning, marginal och tryckytan för arket som redigeras (förut i editorns flik Utskrift), och
 * kartbytets överlapp. "Flytta ramen på arket" visar ramens handtag på arket. Allt sparas i banans (eller delens) tryckyta,
 * som skrivs till .ppen som förut.
 */
export function SheetPaperPanel({ raceId, document, target, readOnly, onSave, frameEditing, onFrameEditing, layout }: {
  raceId: string; document: CourseSettingDocument; target: SheetTarget | undefined; readOnly: boolean;
  onSave: (edits: CourseSettingEdit[]) => Promise<boolean>; frameEditing: boolean; onFrameEditing: (on: boolean) => void;
  /** ADR-0217: arket i en annan layout än huvudlayouten: skalan är layoutens och ändras i layouten (`onEdit`). */
  layout?: { readonly name: string; readonly onEdit: () => void } | undefined;
}) {
  const text = useTexts(sheetPaperSv, sheetPaperEn);
  const [failed, setFailed] = useState(false);
  if (!target) return null;
  const { course, part, sheet } = target;
  const area = printAreaOf(document, course, part);
  const page = pageOfSheet(area, sheet);
  const own = ownPrintArea(document, course, part);
  const manual = !area.automatic && area.rect !== undefined;
  const save = async (edits: CourseSettingEdit[]) => setFailed(!(await onSave(edits)));
  const withPage = (changes: Partial<PrintPage>) => void save([printAreaEdit(course, part, { ...area, page: { ...page, ...changes } })]);
  const frame = sheet.frames.find(row => row.course === course && row.part === part) ?? sheet.frames[0];
  const parts = course === "ALL_CONTROLS" ? 1 : countCourseParts(document, course);
  const overlap: PartOverlap = paperLayoutOf(document, course).overlap ?? "LAST_LEG";
  const scale = frame?.printScale;
  return <section className={styles.panel} aria-labelledby="sheet-paper" data-testid="sheet-paper" data-course={course} data-part={part ?? ""}>
    <h2 id="sheet-paper">{text.heading}</h2>
    <p className={styles.muted}>{readOnly ? text.readOnly : text.help} <HelpLink article="arket" view={["CS_PRINT_PAGE", "CS_PRINT"]} /></p>
    <fieldset className={styles.stack} disabled={readOnly}>
      <legend><strong data-testid="sheet-paper-target">{target.label}</strong></legend>
      <div className={styles.row}>
        <label className={styles.field}>{text.paper}
          <select value={paperNameOf(page) ?? ""} data-testid="sheet-paper-size" onChange={event => withPage({ ...PAPER_SIZES[event.target.value as PaperName] })}>
            {!paperNameOf(page) && <option value="">{`${Math.round(page.width * HUNDREDTH_INCH_MM)} × ${Math.round(page.height * HUNDREDTH_INCH_MM)} mm`}</option>}
            {PAPERS.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
        <label className={styles.field}>{text.orientation}
          <select value={page.landscape ? "landscape" : "portrait"} data-testid="sheet-paper-orientation" onChange={event => withPage({ landscape: event.target.value === "landscape" })}>
            <option value="portrait">{text.portrait}</option><option value="landscape">{text.landscape}</option></select></label>
        <MarginField value={Math.round(page.margins * HUNDREDTH_INCH_MM)} onCommit={mm => withPage({ margins: Math.round(mm / HUNDREDTH_INCH_MM) })} />
        {scale !== undefined && (layout ? <span className={styles.muted} data-testid="sheet-paper-scale">{text.layoutScale(thousands(scale), layout.name)}{" "}
          <button type="button" className={styles.linkButton} onClick={layout.onEdit} data-testid="sheet-paper-scale-layout">{text.layoutScaleChange}</button></span>
          : <span className={styles.muted} data-testid="sheet-paper-scale">{text.scale(thousands(scale))}{" "}
          {course !== "ALL_CONTROLS" && <Link href={`/admin/${raceId}/course-setting`}>{text.scaleChange}</Link>}</span>)}
      </div>
      <div className={styles.row} role="radiogroup" aria-label={text.area}>
        <span>{text.area}:</span>
        <label className={styles.check}><input type="radio" name="sheet-paper-area" checked={!manual} data-testid="sheet-paper-area-auto"
          onChange={() => { onFrameEditing(false); void save([printAreaEdit(course, part, { automatic: true, restrictToPageSize: true, page })]); }} />{text.automatic}</label>
        <label className={styles.check}><input type="radio" name="sheet-paper-area" checked={manual} data-testid="sheet-paper-area-manual" disabled={!frame}
          onChange={() => { if (!frame) return; onFrameEditing(true);
            void save([printAreaEdit(course, part, { automatic: false, restrictToPageSize: true, rect: frame.mapArea, page })]); }} />{text.manual}</label>
        {!readOnly && <label className={styles.check}><input type="checkbox" checked={frameEditing} data-testid="sheet-frame-edit"
          onChange={event => onFrameEditing(event.target.checked)} />{text.frameEdit}</label>}
        {!readOnly && own && <Button variant="quiet" data-testid="sheet-paper-reset" onClick={() => { onFrameEditing(false); void save([printAreaEdit(course, part, null)]); }}>
          {part !== undefined ? text.partReset : text.reset}</Button>}
      </div>
      {part !== undefined && <p className={styles.muted} data-testid="sheet-paper-part-area">{own ? text.partOwn : text.partInherits}</p>}
      {parts > 1 && <label className={styles.field}>{text.overlap}
        <select value={overlap} data-testid="sheet-paper-overlap" onChange={event => void save([{ type: "SET_PAPER_LAYOUT", course,
          layout: { ...paperLayoutOf(document, course), overlap: event.target.value as PartOverlap } }])}>
          <option value="NONE">{text.overlapNone}</option><option value="LAST_LEG">{text.overlapLastLeg}</option>
          <option value="PREVIOUS_PART">{text.overlapPrevious}</option></select></label>}
    </fieldset>
    {failed && <p role="status" className={styles.paperWarning}>{text.failed}</p>}
  </section>;
}

/** Marginalen i mm, sparad när fältet lämnas (eller Enter). */
function MarginField({ value, onCommit }: { value: number; onCommit: (mm: number) => void }) {
  const text = useTexts(sheetPaperSv, sheetPaperEn);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const next = Number(draft.replace(",", "."));
    if (Number.isFinite(next) && next >= 0 && next <= 30 && Math.round(next) !== value) onCommit(Math.round(next));
    else setDraft(String(value));
  };
  return <label className={styles.field}>{text.margins}<input type="number" min={0} max={30} step={1} className={styles.small} value={draft}
    data-testid="sheet-paper-margin" onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") commit(); }} /></label>;
}

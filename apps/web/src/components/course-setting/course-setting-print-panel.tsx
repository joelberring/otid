"use client";

import { COURSE_PRINT_SCALES, partsForChooser, type CourseSettingDocument, type CourseSettingEdit } from "@o-tid/course-setting";
import { coursePrintEn } from "../../i18n/course-setting-print-en";
import { useTexts } from "../language-provider";
import { coursePrintSv } from "../../i18n/course-setting-print-sv";
import { ALL_CONTROLS } from "../../lib/course-setting-hit";
import { Button } from "../ui";
import styles from "./course-setting.module.css";

const thousands = (value: number) => Math.round(value).toLocaleString("sv-SE").replace(/\s/g, " ");

/**
 * Steg 64, ADR-0211 tillägg: fliken Utskrift för vald bana (eller Alla kontroller) länkar till utskriften, där papper,
 * riktning, marginal och kartramen ställs in på arket. Här finns bara det som styr kartan i editorn: kartbytets del (kartan
 * visar delen och dess ram) och skalan (den hör till banan, ADR-0211 beslut 5). En fast ram dras på kartan som förut.
 */
export function PrintPanel({ document, view, readOnly, onEdits, onPreview, onLayout, part, onPart, onCourseProperties }: {
  document: CourseSettingDocument; view: string; readOnly: boolean;
  onEdits: (edits: readonly CourseSettingEdit[]) => void; onPreview: () => void; onLayout: () => void;
  /** Kartbyten (ADR-0203): vald del (undefined = hela banan) och väljaren. */
  part?: number | undefined; onPart?: ((part: number | undefined) => void) | undefined;
  /** Skalan hör till banan (ADR-0211 beslut 5): öppnar banans egenskaper. */
  onCourseProperties?: (() => void) | undefined;
}) {
  const text = useTexts(coursePrintSv, coursePrintEn);
  const parts = partsForChooser(document, view);
  const partOwnArea = part !== undefined ? document.courses.find(item => item.id === view)?.partPrintAreas?.[String(part)] : undefined;
  const course = document.courses.find(item => item.id === view);
  const scale = view === ALL_CONTROLS ? document.event.allControlsPrintScale ?? document.event.mapScale : course?.printScale ?? document.event.mapScale;
  const scales = [...new Set([document.event.mapScale, ...COURSE_PRINT_SCALES, scale])].sort((a, b) => b - a);
  const setScale = (value: number) => onEdits([{ type: "SET_EVENT", changes: { allControlsPrintScale: value } }]);
  return <section className={styles.panel} aria-labelledby="course-setting-print" data-testid="course-setting-print">
    <h2 id="course-setting-print">{text.print.heading}: {course?.name ?? text.print.allControls}</h2>
    <p className={styles.muted}>{text.print.help}</p>
    <div className={styles.row}><Button onClick={onPreview}>{text.print.preview}</Button>
      <Button variant="secondary" onClick={onLayout} data-testid="course-setting-print-layout">{text.print.layout}</Button></div>
    {parts > 1 && <fieldset className={styles.stack} data-testid="course-setting-parts">
      <legend>{text.print.parts}</legend>
      <label className={styles.stack}>{text.print.part}
        <select value={part === undefined ? "" : String(part)} data-testid="course-setting-part"
          onChange={event => onPart?.(event.target.value === "" ? undefined : Number(event.target.value))}>
          <option value="">{text.print.wholeCourse}</option>
          {Array.from({ length: parts }, (_, index) => <option key={index} value={index}>{text.print.partName(index + 1)}</option>)}
        </select></label>
      {part !== undefined && <p className={styles.muted} data-testid="course-setting-part-area">{partOwnArea ? text.print.partOwnArea : text.print.partInherits}</p>}
    </fieldset>}
    {view === ALL_CONTROLS ? <label className={styles.stack}>{text.print.scale}
      <select value={scale} disabled={readOnly} onChange={event => setScale(Number(event.target.value))} data-testid="course-setting-print-scale">
        {scales.map(value => <option key={value} value={value}>{value === document.event.mapScale ? text.print.mapScale(thousands(value)) : `1:${thousands(value)}`}</option>)}
      </select></label>
      : <div className={styles.stack} data-testid="course-setting-print-scale-readonly">
        <span>{text.print.scale}: <strong data-testid="course-setting-print-scale-value">1:{thousands(scale)}</strong></span>
        {onCourseProperties && <Button variant="quiet" onClick={onCourseProperties} data-testid="course-setting-print-scale-change">{text.print.scaleChange}</Button>}
      </div>}
  </section>;
}

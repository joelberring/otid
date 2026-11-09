"use client";

import { useState, type ReactNode } from "react";
import { trainingEn } from "../../i18n/course-setting-training-en";
import { useTexts } from "../language-provider";
import {
  courseTrainingOf, isFullFilter, presetFilter, trainingOf, type CourseSettingDocument, type CourseSettingEdit, type CourseTraining, type SymbolCatalogEntry,
  type TrainingArea
} from "@o-tid/course-setting";
import { trainingSv } from "../../i18n/course-setting-training-sv";
import { ALL_CONTROLS } from "../../lib/course-setting-hit";
import { newSection, omit, putCourseTraining } from "../../lib/course-setting-training";
import { Button } from "../ui";
import { SymbolFilterEditor } from "./course-setting-training-filter";
import { OutsideBlock, SectionsBlock } from "./course-setting-training-sections";
import { AttackBlock, LineBlock, MirrorBlock, PairsBlock, PiecesBlock, StarBlock } from "./course-setting-training-extras";
import type { TrainingTool } from "./use-course-setting-training";
import styles from "./course-setting-training.module.css";

export type FormCard = Exclude<keyof typeof trainingSv.forms, "heading">;

/** Små bilder för formerna (banans lila, kartan grå). */
export function FormIcon({ form }: { form: string }): ReactNode {
  const course = "var(--training-course, #a626ff)";
  const common = { width: 48, height: 36, viewBox: "0 0 48 36", "aria-hidden": true } as const;
  switch (form) {
    case "CORRIDOR": return <svg {...common}><path d="M4 30 L18 10 L32 24 L44 6" stroke="#cfcfcf" strokeWidth="11" fill="none" strokeLinejoin="miter" />
      <path d="M4 30 L18 10 L32 24 L44 6" stroke={course} strokeWidth="1.6" fill="none" /></svg>;
    case "ATTACK": return <svg {...common}><path d="M4 30 L34 10" stroke={course} strokeWidth="1.6" /><circle cx="38" cy="8" r="6" stroke={course} strokeWidth="1.6" fill="none" />
      <circle cx="24" cy="17" r="3.4" stroke={course} strokeWidth="1.4" fill="none" strokeDasharray="2 1.5" /></svg>;
    case "BAND": return <svg {...common}><path d="M2 12 C12 4 20 20 30 10 S44 6 46 12 M2 22 C12 14 20 30 30 20 S44 16 46 22 M2 32 C12 24 20 38 30 30" stroke="#b5651d" strokeWidth="1.2" fill="none" /></svg>;
    case "WINDOW": return <svg {...common}><circle cx="10" cy="26" r="7" fill="#d9d9d9" /><circle cx="24" cy="10" r="7" fill="#d9d9d9" /><circle cx="38" cy="24" r="7" fill="#d9d9d9" />
      <path d="M10 26 L24 10 L38 24" stroke={course} strokeWidth="1.4" fill="none" /></svg>;
    case "NO_MAP": return <svg {...common}><circle cx="8" cy="28" r="4" stroke={course} strokeWidth="1.4" fill="none" /><circle cx="40" cy="8" r="4" stroke={course} strokeWidth="1.4" fill="none" />
      <path d="M12 26 L36 10" stroke={course} strokeWidth="1.4" strokeDasharray="3 2" /></svg>;
    case "AREA": return <svg {...common}><path d="M6 30 L10 6 L36 4 L44 26 Z" fill="#efe3d6" stroke="#b5651d" strokeWidth="1.2" strokeDasharray="3 2" />
      <path d="M12 22 C20 14 26 24 36 14" stroke="#b5651d" strokeWidth="1" fill="none" /></svg>;
    case "STAR": return <svg {...common}><path d="M24 18 L8 6 M24 18 L42 8 M24 18 L40 32 M24 18 L6 30" stroke={course} strokeWidth="1.3" />
      <circle cx="24" cy="18" r="3" fill={course} /><circle cx="8" cy="6" r="3" stroke={course} fill="none" /><circle cx="42" cy="8" r="3" stroke={course} fill="none" />
      <circle cx="40" cy="32" r="3" stroke={course} fill="none" /><circle cx="6" cy="30" r="3" stroke={course} fill="none" /></svg>;
    case "LINE": return <svg {...common}><path d="M4 30 C14 30 12 8 24 10 S36 30 44 6" stroke={course} strokeWidth="1.8" fill="none" /></svg>;
    case "PAIRS": return <svg {...common}><circle cx="13" cy="18" r="7" stroke={course} strokeWidth="1.5" fill="none" /><circle cx="35" cy="18" r="7" stroke={course} strokeWidth="1.5" fill="none" strokeDasharray="3 2" />
      <text x="9" y="34" fontSize="8" fill={course}>1a</text><text x="31" y="34" fontSize="8" fill={course}>1b</text></svg>;
    case "PIECES": return <svg {...common}><rect x="3" y="3" width="12" height="12" fill="#e0e0e0" /><rect x="18" y="3" width="12" height="12" fill="#e0e0e0" />
      <rect x="33" y="3" width="12" height="12" fill="#e0e0e0" /><rect x="3" y="20" width="12" height="12" fill="#e0e0e0" /><rect x="18" y="20" width="12" height="12" fill="#e0e0e0" />
      <path d="M5 13 L13 5 M20 6 L28 12 M35 12 L43 5" stroke={course} strokeWidth="1.2" /></svg>;
    case "MIRROR": return <svg {...common}><path d="M24 2 L24 34" stroke="#888" strokeWidth="1" strokeDasharray="2 2" />
      <path d="M4 28 L12 10 L20 22" stroke={course} strokeWidth="1.5" fill="none" /><path d="M44 28 L36 10 L28 22" stroke={course} strokeWidth="1.5" fill="none" strokeOpacity="0.55" /></svg>;
    default: return null;
  }
}

/**
 * ADR-0192 beslut 8: fliken Träning. Formerna som kort med bild och en rad, kartan för hela banan (grundfiltret), avsnitten i
 * banans ordning, ritade områden och de andra formerna. Allt kombineras på samma bana.
 */
export function TrainingPanel({ document, view, readOnly, symbols, show, onShow, tool, onTool, onFinish, onEdits, say }: {
  document: CourseSettingDocument; view: string; readOnly: boolean; symbols: readonly SymbolCatalogEntry[]; show: boolean; onShow: (show: boolean) => void;
  tool: TrainingTool | undefined; onTool: (tool: TrainingTool | undefined) => void; onFinish: () => void;
  onEdits: (edits: readonly CourseSettingEdit[]) => void; say: (message: { tone: "ok" | "error" | "attention"; text: string }) => void;
}) {
  const text = useTexts(trainingSv, trainingEn);
  const inCourse = view !== ALL_CONTROLS && document.courses.some(course => course.id === view);
  const training = inCourse ? courseTrainingOf(document, view) : undefined;
  const put = (next: CourseTraining) => onEdits([putCourseTraining(view, next)]);
  // Formerna som har en egen ruta: öppna när de valts eller redan används på banan.
  const [opened, setOpened] = useState<ReadonlySet<FormCard>>(new Set());
  const open = (form: FormCard) => {
    setOpened(current => new Set([...current, form]));
    setTimeout(() => globalThis.document?.getElementById(`training-block-${form}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 0);
  };
  const attacksHere = Object.values(trainingOf(document).attackPoints).length > 0;
  const shown = (form: FormCard) => opened.has(form) || (form === "ATTACK" && attacksHere) || (form === "STAR" && Boolean(training?.star))
    || (form === "LINE" && Boolean(training?.line)) || (form === "PAIRS" && Boolean(training?.pairs)) || (form === "PIECES" && Boolean(training?.pieces))
    || (form === "MIRROR" && training?.mirror === true);
  const add = (form: FormCard) => {
    if (form === "AREA") { onTool({ kind: "AREA", points: [] }); return; }
    if (!training) return;
    if (form === "CORRIDOR" || form === "BAND" || form === "WINDOW" || form === "NO_MAP") {
      const section = newSection(form, training.sections[training.sections.length - 1]);
      // Den första korridoren eller det första fönstret: vitt utanför (som en korridorkarta brukar vara).
      const outside = training.sections.length === 0 && training.outside.kind === "FULL" && (form === "CORRIDOR" || form === "WINDOW")
        ? { kind: "WHITE" as const } : training.outside;
      put({ ...training, outside, sections: [...training.sections, section] });
      return;
    }
    if (form === "ATTACK") onTool({ kind: "ATTACK" });
    if (form === "MIRROR" && !training.mirror) put({ ...training, mirror: true });
    open(form);
  };
  const cards: FormCard[] = ["CORRIDOR", "ATTACK", "BAND", "WINDOW", "AREA", "STAR", "LINE", "PAIRS", "PIECES", "NO_MAP", "MIRROR"];
  return <section className={styles.panel} aria-labelledby="course-setting-training" data-testid="course-setting-training">
    <h2 id="course-setting-training">{text.heading}</h2>
    <p className={styles.muted}>{inCourse ? text.help : text.chooseCourse}</p>
    <label className={styles.check}><input type="checkbox" checked={show} onChange={event => onShow(event.target.checked)} data-testid="training-show" />
      <span>{text.show}<br /><span className={styles.muted}>{text.showHelp}</span></span></label>
    {readOnly && <p className={styles.muted}>{text.readOnly}</p>}
    {tool && tool.kind !== "ATTACK" && <div className={styles.toolBar} role="status">
      <span>{tool.kind === "AREA" ? text.areas.drawing(tool.points.length) : text.line.drawing(tool.points.length)}</span>
      <Button onClick={onFinish} disabled={tool.points.length < (tool.kind === "AREA" ? 3 : 2)} data-testid="training-tool-finish">{text.areas.finish}</Button>
      <Button variant="secondary" onClick={() => onTool(undefined)}>{text.areas.cancel}</Button>
    </div>}
    {!readOnly && <div className={styles.cards} role="group" aria-label={text.forms.heading}>
      {cards.map(form => <button key={form} type="button" className={styles.card} onClick={() => add(form)} data-testid={`training-add-${form}`}
        disabled={!inCourse && form !== "AREA"}>
        <FormIcon form={form} /><span className={styles.cardTitle}>{text.forms[form].title}</span><span className={styles.cardLine}>{text.forms[form].line}</span>
      </button>)}
    </div>}
    {training && <section className={styles.block} aria-labelledby="training-base">
      <h3 id="training-base">{text.base.heading}</h3>
      <p className={styles.muted}>{text.base.help}</p>
      <SymbolFilterEditor label={text.base.heading} filter={training.filter ?? presetFilter("ALL")} symbols={symbols} readOnly={readOnly}
        onChange={filter => put(isFullFilter(filter) ? withoutFilter(training) : { ...training, filter })} />
    </section>}
    {training && <SectionsBlock document={document} view={view} readOnly={readOnly} symbols={symbols} onEdits={onEdits} />}
    {training && training.sections.length > 0 && <OutsideBlock training={training} readOnly={readOnly} symbols={symbols}
      onChange={outside => put({ ...training, outside })} />}
    {training && shown("ATTACK") && <div id="training-block-ATTACK"><AttackBlock document={document} view={view} readOnly={readOnly} tool={tool} onTool={onTool}
      onEdits={onEdits} /></div>}
    <AreasBlock document={document} view={view} readOnly={readOnly} symbols={symbols} onEdits={onEdits} />
    {training && shown("STAR") && <div id="training-block-STAR"><StarBlock document={document} view={view} readOnly={readOnly} onEdits={onEdits} say={say} /></div>}
    {training && shown("LINE") && <div id="training-block-LINE"><LineBlock document={document} view={view} readOnly={readOnly} tool={tool} onTool={onTool}
      onEdits={onEdits} /></div>}
    {training && shown("PAIRS") && <div id="training-block-PAIRS"><PairsBlock document={document} view={view} readOnly={readOnly} onEdits={onEdits} /></div>}
    {training && shown("PIECES") && <div id="training-block-PIECES"><PiecesBlock document={document} view={view} readOnly={readOnly} onEdits={onEdits} /></div>}
    {training && shown("MIRROR") && <div id="training-block-MIRROR"><MirrorBlock document={document} view={view} readOnly={readOnly} onEdits={onEdits} /></div>}
    {inCourse && !readOnly && document.training?.courses[view] && <Button variant="quiet" onClick={() => onEdits([putCourseTraining(view, null)])}
      data-testid="training-remove">{text.removeCourse}</Button>}
  </section>;
}

function withoutFilter(training: CourseTraining): CourseTraining {
  return omit(training, "filter");
}

function AreasBlock({ document, view, readOnly, symbols, onEdits }: {
  document: CourseSettingDocument; view: string; readOnly: boolean; symbols: readonly SymbolCatalogEntry[]; onEdits: (edits: readonly CourseSettingEdit[]) => void;
}) {
  const text = useTexts(trainingSv, trainingEn);
  const areas = Object.values(trainingOf(document).areas).filter(area => area.courses.length === 0 || area.courses.includes(view));
  const put = (area: TrainingArea | null, id: string) => onEdits([{ type: "PUT_TRAINING", areas: { [id]: area } }]);
  return <section className={styles.block} aria-labelledby="training-areas">
    <h3 id="training-areas">{text.areas.heading}</h3>
    {areas.length === 0 ? <p className={styles.muted}>{text.areas.none}</p> : areas.map((area, index) => <details key={area.id} className={styles.item} open>
      <summary>{area.name ?? text.areas.name(index + 1)} · {text.filter.presets[area.filter.preset]}</summary>
      <SymbolFilterEditor label={area.name ?? text.areas.name(index + 1)} filter={area.filter} symbols={symbols} readOnly={readOnly}
        onChange={filter => put({ ...area, filter }, area.id)} />
      {view !== ALL_CONTROLS && <label className={styles.stack}>{text.areas.courses}
        <select value={area.courses.length === 0 ? "ALL" : "THIS"} disabled={readOnly}
          onChange={event => put({ ...area, courses: event.target.value === "ALL" ? [] : [view] }, area.id)}>
          <option value="THIS">{text.areas.thisCourse}</option><option value="ALL">{text.areas.allCourses}</option></select></label>}
      {!readOnly && <Button variant="quiet" onClick={() => put(null, area.id)}>{text.areas.remove}</Button>}
    </details>)}
  </section>;
}

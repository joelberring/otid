"use client";

import { useState } from "react";
import { trainingEn } from "../../i18n/course-setting-training-en";
import { useLanguage, useTexts } from "../language-provider";
import {
  courseTrainingOf, DEFAULT_PIECES, trainingOf, type AttackStyle, type CourseSettingDocument, type CourseSettingEdit, type CourseTraining
} from "@o-tid/course-setting";
import { trainingSv } from "../../i18n/course-setting-training-sv";
import { CONTROL_WORDS, courseControlChoices, hasForks, lineAlongLegs, makePairs, omit, putCourseTraining, starCourseEdits } from "../../lib/course-setting-training";
import { Button } from "../ui";
import type { TrainingTool } from "./use-course-setting-training";
import styles from "./course-setting-training.module.css";

type Edits = (edits: readonly CourseSettingEdit[]) => void;
const DEFAULT_ATTACK: AttackStyle = { sizeRatio: 0.6, style: "SOLID" };

/** Sista säkra: stilen för hela banläggningen, verktyget och banans sista säkra. */
export function AttackBlock({ document, view, readOnly, tool, onTool, onEdits }: {
  document: CourseSettingDocument; view: string; readOnly: boolean; tool: TrainingTool | undefined; onTool: (tool: TrainingTool | undefined) => void; onEdits: Edits;
}) {
  const text = useTexts(trainingSv, trainingEn);
  const words = CONTROL_WORDS[useLanguage()];
  const training = trainingOf(document);
  const style = training.attackStyle ?? DEFAULT_ATTACK;
  const choices = courseControlChoices(document, view, words);
  const name = (control: string) => choices.find(row => row.control === control)?.label ?? "?";
  const legs = new Set<string>();
  for (let i = 0; i + 1 < choices.length; i++) legs.add(`${choices[i]!.control}-${choices[i + 1]!.control}`);
  const attacks = Object.values(training.attackPoints).filter(attack => legs.has(`${attack.from}-${attack.to}`));
  const adding = tool?.kind === "ATTACK";
  return <section className={styles.block} aria-labelledby="training-attack" data-testid="training-attack">
    <h3 id="training-attack">{text.attack.heading}</h3>
    <p className={styles.muted}>{text.attack.help}</p>
    {!readOnly && <div className={styles.row}>
      <Button variant={adding ? "primary" : "secondary"} aria-pressed={adding} onClick={() => onTool(adding ? undefined : { kind: "ATTACK" })}
        data-testid="training-attack-add">{adding ? text.areas.finish : text.attack.add}</Button>
      {adding && <span className={styles.muted} role="status">{text.attack.adding}</span>}
    </div>}
    <div className={styles.row}>
      <label className={styles.stack}>{text.attack.size} ({Math.round(style.sizeRatio * 100)} %)
        <input type="range" min={0.4} max={0.9} step={0.05} value={style.sizeRatio} disabled={readOnly}
          onChange={event => onEdits([{ type: "PUT_TRAINING", attackStyle: { ...style, sizeRatio: Number(event.target.value) } }])} /></label>
    </div>
    <div className={styles.segmented} role="group" aria-label={text.attack.style}>
      {(["SOLID", "DASHED", "THIN"] as const).map(kind => <button key={kind} type="button" aria-pressed={style.style === kind} disabled={readOnly}
        onClick={() => onEdits([{ type: "PUT_TRAINING", attackStyle: { ...style, style: kind } }])}>{text.attack.styles[kind]}</button>)}
    </div>
    {attacks.length === 0 ? <p className={styles.muted}>{text.attack.none}</p> : <ul className={styles.list}>
      {attacks.map(attack => <li key={attack.id}><span>{text.attack.row(`${name(attack.from)}–${name(attack.to)}`)}</span>
        {!readOnly && <Button variant="quiet" onClick={() => onEdits([{ type: "PUT_TRAINING", attackPoints: { [attack.id]: null } }])}>{text.attack.remove}</Button>}</li>)}
    </ul>}
  </section>;
}

/** Stjärna: central kontroll, uddar och utskrift; "Skapa stjärnbana" gör en ny bana i ett ångra-steg. */
export function StarBlock({ document, view, readOnly, onEdits, say }: {
  document: CourseSettingDocument; view: string; readOnly: boolean; onEdits: Edits; say: (message: { tone: "ok" | "error" | "attention"; text: string }) => void;
}) {
  const text = useTexts(trainingSv, trainingEn);
  const words = CONTROL_WORDS[useLanguage()];
  const training = courseTrainingOf(document, view);
  const normal = Object.values(document.controls).filter(control => control.kind === "NORMAL")
    .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? "", "sv-SE", { numeric: true }));
  const [center, setCenter] = useState(training.star?.center ?? normal[0]?.id ?? "");
  const [spokes, setSpokes] = useState<readonly string[]>(() => courseControlChoices(document, view, words)
    .filter(row => document.controls[row.control]?.kind === "NORMAL" && row.control !== center).map(row => row.control));
  const code = (id: string) => document.controls[id]?.code ?? "?";
  const create = (each: boolean) => {
    const chosen = spokes.filter(id => id !== center);
    if (!center || chosen.length === 0) { say({ tone: "attention", text: text.star.needCenter }); return; }
    if (each) {
      let next = document;
      const edits: CourseSettingEdit[] = [];
      for (const spoke of chosen) {
        const made = starCourseEdits(next, text.star.courseName(`${code(center)}–${code(spoke)}`), center, [spoke]);
        edits.push(...made.edits);
        next = { ...next, courses: [...next.courses, { id: made.courseId, name: "", kind: "NORMAL", order: 0, labelKind: "SEQUENCE" }] };
      }
      onEdits(edits);
      say({ tone: "ok", text: text.star.createdMany(chosen.length) });
      return;
    }
    const name = text.star.courseName(code(center));
    const made = starCourseEdits(document, name, center, chosen);
    onEdits([...made.edits, putCourseTraining(made.courseId, { outside: { kind: "FULL" }, sections: [], star: { center, print: "PER_CONTROL" } })]);
    say({ tone: "ok", text: text.star.created(name) });
  };
  return <section className={styles.block} aria-labelledby="training-star" data-testid="training-star">
    <h3 id="training-star">{text.star.heading}</h3>
    <label className={styles.stack}>{text.star.center}
      <select value={center} disabled={readOnly} onChange={event => setCenter(event.target.value)} data-testid="training-star-center">
        {normal.map(control => <option key={control.id} value={control.id}>{control.code}</option>)}</select></label>
    <fieldset className={styles.details}><legend>{text.star.controls}</legend>
      <div className={styles.presets}>{normal.filter(control => control.id !== center).map(control => <label key={control.id} className={styles.check}>
        <input type="checkbox" checked={spokes.includes(control.id)} disabled={readOnly}
          onChange={event => setSpokes(current => event.target.checked ? [...current, control.id] : current.filter(id => id !== control.id))} />{control.code}</label>)}</div>
    </fieldset>
    {!readOnly && <div className={styles.row}>
      <Button onClick={() => create(false)} data-testid="training-star-create">{text.star.create}</Button>
      <Button variant="secondary" onClick={() => create(true)}>{text.star.createEach}</Button>
    </div>}
    {training.star && <>
      <div className={styles.segmented} role="group" aria-label={text.star.print}>
        {(["ALL", "PER_CONTROL"] as const).map(print => <button key={print} type="button" aria-pressed={training.star!.print === print} disabled={readOnly}
          onClick={() => onEdits([putCourseTraining(view, { ...training, star: { ...training.star!, print } })])}>
          {print === "ALL" ? text.star.printAll : text.star.printEach}</button>)}
      </div>
      {!readOnly && <Button variant="quiet" onClick={() => { onEdits([putCourseTraining(view, omit(training, "star"))]); }}>{text.star.remove}</Button>}
    </>}
  </section>;
}

/** Linjeorientering: rita linjen eller ta den längs sträckorna. */
export function LineBlock({ document, view, readOnly, tool, onTool, onEdits }: {
  document: CourseSettingDocument; view: string; readOnly: boolean; tool: TrainingTool | undefined; onTool: (tool: TrainingTool | undefined) => void; onEdits: Edits;
}) {
  const text = useTexts(trainingSv, trainingEn);
  const training = courseTrainingOf(document, view);
  const drawing = tool?.kind === "LINE";
  const put = (next: CourseTraining) => onEdits([putCourseTraining(view, next)]);
  return <section className={styles.block} aria-labelledby="training-line" data-testid="training-line">
    <h3 id="training-line">{text.line.heading}</h3>
    <p className={styles.muted}>{text.line.help}</p>
    {training.line && <p className={styles.muted}>{text.line.points(training.line.points.length)}</p>}
    {!readOnly && !drawing && <div className={styles.row}>
      <Button onClick={() => onTool({ kind: "LINE", points: [] })} data-testid="training-line-draw">{text.line.draw}</Button>
      <Button variant="secondary" onClick={() => put({ ...training, line: { points: lineAlongLegs(document, view) } })} data-testid="training-line-legs">
        {text.line.fromLegs}</Button>
      {training.line && <Button variant="quiet" onClick={() => { put(omit(training, "line")); }}>{text.line.remove}</Button>}
    </div>}
  </section>;
}

/** Kepsorientering: par ur banans kontroller, sträckorna av eller på, gemensam karta (förval) eller A och B. */
export function PairsBlock({ document, view, readOnly, onEdits }: { document: CourseSettingDocument; view: string; readOnly: boolean; onEdits: Edits }) {
  const text = useTexts(trainingSv, trainingEn);
  const words = CONTROL_WORDS[useLanguage()];
  const training = courseTrainingOf(document, view);
  const [mode, setMode] = useState<"ADJACENT" | "HALVES">("ADJACENT");
  const pairs = training.pairs;
  const put = (next: CourseTraining) => onEdits([putCourseTraining(view, next)]);
  const normal = courseControlChoices(document, view, words).filter(row => document.controls[row.control]?.kind === "NORMAL").length;
  if (hasForks(document, view)) return <section className={styles.block}><h3>{text.pairs.heading}</h3><p className={styles.muted}>{text.pairs.forked}</p></section>;
  return <section className={styles.block} aria-labelledby="training-pairs" data-testid="training-pairs">
    <h3 id="training-pairs">{text.pairs.heading}</h3>
    <p className={styles.muted}>{text.pairs.help}</p>
    {!readOnly && <div className={styles.row}>
      <label className={styles.stack}>{text.pairs.mode}
        <select value={mode} onChange={event => setMode(event.target.value as "ADJACENT" | "HALVES")}>
          <option value="ADJACENT">{text.pairs.adjacent}</option><option value="HALVES">{text.pairs.halves}</option></select></label>
      <Button onClick={() => put({ ...training, pairs: { pairs: makePairs(document, view, mode), legs: pairs?.legs ?? false, print: pairs?.print ?? "COMMON" } })}
        data-testid="training-pairs-make">{text.pairs.make}</Button>
    </div>}
    {pairs && <>
      <p className={styles.muted}>{text.pairs.count(pairs.pairs.length)}{normal > pairs.pairs.length * 2 ? ` · ${text.pairs.unpaired(normal - pairs.pairs.length * 2)}` : ""}</p>
      <label className={styles.check}><input type="checkbox" checked={pairs.legs} disabled={readOnly}
        onChange={event => put({ ...training, pairs: { ...pairs, legs: event.target.checked } })} />{text.pairs.legs}</label>
      <div className={styles.segmented} role="group" aria-label={text.pairs.print}>
        {(["COMMON", "SEPARATE"] as const).map(print => <button key={print} type="button" aria-pressed={pairs.print === print} disabled={readOnly}
          onClick={() => put({ ...training, pairs: { ...pairs, print } })}>{print === "COMMON" ? text.pairs.common : text.pairs.separate}</button>)}
      </div>
      {pairs.print === "SEPARATE" && <p className={styles.muted}>{text.pairs.separateHelp}</p>}
      {!readOnly && <Button variant="quiet" onClick={() => { put(omit(training, "pairs")); }}>{text.pairs.remove}</Button>}
    </>}
  </section>;
}

/** Kartbitarna: bitens storlek, skala, marginal och ordning (utskriften i förhandsvisningen). */
export function PiecesBlock({ document, view, readOnly, onEdits }: { document: CourseSettingDocument; view: string; readOnly: boolean; onEdits: Edits }) {
  const text = useTexts(trainingSv, trainingEn);
  const training = courseTrainingOf(document, view);
  const pieces = training.pieces ?? DEFAULT_PIECES;
  const put = (next: CourseTraining) => onEdits([putCourseTraining(view, next)]);
  const number = (label: string, value: number | undefined, min: number, max: number, change: (value: number | undefined) => void) =>
    <label className={styles.stack}>{label}<input type="number" min={min} max={max} defaultValue={value ?? ""} disabled={readOnly}
      onBlur={event => { const raw = event.target.value.trim(); const parsed = Number(raw);
        if (raw === "") change(undefined); else if (Number.isFinite(parsed) && parsed >= min && parsed <= max) change(parsed); }} /></label>;
  return <section className={styles.block} aria-labelledby="training-pieces" data-testid="training-pieces">
    <h3 id="training-pieces">{text.pieces.heading}</h3>
    <p className={styles.muted}>{text.pieces.help}</p>
    <div className={styles.row}>
      {number(text.pieces.size, pieces.sizeMm, 20, 300, value => put({ ...training, pieces: { ...pieces, sizeMm: value ?? DEFAULT_PIECES.sizeMm } }))}
      {number(text.pieces.scale, pieces.scale, 500, 100_000, value => put({ ...training, pieces: value ? { ...pieces, scale: value } : omit(pieces, "scale") }))}
      {number(text.pieces.margin, pieces.marginMeters, 0, 2000, value => put({ ...training, pieces: { ...pieces, marginMeters: value ?? 0 } }))}
    </div>
    <div className={styles.segmented} role="group" aria-label={text.pieces.order}>
      {(["COURSE", "SHUFFLED"] as const).map(order => <button key={order} type="button" aria-pressed={pieces.order === order} disabled={readOnly}
        onClick={() => put({ ...training, pieces: { ...pieces, order } })}>{order === "COURSE" ? text.pieces.course : text.pieces.shuffled}</button>)}
    </div>
    {training.pieces && !readOnly && <Button variant="quiet" onClick={() => { put(omit(training, "pieces")); }}>{text.pieces.remove}</Button>}
  </section>;
}

/** Spegelorientering (ADR-0192 beslut 12): kartan och banan spegelvända i utskriften. */
export function MirrorBlock({ document, view, readOnly, onEdits }: { document: CourseSettingDocument; view: string; readOnly: boolean; onEdits: Edits }) {
  const text = useTexts(trainingSv, trainingEn);
  const training = courseTrainingOf(document, view);
  return <section className={styles.block} aria-labelledby="training-mirror" data-testid="training-mirror">
    <h3 id="training-mirror">{text.mirror.heading}</h3>
    <p className={styles.muted}>{text.mirror.help}</p>
    <label className={styles.check}><input type="checkbox" checked={training.mirror === true} disabled={readOnly} data-testid="training-mirror-on"
      onChange={event => onEdits([putCourseTraining(view, event.target.checked ? { ...training, mirror: true } : omit(training, "mirror"))])} />
      <span>{text.mirror.on}</span></label>
  </section>;
}

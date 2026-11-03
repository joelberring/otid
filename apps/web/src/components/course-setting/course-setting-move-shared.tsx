"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { applyEdit } from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { moveSharedSv as text } from "../../i18n/course-setting-move-sv";
import { applySteps, cancelDrag, endDrag, type EditorState } from "../../lib/course-setting-editor";
import {
  courseNameList, localStore, MOVE_THRESHOLD_CHOICES, newControlEdit, readMoveThreshold, readRememberedChoice, sessionStore, sharedMoveQuestion,
  writeMoveThreshold, writeRememberedChoice, type MoveChoice, type SharedMove
} from "../../lib/course-setting-move-shared";
import type { EditorStore } from "../../lib/course-setting-sync";
import { Button } from "../ui";
import main from "./course-setting.module.css";
import styles from "./course-setting-move-shared.module.css";

export type MoveOutcome = MoveChoice | "CANCEL";
type Source = { readonly kind: "drag" } | { readonly kind: "field"; readonly done: (outcome: MoveOutcome, message?: string) => void };
type Change = (change: (current: EditorState) => EditorState) => void;

/** Frågan som dialog (bred skärm och telefon): tre knappar under varandra och "Kom ihåg". */
function MoveQuestion({ question, onChoose }: { question: SharedMove; onChoose: (outcome: MoveOutcome, remember: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [remember, setRemember] = useState(false);
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal?.(); }, []);
  const many = question.occurrences > 1;
  return <dialog ref={ref} className={styles.dialog} aria-labelledby="move-shared-heading" data-testid="course-setting-move-question"
    onCancel={event => { event.preventDefault(); onChoose("CANCEL", false); }}>
    <h2 id="move-shared-heading">{text.heading(question.code)}</h2>
    <p>{text.intro(question.code, Math.round(question.meters), question.courseName)}</p>
    <p className={styles.courses} data-testid="course-setting-move-courses">{courseNameList(question.otherCourses, 6)}</p>
    {many && <p className={styles.note}>{question.courseControls.length === question.occurrences
      ? text.occurrencesAll(question.occurrences) : text.occurrencesOne(question.occurrences)}</p>}
    <div className={styles.choices}>
      <button type="button" className={styles.choice} data-testid="course-setting-move-all" onClick={() => onChoose("ALL", remember)}>
        <strong>{`${text.all} (${question.otherCourses.length + 1})`}</strong><span>{text.allHelp}</span></button>
      <button type="button" className={styles.choice} data-testid="course-setting-move-new" onClick={() => onChoose("NEW", remember)}>
        <strong>{`${text.newOnly} ${question.courseName}`}</strong><span>{text.newHelp(question.newCode, question.code)}</span></button>
      <button type="button" className={`${styles.choice} ${styles.quiet}`} data-testid="course-setting-move-cancel" onClick={() => onChoose("CANCEL", false)}>
        <strong>{text.cancel}</strong><span>{text.cancelHelp}</span></button>
    </div>
    <label className={styles.remember}><input type="checkbox" checked={remember} data-testid="course-setting-move-remember"
      onChange={event => setRemember(event.target.checked)} />{text.remember}</label>
  </dialog>;
}

/**
 * Frågan när en delad kontroll flyttas långt i en bana: efter en dragning (dragningen står kvar på det nya läget medan
 * frågan visas, och sparandet väntar) och efter "Flytta hit" i fältläget. Varje val blir ett steg i historiken.
 */
export function useMoveShared({ raceId, store, apply, edit, poke, say }: {
  raceId: string; store: EditorStore; apply: Change; edit: Change; poke: () => void;
  say: (message: { tone: "ok" | "attention"; text: string }) => void;
}) {
  const [pending, setPending] = useState<{ question: SharedMove; source: Source }>();
  const [threshold, setThreshold] = useState(() => readMoveThreshold(localStore()));
  const [remembered, setRemembered] = useState(() => readRememberedChoice(sessionStore(), raceId));

  function finish(outcome: MoveOutcome, question: SharedMove, source: Source, fromMemory: boolean) {
    let message: string | undefined;
    if (outcome === "NEW") {
      if (source.kind === "drag") store.update(cancelDrag);
      let created: string | undefined;
      edit(current => applySteps(current, [newControlEdit(question)], applyEdit, (id, document) => {
        created = id && document.controls[id] ? id : undefined;
        return created ? { kind: "control", control: created, courseControl: question.courseControls[0] } : undefined;
      }));
      const code = created ? store.state.document.controls[created]?.code ?? question.newCode : undefined;
      if (code) message = fromMemory ? text.rememberedNew(code, question.code, question.courseName) : text.created(code, question.code, question.courseName);
    } else if (outcome === "ALL") {
      if (source.kind === "drag") apply(endDrag);
      else edit(current => applySteps(current, [{ type: "MOVE_CONTROL", control: question.control, at: question.at }], applyEdit));
      if (fromMemory) message = text.rememberedAll(question.code);
    } else if (source.kind === "drag") apply(cancelDrag);
    poke();
    if (source.kind === "field") source.done(outcome, message);
    else if (message) say({ tone: "ok", text: message });
  }

  function choose(outcome: MoveOutcome, remember: boolean) {
    const current = pending;
    setPending(undefined);
    if (!current) return;
    if (remember && outcome !== "CANCEL") { writeRememberedChoice(sessionStore(), raceId, outcome); setRemembered(outcome); }
    finish(outcome, current.question, current.source, false);
  }

  function ask(question: SharedMove, source: Source) {
    if (remembered) finish(remembered, question, source, true);
    else setPending({ question, source });
  }

  /** Dragningen slutade. true = frågan tar över (valet avslutar dragningen); false = en vanlig dragning. */
  function dragEnded(courseControl: string | undefined, variant: string | undefined): boolean {
    const state = store.state;
    const moved = state.dragEdit;
    if (!state.dragBase || moved?.type !== "MOVE_CONTROL") return false;
    const from = state.dragBase.controls[moved.control]?.at;
    const question = from && sharedMoveQuestion(state.dragBase, { view: state.view, control: moved.control, from, at: moved.at,
      courseControl, variant, thresholdM: threshold });
    if (!question) return false;
    ask(question, { kind: "drag" });
    return true;
  }

  /** "Flytta hit" i fältläget: frågar vid behov, annars flyttas kontrollen direkt. */
  function moveTo(control: string, at: Point, courseControl: string | undefined, variant: string | undefined,
    done: (outcome: MoveOutcome, message?: string) => void) {
    const state = store.state;
    const from = state.document.controls[control]?.at;
    const question = from && sharedMoveQuestion(state.document, { view: state.view, control, from, at, courseControl, variant, thresholdM: threshold });
    if (question) { ask(question, { kind: "field", done }); return; }
    edit(current => applySteps(current, [{ type: "MOVE_CONTROL", control, at }], applyEdit));
    done("ALL");
  }

  const settings = (mapScale: number): ReactNode => {
    const choices = [...new Set([...MOVE_THRESHOLD_CHOICES, threshold])].sort((a, b) => a - b);
    const mm = (threshold * 1000 / mapScale).toLocaleString("sv-SE", { maximumFractionDigits: 1 });
    return <section className={main.panel} aria-labelledby="move-shared-settings" data-testid="course-setting-move-settings">
      <h2 id="move-shared-settings">{text.settings.heading}</h2>
      <label className={main.stack}>{text.settings.threshold}
        <select value={threshold} data-testid="course-setting-move-threshold" onChange={event => {
          const value = Number(event.target.value);
          setThreshold(value); writeMoveThreshold(localStore(), value);
        }}>{choices.map(value => <option key={value} value={value}>{text.settings.meters(value)}</option>)}</select></label>
      <p className={main.muted}>{text.settings.help(mm, mapScale)}</p>
      <div className={main.row}>
        <p className={main.muted} data-testid="course-setting-move-remembered">{remembered ? text.settings.remembered(remembered) : text.settings.notRemembered}</p>
        {remembered && <Button variant="secondary" data-testid="course-setting-move-forget"
          onClick={() => { writeRememberedChoice(sessionStore(), raceId, undefined); setRemembered(undefined); }}>{text.settings.reset}</Button>}
      </div>
    </section>;
  };

  const dialog = pending ? <MoveQuestion key={`${pending.question.control}-${pending.question.at.x}-${pending.question.at.y}`}
    question={pending.question} onChoose={choose} /> : null;
  return { dragEnded, moveTo, dialog, settings, open: pending !== undefined };
}

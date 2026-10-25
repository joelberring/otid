"use client";

import { useMemo, useState } from "react";
import type { CourseEditListResponse, CourseForkingItem } from "@o-tid/contracts";
import { courseForkingFairness, forkingLetters, generateForkingVariants, validateCourseForking } from "@o-tid/domain";
import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { forkingSv as forking } from "../../i18n/forking-sv";
import type { DiagramTarget } from "../../lib/forking-diagram";
import { Button, Field, Notice } from "../ui";
import { ForkingDiagram } from "../forking/forking-diagram";
import type { Workspace } from "./workspace-state";

type CourseRow = CourseEditListResponse["courses"][number];

const codesOf = (value: string) => value.trim().split(/[\s,]+/).filter(Boolean);
const parseCodes = (value: string) => codesOf(value).map(Number).filter(code => Number.isInteger(code) && code > 0 && code <= 2_147_483_647);
const nameOf = (item: CourseForkingItem | undefined, fallback: string) =>
  item?.kind === "CONTROL" ? String(item.code) : item?.kind === "LOOP" ? String(item.center) : fallback;

/**
 * Steg 49: gafflingarna på en bana som bild och fält. I bilden väljer man en kontroll (lägg till fjäril, ta bort) eller en
 * sträcka (lägg till gaffling eller kontroll); varje alternativ och slinga har ett fält med kontrollkoder. Varianterna
 * räknas fram direkt och sparas genom "Redigera bana" (besked först när resultat ändras).
 */
export function ForkingEditor({ ws, course }: { ws: Workspace; course: CourseRow }) {
  const { busy, cancelCourseEdit, changeCourseEditForking, courseEditAttempt, courseEditError, courseEditForking, courseEditPreview,
    previewCourseEdit, saveCourseEdit } = ws;
  const items = useMemo(() => courseEditForking ?? [], [courseEditForking]);
  const [selected, setSelected] = useState<DiagramTarget>();
  const [newCode, setNewCode] = useState("");
  const [codeError, setCodeError] = useState("");
  // Fältens text per alternativ ("item.branch"), så att en halvskriven kod står kvar medan man skriver.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const letters = useMemo(() => forkingLetters({ items }), [items]);
  const problems = useMemo(() => validateCourseForking({ items }), [items]);
  const generated = useMemo(() => problems.length === 0 ? generateForkingVariants({ items }) : [], [items, problems]);
  const fairness = useMemo(() => generated.length > 1 ? courseForkingFairness({ mode: course.forkingMode ?? "BALANCED",
    variants: generated, forking: { items } }) : undefined, [generated, items, course.forkingMode]);
  const locked = busy || !!courseEditAttempt;
  const change = (next: CourseForkingItem[]) => {
    setDrafts({});
    setSelected(undefined); setCodeError("");
    changeCourseEditForking(next);
  };
  const replace = (index: number, item: CourseForkingItem | null, insert = false) => {
    const next = [...items];
    if (insert && item) next.splice(index, 0, item); else if (item) next[index] = item; else next.splice(index, 1);
    change(next);
  };
  const branchesOf = (item: CourseForkingItem) => item.kind === "FORK" ? item.branches : item.kind === "LOOP" ? item.loops : [];
  const withBranches = (item: CourseForkingItem, branches: number[][]): CourseForkingItem =>
    item.kind === "FORK" ? { ...item, branches } : item.kind === "LOOP" ? { ...item, loops: branches } : item;
  const setBranch = (index: number, branch: number, value: string) => {
    const item = items[index]!;
    setDrafts({ ...drafts, [`${index}.${branch}`]: value });
    const next = [...items];
    next[index] = withBranches(item, branchesOf(item).map((codes, position) => position === branch ? parseCodes(value) : [...codes]));
    setSelected(undefined);
    changeCourseEditForking(next);
  };
  const addControl = (before: number) => {
    const code = Number(newCode.trim());
    if (!/^\d+$/.test(newCode.trim()) || !Number.isInteger(code) || code <= 0) { setCodeError(forking.invalidCode); return; }
    setNewCode("");
    replace(before, { kind: "CONTROL", code }, true);
  };
  const forkCount = (index: number) => items.slice(0, index + 1).filter(item => item.kind !== "CONTROL").length;
  const selectedItem = selected && selected.kind !== "LEG" ? items[selected.item] : undefined;
  const preview = courseEditPreview;
  return <form className={styles.editor} aria-label={forking.editorTitle(course.name)} noValidate
    onSubmit={event => { event.preventDefault(); void saveCourseEdit(); }}>
    <h3>{forking.editorTitle(course.name)}</h3>
    <p className={styles.workflowHelp}>{forking.editorHelp}</p>
    <ForkingDiagram items={items} letters={letters} label={forking.courseDiagram(course.name)} selected={selected}
      onSelect={target => { setSelected(target); setCodeError(""); }} />
    <section className={styles.forkingSelection} aria-label={forking.title} aria-live="polite">
      {!selected && <p className={styles.workflowHelp}>{forking.selectionHelp}</p>}
      {selected?.kind === "LEG" && <>
        <strong>{forking.legButton(nameOf(items[selected.before - 1], forking.start), nameOf(items[selected.before], forking.finish))}</strong>
        <div className={styles.actions}>
          <Button variant="secondary" disabled={locked} onClick={() => replace(selected.before, { kind: "FORK", branches: [[], []] }, true)}>
            {forking.addFork(nameOf(items[selected.before - 1], forking.start), nameOf(items[selected.before], forking.finish))}</Button>
        </div>
        <div className={styles.fieldRow}>
          <Field label={forking.addControlCode} error={codeError} className={styles.narrowField}>
            <input inputMode="numeric" autoComplete="off" value={newCode} maxLength={10} disabled={locked}
              onChange={event => { setNewCode(event.target.value); setCodeError(""); }} /></Field>
          <Button variant="secondary" disabled={locked} onClick={() => addControl(selected.before)}>{forking.addControl}</Button>
        </div>
      </>}
      {selected?.kind === "CONTROL" && selectedItem?.kind === "CONTROL" && <>
        <strong>{forking.controlButton(selectedItem.code, false)}</strong>
        <div className={styles.actions}>
          <Button variant="secondary" disabled={locked}
            onClick={() => replace(selected.item, { kind: "LOOP", center: selectedItem.code, loops: [[], []] })}>{forking.addLoop(selectedItem.code)}</Button>
          <Button variant="quiet" disabled={locked || items.length <= 1} onClick={() => replace(selected.item, null)}>
            {forking.removeControl(selectedItem.code)}</Button>
        </div>
      </>}
      {selected?.kind === "CONTROL" && selectedItem?.kind === "LOOP" && <>
        <strong>{forking.controlButton(selectedItem.center, true)}</strong>
        <div className={styles.actions}><Button variant="quiet" disabled={locked}
          onClick={() => replace(selected.item, { kind: "CONTROL", code: selectedItem.center })}>{forking.removeLoop}</Button></div>
      </>}
      {selected?.kind === "BRANCH" && <p>{forking.branchButton(letters[selected.item]?.[selected.branch] ?? "", selectedItem?.kind === "LOOP")}:
        {" "}{forking.branchHelp}</p>}
    </section>
    {items.map((item, index) => {
      if (item.kind === "CONTROL") return null;
      const own = letters[index] ?? [];
      const branches = branchesOf(item);
      const loop = item.kind === "LOOP";
      const legend = loop ? forking.loopLegend(item.center, own.join(", ")) : forking.forkLegend(forkCount(index), own.join(", "));
      return <fieldset key={`${index}-${item.kind}`} className={styles.forkingItem}>
        <legend>{legend}</legend>
        <div className={styles.forkingBranches}>{branches.map((codes, branch) => {
          const letter = own[branch] ?? String(branch + 1);
          const focus = selected?.kind === "BRANCH" && selected.item === index && selected.branch === branch;
          return <div key={branch} className={styles.forkingBranch} data-selected={focus || undefined}>
            <Field label={loop ? forking.loopField(letter) : forking.branchField(letter)}>
              <input inputMode="numeric" autoComplete="off" disabled={locked} maxLength={4000} autoFocus={focus}
                value={drafts[`${index}.${branch}`] ?? codes.join(" ")} onChange={event => setBranch(index, branch, event.target.value)} /></Field>
            {branches.length > 2 && <Button variant="quiet" disabled={locked} aria-label={`${forking.removeBranch(letter)} (${legend})`}
              onClick={() => replace(index, withBranches(item, branches.filter((_codes, position) => position !== branch).map(list => [...list])))}>
              {forking.removeBranch(letter)}</Button>}
          </div>;
        })}</div>
        <div className={styles.actions}>
          {branches.length < 4 && <Button variant="secondary" disabled={locked}
            onClick={() => replace(index, withBranches(item, [...branches.map(list => [...list]), []]))}>{loop ? forking.addLoopBranch : forking.addBranch}</Button>}
          <Button variant="quiet" disabled={locked} onClick={() => replace(index, loop ? { kind: "CONTROL", code: item.center } : null)}>
            {loop ? forking.removeLoop : forking.removeFork}</Button>
        </div>
      </fieldset>;
    })}
    <section className={styles.forkingVariants} aria-label={forking.generatedTitle}>
      <h4>{forking.generatedTitle}</h4>
      {problems.length > 0 ? <p className={styles.muted}>{forking.problem(problems[0]!)}</p>
        : generated.length === 0 ? <p className={styles.muted}>{forking.noForks}</p> : <>
          <p>{forking.generated(generated.length)}</p>
          <ul className={styles.changeList}>{generated.map(variant => <li key={variant.code}>
            <strong>{variant.code}</strong> {variant.controlCodes.join(" ")}</li>)}</ul>
        </>}
      {fairness?.level === "WARNING" && <Notice tone="attention" role="status">{forking.warning(fairness.warningLegs)}</Notice>}
      {fairness?.level === "NOTICE" && <p className={styles.workflowHelp}>{forking.notice}</p>}
    </section>
    {preview && <section className={styles.review} role="status" aria-live="polite">
      {preview.forking && <p>{forking.previewForking(preview.forking.variants.length, preview.forking.removedCodes.length,
        preview.forking.renamedEntryCount, preview.forking.reassignedEntryCount)}</p>}
      {preview.readOutCount === 0 ? <p>{text.courseEditNobodyReadOut}</p> : <p><strong>{text.courseEditSummary(
        preview.readOutCount, preview.becomesOkCount, preview.becomesMispunchedCount, preview.unchangedCount,
        preview.changes.filter(row => row.after === "OVERTIME").length)}</strong></p>}
      {preview.manualDecisionCount > 0 && <Notice tone="attention">{text.courseEditManualDecisions(preview.manualDecisionCount)}</Notice>}
      {preview.changes.length > 0 ? <>
        <h3>{text.courseEditChangesTitle}</h3>
        <ul className={styles.changeList}>{preview.changes.map(row => <li key={row.entryId}>
          <strong>{row.displayName}</strong> · {row.className} · {text.courseEditStatus[row.before]} → {text.courseEditStatus[row.after]}</li>)}</ul>
        <p>{text.courseEditConfirmHelp}</p>
      </> : preview.readOutCount > 0 && <p>{text.courseEditNoStatusChange}</p>}
    </section>}
    {courseEditError && <Notice tone="error" role="alert">{courseEditError}</Notice>}
    <div className={styles.actions}>
      <Button variant="secondary" disabled={locked} onClick={() => void previewCourseEdit()}>{text.courseEditPreview}</Button>
      <Button type="submit" disabled={busy}>{text.courseEditSave}</Button>
      {!courseEditAttempt && <Button variant="quiet" disabled={busy} onClick={cancelCourseEdit}>{text.courseEditCancel}</Button>}
    </div>
  </form>;
}

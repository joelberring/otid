"use client";

import { useMemo, useState } from "react";
import type { CourseSettingForkLetters } from "@o-tid/contracts";
import {
  isForkLetterLocked, needsRenumber, renumberPreview, variantLetters, type Course, type CourseSettingDocument, type CourseSettingEdit
} from "@o-tid/course-setting";
import { forkLettersEn } from "../../i18n/course-setting-fork-letters-en";
import { forkLettersSv } from "../../i18n/course-setting-fork-letters-sv";
import { fetchCourseSettingForkLetters } from "../../lib/course-setting-api";
import { safely } from "../../lib/course-setting-safely";
import { useLocale, useTexts } from "../language-provider";
import { Button } from "../ui";
import base from "./course-setting.module.css";
import styles from "./course-setting-variants.module.css";

type Step = { kind: "renumber" } | { kind: "unlock" };
type Facts = { state: "loading" } | { state: "failed" } | { state: "ready"; course: CourseSettingForkLetters["courses"][number] | undefined };

/**
 * ADR-0175, tillägg 2026-11-21 (b): banans läge för nycklarna (utkast eller låst och varför), Lås/Häv låset och «Ordna
 * nycklarna» med förhandsvisning gammal → ny kod. I en låst bana (och när låset hävs) visas först det som berörs: tryckta
 * kartor, publicerad startlista, löpare med tilldelad variant och bortval som får ny kod. Ändringarna är vanliga ändringssteg
 * (`RENUMBER_FORK_LETTERS`, `SET_FORK_LETTER_LOCK`), så ångra, autospar, samarbete och versioner gäller.
 */
export function ForkLettersPanel({ raceId, document, course, readOnly, onEdits }: {
  raceId: string | undefined; document: CourseSettingDocument; course: Course; readOnly: boolean; onEdits: (edits: CourseSettingEdit[]) => void;
}) {
  const text = useTexts(forkLettersSv, forkLettersEn);
  const locale = useLocale();
  const [step, setStep] = useState<Step>();
  const [facts, setFacts] = useState<Facts>();
  const letters = useMemo(() => safely("Nycklarna", () => [...variantLetters(document, course.id).values()], () => []), [document, course.id]);
  const preview = useMemo(() => step?.kind === "renumber" ? safely("Nycklarna", () => renumberPreview(document, course.id), () => []) : [],
    [step, document, course.id]);
  const needed = useMemo(() => safely("Nycklarna", () => needsRenumber(document, course.id), () => false), [document, course.id]);
  if (letters.length === 0) return null;
  const locked = isForkLetterLocked(course);
  const lock = course.forkLetterLock;
  const id = `course-fork-letters-${course.id}`;
  const at = lock ? new Date(lock.at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "";
  const load = () => {
    if (!raceId) { setFacts({ state: "ready", course: undefined }); return; }
    setFacts({ state: "loading" });
    fetchCourseSettingForkLetters(raceId).then(response => setFacts({ state: "ready", course: response.courses.find(row => row.course === course.id) }),
      () => setFacts({ state: "failed" }));
  };
  const open = (next: Step) => {
    setStep(next);
    if (locked) load(); else setFacts(undefined);
  };
  const close = () => { setStep(undefined); setFacts(undefined); };
  const now = () => new Date().toISOString();
  const changed = preview.filter(row => row.from !== row.to);
  const excludedMoved = changed.filter(row => row.excluded).map(row => `${row.from} → ${row.to}`);

  return <section className={styles.prune} aria-labelledby={id} data-testid="course-setting-fork-letters">
    <h3 id={id}>{text.heading}</h3>
    <p className={styles.summary} role="status" data-testid="course-setting-fork-letters-state" data-locked={locked || undefined}>
      {lock ? text.locked(text.reasons[lock.reason], at) : needed ? text.draftKept(letters.join(", ")) : text.draft}</p>
    {!readOnly && !step && <div className={base.row}>
      <Button variant="secondary" onClick={() => open({ kind: "renumber" })} data-testid="course-setting-fork-letters-renumber">{text.renumber}</Button>
      {locked ? <Button variant="quiet" onClick={() => open({ kind: "unlock" })} data-testid="course-setting-fork-letters-unlock">{text.unlock}</Button>
        : <Button variant="quiet" onClick={() => onEdits([{ type: "SET_FORK_LETTER_LOCK", course: course.id, locked: true, reason: "MANUAL", at: now() }])}
          data-testid="course-setting-fork-letters-lock">{text.lock}</Button>}
    </div>}
    {step && <div className={styles.preview} role="region" aria-label={step.kind === "renumber" ? text.preview : text.unlock}
      data-testid="course-setting-fork-letters-preview">
      {step.kind === "renumber" && (changed.length === 0 ? <p>{text.renumberNothing}</p> : <>
        <p><strong>{text.preview}</strong></p>
        <div className={styles.scroll}><table className={styles.table}>
          <caption className={base.muted}>{text.previewCaption(course.name)}</caption>
          <thead><tr><th scope="col">{text.from}</th><th scope="col">{text.to}</th></tr></thead>
          <tbody>{preview.map(row => <tr key={row.from} data-excluded={row.excluded || undefined} data-testid="course-setting-fork-letters-row">
            <td><strong>{row.from}</strong></td>
            <td>{row.to === row.from ? text.same : row.to}{row.excluded && <span className={styles.mark}>{text.excluded}</span>}</td>
          </tr>)}</tbody>
        </table></div>
      </>)}
      {locked && <>
        <p><strong>{step.kind === "renumber" ? text.confirmRenumber : text.confirmUnlock}</strong></p>
        <Affected text={text} facts={facts} excludedMoved={step.kind === "renumber" ? excludedMoved : []} />
      </>}
      <div className={base.row}>
        {step.kind === "renumber" && changed.length > 0 && <Button disabled={locked && facts?.state === "loading"} data-testid="course-setting-fork-letters-apply"
          onClick={() => { onEdits([{ type: "RENUMBER_FORK_LETTERS", course: course.id }]); close(); }}>{locked ? text.confirm : text.apply}</Button>}
        {step.kind === "unlock" && <Button disabled={facts?.state === "loading"} data-testid="course-setting-fork-letters-unlock-confirm"
          onClick={() => { onEdits([{ type: "SET_FORK_LETTER_LOCK", course: course.id, locked: false, at: now() }]); close(); }}>{text.confirm}</Button>}
        <Button variant="quiet" onClick={close}>{text.cancel}</Button>
      </div>
    </div>}
  </section>;
}

function Affected({ text, facts, excludedMoved }: { text: typeof forkLettersSv; facts: Facts | undefined; excludedMoved: readonly string[] }) {
  if (!facts || facts.state === "loading") return <p className={base.muted} role="status">{text.loading}</p>;
  if (facts.state === "failed") return <p role="alert">{text.loadFailed}</p>;
  const row = facts.course;
  const lines: string[] = [];
  if (row?.printedMaps) lines.push(text.printed(row.printedMaps));
  if (row?.startListPublished) lines.push(text.startList);
  if (excludedMoved.length > 0) lines.push(text.excludedAffected(excludedMoved.join(", ")));
  const runners = row?.runners ?? [];
  return <div data-testid="course-setting-fork-letters-affected">
    <p><strong>{text.affected}</strong></p>
    {lines.length === 0 && runners.length === 0 && <p>{text.nothingAffected}</p>}
    {lines.map(line => <p key={line}>{line}</p>)}
    {runners.length > 0 && <>
      <p>{text.runners(row!.runnerCount)}</p>
      <ul>{runners.map((runner, index) => <li key={`${runner.name}-${index}`}>{runner.name}, {runner.className}: {runner.code}</li>)}</ul>
      {row!.runnerCount > runners.length && <p>{text.more(row!.runnerCount - runners.length)}</p>}
    </>}
    <p className={base.muted}>{text.printedUnknown}</p>
  </div>;
}

"use client";

import { useMemo, useState } from "react";
import { runnerPrintEn } from "../../i18n/course-setting-print-more-en";
import { coursePrintEn } from "../../i18n/course-setting-print-en";
import { useTexts } from "../language-provider";
import type { Texts } from "../../lib/language";
import Link from "next/link";
import type { SheetItem } from "@o-tid/course-setting";
import { coursePrintSv } from "../../i18n/course-setting-print-sv";
import { runnerPrintSv } from "../../i18n/course-setting-runner-print-sv";
import type { RunnerPrint, RunnerPrintProblem } from "../../lib/course-setting-runner-print";
import { searchRunners, type RunnerSelection } from "../../lib/course-setting-runner-select";
import { Button, Notice } from "../ui";
import styles from "./course-setting-print-page.module.css";

export type BackMode = "NONE" | "DUPLEX" | "SEPARATE";

function problemText(problem: RunnerPrintProblem, text: Texts<typeof coursePrintSv>): string {
  switch (problem.kind) {
    case "MISSING_VARIANT": return text.page.problem.MISSING_VARIANT(problem.name, problem.className);
    case "UNKNOWN_COURSE": return text.page.problem.UNKNOWN_COURSE(problem.courseName);
    case "UNKNOWN_VARIANT": return text.page.problem.UNKNOWN_VARIANT(problem.courseName, problem.variantCode);
    case "EXCLUDED_VARIANT": return text.page.problem.EXCLUDED_VARIANT(problem.courseName, problem.variantCode, problem.count);
    case "COUNT": return text.page.problem.COUNT([problem.courseName, problem.variantCode, problem.layout && `(${problem.layout})`].filter(Boolean).join(" "),
      problem.expected, problem.actual);
  }
}

/**
 * Steg 64 och ADR-0213: en karta per löpare. Ordningen, baksidan (ingen, dubbelsidigt i samma PDF eller separat körning i
 * Kartor till starten), vilka som skrivs ut (alla, klasser, löpare, lag med sträcka) och kontrollen mot Kartor till starten.
 */
export function RunnerControls({ bundlesState, runners, raceId, order, setOrder, backMode, setBackMode, selection, setSelection, chosen }: {
  bundlesState: "none" | "reading" | "ready" | "failed"; runners: RunnerPrint | undefined; raceId: string;
  order: "BUNDLE" | "START"; setOrder: (order: "BUNDLE" | "START") => void;
  backMode: BackMode; setBackMode: (mode: BackMode) => void;
  selection: RunnerSelection; setSelection: (selection: RunnerSelection) => void;
  /** Antalet kartor i urvalet. */
  chosen: number;
}) {
  const runnerText = useTexts(runnerPrintSv, runnerPrintEn);
  const text = useTexts(coursePrintSv, coursePrintEn);
  if (bundlesState === "reading" || bundlesState === "none") return <p role="status">{text.page.runnersLoading}</p>;
  if (bundlesState === "failed" || !runners) return <Notice tone="error">{text.page.runnersFailed}</Notice>;
  return <div className={styles.stack} data-testid="print-runners">
    <div className={styles.row}>
      <label className={styles.field}>{text.page.order}<select value={order} onChange={event => setOrder(event.target.value as "BUNDLE" | "START")}>
        <option value="BUNDLE">{text.page.orderBundle}</option><option value="START">{text.page.orderStart}</option></select></label>
      <label className={styles.field}>{runnerText.back}<select value={backMode} data-testid="print-back-mode" onChange={event => setBackMode(event.target.value as BackMode)}>
        {(["NONE", "DUPLEX", "SEPARATE"] as const).map(mode => <option key={mode} value={mode}>{runnerText.backModes[mode]}</option>)}</select></label>
    </div>
    {backMode === "DUPLEX" && <p className={styles.muted}>{runnerText.backDuplexHelp}</p>}
    {backMode === "SEPARATE" && <p className={styles.muted}>{runnerText.backSeparate}{" "}
      <Link href={`/admin/${raceId}/maps`} data-testid="print-back-separate">{runnerText.backSeparateLink}</Link></p>}
    <RunnerChooser items={runners.items} selection={selection} setSelection={setSelection} />
    <p className={styles.muted} data-testid="print-runner-selected">{runnerText.selected(chosen, runners.items.length)}{" · "}
      <a href="#runner-check">{runnerText.checkLink}</a></p>
    {runners.items.length === 0 && <p className={styles.muted}>{text.page.runnersNone}</p>}
    {runners.counts.length > 0 && <p className={styles.muted}>{text.page.runnerCounts}: {runners.counts.map(row =>
      `${row.courseName} ${row.variantCode ?? text.page.noVariant}${row.layout ? ` (${row.layout})` : ""} ${row.count}`).join(" · ")}</p>}
    {runners.problems.length === 0 ? <Notice tone="ok"><p data-testid="print-runner-check">{text.page.runnerOk}</p></Notice>
      : <Notice tone="error"><p data-testid="print-runner-check">{text.page.runnerProblems}</p>
        <ul className={styles.problems}>{runners.problems.map((problem, index) => <li key={index}>{problemText(problem, text)}</li>)}</ul>
        <p><Link href={`/admin/${raceId}/maps`}>{text.page.bundlesLink}</Link></p></Notice>}
  </div>;
}

/** Vilka som skrivs ut: alla, valda klasser, valda löpare (sök på namn eller nummer) eller valda lag med sträcka. */
function RunnerChooser({ items, selection, setSelection }: { items: readonly SheetItem[]; selection: RunnerSelection; setSelection: (selection: RunnerSelection) => void }) {
  const runnerText = useTexts(runnerPrintSv, runnerPrintEn);
  const classes = useMemo(() => [...new Set(items.flatMap(item => item.runner?.className ? [item.runner.className] : []))].sort((a, b) => a.localeCompare(b, "sv-SE")), [items]);
  const legs = useMemo(() => [...new Set(items.flatMap(item => item.runner?.leg !== undefined ? [item.runner.leg] : []))].sort((a, b) => a - b), [items]);
  const relay = legs.length > 0;
  const [query, setQuery] = useState("");
  const [teamsText, setTeamsText] = useState(selection.kind === "TEAMS" ? selection.teams.join(", ") : "");
  const kind = selection.kind;
  const choose = (next: RunnerSelection["kind"]) => setSelection(next === "ALL" ? { kind: "ALL" } : next === "CLASSES" ? { kind: "CLASSES", classes: [] }
    : next === "RUNNERS" ? { kind: "RUNNERS", entries: [] } : { kind: "TEAMS", teams: [], leg: "ALL" });
  const byEntry = new Map(items.flatMap(item => item.runner?.entryId ? [[item.runner.entryId, item] as const] : []));
  const found = kind === "RUNNERS" ? searchRunners(items, query).filter(item => !selection.entries.includes(item.runner!.entryId!)) : [];
  const label = (item: SheetItem) => [item.runner?.startNumber, item.runner?.name, item.runner?.team ? `lag ${item.runner.team.number}` : "", item.runner?.className]
    .filter(Boolean).join(" · ");
  return <fieldset className={styles.stack} data-testid="print-runner-chooser">
    <legend><strong>{runnerText.who}</strong></legend>
    <div className={styles.row} role="radiogroup" aria-label={runnerText.who}>
      {(["ALL", "CLASSES", "RUNNERS", ...(relay ? ["TEAMS" as const] : [])] as const).map(option => <label key={option} className={styles.check}>
        <input type="radio" name="print-runner-who" checked={kind === option} onChange={() => choose(option)} data-testid={`print-who-${option}`} />
        {runnerText.whoKinds[option]}</label>)}
    </div>
    {selection.kind === "CLASSES" && <div className={styles.row} role="group" aria-label={runnerText.classes}>
      {classes.map(name => <label key={name} className={styles.check}><input type="checkbox" checked={selection.classes.includes(name)}
        onChange={event => setSelection({ kind: "CLASSES", classes: event.target.checked ? [...selection.classes, name] : selection.classes.filter(row => row !== name) })} />
        {name}</label>)}
    </div>}
    {selection.kind === "RUNNERS" && <div className={styles.stack}>
      <label className={styles.field}>{runnerText.search}<input type="search" className={styles.medium} value={query} placeholder={runnerText.searchHint}
        onChange={event => setQuery(event.target.value)} data-testid="print-runner-search" /></label>
      {found.length > 0 && <ul className={styles.paperRows} data-testid="print-runner-found">{found.map(item => <li key={item.runner!.entryId}>
        <Button variant="secondary" aria-label={runnerText.add(item.runner?.name ?? "")} data-testid="print-runner-add"
          onClick={() => { setSelection({ kind: "RUNNERS", entries: [...selection.entries, item.runner!.entryId!] }); setQuery(""); }}>+ {label(item)}</Button></li>)}</ul>}
      <span className={styles.muted}>{runnerText.chosenRunners(selection.entries.length)}</span>
      {selection.entries.length > 0 && <ul className={styles.paperRows} data-testid="print-runner-chosen">{selection.entries.map(id => {
        const item = byEntry.get(id);
        return <li key={id}><span>{item ? label(item) : id}</span><Button variant="quiet" aria-label={runnerText.remove(item?.runner?.name ?? id)}
          onClick={() => setSelection({ kind: "RUNNERS", entries: selection.entries.filter(row => row !== id) })}>×</Button></li>;
      })}</ul>}
    </div>}
    {selection.kind === "TEAMS" && <div className={styles.row}>
      <label className={styles.field}>{runnerText.teams}<input className={styles.medium} value={teamsText} placeholder={runnerText.teamsHint} inputMode="numeric"
        data-testid="print-runner-teams" onChange={event => {
          setTeamsText(event.target.value);
          setSelection({ ...selection, teams: event.target.value.split(/[\s,;]+/).map(Number).filter(value => Number.isInteger(value) && value > 0) });
        }} /></label>
      <label className={styles.field}>{runnerText.leg}<select value={String(selection.leg)} data-testid="print-runner-leg"
        onChange={event => setSelection({ ...selection, leg: event.target.value === "ALL" ? "ALL" : Number(event.target.value) })}>
        <option value="ALL">{runnerText.allLegs}</option>{legs.map(leg => <option key={leg} value={leg}>{runnerText.legName(leg)}</option>)}</select></label>
    </div>}
  </fieldset>;
}

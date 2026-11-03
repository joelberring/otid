"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { CourseSettingDocument } from "@o-tid/course-setting";
import { coursePropertiesSv as copy } from "../../i18n/course-setting-properties-sv";
import { safely } from "../../lib/course-setting-safely";
import { routeLengthLegs, routeLengthSummary, type LegLength } from "../../lib/course-setting-route-length";
import type { RouteChoiceSession } from "../../lib/route-choice-client";
import { Button } from "../ui";
import styles from "./course-setting.module.css";

const text = copy.routeLength;

/**
 * ADR-0190 beslut 6: banans längd längs föreslagna vägval. Räknas när banläggaren ber om det (vägvalens Worker startas
 * då, som när en sträcka väljs); sträckorna sparas per indata, så att bara flyttade sträckor räknas om. Väljs en sträcka
 * medan banan räknas avbryts räkningen (Workern räknar en sak i taget); "Räkna klart" tar resten.
 */
/**
 * ADR-0199: vägvalens svar per indata (`legInput`-nyckeln), gemensamt för banans längd, vald sträcka och varningarna om
 * förbjudna områden, så att en sträcka som redan räknats inte räknas igen.
 */
export function useRouteResults() {
  const [results, setResults] = useState<ReadonlyMap<string, LegLength>>(new Map());
  const record = useCallback((key: string, best: number | undefined, straight: number) => setResults(current => {
    if (current.has(key)) return current;
    const next = new Map(current.size > 2000 ? [] : current);
    return next.set(key, { best, straight });
  }), []);
  return { results, record };
}

export type RouteResults = ReturnType<typeof useRouteResults>;

export function useRouteLength({ document, view, variant, session, ready, failed, wanted, onWanted, store }: {
  document: CourseSettingDocument; view: string; variant: string | undefined; store: RouteResults;
  session: RefObject<RouteChoiceSession | undefined>; ready: boolean; failed: boolean;
  /** Vägvalens Worker behövs (startas av `useRouteChoiceWorker`). */
  wanted: boolean; onWanted: () => void;
}) {
  const legs = useMemo(() => safely("Vägvalens sträckor", () => routeLengthLegs(document, view, variant), () => undefined),
    [document, view, variant]);
  const { results, record } = store;
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const run = () => {
    if (!legs || !session.current) return;
    const missing = legs.legs.filter(leg => !results.has(leg.key));
    if (missing.length === 0) return;
    setRunning(true); setError(false);
    session.current.analyse(missing, (_index, analysis) => record(analysis.key, analysis.best?.meters, analysis.straightMeters),
      () => setRunning(false), () => { setRunning(false); setError(true); });
  };
  // Workern blev klar efter att banläggaren bad om längden.
  useEffect(() => { if (ready && pending.current) { pending.current = false; run(); } }, [ready]);
  useEffect(() => { if (failed && wanted) { pending.current = false; setRunning(false); setError(true); } }, [failed, wanted]);
  return {
    legs, results, running, error, wanted,
    start: () => { onWanted(); if (ready) run(); else { pending.current = true; setRunning(true); } },
    /** Vägvalens Worker fick en annan körning (vald sträcka): den här är avbruten. */
    interrupted: () => { pending.current = false; setRunning(false); },
    /** En vald sträcka som räknats (samma indata) räknas inte igen. */
    remember: record
  };
}

export type RouteLength = ReturnType<typeof useRouteLength>;

export function RouteLengthPanel({ state, hasMap }: { state: RouteLength; hasMap: boolean }) {
  const legs = state.legs;
  if (!legs) return null;
  const summary = routeLengthSummary(legs.legs, state.results);
  return <section className={styles.panel} aria-labelledby="course-setting-route-length" data-testid="course-setting-route-length">
    <h2 id="course-setting-route-length">{text.heading}</h2>
    <p className={styles.muted}>{text.help}{legs.variant ? ` ${text.variant(legs.variant)}` : ""}</p>
    {!hasMap ? <p className={styles.muted}>{text.noMap}</p> : legs.legs.length === 0 ? <p className={styles.muted}>{text.noLegs}</p> : <>
      {summary.kind === "done" && <p role="status" data-testid="course-setting-route-length-result"><strong>
        {text.done(summary.best, summary.straight, summary.percent)}</strong></p>}
      {summary.kind === "no-route" && <p role="status">{text.noRoute(summary.legs)}</p>}
      {summary.kind === "partial" && (state.running ? <p role="status" className={styles.muted}>{text.running(summary.done, summary.total)}</p>
        : <div className={styles.row}>
          {summary.done > 0 && <span className={styles.muted}>{text.partial(summary.done, summary.total)}</span>}
          <Button variant="secondary" onClick={state.start}>{summary.done > 0 ? text.again : text.count}</Button>
        </div>)}
      {state.error && <p role="alert" className={styles.muted}>{text.failed}</p>}
    </>}
  </section>;
}

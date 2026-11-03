"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import { checkDocument, type CourseSettingDocument, type OverprintOptions } from "@o-tid/course-setting";
import type { LegInput } from "@o-tid/route-choice";
import { courseSettingSv as text } from "../../i18n/course-setting-sv";
import { checkGroups, checkRows, forbiddenRouteLegs, legRouteLookup, type CheckGroup, type CheckRow } from "../../lib/course-setting-checks";
import type { LegLength } from "../../lib/course-setting-route-length";
import { safely } from "../../lib/course-setting-safely";
import type { RouteChoiceSession } from "../../lib/route-choice-client";
import { Button } from "../ui";
import { useNarrow } from "./course-setting-field";
import styles from "./course-setting.module.css";

const copy = text.checks;

/**
 * ADR-0199: kontrollerna i fliken Varningar, och sträckorna vars fågelväg korsar ett förbjudet område med deras vägval. Vägvalen räknas i vägvalens Worker
 * (samma svar som banans längd och vald sträcka) när fliken Varningar är öppen, och på datorn utan att den är det. I
 * telefonen startas Workern bara med fliken, eftersom den är det tyngsta i editorn.
 */
export function useForbiddenRoutes({ document, results, hasMap, tabOpen, numberObstacles }: {
  document: CourseSettingDocument; results: ReadonlyMap<string, LegLength>; hasMap: boolean; tabOpen: boolean;
  /** Kartans hinder för numren (ADR-0211 beslut 4): de placerade numren kontrolleras mot dem. */
  numberObstacles?: OverprintOptions["numberObstacles"];
}) {
  const narrow = useNarrow();
  const candidates = useMemo(() => safely("Sträckorna genom förbjudna områden", () => forbiddenRouteLegs(document), () => [] as LegInput[]),
    [document]);
  const missing = useMemo(() => candidates.filter(leg => !results.has(leg.key)), [candidates, results]);
  // Kontrollerna räknas om bara när en av de här sträckorna fått ett svar (inte för varje sträcka i banans längd).
  const signature = candidates.map(leg => { const result = results.get(leg.key); return result ? result.best === undefined ? "x" : "o" : "?"; }).join("");
  const legRoute = useMemo(() => legRouteLookup(document, results), [document, signature]);
  // Kontrollerna med vägvalen, som rader i grupper (godtagna räknas inte i fliken).
  const checked = useMemo(() => safely("Kontrollerna", () => checkDocument(document, { legRoute, ...(numberObstacles ? { numberObstacles } : {}) }), () => []),
    [document, legRoute, numberObstacles]);
  const checks = useMemo(() => checkGroups(checkRows(document, checked)), [document, checked]);
  return { candidates, missing, checked, checks, wanted: hasMap && missing.length > 0 && (tabOpen || !narrow) };
}

/**
 * Räknar de saknade sträckorna när Workern är ledig. Vald sträcka och banans längd går före: de avbryter den här
 * körningen (`cancelled`), som tar vid igen när de är klara.
 */
export function useForbiddenRouteRunner({ legs, wanted, session, ready, failed, busy, record }: {
  legs: readonly LegInput[]; wanted: boolean; session: RefObject<RouteChoiceSession | undefined>; ready: boolean; failed: boolean;
  busy: boolean; record: (key: string, best: number | undefined, straight: number) => void;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(false);
  const keys = legs.map(leg => leg.key).join("|");
  useEffect(() => { setError(false); }, [keys]);
  useEffect(() => {
    if (!wanted || !ready || failed || busy || running || error || legs.length === 0) return;
    const timer = setTimeout(() => {
      const worker = session.current;
      if (!worker) return;
      setRunning(true);
      worker.analyse(legs, (_index, analysis) => record(analysis.key, analysis.best?.meters, analysis.straightMeters),
        () => setRunning(false), () => { setRunning(false); setError(true); }, () => setRunning(false));
    }, 500);
    return () => clearTimeout(timer);
  }, [wanted, ready, failed, busy, running, error, keys]);
  return { running: running && wanted, failed: failed || error };
}

function Row({ row, readOnly, onShow, onAccept, onUnaccept }: { row: CheckRow; readOnly: boolean; onShow: (row: CheckRow) => void;
  onAccept: (rows: readonly CheckRow[]) => void; onUnaccept: (rows: readonly CheckRow[]) => void }) {
  return <li className={styles.checkRow} data-testid="course-setting-check" data-key={row.key} data-level={row.level}>
    <button type="button" className={styles.checkText} title={copy.show} onClick={() => onShow(row)}>{row.text}</button>
    {!readOnly && row.acceptable && (row.accepted
      ? <Button variant="quiet" aria-label={copy.unacceptLabel(row.text)} onClick={() => onUnaccept([row])}>{copy.unaccept}</Button>
      : <Button variant="secondary" aria-label={copy.acceptLabel(row.text)} title={copy.acceptHelp} onClick={() => onAccept([row])}>{copy.accept}</Button>)}
  </li>;
}

/** Fliken Varningar: grupperna per sort (fel, varningar, notiser), godta och de godtagna hopfällda. */
export function ChecksPanel({ groups, accepted, readOnly, routes, onShow, onAccept, onUnaccept }: {
  groups: readonly CheckGroup[]; accepted: readonly CheckRow[]; readOnly: boolean;
  routes: { pending: number; running: boolean; failed: boolean };
  onShow: (row: CheckRow) => void; onAccept: (rows: readonly CheckRow[]) => void; onUnaccept: (rows: readonly CheckRow[]) => void;
}) {
  const rowProps = { readOnly, onShow, onAccept, onUnaccept };
  return <section className={styles.panel} aria-labelledby="course-setting-checks" data-testid="course-setting-checks">
    <h2 id="course-setting-checks">{copy.heading}</h2>
    {routes.pending > 0 && routes.running && <p role="status" className={styles.muted}>{copy.routes(routes.pending)}</p>}
    {routes.pending > 0 && routes.failed && <p className={styles.muted}>{copy.routesFailed}</p>}
    {groups.length === 0 ? <p className={styles.muted}>{copy.none}</p> : groups.map(group => {
      const acceptable = group.rows.filter(row => row.acceptable);
      return <section key={group.id} className={styles.checkGroup} data-level={group.level} data-group={group.id} aria-label={group.heading}>
        <h3 className={styles.checkHead}>
          <span className={styles.checkLevel} data-level={group.level}>{copy.levels[group.level]}</span>
          <span>{group.heading} ({group.rows.length})</span>
          {!readOnly && acceptable.length > 1 && <Button variant="quiet" onClick={() => onAccept(acceptable)}>{copy.acceptAll(acceptable.length)}</Button>}
        </h3>
        {acceptable.length === 0 && <p className={styles.muted}>{copy.notAcceptable}</p>}
        <ul className={styles.checks}>{group.rows.slice(0, 100).map(row => <Row key={`${row.level}|${row.key}`} row={row} {...rowProps} />)}</ul>
      </section>;
    })}
    {accepted.length > 0 && <details className={styles.checkAccepted} data-testid="course-setting-checks-accepted">
      <summary>{copy.accepted(accepted.length)}</summary>
      <ul className={styles.checks}>{accepted.slice(0, 200).map(row => <Row key={`${row.level}|${row.key}`} row={row} {...rowProps} />)}</ul>
    </details>}
    {groups.some(group => group.id.endsWith(":LEG_THROUGH_FORBIDDEN")) && <p className={styles.muted}>{copy.routesHelp}</p>}
  </section>;
}

"use client";

import { useMemo, useState } from "react";
import type { Course, CourseSettingDocument, CourseSettingEdit } from "@o-tid/course-setting";
import { unusedAfterExclusion, type ProtectedVariant, type VariantPruning } from "@o-tid/domain";
import { courseVariantsSv as text } from "../../i18n/course-setting-variants-sv";
import { safely } from "../../lib/course-setting-safely";
import { excludedRows, parseLimit, pruningPlan, variantTable, type VariantTable } from "../../lib/course-setting-variants";
import { Button } from "../ui";
import type { RouteLength } from "./course-setting-route-length";
import base from "./course-setting.module.css";
import styles from "./course-setting-variants.module.css";

const MAX_RACE_VARIANTS = 100;
const DEFAULT_LONGEST = 3;
const PRUNE_MODES = ["LONGEST", "DOMINATED", "CAP"] as const;
type PruneMode = (typeof PRUNE_MODES)[number];

/**
 * ADR-0198 (ägaren 2026-11-03): varianterna av en gafflad bana med fågelväg, längd längs vägval (räknas på begäran i
 * vägvalens Worker, samma tabell som banans längd), antal kontroller och skillnad mot den kortaste. Bocka ur en variant för
 * att välja bort den, eller "Begränsa varianter" med förhandsgranskning. Bortvalen sparas på banan (`UPDATE_COURSE`), så
 * att de följer med autosparande, ångra och versioner.
 */
export function VariantsPanel({ document, course, routeLength, hasMap, readOnly, onEdits }: {
  document: CourseSettingDocument; course: Course; routeLength: RouteLength; hasMap: boolean; readOnly: boolean;
  onEdits: (edits: CourseSettingEdit[]) => void;
}) {
  const table = useMemo(() => safely("Varianterna", () => variantTable(document, course.id, routeLength.results), () => undefined),
    [document, course.id, routeLength.results]);
  if (!table) return null;
  return <VariantsBody key={course.id} table={table} course={course} routeLength={routeLength} hasMap={hasMap} readOnly={readOnly} onEdits={onEdits} />;
}

function VariantsBody({ table, course, routeLength, hasMap, readOnly, onEdits }: {
  table: VariantTable; course: Course; routeLength: RouteLength; hasMap: boolean; readOnly: boolean; onEdits: (edits: CourseSettingEdit[]) => void;
}) {
  // Ägaren 2026-11-03: förval "Ta bort de längsta" med 3; "längst i alla avseenden (alla)" och taken är andra sätt.
  const [mode, setMode] = useState<PruneMode>("LONGEST");
  const [longest, setLongest] = useState(String(Math.min(DEFAULT_LONGEST, Math.max(1, table.rows.length - 1))));
  const [percent, setPercent] = useState("");
  const [count, setCount] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [plan, setPlan] = useState<VariantPruning>();
  const excluded = new Set(table.rows.filter(row => row.excluded).map(row => row.code));
  const total = table.rows.length, kept = total - excluded.size;
  const goes = new Set(plan?.excluded.map(row => row.code) ?? []);
  const unused = unusedAfterExclusion(table.prunable, excluded);
  const id = `course-variants-${course.id}`;
  const save = (codes: ReadonlySet<string>) => {
    onEdits([{ type: "UPDATE_COURSE", course: course.id, changes: { excludedVariants: codes.size === 0 ? null : excludedRows(table, codes) } }]);
  };
  const toggle = (code: string, use: boolean) => {
    const next = new Set(excluded);
    if (use) next.delete(code); else next.add(code);
    // Minst en variant används alltid.
    if (next.size >= total) return;
    setPlan(undefined);
    save(next);
  };
  const preview = () => {
    if (mode === "LONGEST") {
      const value = parseLimit(longest, 1);
      if (value === undefined || value === "invalid" || value > total - 1) { setInvalid(true); return; }
      setInvalid(false);
      setPlan(pruningPlan(table, { longest: value }));
      return;
    }
    if (mode === "DOMINATED") { setInvalid(false); setPlan(pruningPlan(table, { dominated: true })); return; }
    const maxPercentLonger = parseLimit(percent, 0), maxCount = parseLimit(count, 1);
    if (maxPercentLonger === "invalid" || maxCount === "invalid" || (maxPercentLonger === undefined && maxCount === undefined)) { setInvalid(true); return; }
    setInvalid(false);
    setPlan(pruningPlan(table, { maxPercentLonger, maxCount }));
  };
  const reason = (row: ProtectedVariant) => row.control !== undefined ? text.prune.needed(text.prune.control(table.label(row.control)))
    : row.leg !== undefined ? text.prune.needed(text.prune.leg(...(row.leg.split(">").map(table.label) as [string, string])))
      : text.prune.last;
  const routeTotal = table.legs.length;
  const routeState = !hasMap ? text.route.noMap : routeLength.error ? text.route.failed : table.routeComplete ? text.route.done
    : routeLength.running ? text.route.running(table.routeDone, routeTotal) : table.routeDone > 0 ? text.route.partial(table.routeDone, routeTotal) : undefined;
  const unusedLabels = [...unused.controls.map(control => text.prune.control(table.label(control))),
    ...(unused.controls.length === 0 ? unused.legs.slice(0, 5).map(leg => text.prune.leg(...(leg.split(">").map(table.label) as [string, string]))) : [])];

  return <section className={base.panel} aria-labelledby={id} data-testid="course-setting-variants">
    <h2 id={id}>{text.heading}</h2>
    <p className={styles.summary} role="status" data-testid="course-setting-variants-summary">{text.summary(total, kept)}</p>
    <p className={base.muted}>{text.help}</p>
    {kept > MAX_RACE_VARIANTS && <p className={styles.warning} role="alert">{text.tooMany(kept)}</p>}
    {course.relay && <p className={styles.warning} role="note">{text.relay}</p>}
    {unusedLabels.length > 0 && <p className={styles.warning} role="note" data-testid="course-setting-variants-unused">{text.unused(unusedLabels)}</p>}
    <div className={styles.scroll}>
      <table className={styles.table} data-testid="course-setting-variants-table">
        <caption className={base.muted}>{text.table.caption(course.name)}</caption>
        <thead><tr>
          <th scope="col">{text.table.used}</th><th scope="col">{text.table.code}</th><th scope="col">{text.table.straight}</th>
          <th scope="col">{text.table.route}</th><th scope="col">{text.table.controls}</th><th scope="col">{text.table.difference}</th>
        </tr></thead>
        <tbody>{table.rows.map(row => {
          const mark = plan ? (goes.has(row.code) ? "goes" : undefined) : undefined;
          return <tr key={row.code} data-excluded={row.excluded || undefined} data-preview={mark} data-testid="course-setting-variant-row">
            <td><input type="checkbox" checked={!row.excluded} disabled={readOnly || (!row.excluded && kept <= 1)} aria-label={text.table.use(row.code)}
              onChange={event => toggle(row.code, event.target.checked)} /></td>
            <td><strong>{row.code}</strong>{mark === "goes" && <span className={styles.mark}>{text.table.goes}</span>}</td>
            <td>{text.km(row.straightMeters)}</td>
            <td>{typeof row.route === "number" ? text.km(row.route) : row.route === "NO_ROUTE" ? text.table.noRoute : text.table.notCounted}</td>
            <td>{row.controlCount}</td>
            <td>{row.differenceMeters === 0 ? text.table.shortest : text.difference(row.differenceMeters, row.differencePercent)}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <div className={base.row}>
      {hasMap && !table.routeComplete && !routeLength.running &&
        <Button variant="secondary" onClick={() => routeLength.startLegs(table.legs)} data-testid="course-setting-variants-route">
          {table.routeDone > 0 ? text.route.again : text.route.count}</Button>}
      {routeState && <span className={base.muted} role="status">{routeState}</span>}
    </div>
    {!readOnly && <div className={styles.prune} data-testid="course-setting-variants-prune">
      <h3>{text.prune.heading}</h3>
      <fieldset className={styles.modes}>
        <legend className={base.muted}>{text.prune.mode}</legend>
        {PRUNE_MODES.map(value => <label key={value} className={base.inline}>
          <input type="radio" name={`${id}-mode`} value={value} checked={mode === value}
            onChange={() => { setMode(value); setPlan(undefined); setInvalid(false); }} />{text.prune.modes[value]}</label>)}
      </fieldset>
      {mode === "LONGEST" && <div className={base.row}>
        <label>{text.prune.longest(total - 1)}<input type="text" inputMode="numeric" value={longest} aria-invalid={invalid || undefined}
          data-testid="course-setting-variants-longest" onChange={event => { setLongest(event.target.value); setPlan(undefined); }} /></label>
      </div>}
      <p className={base.muted}>{mode === "LONGEST" ? text.prune.longestHelp(table.routeComplete) : mode === "DOMINATED"
        ? text.prune.dominatedHelp(table.routeComplete) : text.prune.capHelp}</p>
      {mode === "CAP" && <div className={base.row}>
        <label>{text.prune.percent}<input type="text" inputMode="numeric" value={percent} aria-invalid={invalid || undefined}
          onChange={event => { setPercent(event.target.value); setPlan(undefined); }} /></label>
        <label>{text.prune.count}<input type="text" inputMode="numeric" value={count} aria-invalid={invalid || undefined}
          onChange={event => { setCount(event.target.value); setPlan(undefined); }} /></label>
      </div>}
      {invalid && <p role="alert" className={base.muted}>{mode === "LONGEST" ? text.prune.longestInvalid(total - 1) : text.prune.invalid}</p>}
      <div className={base.row}>
        <Button variant="secondary" onClick={preview}>{text.prune.preview}</Button>
        {excluded.size > 0 && <Button variant="quiet" onClick={() => { setPlan(undefined); save(new Set()); }}>{text.useAll}</Button>}
      </div>
      {plan && <div className={styles.preview} role="region" aria-label={text.prune.heading} data-testid="course-setting-variants-preview">
        {plan.excluded.length === 0 ? <p>{text.prune.nothing}</p> : <>
          <p><strong>{text.prune.goes(plan.excluded.length)}</strong> {plan.excluded.map(row => `${row.code} (${text.prune.reasons[row.reason](row.by)})`).join(", ")}</p>
          <p><strong>{text.prune.stays(plan.kept.length)}</strong> {plan.kept.map(code => {
            const guarded = plan.protected.find(row => row.code === code);
            return guarded ? `${code} (${reason(guarded)})` : code;
          }).join(", ")}</p>
        </>}
        <div className={base.row}>
          {plan.excluded.length > 0 && <Button onClick={() => { save(new Set(plan.excluded.map(row => row.code))); setPlan(undefined); }}>
            {text.prune.apply(plan.excluded.length)}</Button>}
          <Button variant="quiet" onClick={() => setPlan(undefined)}>{text.prune.cancel}</Button>
        </div>
      </div>}
    </div>}
  </section>;
}

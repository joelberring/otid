"use client";

import Link from "next/link";
import React, { useMemo, useState } from "react";
import { sortByTotalLoss, sortSplitRows, type SplitTableCell, type SplitTableColumn } from "@o-tid/domain";
import { splitAnalysisSv as text } from "../../i18n/split-analysis-sv";
import { listsSv } from "../../i18n/lists-sv";
import { formatDuration } from "../../lib/clock-time";
import { resultListFromPublic, splitGroups, type ResultRow, type SplitGroup } from "../../lib/lists/result-list-model";
import { analysisClassNames, legLabel, routeHref } from "../../lib/split-analysis";
import { useResultListData, type ResultListData } from "../lists/use-result-list-data";
import styles from "./split-analysis.module.css";

type View = "SPLITS" | "LOSS";
type Props = { raceId: string; initial: ResultListData; routeLegs: Record<string, string[]>; initialClass: string | null };

const duration = (ms: number | null | undefined) => ms === null || ms === undefined ? "" : formatDuration(ms);
const slug = (value: string) => value.replace(/\W+/g, "-");

function columnLabel(column: SplitTableColumn, index: number) {
  return { number: text.legNumber(index), control: column.kind === "FINISH" ? text.finish : text.control(column.controlCode, column.occurrence) };
}

/** Löparens namn (länk till resultatsidan), klubb och status när resultatet inte är godkänt. */
function Runner({ row, raceId }: { row: ResultRow; raceId: string }) {
  return <th scope="row" className={styles.stick}>
    {row.publicResultId ? <Link href={`/results/${raceId}/participants/${row.publicResultId}`}>{row.name}</Link> : row.name}
    <span className={styles.sub}>{row.status === "OK" ? row.club ?? "" : <span className={styles.status}>{text.status[row.status]}</span>}</span>
  </th>;
}

/** En cell: sträcktid och placering, förlust mot bästa, totaltid och placering, och länk till vägval när det finns. */
function Cell({ cell, route, runner, leg }: { cell: SplitTableCell | null; route: string | undefined; runner: string; leg: string }) {
  if (!cell) return <td className={styles.leg}><span className={styles.muted} title={text.missingLabel}>{text.missing}</span>
    <span className={styles.hidden}>{text.missingLabel}</span></td>;
  return <td className={styles.leg} data-best={cell.best || undefined}>
    <span className={styles.legTime}>
      {cell.legMs === null ? <span className={styles.muted} title={text.missingLabel}>{text.missing}</span> : duration(cell.legMs)}
      {cell.best && <><span aria-hidden="true" className={styles.star}>★</span><span className={styles.hidden}> ({text.bestLeg})</span></>}
      {cell.place !== null && <small> {text.legPlace(cell.place)}</small>}
    </span>
    {cell.lossMs !== null && cell.lossMs !== 0 && <span className={styles.loss}>
      {cell.lossMs > 0 ? text.lossValue(duration(cell.lossMs)) : text.gainValue(duration(-cell.lossMs))}</span>}
    <span className={styles.total}>{duration(cell.elapsedMs)}{cell.elapsedPlace !== null && ` ${text.legPlace(cell.elapsedPlace)}`}</span>
    {route && <Link className={styles.route} href={route} aria-label={text.routeLabel(runner, legLabel(leg))}>{text.route}</Link>}
  </td>;
}

function SplitGroupTable({ group, raceId, routeLegs, title }: { group: SplitGroup; raceId: string; routeLegs: Record<string, string[]>; title: string }) {
  const [sorted, setSorted] = useState<number | null>(null);
  const { table, rows } = group;
  const order = useMemo(() => sortSplitRows(table, sorted === null ? null : { column: sorted, by: "LEG" }), [table, sorted]);
  const id = `splits-${slug(title)}`;
  const sortedColumn = sorted === null ? undefined : table.columns[sorted];
  return <section className={styles.block} aria-labelledby={id}>
    <div className={styles.blockHead}><h2 id={id}>{title}</h2><p>{text.runners(rows.length)}</p>
      {table.idealMs !== null && <p>{text.ideal} {duration(table.idealMs)}</p>}</div>
    {sortedColumn && <p className={styles.sortNote} role="status">{text.sortedBy(legLabel(sortedColumn.leg))}{" "}
      <button type="button" className={styles.linkButton} onClick={() => setSorted(null)}>{text.sortReset}</button></p>}
    <div className={styles.scroll}>
      <table className={styles.table} aria-labelledby={id}>
        <thead><tr>
          <th scope="col" className={styles.place}>{text.place}</th>
          <th scope="col" className={styles.stick}>{text.name}</th>
          <th scope="col" className={styles.num}>{text.time}</th>
          {table.columns.map((column, index) => {
            const label = columnLabel(column, index);
            const active = sorted === index;
            return <th key={column.leg} scope="col" className={styles.legHead} aria-sort={active ? "ascending" : "none"}>
              <button type="button" aria-pressed={active} aria-label={text.sortBy(legLabel(column.leg))} onClick={() => setSorted(active ? null : index)}>
                <span className={styles.legNumber}>{label.number}</span><span>{label.control}</span>
              </button></th>;
          })}
        </tr></thead>
        <tbody>{order.map(index => {
          const row = rows[index]!;
          const cells = table.rows[index]!.cells;
          const legs = row.publicResultId ? routeLegs[row.publicResultId] : undefined;
          return <tr key={row.publicResultId ?? `${row.name}-${index}`} data-status={row.status}>
            <td className={styles.place}>{row.place ?? ""}</td>
            <Runner row={row} raceId={raceId} />
            <td className={styles.num}>{duration(row.timeMs)}{row.behindMs ? <span className={styles.sub}>+{duration(row.behindMs)}</span> : null}</td>
            {table.columns.map((column, columnIndex) => {
              const cell = cells[columnIndex] ?? null;
              const route = row.publicResultId && cell?.legMs !== null && cell && legs?.includes(column.leg)
                ? routeHref(raceId, row.publicResultId, column.leg) : undefined;
              return <Cell key={column.leg} cell={cell} route={route} runner={row.name} leg={column.leg} />;
            })}
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
}

/** Tidsförlust: summan av förlusterna mot bästa sträcka, minst först. */
function LossTable({ group, raceId, title }: { group: SplitGroup; raceId: string; title: string }) {
  const order = useMemo(() => sortByTotalLoss(group.table), [group.table]);
  const id = `loss-${slug(title)}`;
  return <section className={styles.block} aria-labelledby={id}>
    <div className={styles.blockHead}><h2 id={id}>{title}</h2><p>{text.runners(group.rows.length)}</p>
      {group.table.idealMs !== null && <p>{text.ideal} {duration(group.table.idealMs)}</p>}</div>
    <table className={`${styles.table} ${styles.lossTable}`} aria-labelledby={id}>
      <thead><tr><th scope="col" className={styles.place}>{text.place}</th><th scope="col">{text.name}</th>
        <th scope="col" className={styles.num}>{text.time}</th><th scope="col" className={styles.num}>{text.loss}</th></tr></thead>
      <tbody>{order.map(index => {
        const row = group.rows[index]!;
        const loss = group.table.rows[index]!.totalLossMs;
        return <tr key={row.publicResultId ?? `${row.name}-${index}`} data-status={row.status}>
          <td className={styles.place}>{row.place ?? ""}</td>
          <Runner row={row} raceId={raceId} />
          <td className={styles.num}>{duration(row.timeMs)}</td>
          <td className={styles.num}>{loss === null ? <span className={styles.muted}>{text.missing}</span> : `+${duration(loss)}`}</td>
        </tr>;
      })}</tbody>
    </table>
  </section>;
}

/**
 * Sträcktidsanalys per klass (PLAN.md steg 16), i stil med WinSplits: löpare som rader och sträckor som kolumner.
 * Tabellen rullar i sidled med namnkolumnen fast; sidan rullar aldrig i sidled. Uppdateras av sig själv.
 */
export function SplitAnalysis({ raceId, initial, routeLegs, initialClass }: Props) {
  const { data, failed } = useResultListData(raceId, initial);
  const model = useMemo(() => resultListFromPublic((data ?? initial).results, (data ?? initial).relay), [data, initial]);
  const classNames = useMemo(() => analysisClassNames(model), [model]);
  const [chosen, setChosen] = useState(initialClass ?? "");
  const [view, setView] = useState<View>("SPLITS");
  const className = classNames.includes(chosen) ? chosen : classNames[0] ?? "";
  const raceClass = model.classes.find(row => row.name === className);
  const groups = useMemo(() => raceClass ? splitGroups(raceClass) : [], [raceClass]);
  const relayClasses = model.relayClasses.map(row => row.name);
  const choose = (name: string) => {
    setChosen(name);
    window.history.replaceState(null, "", `?class=${encodeURIComponent(name)}`);
  };
  const forked = groups.some(group => group.variant !== null);
  const mispunched = groups.some(group => group.rows.some(row => row.status !== "OK"));
  const routes = groups.some(group => group.rows.some(row => row.publicResultId && routeLegs[row.publicResultId]));
  return <div className={styles.analysis}>
    <div className={styles.toolbar} role="toolbar" aria-label={text.title}>
      <label className={styles.classPicker}><span>{text.classLabel}</span>
        <select value={className} onChange={event => choose(event.target.value)} disabled={classNames.length === 0}>
          {classNames.map(name => <option key={name} value={name}>{name}</option>)}
        </select></label>
      <div className={styles.segmented} role="group" aria-label={text.viewLabel}>
        {(["SPLITS", "LOSS"] as const).map(id => <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>
          {text.views[id]}</button>)}
      </div>
    </div>
    {failed && <p className={styles.notice} role="alert">{listsSv.results.refreshFailed}</p>}
    {initialClass && chosen === initialClass && !classNames.includes(initialClass) && classNames.length > 0 &&
      <p className={styles.notice} role="status">{text.noClass}</p>}
    {classNames.length === 0 ? <p className={styles.nothing}>{text.none}</p> : <>
      <div className={styles.help}>
        <p>{view === "SPLITS" ? text.help : text.lossHelp}</p>
        {forked && <p>{text.helpForked}</p>}
        {mispunched && <p>{text.helpMispunched}</p>}
        {routes && view === "SPLITS" && <p>{text.helpRoutes}</p>}
      </div>
      {groups.map(group => {
        const title = group.variant ? text.variantHeading(group.className, group.variant) : group.className;
        return view === "SPLITS"
          ? <SplitGroupTable key={`${className}-${title}`} group={group} raceId={raceId} routeLegs={routeLegs} title={title} />
          : <LossTable key={`${className}-${title}`} group={group} raceId={raceId} title={title} />;
      })}
    </>}
    {relayClasses.length > 0 && <p className={styles.note}>{text.relayNotSupported(relayClasses.join(", "))}</p>}
  </div>;
}

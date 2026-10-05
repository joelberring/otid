"use client";

import Link from "next/link";
import React, { useMemo, useState, type ReactNode } from "react";
import { listsSv as text } from "../../i18n/lists-sv";
import { formatDuration } from "../../lib/clock-time";
import { resultListCsv, type ResultView } from "../../lib/lists/csv";
import { filterResults, resultClassNames, resultsByClub, splitGroups, type RelayClass, type RelayTeam, type ResultClass, type ResultListModel,
  type ResultRow } from "../../lib/lists/result-list-model";
import { download, ListFrame, type IofExport } from "./list-frame";
import styles from "./lists.module.css";

const t = text.results;
const duration = (ms: number | null) => ms === null ? "" : formatDuration(ms);
const behind = (ms: number | null) => ms === null ? "" : ms === 0 ? "" : `+${formatDuration(ms)}`;
const slug = (value: string) => value.replace(/\W+/g, "-");

type Context = { raceId: string; links: boolean };

/** Länk till sträcktidsanalysen för klassen (bara publikt; rogaining har ingen). */
function AnalysisLink({ className, context }: { className: string; context: Context }) {
  if (!context.links) return null;
  return <Link className={styles.headLink} href={`/results/${context.raceId}/splits?class=${encodeURIComponent(className)}`}
    aria-label={t.analysisLinkLabel(className)}>{t.analysisLink}</Link>;
}

function Status({ row }: { row: ResultRow }) {
  const label = row.status === "OK" && row.reason === "MANUAL_APPROVAL" ? t.manualApproval : t.status[row.status];
  return <td className={`${styles.status} ${styles.statusCol}`} data-status={row.status}>{label}
    {row.status === "MP" && row.missingControls.length > 0 && <span className={styles.sub}>{t.missing(row.missingControls.join(", "))}</span>}</td>;
}

/** Löparens namn, länkat till resultatsidan på den publika sidan. Klubb och variant under namnet. */
function Runner({ row, context, club = true }: { row: ResultRow; context: Context; club?: boolean }) {
  return <th scope="row">
    {context.links && row.publicResultId ? <Link href={`/results/${context.raceId}/participants/${row.publicResultId}`}>{row.name}</Link> : row.name}
    {club && <span className={styles.subMobile}>{row.club ?? ""}</span>}
    {row.variant && <span className={styles.sub}>{t.variant(row.variant)}</span>}
  </th>;
}

/**
 * Rogainingklass (ADR-0170 beslut 5): placering efter summa och sedan tid. Poäng och straff visas på bred skärm;
 * på mobil summa med tiden under.
 */
function ScoredClassBlock({ raceClass, context }: { raceClass: ResultClass; context: Context }) {
  const id = `result-class-${slug(raceClass.name)}`;
  const score = (row: ResultRow, value: (score: NonNullable<ResultRow["score"]>) => number) => row.score ? value(row.score) : "";
  return <section className={styles.block} aria-labelledby={id}>
    <div className={styles.blockHead}><h3 id={id}>{raceClass.name}</h3><p>{t.runners(raceClass.rows.length)}</p></div>
    <p className={styles.note}>{t.scoredHelp}</p>
    <table className={styles.table} aria-labelledby={id}>
      <thead><tr><th scope="col" className={styles.place}>{t.place}</th><th scope="col">{t.name}</th>
        <th scope="col" className={styles.wideOnly}>{t.club}</th>
        <th scope="col" className={`${styles.num} ${styles.narrow} ${styles.wideOnly}`}>{t.points}</th>
        <th scope="col" className={`${styles.num} ${styles.narrow} ${styles.wideOnly}`}>{t.penalty}</th>
        <th scope="col" className={`${styles.num} ${styles.narrow}`}>{t.total}</th>
        <th scope="col" className={`${styles.num} ${styles.narrow} ${styles.wideOnly}`}>{t.time}</th>
        <th scope="col" className={styles.statusCol}>{t.statusColumn}</th></tr></thead>
      <tbody>{raceClass.rows.map((row, index) => <tr key={row.publicResultId ?? `${row.name}-${index}`} data-status={row.status}>
        <td className={styles.place}>{row.place ?? ""}</td>
        <Runner row={row} context={context} />
        <td className={styles.wideOnly}>{row.club ?? ""}</td>
        <td className={`${styles.num} ${styles.wideOnly}`}>{score(row, value => value.controlPoints)}</td>
        <td className={`${styles.num} ${styles.wideOnly} ${styles.muted}`}>{row.score && row.score.penalty > 0 ? `−${row.score.penalty}` : ""}</td>
        <td className={styles.num}><span className={styles.strong}>{score(row, value => value.total)}</span>
          <span className={styles.subMobile}>{duration(row.timeMs)}</span></td>
        <td className={`${styles.num} ${styles.wideOnly}`}>{duration(row.timeMs)}</td>
        <Status row={row} />
      </tr>)}</tbody>
    </table>
  </section>;
}

/** Rogaining "med sträcktider": de räknade kontrollerna i stämplingsordning med poäng och tid från start. */
function ScoredControlsBlock({ raceClass, context }: { raceClass: ResultClass; context: Context }) {
  const id = `result-controls-${slug(raceClass.name)}`;
  return <section className={styles.block} aria-labelledby={id}>
    <div className={styles.blockHead}><h3 id={id}>{raceClass.name}</h3><p>{t.scoredControls}</p></div>
    <table className={`${styles.table} ${styles.scoredTable}`} aria-labelledby={id}>
      <thead><tr><th scope="col" className={styles.place}>{t.place}</th><th scope="col" className={styles.nameCol}>{t.name}</th>
        <th scope="col" className={`${styles.num} ${styles.scoreCol}`}>{t.total}</th><th scope="col">{t.scoredControls}</th></tr></thead>
      <tbody>{raceClass.rows.map((row, index) => {
        const times = new Map(row.splits.map(split => [split.controlCode, split.elapsedMs]));
        return <tr key={row.publicResultId ?? `${row.name}-${index}`}>
          <td className={styles.place}>{row.place ?? ""}</td>
          <th scope="row">{context.links && row.publicResultId
            ? <Link href={`/results/${context.raceId}/participants/${row.publicResultId}`}>{row.name}</Link> : row.name}
            <span className={styles.sub}>{row.status === "OK" ? duration(row.timeMs) : t.status[row.status]}</span></th>
          <td className={`${styles.num} ${styles.strong}`}>{row.score?.total ?? ""}</td>
          <td><ol className={styles.scoredControls}>{(row.score?.controls ?? []).map(control => <li key={control.controlCode}>
            <strong>{t.scoredControl(control.controlCode, control.points)}</strong>
            {times.has(control.controlCode) && <span className={styles.muted}> {formatDuration(times.get(control.controlCode)!)}</span>}
          </li>)}</ol></td>
        </tr>;
      })}</tbody>
    </table>
  </section>;
}

function ClassBlock({ raceClass, context }: { raceClass: ResultClass; context: Context }) {
  if (raceClass.scored) return <ScoredClassBlock raceClass={raceClass} context={context} />;
  const id = `result-class-${slug(raceClass.name)}`;
  return <section className={styles.block} aria-labelledby={id}>
    <div className={styles.blockHead}><h3 id={id}>{raceClass.name}</h3><p>{t.runners(raceClass.rows.length)}</p>
      {raceClass.rows.some(row => row.splits.length > 0) && <AnalysisLink className={raceClass.name} context={context} />}</div>
    {raceClass.mixedCourses && <p className={styles.notice}>{t.mixedCourses}</p>}
    <table className={styles.table} aria-labelledby={id}>
      <thead><tr><th scope="col" className={styles.place}>{t.place}</th><th scope="col">{t.name}</th>
        <th scope="col" className={styles.wideOnly}>{t.club}</th><th scope="col" className={`${styles.num} ${styles.narrow}`}>{t.time}</th>
        <th scope="col" className={`${styles.num} ${styles.narrow} ${styles.wideOnly}`}>{t.behind}</th>
        <th scope="col" className={styles.statusCol}>{t.statusColumn}</th></tr></thead>
      <tbody>{raceClass.rows.map((row, index) => <tr key={row.publicResultId ?? `${row.name}-${index}`} data-status={row.status}>
        <td className={styles.place}>{row.place ?? ""}</td>
        <Runner row={row} context={context} />
        <td className={styles.wideOnly}>{row.club ?? ""}</td>
        <td className={styles.num}>{duration(row.timeMs)}{row.behindMs ? <span className={`${styles.subMobile}`}>{behind(row.behindMs)}</span> : null}</td>
        <td className={`${styles.num} ${styles.wideOnly} ${styles.muted}`}>{behind(row.behindMs)}</td>
        <Status row={row} />
      </tr>)}</tbody>
    </table>
  </section>;
}

function teamStatus(team: RelayTeam): string {
  return team.status === "RUNNING" && team.currentLeg ? t.outOnLeg(team.currentLeg) : t.teamStatus[team.status];
}

/** Stafett per klass: lagen med placering, tid och status, och sträcklöparna under varje lag. */
function RelayBlock({ raceClass, context }: { raceClass: RelayClass; context: Context }) {
  const id = `result-relay-${slug(raceClass.name)}`;
  return <section className={styles.block} aria-labelledby={id}>
    <div className={styles.blockHead}><h3 id={id}>{raceClass.name}</h3><p>{t.legs(raceClass.legCount)} · {t.teams(raceClass.teams.length)}</p></div>
    {raceClass.teams.length === 0 ? <p className={styles.empty}>{t.empty}</p> :
      <table className={styles.table} aria-label={t.teamResults(raceClass.name)}>
        <thead><tr><th scope="col" className={styles.place}>{t.place}</th><th scope="col">{t.team}</th>
          <th scope="col" className={`${styles.num} ${styles.narrow}`}>{t.time}</th>
          <th scope="col" className={`${styles.num} ${styles.narrow} ${styles.wideOnly}`}>{t.behind}</th>
          <th scope="col" className={styles.statusCol}>{t.statusColumn}</th></tr></thead>
        {raceClass.teams.map(team => <tbody key={team.number} className={styles.team} data-status={team.status}>
          <tr>
            <td className={styles.place}>{team.position ?? ""}</td>
            <th scope="rowgroup">{team.number} {team.name}<span className={styles.sub}>{team.organisationName ?? ""}</span></th>
            <td className={styles.num}>{duration(team.elapsedMs)}</td>
            <td className={`${styles.num} ${styles.wideOnly} ${styles.muted}`}>{behind(team.timeBehindMs)}</td>
            <td className={`${styles.status} ${styles.statusCol}`} data-status={team.status}>{teamStatus(team)}</td>
          </tr>
          {team.legs.map(leg => <tr key={leg.leg} className={styles.legRow}>
            <td className={styles.place}>{t.legShort(leg.leg)}</td>
            <th scope="row">{context.links
              ? <Link href={`/results/${context.raceId}/participants/${leg.publicResultId}`}>{leg.givenName} {leg.familyName}</Link>
              : `${leg.givenName} ${leg.familyName}`}{leg.restarted && <span className={styles.muted}> · {t.restarted}</span>}</th>
            <td className={styles.num}>{leg.status === "OK" ? duration(leg.elapsedMs) : ""}
              {leg.legPosition !== null && <span className={styles.sub}>({leg.legPosition})</span>}</td>
            <td className={styles.wideOnly} />
            <td className={`${styles.status} ${styles.statusCol}`} data-status={leg.status ?? "RUNNING"}>
              {leg.status ? t.status[leg.status] : ""}</td>
          </tr>)}
        </tbody>)}
      </table>}
  </section>;
}

function SplitsBlock({ raceClass, context }: { raceClass: ResultClass; context: Context }) {
  if (raceClass.scored) return <ScoredControlsBlock raceClass={raceClass} context={context} />;
  const groups = splitGroups(raceClass);
  if (groups.length === 0) return <section className={styles.block} aria-label={raceClass.name}>
    <div className={styles.blockHead}><h3>{raceClass.name}</h3></div><p className={styles.empty}>{t.noSplits}</p></section>;
  return <>{groups.map(group => {
    const title = group.variant ? t.variantHeading(group.className, group.variant) : group.className;
    const id = `result-splits-${slug(title)}`;
    return <section key={title} className={styles.block} aria-labelledby={id}>
      <div className={styles.blockHead}><h3 id={id}>{title}</h3><p>{t.runners(group.rows.length)}</p>
        <AnalysisLink className={group.className} context={context} /></div>
      <div className={styles.splitScroll}>
        <table className={`${styles.table} ${styles.splitTable}`} aria-labelledby={id}>
          <thead><tr><th scope="col" className={styles.place}>{t.place}</th><th scope="col" className={styles.stick}>{t.name}</th>
            <th scope="col" className={styles.num}>{t.time}</th>
            {group.table.columns.map((column, index) => <th key={index} scope="col" className={styles.num}>
              {column.kind === "FINISH" ? t.finish : t.controlHeading(column.controlCode, column.occurrence)}</th>)}
          </tr></thead>
          <tbody>{group.rows.map((row, index) => <tr key={row.publicResultId ?? `${row.name}-${index}`}>
            <td className={styles.place}>{row.place ?? ""}</td>
            <th scope="row" className={styles.stick}>{context.links && row.publicResultId
              ? <Link href={`/results/${context.raceId}/participants/${row.publicResultId}`}>{row.name}</Link> : row.name}
              <span className={styles.sub}>{row.status === "OK" ? row.club ?? "" : t.status[row.status]}</span></th>
            <td className={styles.num}>{duration(row.timeMs)}{row.behindMs ? <span className={styles.sub}>{behind(row.behindMs)}</span> : null}</td>
            {group.table.rows[index]!.cells.map((cell, column) => <td key={column} className={styles.leg}>
              {cell ? <>{cell.legMs === null ? <span className={styles.muted}>–</span>
                : <span className={cell.best ? styles.best : undefined}>{formatDuration(cell.legMs)}</span>}
                {cell.best && <span className={styles.hiddenLabel}> ({t.bestLeg})</span>}
                {cell.place !== null && <small> ({cell.place})</small>}
                <span className={styles.total}>{formatDuration(cell.elapsedMs)}</span></> : <span className={styles.muted}>–</span>}
            </td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </section>;
  })}</>;
}

function RelayLegs({ raceClass }: { raceClass: RelayClass }) {
  return <>{raceClass.legs.map(leg => {
    const id = `result-leg-${slug(raceClass.name)}-${leg.leg}`;
    return <section key={leg.leg} className={styles.block} aria-labelledby={id}>
      <div className={styles.blockHead}><h3 id={id}>{t.legResults(raceClass.name, leg.leg)}</h3></div>
      <table className={styles.table} aria-label={t.legResults(raceClass.name, leg.leg)}>
        <thead><tr><th scope="col" className={styles.place}>{t.place}</th><th scope="col">{t.runner}</th><th scope="col">{t.team}</th>
          <th scope="col" className={`${styles.num} ${styles.narrow}`}>{t.time}</th>
          <th scope="col" className={`${styles.num} ${styles.narrow} ${styles.wideOnly}`}>{t.behind}</th></tr></thead>
        <tbody>{leg.results.map(result => <tr key={result.teamNumber}>
          <td className={styles.place}>{result.position ?? ""}</td>
          <th scope="row">{result.givenName} {result.familyName}</th>
          <td>{result.teamNumber} {result.teamName}</td>
          <td className={`${styles.num} ${result.status === "OK" ? "" : styles.status}`} data-status={result.status}>
            {result.status === "OK" ? duration(result.elapsedMs) : t.status[result.status]}</td>
          <td className={`${styles.num} ${styles.wideOnly} ${styles.muted}`}>{behind(result.timeBehindMs)}</td>
        </tr>)}</tbody>
      </table>
    </section>;
  })}</>;
}

function ByClub({ model, context }: { model: ResultListModel; context: Context }) {
  const groups = useMemo(() => resultsByClub(model), [model]);
  return <>{groups.map(group => {
    const id = `result-club-${slug(group.club ?? "none")}`;
    const facts = [group.summary.runners > 0 && t.clubSummary(group.summary.runners, group.summary.approved, group.summary.podium),
      group.teams.length > 0 && t.clubTeams(group.teams.length)].filter(Boolean).join(" · ");
    return <section key={group.club ?? ""} className={styles.block} aria-labelledby={id}>
      <div className={styles.blockHead}><h3 id={id}>{group.club ?? t.noClub}</h3><p>{facts}</p></div>
      <table className={styles.table} aria-labelledby={id}>
        <thead><tr><th scope="col">{t.name}</th><th scope="col" className={styles.classCol}>{t.className}</th>
          <th scope="col" className={styles.place}>{t.place}</th><th scope="col" className={`${styles.num} ${styles.narrow}`}>{t.time}</th>
          <th scope="col" className={styles.statusCol}>{t.statusColumn}</th></tr></thead>
        <tbody>
          {group.runners.map(({ className, result }, index) => <tr key={result.publicResultId ?? `${result.name}-${index}`}>
            <Runner row={result} context={context} club={false} />
            <td className={styles.classCol}>{className}</td>
            <td className={styles.place}>{result.place ?? ""}</td>
            <td className={styles.num}>{result.score && <span className={styles.strong}>{t.pointsShort(result.score.total)} · </span>}
              {duration(result.timeMs)}</td>
            <Status row={result} />
          </tr>)}
          {group.teams.map(({ className, team }) => <tr key={`${className}-${team.number}`}>
            <th scope="row">{team.number} {team.name}<span className={styles.sub}>{team.legs.map(leg => `${leg.givenName} ${leg.familyName}`).join(", ")}</span></th>
            <td className={styles.classCol}>{className}</td>
            <td className={styles.place}>{team.position ?? ""}</td>
            <td className={styles.num}>{duration(team.elapsedMs)}</td>
            <td className={`${styles.status} ${styles.statusCol}`} data-status={team.status}>{teamStatus(team)}</td>
          </tr>)}
        </tbody>
      </table>
    </section>;
  })}</>;
}

/**
 * Resultatlistorna (PLAN.md steg 13): per klass, med sträcktider och per klubb; stafett som lagresultat med
 * sträcklöpare och sträckresultat. Samma komponent i arbetsytan och på den publika sidan (där namnen länkar
 * till löparens resultatsida).
 */
export function ResultLists({ model, raceId, race, raceDate, links, iof, status }: {
  model: ResultListModel; raceId: string; race: string; raceDate: string; links: boolean; iof?: IofExport | undefined; status?: ReactNode;
}) {
  const [view, setView] = useState<ResultView>("CLASS");
  const [query, setQuery] = useState("");
  const [className, setClassName] = useState("");
  const classNames = useMemo(() => resultClassNames(model), [model]);
  const selected = classNames.includes(className) ? className : "";
  const shown = useMemo(() => filterResults(model, query, selected), [model, query, selected]);
  const count = shown.classes.reduce((sum, row) => sum + row.rows.length, 0);
  const teams = shown.relayClasses.reduce((sum, row) => sum + row.teams.length, 0);
  const context: Context = { raceId, links };
  const views = (["CLASS", "SPLITS", "CLUB"] as const).map(id => ({ id, label: t.views[id] }));
  const empty = model.classes.length === 0 && model.relayClasses.every(row => row.teams.length === 0);
  return <ListFrame title={t.titles[view]} race={race} toolbar={{
    views, view, onView: setView, query, onQuery: setQuery, searchPlaceholder: text.searchPlaceholder,
    classes: classNames, className: selected, onClass: setClassName,
    count: [count > 0 && t.runners(count), teams > 0 && t.teams(teams)].filter(Boolean).join(" · ") || t.runners(0), iof,
    onCsv: () => download(`${text.csv.files.results[view]}-${raceDate}.csv`, resultListCsv(view, shown), "text/csv;charset=utf-8")
  }}>
    {status}
    {empty ? <p className={styles.nothing}>{t.empty}</p>
      : shown.classes.length === 0 && shown.relayClasses.length === 0 ? <p className={styles.nothing}>{text.noMatches}</p>
        : view === "CLASS" ? <>
          {shown.relayClasses.map(raceClass => <RelayBlock key={raceClass.name} raceClass={raceClass} context={context} />)}
          {shown.classes.map(raceClass => <ClassBlock key={raceClass.name} raceClass={raceClass} context={context} />)}</>
          : view === "SPLITS" ? <>
            {shown.relayClasses.map(raceClass => <RelayLegs key={raceClass.name} raceClass={raceClass} />)}
            {shown.classes.map(raceClass => <SplitsBlock key={raceClass.name} raceClass={raceClass} context={context} />)}</>
            : <ByClub model={shown} context={context} />}
  </ListFrame>;
}

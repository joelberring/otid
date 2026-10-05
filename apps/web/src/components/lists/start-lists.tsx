"use client";

import React, { useEffect, useMemo, useState } from "react";
import { listsSv as text } from "../../i18n/lists-sv";
import { formatClockTime } from "../../lib/clock-time";
import { startListCsv, type StartView } from "../../lib/lists/csv";
import { classStartRows, filterStartList, groupByStartTime, startClub, startListByClub, type StartClass, type StartEntry,
  type StartListModel, type StartMode } from "../../lib/lists/start-list-model";
import { download, ListFrame, type IofExport } from "./list-frame";
import styles from "./lists.module.css";

const t = text.start;

/** Klockslag utan sekunder när de är noll (10:02), annars med (10:02:30). */
function clock(instant: string, timeZone: string): string {
  const full = formatClockTime(instant, timeZone);
  return full.endsWith(":00") ? full.slice(0, 5) : full;
}

function modeText(mode: StartMode, timeZone: string): string {
  if (mode.kind === "FREE") return t.freeStart;
  if (mode.kind === "MASS") return t.massStart(mode.time ? clock(mode.time, timeZone) : null);
  if (mode.kind === "RELAY") return `${t.relay} · ${t.legs(mode.legCount)}`;
  return t.minuteStart;
}

type Context = { model: StartListModel; onSelectEntry?: ((id: string) => void) | undefined; disabled?: boolean | undefined };

/** Namnet; i arbetsytan en knapp som öppnar deltagarkortet. Klubben visas under namnet på smala skärmar. */
function Name({ entry, context, club = true }: { entry: StartEntry; context: Context; club?: boolean }) {
  const { onSelectEntry, disabled } = context;
  return <th scope="row">
    {onSelectEntry && entry.id
      ? <button type="button" className={styles.person} disabled={disabled} onClick={() => onSelectEntry(entry.id!)}
        aria-label={t.openPerson(entry.name)}>{entry.name}</button>
      : entry.name}
    {club && <span className={styles.subMobile}>{startClub(entry) ?? ""}</span>}
  </th>;
}

function Card({ entry }: { entry: StartEntry }) {
  return entry.multipleCards ? <td className={`${styles.card} ${styles.attention}`}>{t.multipleCards}</td>
    : <td className={styles.card}>{entry.card ?? <span className={styles.muted}>{t.noCard}</span>}</td>;
}

function ClassBlock({ raceClass, context }: { raceClass: StartClass; context: Context }) {
  const { model } = context, timeZone = model.timeZone;
  const relay = raceClass.mode.kind === "RELAY", free = raceClass.mode.kind === "FREE";
  const variants = raceClass.entries.some(entry => entry.variant);
  const teams = relay ? [...new Set(raceClass.entries.map(entry => entry.relay?.teamNumber ?? 0))] : [];
  const facts = [raceClass.courseName && t.course(raceClass.courseName), modeText(raceClass.mode, timeZone),
    relay ? t.teams(teams.length) : t.runners(raceClass.entries.length),
    raceClass.vacancies.length > 0 && t.vacancies(raceClass.vacancies.length)].filter(Boolean).join(" · ");
  const id = `start-class-${raceClass.name.replace(/\W+/g, "-")}`;
  const time = (entry: StartEntry) => free ? <span className={styles.muted} title={t.freeStart}>–</span>
    : entry.startTime ? clock(entry.startTime, timeZone)
    : entry.relay && entry.relay.leg > 1 ? <span className={styles.muted}>{t.waitingChangeover}</span>
      : <span className={styles.attention}>{t.missingTime}</span>;
  const head = <thead><tr>
    {relay ? <th scope="col" className={styles.narrow}>{t.leg}</th> : <th scope="col" className={styles.time}>{t.time}</th>}
    <th scope="col">{t.name}</th><th scope="col" className={styles.wideOnly}>{t.club}</th>
    {relay && <th scope="col" className={styles.time}>{t.time}</th>}
    {model.cards && <th scope="col" className={styles.card}>{t.card}</th>}
    {variants && <th scope="col" className={styles.narrow}>{t.variant}</th>}
  </tr></thead>;
  return <section className={styles.block} aria-labelledby={id}>
    <div className={styles.blockHead}><h3 id={id}>{raceClass.name}</h3><p>{facts}</p></div>
    {raceClass.entries.length === 0 && raceClass.vacancies.length === 0 ? <p className={styles.empty}>{t.empty}</p>
      : <table className={styles.table} aria-labelledby={id}>{head}
        {relay ? teams.map(number => {
          const legs = raceClass.entries.filter(entry => entry.relay?.teamNumber === number);
          const team = legs[0]?.relay;
          return <tbody key={number} className={styles.team}>
            <tr><th scope="rowgroup" colSpan={3 + (model.cards ? 1 : 0) + (variants ? 1 : 0) + 1}>
              {team && t.teamHeading(team.teamNumber, team.teamName)}{team?.teamClub && <span className={styles.muted}> · {team.teamClub}</span>}</th></tr>
            {legs.map(entry => <tr key={`${number}-${entry.relay?.leg}`} className={styles.legRow}>
              <td className={styles.narrow}>{t.legShort(entry.relay?.leg ?? 0)}</td>
              <Name entry={entry} context={context} />
              <td className={styles.wideOnly}>{entry.club ?? ""}</td>
              <td className={styles.time}>{time(entry)}</td>
              {model.cards && <Card entry={entry} />}
              {variants && <td className={styles.narrow}>{entry.variant ?? ""}</td>}
            </tr>)}
          </tbody>;
        }) : <tbody>{classStartRows(raceClass).map((row, index) => row.entry
          ? <tr key={row.entry.id ?? `${row.entry.name}-${index}`}>
            <td className={styles.time}>{time(row.entry)}</td>
            <Name entry={row.entry} context={context} />
            <td className={styles.wideOnly}>{row.entry.club ?? ""}</td>
            {model.cards && <Card entry={row.entry} />}
            {variants && <td className={styles.narrow}>{row.entry.variant ?? "–"}</td>}
          </tr>
          : <tr key={`vacant-${row.time}`} className={styles.vacant}>
            <td className={styles.time}>{row.time && clock(row.time, timeZone)}</td>
            <th scope="row">{t.vacant}</th><td className={styles.wideOnly} />
            {model.cards && <td className={styles.card} />}{variants && <td className={styles.narrow} />}
          </tr>)}</tbody>}
      </table>}
  </section>;
}

function ByTime({ classes, context, now }: { classes: StartClass[]; context: Context; now: number }) {
  const { model } = context;
  const groups = useMemo(() => groupByStartTime(classes), [classes]);
  const several = groups.places.length > 1;
  const current = Math.floor(now / 60_000) * 60_000;
  return <>
    {groups.places.map(place => {
      const id = `start-place-${place.firstControlCode ?? "x"}`;
      const title = place.firstControlCode === null ? t.startPlaceUnknown : t.startPlace(place.firstControlCode);
      return <section key={id} className={styles.block} aria-labelledby={several ? id : undefined} aria-label={several ? undefined : text.start.titles.TIME}>
        {several && <div className={styles.blockHead}><h3 id={id}>{title}</h3>
          <p>{t.runners(place.minutes.reduce((sum, minute) => sum + minute.rows.filter(row => row.entry).length, 0))}</p></div>}
        <table className={styles.table}>
          <thead><tr><th scope="col" className={styles.time}>{t.time}</th><th scope="col" className={styles.classCol}>{t.className}</th>
            <th scope="col">{t.name}</th><th scope="col" className={styles.wideOnly}>{t.club}</th>
            {model.cards && <th scope="col" className={styles.card}>{t.card}</th>}</tr></thead>
          {place.minutes.map(minute => {
            const isNow = minute.minute === current;
            return <tbody key={minute.minute} className={styles.minute} data-current={isNow || undefined}
              aria-label={isNow ? t.nowLabel : undefined}>
              {minute.rows.map((row, index) => <tr key={`${row.className}-${row.entry?.id ?? row.entry?.name ?? "vakant"}-${row.time}-${index}`}
                className={row.entry ? undefined : styles.vacant}>
                {index === 0 && <td className={`${styles.clock}`} rowSpan={minute.rows.length}>
                  {clock(row.time, model.timeZone)}{isNow && <span className={styles.nowMark}>{t.now}</span>}</td>}
                <td className={styles.classCol}>{row.className}</td>
                {row.entry ? <Name entry={row.entry} context={context} /> : <th scope="row">{t.vacant}</th>}
                <td className={styles.wideOnly}>{row.entry ? startClub(row.entry) ?? "" : ""}</td>
                {model.cards && (row.entry ? <Card entry={row.entry} /> : <td className={styles.card} />)}
              </tr>)}
            </tbody>;
          })}
        </table>
      </section>;
    })}
    {groups.free.length > 0 && <section className={styles.block} aria-labelledby="start-free">
      <div className={styles.blockHead}><h3 id="start-free">{t.freeClasses}</h3>
        <p>{groups.free.map(row => `${row.name} (${t.runners(row.entries.length)})`).join(", ")}</p></div>
      <p className={styles.note}>{t.freeHelp}</p>
    </section>}
    {groups.missing.length > 0 && <div className={styles.notice} role="note">
      <strong>{t.missingTitle}</strong>
      {groups.missing.map(row => `${row.entry.name} (${row.className})`).join(", ")}
      {model.cards && <p>{t.missingHelp}</p>}
    </div>}
  </>;
}

function ByClub({ classes, context }: { classes: StartClass[]; context: Context }) {
  const { model } = context;
  const groups = useMemo(() => startListByClub(classes), [classes]);
  const modeOf = new Map(classes.map(row => [row.name, row.mode]));
  return <>{groups.map(group => {
    const id = `start-club-${(group.club ?? "none").replace(/\W+/g, "-")}`;
    return <section key={group.club ?? ""} className={styles.block} aria-labelledby={id}>
      <div className={styles.blockHead}><h3 id={id}>{group.club ?? t.noClub}</h3><p>{t.clubCount(group.rows.length)}</p></div>
      <table className={styles.table} aria-labelledby={id}>
        <thead><tr><th scope="col">{t.name}</th><th scope="col" className={styles.classCol}>{t.className}</th>
          <th scope="col" className={styles.time}>{t.time}</th>{model.cards && <th scope="col" className={styles.card}>{t.card}</th>}</tr></thead>
        <tbody>{group.rows.map(({ className, entry }, index) => <tr key={entry.id ?? `${className}-${entry.name}-${index}`}>
          <Name entry={entry} context={context} club={false} />
          <td className={styles.classCol}>{className}{entry.relay && <span className={styles.sub}>{t.legShort(entry.relay.leg)}</span>}</td>
          <td className={styles.time}>{entry.startTime ? clock(entry.startTime, model.timeZone)
            : <span className={styles.muted}>{modeOf.get(className)?.kind === "FREE" ? t.freeStart : entry.relay ? t.waitingChangeover : "–"}</span>}</td>
          {model.cards && <Card entry={entry} />}
        </tr>)}</tbody>
      </table>
    </section>;
  })}</>;
}

/**
 * Startlistorna (PLAN.md steg 13): per klass, per starttid (minut för minut och per startfålla, med vakanta tider
 * och nuvarande minut markerad) och per klubb. Samma komponent i arbetsytan och på den publika sidan.
 */
export function StartLists({ model, onSelectEntry, disabled, iof }: {
  model: StartListModel; onSelectEntry?: ((id: string) => void) | undefined; disabled?: boolean | undefined; iof?: IofExport | undefined;
}) {
  const [view, setView] = useState<StartView>("CLASS");
  const [query, setQuery] = useState("");
  const [className, setClassName] = useState("");
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (view !== "TIME") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [view]);
  const classNames = useMemo(() => model.classes.map(row => row.name), [model.classes]);
  const selected = classNames.includes(className) ? className : "";
  const classes = useMemo(() => filterStartList(model.classes, query, selected), [model.classes, query, selected]);
  const runners = classes.reduce((sum, row) => sum + row.entries.length, 0);
  const context: Context = { model, onSelectEntry, disabled };
  const views = (["CLASS", "TIME", "CLUB"] as const).map(id => ({ id, label: t.views[id] }));
  const race = `${model.eventName} · ${model.raceName} · ${model.raceDate}`;
  return <ListFrame title={t.titles[view]} race={race} toolbar={{
    views, view, onView: setView, query, onQuery: setQuery, searchPlaceholder: model.cards ? text.searchPlaceholderCards : text.searchPlaceholder,
    classes: classNames, className: selected, onClass: setClassName, count: t.runners(runners), iof,
    onCsv: () => download(`${text.csv.files.start[view]}-${model.raceDate}.csv`, startListCsv(view, classes, model.timeZone, model.cards),
      "text/csv;charset=utf-8")
  }}>
    {model.classes.every(row => row.entries.length === 0) ? <p className={styles.nothing}>{t.noEntries}</p>
      : classes.length === 0 ? <p className={styles.nothing}>{text.noMatches}</p>
        : view === "CLASS" ? classes.map(raceClass => <ClassBlock key={raceClass.name} raceClass={raceClass} context={context} />)
          : view === "TIME" ? <ByTime classes={classes} context={context} now={now} />
            : <ByClub classes={classes} context={context} />}
  </ListFrame>;
}

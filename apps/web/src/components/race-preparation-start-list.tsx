"use client";

import { useMemo, useState } from "react";
import type { EntryTransferCandidates } from "@o-tid/contracts";
import { formatClockTime } from "../lib/clock-time";
import { racePreparationStartListSv as text } from "../i18n/race-preparation-start-list-sv";
import styles from "./race-preparation-start-list.module.css";

const pageSize = 100;
const collator = new Intl.Collator("sv-SE", { numeric: true, sensitivity: "base" });
type Entry = EntryTransferCandidates["entries"][number];
type RaceClass = EntryTransferCandidates["classes"][number];

function searchable(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("sv-SE");
}

export function RacePreparationStartList({ data, disabled, onSelectEntry }: {
  data: EntryTransferCandidates;
  disabled: boolean;
  onSelectEntry: (entryId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [classId, setClassId] = useState("");
  const [page, setPage] = useState(0);
  const classesById = useMemo(() => new Map(data.classes.map(row => [row.id, row])), [data.classes]);
  const selectedClassId = classesById.has(classId) ? classId : "";
  const rows = useMemo(() => {
    const needle = searchable(query.trim());
    return data.entries.filter(entry => {
      const raceClass = classesById.get(entry.classId);
      if (!raceClass) return false;
      if (selectedClassId && entry.classId !== selectedClassId) return false;
      return !needle || [entry.displayName, entry.organisationName, raceClass.name,
        entry.activeAssignment?.cardNumber].some(value => value && searchable(value).includes(needle));
    }).sort((a, b) => {
      const classA = classesById.get(a.classId)!;
      const classB = classesById.get(b.classId)!;
      const classOrder = collator.compare(classA.name, classB.name);
      if (classOrder) return classOrder;
      if (classA.startRule === "FIXED") {
        if (a.fixedStartTime === null && b.fixedStartTime !== null) return 1;
        if (a.fixedStartTime !== null && b.fixedStartTime === null) return -1;
        if (a.fixedStartTime && b.fixedStartTime) {
          const timeOrder = Date.parse(a.fixedStartTime) - Date.parse(b.fixedStartTime);
          if (timeOrder) return timeOrder;
        }
      }
      return collator.compare(a.displayName, b.displayName) || collator.compare(a.id, b.id);
    });
  }, [classesById, data.entries, query, selectedClassId]);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  function start(entry: Entry, raceClass: RaceClass) {
    if (raceClass.startRule === "PUNCH") return text.freeStart;
    if (!entry.fixedStartTime) return <strong className={styles.attention}>{text.missingTime}</strong>;
    return <time dateTime={entry.fixedStartTime}>{formatClockTime(entry.fixedStartTime, data.timeZone)}</time>;
  }

  return <section className={styles.workspace} aria-label={text.title}>
    <div className={styles.heading}>
      <h2>{text.title}</h2>
    </div>
    <p className={styles.notice}>{text.privateNotice}</p>
    <div className={styles.filters}>
      <label>{text.search}<input type="search" autoComplete="off" value={query} disabled={disabled}
        onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
      <label>{text.classFilter}<select value={selectedClassId} disabled={disabled}
        onChange={event => { setClassId(event.target.value); setPage(0); }}>
        <option value="">{text.allClasses}</option>
        {data.classes.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>
      <p className={styles.count} aria-live="polite">{text.shown(visible.length, rows.length, data.entries.length)}</p>
    </div>
    {rows.length === 0 ? <p>{data.entries.length === 0 ? text.empty : text.noMatches}</p>
      : <><div className={styles.tableScroll}><table className={styles.table}>
        <thead><tr>
          <th scope="col">{text.className}</th><th scope="col">{text.plannedStart}</th>
          <th scope="col">{text.name}</th><th scope="col">{text.organisation}</th>
          <th scope="col">{text.card}</th>
        </tr></thead>
        <tbody>{visible.map(entry => {
          const raceClass = classesById.get(entry.classId)!;
          return <tr key={entry.id}>
            <td data-label={text.className}>{raceClass.name}</td>
            <td data-label={text.plannedStart} className={styles.start}>{start(entry, raceClass)}</td>
            <th scope="row" data-label={text.name}><button type="button" className={styles.person} disabled={disabled}
              aria-label={text.openPerson(entry.displayName)} onClick={() => onSelectEntry(entry.id)}>{entry.displayName}</button></th>
            <td data-label={text.organisation}>{entry.organisationName ?? text.noOrganisation}</td>
            <td data-label={text.card} className={entry.multipleActiveAssignments ? styles.attention : undefined}>
              {entry.multipleActiveAssignments ? text.multipleCards : entry.activeAssignment?.cardNumber ?? text.noCard}
            </td>
          </tr>;
        })}</tbody>
      </table></div>
      {pageCount > 1 && <div className={styles.pagination}>
        <button type="button" className="secondary" disabled={disabled || currentPage === 0}
          onClick={() => setPage(currentPage - 1)}>{text.previous}</button>
        <span>{text.page(currentPage + 1, pageCount)}</span>
        <button type="button" className="secondary" disabled={disabled || currentPage === pageCount - 1}
          onClick={() => setPage(currentPage + 1)}>{text.next}</button>
      </div>}
    </>}
  </section>;
}

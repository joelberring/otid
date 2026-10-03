"use client";

import { useEffect, useRef, useState } from "react";
import type { EntryTransferCandidates } from "@o-tid/contracts";
import { raceAdministratorSv as text } from "../i18n/race-administrator-sv";
import styles from "./race-administrator-workspace.module.css";
import detailStyles from "./race-workflow-detail.module.css";

export function RaceClassOverview({ data, disabled, onMissingFixedStart, onReturnToCourses, onOpenCourse, onOpenClass, onOpenParticipants, selectedClassId, selectionReason = "MISSING" }: {
  data: EntryTransferCandidates;
  disabled: boolean;
  onMissingFixedStart: (classId: string) => void;
  onReturnToCourses: () => void;
  onOpenCourse: (classId: string) => void;
  onOpenClass: (classId: string) => void;
  onOpenParticipants: (classId: string) => void;
  selectedClassId: string;
  selectionReason?: "MISSING" | "ASSIGNED" | "DIRECT";
}) {
  const [search, setSearch] = useState("");
  const selectedRow = useRef<HTMLTableRowElement>(null);
  useEffect(() => { selectedRow.current?.focus(); }, [selectedClassId]);
  const counts = new Map<string, { total: number; missingFixedStart: number }>();
  for (const entry of data.entries) {
    const count = counts.get(entry.classId) ?? { total: 0, missingFixedStart: 0 };
    count.total++;
    if (!entry.fixedStartTime) count.missingFixedStart++;
    counts.set(entry.classId, count);
  }
  const mismatches = data.classes.filter(row => (counts.get(row.id)?.total ?? 0) !== row.entryCount).length;
  const missingFixedStart = data.classes.reduce((sum, row) => sum + (row.startRule === "FIXED"
    ? counts.get(row.id)?.missingFixedStart ?? 0 : 0), 0);
  const withoutSpace = data.classes.filter(row => row.maxEntries !== null && row.entryCount >= row.maxEntries).length;
  const query = search.trim().toLocaleLowerCase("sv-SE");
  const visibleClasses = query ? data.classes.filter(row =>
    row.name.toLocaleLowerCase("sv-SE").includes(query) || row.courseName.toLocaleLowerCase("sv-SE").includes(query)) : data.classes;
  const selectedOrdinal = data.classes.findIndex(row => row.id === selectedClassId) + 1;

  return <div className={styles.panel}>
    <h2>{text.classOverviewTitle}</h2>
    {selectedOrdinal > 0 && selectionReason !== "DIRECT" && <div className={styles.classWarningContext}
      data-course-warning-context={selectionReason === "MISSING" ? "true" : undefined}
      data-course-class-context={selectionReason === "ASSIGNED" ? "true" : undefined}>
      <p>{selectionReason === "MISSING" ? text.classOverviewCourseWarningContext(selectedOrdinal)
        : text.classOverviewCourseAssignedContext(selectedOrdinal)}</p>
      <button type="button" className={styles.classWarningReturn} disabled={disabled}
        onClick={onReturnToCourses}>{text.classOverviewReturnToCourses}</button>
    </div>}
    <p className={mismatches ? styles.warning : styles.classOverviewSummary}>
      {mismatches ? text.classOverviewMismatchSummary(mismatches) : text.classOverviewSummary(missingFixedStart, withoutSpace)}
    </p>
    <div className={styles.classOverviewFinder}>
      <label className={styles.classOverviewSearch}>{text.classOverviewSearch}
        <input type="search" value={search} onChange={event => setSearch(event.target.value)} />
      </label>
      <p className={styles.classOverviewMatchCount} role="status" aria-live="polite">
        {text.classOverviewMatchCount(visibleClasses.length, data.classes.length)}
      </p>
    </div>
    {visibleClasses.length === 0 ? <p className={styles.classOverviewEmpty}>
      {data.classes.length === 0 ? text.classOverviewNoClasses : text.classOverviewNoMatches}
    </p> : <div className={styles.tableScroll}><table className={styles.classOverviewTable}><thead><tr>
      <th scope="col">{text.raceClass}</th><th scope="col">{text.classOverviewCourse}</th>
      <th scope="col">{text.classOverviewStartAndTime}</th><th scope="col">{text.capacityCount}</th>
    </tr></thead><tbody>{visibleClasses.map(row => {
      const count = counts.get(row.id) ?? { total: 0, missingFixedStart: 0 };
      const countMatches = count.total === row.entryCount;
      const selected = row.id === selectedClassId;
      const ordinal = data.classes.findIndex((raceClass) => raceClass.id === row.id) + 1;
      return <tr key={row.id} ref={selected ? selectedRow : undefined} tabIndex={selected ? -1 : undefined}
        data-selected={selected ? "true" : undefined} className={selected ? detailStyles.selectedClassRow : undefined}>
        <th scope="row"><button type="button" className={styles.classOverviewNameButton} disabled={disabled}
          aria-label={text.classOverviewSelectClass(ordinal, row.name)}
          onClick={() => onOpenClass(row.id)}>{row.name}</button>
          {selected && <span className={detailStyles.selectedClassMarker}>{text.classOverviewSelectedRow(ordinal)}</span>}
        </th>
        <td data-label={text.classOverviewCourse} className={styles.classCourseCell}>
          <button type="button" className={styles.classCourseLink} disabled={disabled}
            aria-label={text.classOverviewOpenCourse(ordinal, row.name, row.courseName, row.courseVersion)}
            onClick={() => onOpenCourse(row.id)}>{row.courseName} <span className={styles.classCourseVersion}>· {text.classOverviewVersion(row.courseVersion)}</span></button>
        </td>
        <td data-label={text.classOverviewStartAndTime}>{row.startRule === "FIXED" ? text.rosterFixedStart : text.classOverviewPunch}
          {" · "}{row.startRule === "PUNCH" ? text.classOverviewFreeStart
            : !countMatches ? <strong className={styles.classReadinessAttention}>{text.classOverviewCountMismatch}</strong>
            : row.entryCount === 0 ? text.classOverviewNoEntries
            : count.missingFixedStart === 0 ? text.classOverviewTimesReady
            : <button type="button" className={styles.classReadinessLink} disabled={disabled}
              aria-label={text.classOverviewOpenMissingTimes(row.name, count.missingFixedStart)}
              onClick={() => onMissingFixedStart(row.id)}>{text.classOverviewTimesMissing(count.missingFixedStart)}</button>}
        </td>
        <td data-label={text.capacityCount} className={styles.classParticipantCountCell}>
          <button type="button" className={styles.classParticipantCountButton} disabled={disabled}
            aria-label={text.classOverviewOpenParticipants(ordinal, row.name, row.entryCount)}
            onClick={() => onOpenParticipants(row.id)}>{row.entryCount}</button>
          {" / "}{row.maxEntries ?? text.unlimited}
          {row.maxEntries !== null && row.entryCount >= row.maxEntries &&
            <strong className={styles.classCapacityState}> · {row.maxEntries === 0 ? text.classOverviewClosed : text.classOverviewFull}</strong>}
          {!countMatches && <strong className={styles.classReadinessAttention}> · {text.classOverviewCountMismatch}</strong>}
        </td>
      </tr>;
    })}</tbody></table></div>}
  </div>;
}

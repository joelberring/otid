"use client";

import { useEffect, useRef, useState } from "react";
import { adminCourseControlGeometryStateResponseSchema, type AdminCourseControlGeometryStateResponse, type EntryTransferCandidates } from "@o-tid/contracts";
import { raceWorkflowDetailSv as text } from "../i18n/race-workflow-detail-sv";
import styles from "./race-workflow-detail.module.css";

type RaceClass = EntryTransferCandidates["classes"][number];
type LoadState =
  | { status: "loading"; raceId: string }
  | { status: "loaded"; raceId: string; data: AdminCourseControlGeometryStateResponse }
  | { status: "unavailable"; raceId: string };

export function RaceCourseOverview({ raceId, classes, disabled, onOpenClass, onOpenAssignedClass, selectedCourseVersionId }: {
  raceId: string;
  classes: RaceClass[];
  disabled: boolean;
  onOpenClass: (classId: string) => void;
  onOpenAssignedClass: (classId: string) => void;
  selectedCourseVersionId?: string | undefined;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading", raceId });
  const [reloadNumber, setReloadNumber] = useState(0);
  const [search, setSearch] = useState({ raceId, value: "" });
  const selectedDetails = useRef<HTMLDetailsElement>(null);
  const focusedSelection = useRef("");

  useEffect(() => {
    setSearch({ raceId, value: "" });
  }, [raceId]);

  useEffect(() => {
    if (selectedCourseVersionId) setSearch({ raceId, value: "" });
  }, [raceId, selectedCourseVersionId]);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading", raceId });
    void (async () => {
      try {
        const response = await fetch(`/api/admin/races/${encodeURIComponent(raceId)}/course-control-geometries`, {
          credentials: "same-origin", cache: "no-store", signal: controller.signal
        });
        const parsed = adminCourseControlGeometryStateResponseSchema.safeParse(await response.json());
        if (!response.ok || !parsed.success || parsed.data.raceId !== raceId) {
          if (!controller.signal.aborted) setState({ status: "unavailable", raceId });
          return;
        }
        if (!controller.signal.aborted) setState({ status: "loaded", raceId, data: parsed.data });
      } catch {
        if (!controller.signal.aborted) setState({ status: "unavailable", raceId });
      }
    })();
    return () => controller.abort();
  }, [raceId, reloadNumber]);

  const current = state.raceId === raceId ? state : { status: "loading" as const, raceId };
  const referencedCourseIds = new Set(classes.map((raceClass) => raceClass.courseVersionId));
  const courses = current.status === "loaded" ? current.data.courses.filter((course) => referencedCourseIds.has(course.courseVersionId)) : [];
  const targetMatches = selectedCourseVersionId
    ? courses.filter((course) => course.courseVersionId === selectedCourseVersionId).length : 0;
  useEffect(() => {
    if (!selectedCourseVersionId || current.status !== "loaded") {
      focusedSelection.current = "";
      return;
    }
    if (targetMatches !== 1) return;
    const selection = `${raceId}:${selectedCourseVersionId}`;
    if (focusedSelection.current === selection || !selectedDetails.current) return;
    selectedDetails.current.open = true;
    selectedDetails.current.querySelector("summary")?.focus();
    focusedSelection.current = selection;
  }, [raceId, selectedCourseVersionId, current, targetMatches]);
  const searchValue = search.raceId === raceId ? search.value : "";
  const searchPhrase = searchValue.trim().toLocaleLowerCase("sv-SE");
  const visibleCourses = searchPhrase === "" ? courses : courses.filter((course) =>
    course.courseName.toLocaleLowerCase("sv-SE").includes(searchPhrase) ||
    classes.some((raceClass) => raceClass.courseVersionId === course.courseVersionId &&
      raceClass.name.toLocaleLowerCase("sv-SE").includes(searchPhrase))
  );
  const availableCourseIds = new Set(current.status === "loaded" ? current.data.courses.map((course) => course.courseVersionId) : []);
  const missingClasses = current.status === "loaded" ? classes.filter((raceClass) => !availableCourseIds.has(raceClass.courseVersionId)) : [];
  const classIdentity = (raceClass: RaceClass) => JSON.stringify([raceClass.name, raceClass.courseName, raceClass.courseVersion]);
  const identityCounts = new Map<string, number>();
  const classNameCounts = new Map<string, number>();
  for (const raceClass of classes) {
    const identity = classIdentity(raceClass);
    identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);
    classNameCounts.set(raceClass.name, (classNameCounts.get(raceClass.name) ?? 0) + 1);
  }
  const missingClassRows = missingClasses.map((raceClass) => {
    const ordinal = classes.findIndex((row) => row.id === raceClass.id) + 1;
    const description = text.courseOverviewMissingClass(raceClass.name, raceClass.courseName, raceClass.courseVersion);
    return <li key={raceClass.id}>
      <button type="button" className={styles.courseMissingClassButton} disabled={disabled}
        aria-label={text.courseOverviewOpenClassLabel(ordinal, description)} onClick={() => onOpenClass(raceClass.id)}>
        <span>{description}</span>
        {(identityCounts.get(classIdentity(raceClass)) ?? 0) > 1 &&
          <span className={styles.courseMissingOrdinal}>{text.courseOverviewClassRow(ordinal)}</span>}
        <span className={styles.courseMissingOpen}>{text.courseOverviewOpenClass}</span>
      </button>
    </li>;
  });

  return <section className={styles.panel} aria-labelledby="race-course-overview-title">
    <header className={styles.sectionHeader}>
      <div><h2 id="race-course-overview-title">{text.courseOverviewTitle}</h2></div>
      <button type="button" className="secondary" disabled={current.status === "loading"}
        onClick={() => { setState({ status: "loading", raceId }); setReloadNumber((value) => value + 1); }}>{text.courseRefresh}</button>
    </header>
    {current.status === "loading" ? <p role="status">{text.courseOverviewLoading}</p> : null}
    {current.status === "unavailable" ? <p role="status">{text.courseOverviewUnavailable}</p> : null}
    {current.status === "loaded" ? <>
      {classes.length === 0 ? <p className={styles.empty}>{text.courseOverviewEmpty}</p> : null}
      {selectedCourseVersionId && targetMatches !== 1 ?
        <p role="status" className={styles.empty}>{text.courseOverviewTargetUnavailable}</p> : null}
      {missingClasses.length > 0 && missingClasses.length <= 3 ?
        <div className={styles.courseMissing} role="status">
          <p>{text.courseOverviewMissingCount(missingClasses.length)}</p>
          <ul className={styles.courseMissingList}>{missingClassRows}</ul>
        </div> : null}
      {missingClasses.length > 3 ? <details className={styles.courseMissing}>
        <summary className={styles.courseMissingSummary}>
          {text.courseOverviewMissingCount(missingClasses.length)} {text.courseOverviewShowMissingClasses}
        </summary>
        <ul className={styles.courseMissingList}>{missingClassRows}</ul>
      </details> : null}
      {courses.length >= 8 || searchValue.length > 0 ? <div className={styles.courseSearch}>
        <label htmlFor="race-course-search">{text.courseOverviewSearchLabel}</label>
        <input id="race-course-search" type="search" value={searchValue}
          onChange={(event) => setSearch({ raceId, value: event.target.value })} />
        <p className={styles.courseMatchCount} role="status">{text.courseOverviewMatchCount(visibleCourses.length, courses.length)}</p>
      </div> : null}
      {searchPhrase !== "" && visibleCourses.length === 0 ?
        <p className={styles.empty}>{text.courseOverviewNoMatch}</p> : null}
      {visibleCourses.length > 0 ? <ul className={styles.courseList}>
        {visibleCourses.map((course) => {
          const assignedClasses = classes.filter((raceClass) => raceClass.courseVersionId === course.courseVersionId);
          const controls = [...course.controls].sort((left, right) => left.sequence - right.sequence);
          return <li key={course.courseVersionId} className={styles.courseItem}>
            <details ref={targetMatches === 1 && course.courseVersionId === selectedCourseVersionId ? selectedDetails : undefined}
              className={styles.courseDisclosure}>
              <summary className={styles.courseSummary}>
                <h3 className={styles.courseHeading} aria-label={course.courseName}>
                  <span className={styles.courseName}>{course.courseName}</span>
                  <span className={styles.courseMeta}>{text.courseVersionNumber} {course.version} · {text.courseControls} {controls.length}</span>
                </h3>
              </summary>
              <div className={styles.courseDetails}>
                {controls.length === 0 ? <p className={styles.empty}>{text.courseNoControls}</p> :
                  <ol className={styles.controlSequence}>{controls.map((control) => <li key={control.courseControlId}>
                    <span>{control.sequence}.</span><strong>{control.controlCode}</strong>
                  </li>)}</ol>}
              </div>
            </details>
            <div className={styles.courseAssignment}>
              <strong>{text.courseAssignedClasses}:</strong>
              <span className={styles.courseAssignedLinks}>{assignedClasses.map((raceClass) => {
                const ordinal = classes.findIndex((row) => row.id === raceClass.id) + 1;
                return <button key={raceClass.id} type="button" className={styles.courseAssignedClassButton}
                  disabled={disabled} aria-label={text.courseOverviewOpenAssignedClassLabel(ordinal, raceClass.name)}
                  onClick={() => onOpenAssignedClass(raceClass.id)}>
                  {raceClass.name}{(classNameCounts.get(raceClass.name) ?? 0) > 1 &&
                    <span className={styles.courseMissingOrdinal}> · {text.courseOverviewClassRow(ordinal)}</span>}
                </button>;
              })}</span>
            </div>
          </li>;
        })}
      </ul> : null}
    </> : null}
  </section>;
}

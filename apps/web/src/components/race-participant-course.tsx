"use client";

import { useEffect, useState } from "react";
import { adminCourseControlGeometryStateResponseSchema, type AdminCourseControlGeometryStateResponse, type EntryTransferCandidates } from "@o-tid/contracts";
import { raceWorkflowDetailSv as text } from "../i18n/race-workflow-detail-sv";
import styles from "./race-workflow-detail.module.css";

type RaceClass = EntryTransferCandidates["classes"][number];
type Course = AdminCourseControlGeometryStateResponse["courses"][number];
type LoadState = { context: string; status: "loading" | "unavailable" } |
  { context: string; status: "loaded"; course: Course };

export function RaceParticipantCourse({ raceId, snapshotVersion, raceClass, disabled, onUnauthorized, onOpenCourse }: {
  raceId: string;
  snapshotVersion: number;
  raceClass: RaceClass;
  disabled: boolean;
  onUnauthorized: () => void;
  onOpenCourse: (courseVersionId: string) => void;
}) {
  const { id: classId, courseVersionId, courseName, courseVersion } = raceClass;
  const context = JSON.stringify([raceId, snapshotVersion, classId, courseVersionId, courseName, courseVersion]);
  const [state, setState] = useState<LoadState>({ context, status: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    let active = true;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
    setState({ context, status: "loading" });
    void (async () => {
      try {
        const response = await fetch(`/api/admin/races/${encodeURIComponent(raceId)}/course-control-geometries`, {
          credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal
        });
        if (!active) return;
        if (controller.signal.aborted) throw new Error("Aborted course read");
        if (response.status === 401 || response.status === 403) {
          setState({ context, status: "unavailable" });
          onUnauthorized();
          return;
        }
        if (!response.ok || response.redirected) throw new Error("Course unavailable");
        const parsed = adminCourseControlGeometryStateResponseSchema.safeParse(await response.json());
        if (!active) return;
        if (controller.signal.aborted) throw new Error("Aborted course read");
        if (!parsed.success || parsed.data.raceId !== raceId) throw new Error("Course scope mismatch");
        const matches = parsed.data.courses.filter((course) => course.courseVersionId === courseVersionId);
        const course = matches[0];
        if (matches.length !== 1 || !course || course.courseName !== courseName || course.version !== courseVersion) {
          throw new Error("Assigned course mismatch");
        }
        const controls = [...course.controls].sort((left, right) => left.sequence - right.sequence);
        if (new Set(controls.map((control) => control.courseControlId)).size !== controls.length ||
          controls.some((control, index) => control.sequence !== index + 1)) throw new Error("Invalid control order");
        setState({ context, status: "loaded", course: { ...course, controls } });
      } catch {
        if (active && (!controller.signal.aborted || timedOut)) setState({ context, status: "unavailable" });
      } finally {
        window.clearTimeout(timer);
      }
    })();
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [context, raceId, courseVersionId, courseName, courseVersion, retry, onUnauthorized]);

  const current = state.context === context ? state : { context, status: "loading" as const };
  return <section className={`${styles.panel} ${styles.participantCourse}`} aria-labelledby="race-participant-course-title">
    <header className={styles.sectionHeader}>
      <h2 id="race-participant-course-title">{text.assignedCourseTitle}</h2>
      <button type="button" className={`secondary ${styles.participantCourseRefresh}`}
        disabled={disabled || current.status === "loading"}
        onClick={() => { setState({ context, status: "loading" }); setRetry((value) => value + 1); }}>
        {text.assignedCourseRetry}
      </button>
    </header>
    <p className={styles.historicalNote}>{text.assignedCourseSource(snapshotVersion)}</p>
    <div className={styles.participantCourseIdentity}>
      <p className={styles.participantCourseName}><strong>{courseName}</strong> · {text.courseVersionNumber} {courseVersion}</p>
      <button type="button" className={styles.participantCourseOpen} disabled={disabled}
        onClick={() => onOpenCourse(courseVersionId)}>{text.assignedCourseOpen}</button>
    </div>
    {current.status === "loading" && <p role="status">{text.assignedCourseLoading}</p>}
    {current.status === "unavailable" && <p role="status">{text.assignedCourseUnavailable}</p>}
    {current.status === "loaded" && <ol className={styles.controlSequence} aria-label={text.assignedCourseControls}>
      {current.course.controls.map((control) => <li key={control.courseControlId}>
        <span>{control.sequence}.</span><strong>{control.controlCode}</strong>
      </li>)}
    </ol>}
  </section>;
}

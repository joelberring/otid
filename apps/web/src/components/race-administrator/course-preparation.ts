import { useState, type FormEvent } from "react";
import { manualCourseClassCreateResponseSchema } from "@o-tid/contracts";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { parseControlCodes, type CourseClassAttempt, type CourseClassRequest } from "./types";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";

/** Förberedelse av banor: ny bana med klass. Ändring av en befintlig bana finns i course-edit.ts. */
export function useCoursePreparationState() {
  const [courseName, setCourseName] = useState("");
  const [courseClassName, setCourseClassName] = useState("");
  const [courseStartRule, setCourseStartRule] = useState<CourseClassRequest["startRule"]>("PUNCH");
  const [courseControls, setCourseControls] = useState("");
  const [courseClassAttempt, setCourseClassAttempt] = useState<CourseClassAttempt>();
  const [courseClassError, setCourseClassError] = useState("");
  return { courseName, setCourseName, courseClassName, setCourseClassName, courseStartRule, setCourseStartRule, courseControls,
    setCourseControls, courseClassAttempt, setCourseClassAttempt, courseClassError,
    setCourseClassError };
}

export function createCoursePreparationActions(ws: Base & RaceDataActions) {
  const { raceId, data, courseName, courseClassName, courseControls, courseStartRule, busyRef, pending, sent, requireSession,
    begin, finish, current, request, json, csrf, load, setMessage, setCourseClassError,
    setCourseClassAttempt, setCourseName, setCourseClassName, setCourseControls } = ws;
  /** Ny bana med klass ändrar inga resultat: sparas direkt utan granskningssteg (ADR-0169 beslut 4). */
  function saveCourseClass(event: FormEvent) {
    event.preventDefault();
    setCourseClassError("");
    const course = courseName.trim(), raceClass = courseClassName.trim();
    const codes = parseControlCodes(courseControls);
    if (!course || course.length > 160 || !raceClass || raceClass.length > 160) {
      setCourseClassError(text.courseClassInvalidName); return;
    }
    if (!codes) {
      setCourseClassError(text.courseClassInvalidControls); return;
    }
    if (!data) { setCourseClassError(text.courseClassUnavailable); return; }
    const request: CourseClassRequest = { formatVersion: 1, requestId: crypto.randomUUID(),
      expectedSnapshotVersion: data.snapshotVersion, courseName: course, className: raceClass,
      // ADR-0170: typer utan val av startsätt (Träning, Rogaining) har alltid fri start.
      startRule: ws.profile.features.startRuleChoice ? courseStartRule : "PUNCH", controlCodes: codes };
    const value = { kind: "COURSE_CLASS" as const, request };
    pending.current = value; sent.current = false; setCourseClassAttempt(value); void submitCourseClass(value);
  }
  async function submitCourseClass(value: CourseClassAttempt) {
    if (busyRef.current || !requireSession() || (pending.current && pending.current !== value)) return;
    const op = begin();
    let committed = false;
    try {
      const token = csrf();
      const response = await request("/course-classes", op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `manual-course-class-create:${value.request.requestId}` },
        body: JSON.stringify(value.request) });
      if ([400, 409].includes(response.status)) {
        pending.current = undefined; sent.current = false; setCourseClassAttempt(undefined);
        setCourseClassError(text.courseClassRejected); return;
      }
      if (!response.ok) throw new Error("Course class unavailable");
      const receipt = manualCourseClassCreateResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.requestId !== value.request.requestId ||
        receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion ||
        JSON.stringify(receipt.request) !== JSON.stringify(value.request)) throw new Error("Course class receipt mismatch");
      committed = true;
      pending.current = undefined; sent.current = false; setCourseClassAttempt(undefined); setCourseClassError("");
      setCourseName(""); setCourseClassName(""); setCourseControls(""); setMessage(text.courseClassSaved);
      await load(op);
    } catch {
      if (current(op)) {
        if (committed) { setCourseClassError(text.courseClassSavedLoadError); setMessage(text.courseClassSavedLoadError); }
        else { pending.current = value; sent.current = true; setCourseClassAttempt(value); setCourseClassError(text.unreachable); }
      }
    } finally { finish(op); }
  }
  return { saveCourseClass, submitCourseClass };
}
export type CoursePreparationActions = ReturnType<typeof createCoursePreparationActions>;

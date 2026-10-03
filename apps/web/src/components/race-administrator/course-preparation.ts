import { useState, type FormEvent } from "react";
import { manualCourseClassCreateResponseSchema, manualCourseResultImpactResponseSchema,
  manualCourseVersionClassRelinkPreviewSchema, manualCourseVersionClassRelinkRequestSchema,
  manualCourseVersionClassRelinkResponseSchema, type ManualCourseResultImpactResponse,
  type ManualCourseVersionClassRelinkPreview } from "@o-tid/contracts";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { parseControlCodes, type CourseClassAttempt, type CourseClassRequest, type CourseVersionRelinkAttempt } from "./types";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";

/** Förberedelse av banor: ny bana med klass, ny banversion för en klass och påverkan på resultat. */
export function useCoursePreparationState() {
  const [courseName, setCourseName] = useState("");
  const [courseClassName, setCourseClassName] = useState("");
  const [courseStartRule, setCourseStartRule] = useState<CourseClassRequest["startRule"]>("PUNCH");
  const [courseControls, setCourseControls] = useState("");
  const [courseClassReview, setCourseClassReview] = useState<CourseClassRequest>();
  const [courseClassAttempt, setCourseClassAttempt] = useState<CourseClassAttempt>();
  const [courseClassError, setCourseClassError] = useState("");
  const [courseRelinkClassId, setCourseRelinkClassId] = useState("");
  const [courseRelinkPreview, setCourseRelinkPreview] = useState<ManualCourseVersionClassRelinkPreview>();
  const [courseRelinkControls, setCourseRelinkControls] = useState("");
  const [courseRelinkConfirmed, setCourseRelinkConfirmed] = useState(false);
  const [courseRelinkAttempt, setCourseRelinkAttempt] = useState<CourseVersionRelinkAttempt>();
  const [courseRelinkError, setCourseRelinkError] = useState("");
  const [courseResultImpactClassId, setCourseResultImpactClassId] = useState("");
  const [courseResultImpact, setCourseResultImpact] = useState<ManualCourseResultImpactResponse>();
  const [courseResultImpactError, setCourseResultImpactError] = useState("");
  return { courseName, setCourseName, courseClassName, setCourseClassName, courseStartRule, setCourseStartRule, courseControls,
    setCourseControls, courseClassReview, setCourseClassReview, courseClassAttempt, setCourseClassAttempt, courseClassError,
    setCourseClassError, courseRelinkClassId, setCourseRelinkClassId, courseRelinkPreview, setCourseRelinkPreview,
    courseRelinkControls, setCourseRelinkControls, courseRelinkConfirmed, setCourseRelinkConfirmed, courseRelinkAttempt,
    setCourseRelinkAttempt, courseRelinkError, setCourseRelinkError, courseResultImpactClassId, setCourseResultImpactClassId,
    courseResultImpact, setCourseResultImpact, courseResultImpactError, setCourseResultImpactError };
}

export function createCoursePreparationActions(ws: Base & RaceDataActions) {
  const { raceId, data, courseName, courseClassName, courseControls, courseStartRule, courseRelinkClassId, courseRelinkPreview,
    courseRelinkConfirmed, courseRelinkControls, courseResultImpactClassId, busyRef, pending, sent, requireSession, begin,
    finish, current, request, json, csrf, load, setMessage, setUnknown, setData, setCourseClassError, setCourseClassReview,
    setCourseClassAttempt, setCourseName, setCourseClassName, setCourseControls, setCourseRelinkPreview, setCourseRelinkError,
    setCourseRelinkConfirmed, setCourseRelinkControls, setCourseRelinkAttempt, setCourseResultImpact,
    setCourseResultImpactError } = ws;
  function inspectCourseClass(event: FormEvent) {
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
      startRule: courseStartRule, controlCodes: codes };
    setCourseClassReview(request); setCourseClassAttempt(undefined);
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
      if ([400, 409].includes(response.status)) throw new Error("Course class conflict");
      if (!response.ok) throw new Error("Course class unavailable");
      const receipt = manualCourseClassCreateResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.requestId !== value.request.requestId ||
        receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion ||
        JSON.stringify(receipt.request) !== JSON.stringify(value.request)) throw new Error("Course class receipt mismatch");
      committed = true;
      pending.current = undefined; sent.current = false; setCourseClassAttempt(undefined); setCourseClassReview(undefined); setCourseClassError("");
      setCourseName(""); setCourseClassName(""); setCourseControls(""); setMessage(text.courseClassSaved);
      await load(op);
    } catch {
      if (current(op)) {
        if (committed) { setCourseClassError(text.courseClassSavedLoadError); setMessage(text.courseClassSavedLoadError); }
        else { pending.current = value; sent.current = true; setCourseClassAttempt(value); setCourseClassError(text.courseClassUnknown); }
      }
    } finally { finish(op); }
  }
  /** Granskning bekräftad: försöket blir väntande och skickas direkt. */
  function confirmCourseClass(review: CourseClassRequest) {
    const value = { kind: "COURSE_CLASS" as const, request: review };
    pending.current = value; sent.current = false; setCourseClassAttempt(value); void submitCourseClass(value);
  }
  async function loadCourseVersionRelinkPreview() {
    if (busyRef.current || pending.current || !requireSession() || !courseRelinkClassId) return;
    setCourseRelinkPreview(undefined); setCourseRelinkError(""); setCourseRelinkConfirmed(false); setCourseRelinkControls("");
    const op = begin();
    try {
      const response = await request(`/classes/${courseRelinkClassId}/course-version-link`, op);
      if (!response.ok) throw new Error("Course version preview unavailable");
      const value = manualCourseVersionClassRelinkPreviewSchema.parse(await json(response, op));
      if (value.raceId !== raceId || value.classId !== courseRelinkClassId) throw new Error("Course version preview scope mismatch");
      setCourseRelinkControls(value.controlCodes.join(", ")); setCourseRelinkPreview(value);
    } catch { if (current(op)) setCourseRelinkError(text.courseRelinkLoadError); }
    finally { finish(op); }
  }
  async function loadCourseResultImpact() {
    if (busyRef.current || pending.current || !requireSession() || !courseResultImpactClassId) return;
    setCourseResultImpact(undefined); setCourseResultImpactError("");
    const op = begin();
    try {
      const response = await request(`/classes/${courseResultImpactClassId}/course-result-impact`, op);
      if (!response.ok) throw new Error("Course result impact unavailable");
      const value = manualCourseResultImpactResponseSchema.parse(await json(response, op));
      if (value.raceId !== raceId || value.classId !== courseResultImpactClassId) throw new Error("Course result impact scope mismatch");
      setCourseResultImpact(value);
    } catch { if (current(op)) setCourseResultImpactError(text.courseResultImpactLoadError); }
    finally { finish(op); }
  }
  function inspectCourseVersionRelink(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || pending.current || !requireSession() || !courseRelinkPreview || !courseRelinkConfirmed) return;
    const codes = parseControlCodes(courseRelinkControls);
    if (!codes) {
      setCourseRelinkError(text.courseRelinkInvalidControls); return;
    }
    const parsed = manualCourseVersionClassRelinkRequestSchema.safeParse({ formatVersion: 1, requestId: crypto.randomUUID(),
      expectedSnapshotVersion: courseRelinkPreview.snapshotVersion, courseId: courseRelinkPreview.courseId,
      classId: courseRelinkPreview.classId, expectedClassCourseVersionId: courseRelinkPreview.classCourseVersionId,
      controlCodes: codes });
    if (!parsed.success) { setCourseRelinkError(text.courseRelinkInvalidControls); return; }
    const value: CourseVersionRelinkAttempt = { kind: "COURSE_VERSION_RELINK", preview: courseRelinkPreview, request: parsed.data };
    pending.current = value; sent.current = false; setCourseRelinkAttempt(value); setCourseRelinkError("");
  }
  async function submitCourseVersionRelink(value: CourseVersionRelinkAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current; let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/classes/${value.preview.classId}/course-version-link`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token,
          "idempotency-key": `manual-course-version-link:${value.request.requestId}` }, body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setCourseRelinkError(text.courseRelinkUnknown); return; }
        pending.current = undefined; sent.current = false; setCourseRelinkAttempt(undefined); setCourseRelinkPreview(undefined);
        setCourseRelinkConfirmed(false); setCourseRelinkError(response.status === 409 ? text.courseRelinkConflict : text.courseRelinkBlocked); return;
      }
      if (!response.ok) throw new Error("Unknown course version outcome");
      const receipt = manualCourseVersionClassRelinkResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.classId !== value.preview.classId || receipt.courseId !== value.request.courseId ||
        receipt.requestId !== value.request.requestId || receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion ||
        receipt.previousCourseVersionId !== value.request.expectedClassCourseVersionId || JSON.stringify(receipt.request) !== JSON.stringify(value.request)) {
        throw new Error("Course version receipt mismatch");
      }
      committed = true; pending.current = undefined; sent.current = false; setCourseRelinkAttempt(undefined);
      setCourseRelinkPreview(undefined); setCourseRelinkConfirmed(false); setCourseRelinkControls(""); setUnknown(false);
      setData(undefined); setMessage(text.courseRelinkSaved); await load(op);
    } catch { if (current(op)) setCourseRelinkError(committed ? text.courseRelinkSavedLoadError : text.courseRelinkUnknown); }
    finally { finish(op); }
  }
  return { inspectCourseClass, submitCourseClass, confirmCourseClass, loadCourseVersionRelinkPreview, loadCourseResultImpact,
    inspectCourseVersionRelink, submitCourseVersionRelink };
}
export type CoursePreparationActions = ReturnType<typeof createCoursePreparationActions>;

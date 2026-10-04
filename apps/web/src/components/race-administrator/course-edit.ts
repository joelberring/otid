import { useState } from "react";
import { courseEditListResponseSchema, courseEditPreviewResponseSchema, courseEditResponseSchema,
  type CourseEditListResponse, type CourseEditPreviewResponse, type CourseEditRequest } from "@o-tid/contracts";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { parseControlCodes, type CourseEditAttempt, type Operation } from "./types";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";

/** Redigera bana (ADR-0169): banlistan, öppen redigering, besked och sparande. */
export function useCourseEditState() {
  const [courseList, setCourseList] = useState<CourseEditListResponse>();
  const [courseListError, setCourseListError] = useState("");
  const [editingCourseId, setEditingCourseId] = useState("");
  // Gafflad bana: varianten som redigeras ("" = banan saknar varianter).
  const [editingVariantCode, setEditingVariantCode] = useState("");
  const [courseEditControls, setCourseEditControls] = useState("");
  const [courseEditPreview, setCourseEditPreview] = useState<CourseEditPreviewResponse>();
  const [courseEditError, setCourseEditError] = useState("");
  const [courseEditSaved, setCourseEditSaved] = useState("");
  const [courseEditAttempt, setCourseEditAttempt] = useState<CourseEditAttempt>();
  return { courseList, setCourseList, courseListError, setCourseListError, editingCourseId, setEditingCourseId,
    editingVariantCode, setEditingVariantCode,
    courseEditControls, setCourseEditControls, courseEditPreview, setCourseEditPreview, courseEditError, setCourseEditError,
    courseEditSaved, setCourseEditSaved, courseEditAttempt, setCourseEditAttempt };
}

const sameCodes = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length && left.every((code, index) => code === right[index]);

export function createCourseEditActions(ws: Base & RaceDataActions) {
  const { raceId, courseList, editingCourseId, editingVariantCode, setEditingVariantCode, courseEditControls, courseEditPreview, busyRef, pending, sent, requireSession,
    begin, finish, current, request, json, csrf, load, setCourseList, setCourseListError, setEditingCourseId,
    setCourseEditControls, setCourseEditPreview, setCourseEditError, setCourseEditSaved, setCourseEditAttempt } = ws;

  async function readCourses(op: Operation) {
    const response = await request("/courses", op);
    if (!response.ok) throw new Error("Course list unavailable");
    const value = courseEditListResponseSchema.parse(await json(response, op));
    if (value.raceId !== raceId) throw new Error("Course list scope mismatch");
    setCourseList(value); setCourseListError("");
    return value;
  }
  async function loadCourses() {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = begin();
    try { await readCourses(op); }
    catch { if (current(op)) setCourseListError(text.courseEditListError); }
    finally { finish(op); }
  }
  /** Öppnar redigeringen för en bana, eller för en variant av en gafflad bana. */
  function startCourseEdit(courseId: string, variantCode = "") {
    if (busyRef.current || pending.current) return;
    const course = courseList?.courses.find(row => row.courseId === courseId);
    const variant = course?.variants.find(row => row.code === variantCode);
    if (!course || (variantCode !== "" && !variant)) return;
    setEditingCourseId(courseId); setEditingVariantCode(variantCode);
    setCourseEditControls((variant?.controlCodes ?? course.controlCodes).join(" "));
    setCourseEditPreview(undefined); setCourseEditError(""); setCourseEditSaved("");
  }
  function cancelCourseEdit() {
    if (pending.current) return;
    setEditingCourseId(""); setEditingVariantCode(""); setCourseEditControls(""); setCourseEditPreview(undefined); setCourseEditError("");
  }
  function changeCourseEditControls(value: string) {
    setCourseEditControls(value); setCourseEditPreview(undefined); setCourseEditError("");
  }
  /** Kontrollerar fältet. Ger koderna eller visar vad som är fel. */
  function proposedCodes(): number[] | undefined {
    const course = courseList?.courses.find(row => row.courseId === editingCourseId);
    const codes = parseControlCodes(courseEditControls);
    if (!course || !codes) { setCourseEditError(text.courseEditInvalidControls); return undefined; }
    const current = editingVariantCode ? course.variants.find(row => row.code === editingVariantCode)?.controlCodes : course.controlCodes;
    if (current && sameCodes(current, codes)) { setCourseEditError(text.courseEditUnchanged); return undefined; }
    return codes;
  }
  async function readPreview(op: Operation, codes: number[]) {
    if (!courseList) throw new Error("Course list missing");
    const response = await request(`/courses/${editingCourseId}/edit-preview`, op, { method: "POST",
      headers: { "content-type": "application/json", "x-otid-csrf": csrf() },
      body: JSON.stringify({ formatVersion: 1, expectedSnapshotVersion: courseList.snapshotVersion, controlCodes: codes,
        ...(editingVariantCode ? { variantCode: editingVariantCode } : {}) }) });
    if (response.status === 409) return "conflict" as const;
    if (!response.ok) throw new Error("Course edit preview unavailable");
    const value = courseEditPreviewResponseSchema.parse(await json(response, op));
    if (value.raceId !== raceId || value.courseId !== editingCourseId || !sameCodes(value.controlCodes, codes) ||
        (value.variantCode ?? "") !== editingVariantCode) {
      throw new Error("Course edit preview scope mismatch");
    }
    setCourseEditPreview(value);
    return value;
  }
  /** Tävlingen har ändrats under tiden: läs om banorna och be om ett nytt besked. */
  async function staleCourseList(op: Operation) {
    setCourseEditPreview(undefined); setCourseEditError(text.courseEditConflict);
    await readCourses(op);
  }
  async function previewCourseEdit() {
    if (busyRef.current || pending.current || !requireSession()) return;
    setCourseEditError(""); setCourseEditSaved("");
    const codes = proposedCodes();
    if (!codes) return;
    const op = begin();
    try { if (await readPreview(op, codes) === "conflict") await staleCourseList(op); }
    catch { if (current(op)) setCourseEditError(text.courseEditPreviewError); }
    finally { finish(op); }
  }
  async function send(op: Operation, attempt: CourseEditAttempt) {
    sent.current = true;
    const response = await request(`/courses/${attempt.request.courseId}/edit`, op, { method: "POST",
      headers: { "content-type": "application/json", "x-otid-csrf": csrf(), "idempotency-key": `course-edit:${attempt.request.requestId}` },
      body: JSON.stringify(attempt.request) });
    if (response.status === 409 || response.status === 400 || response.status === 404) {
      pending.current = undefined; sent.current = false; setCourseEditAttempt(undefined);
      if (response.status === 409) await staleCourseList(op);
      else setCourseEditError(text.courseEditRejected);
      return;
    }
    if (!response.ok) throw new Error("Unknown course edit outcome");
    const receipt = courseEditResponseSchema.parse(await json(response, op));
    if (receipt.raceId !== raceId || receipt.requestId !== attempt.request.requestId ||
        JSON.stringify(receipt.request) !== JSON.stringify(attempt.request)) throw new Error("Course edit receipt mismatch");
    pending.current = undefined; sent.current = false; setCourseEditAttempt(undefined);
    setEditingCourseId(""); setEditingVariantCode(""); setCourseEditControls(""); setCourseEditPreview(undefined); setCourseEditError("");
    setCourseEditSaved(text.courseEditSaved(receipt.recalculated.length));
    try { await load(op); await readCourses(op); }
    catch { if (current(op)) setCourseListError(text.courseEditSavedLoadError); }
  }
  /**
   * Sparar direkt om ingen löpares status ändras. Annars visas beskedet först och
   * ändringen sparas när arrangören trycker på "Spara ändringen" igen.
   */
  async function saveCourseEdit() {
    if (busyRef.current || !requireSession()) return;
    const waiting = pending.current;
    const retry = waiting && "kind" in waiting && waiting.kind === "COURSE_EDIT" ? waiting : undefined;
    if (pending.current && !retry) return;
    setCourseEditError(""); setCourseEditSaved("");
    const op = begin();
    try {
      let attempt = retry;
      if (!attempt) {
        const codes = proposedCodes();
        if (!codes || !courseList) return;
        let preview: CourseEditPreviewResponse | undefined = courseEditPreview;
        if (!preview || !sameCodes(preview.controlCodes, codes)) {
          const read = await readPreview(op, codes);
          if (read === "conflict") { await staleCourseList(op); return; }
          // Någon löpares status ändras: visa beskedet och vänta på bekräftelse.
          if (read.requiresConfirmation) return;
          preview = read;
        }
        const request: CourseEditRequest = { formatVersion: 1, requestId: crypto.randomUUID(),
          expectedSnapshotVersion: preview.snapshotVersion, courseId: editingCourseId, controlCodes: codes,
          ...(editingVariantCode ? { variantCode: editingVariantCode } : {}), confirmResultChanges: preview.requiresConfirmation };
        attempt = { kind: "COURSE_EDIT", request };
        pending.current = attempt; sent.current = false; setCourseEditAttempt(attempt);
      }
      await send(op, attempt);
    } catch { if (current(op)) setCourseEditError(pending.current ? text.unreachable : text.courseEditPreviewError); }
    finally { finish(op); }
  }
  return { readCourses, loadCourses, startCourseEdit, cancelCourseEdit, changeCourseEditControls, previewCourseEdit, saveCourseEdit };
}
export type CourseEditActions = ReturnType<typeof createCourseEditActions>;

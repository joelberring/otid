import { useState } from "react";
import { courseEditListResponseSchema, courseEditPreviewResponseSchema, courseEditResponseSchema,
  type CourseEditListResponse, type CourseEditPreviewResponse, type CourseEditRequest, type CourseForkingItem } from "@o-tid/contracts";
import { validateCourseForking } from "@o-tid/domain";
import { forkingSv } from "../../i18n/forking-sv";
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
  // Steg 49: gafflingsstrukturen som redigeras (undefined = kontrollföljden redigeras) och den som öppnades.
  const [courseEditForking, setCourseEditForking] = useState<CourseForkingItem[]>();
  const [courseEditForkingOriginal, setCourseEditForkingOriginal] = useState("");
  return { courseList, setCourseList, courseListError, setCourseListError, editingCourseId, setEditingCourseId,
    courseEditForking, setCourseEditForking, courseEditForkingOriginal, setCourseEditForkingOriginal,
    editingVariantCode, setEditingVariantCode,
    courseEditControls, setCourseEditControls, courseEditPreview, setCourseEditPreview, courseEditError, setCourseEditError,
    courseEditSaved, setCourseEditSaved, courseEditAttempt, setCourseEditAttempt };
}

const sameCodes = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length && left.every((code, index) => code === right[index]);

export function createCourseEditActions(ws: Base & RaceDataActions) {
  const { raceId, courseList, editingCourseId, editingVariantCode, setEditingVariantCode, courseEditControls, courseEditPreview, writingRef, pending, sent, requireSession,
    begin, finish, current, request, json, csrf, load, setCourseList, setCourseListError, setEditingCourseId,
    setCourseEditControls, setCourseEditPreview, setCourseEditError, setCourseEditSaved, setCourseEditAttempt,
    courseEditForking, setCourseEditForking, setCourseEditForkingOriginal } = ws;

  async function readCourses(op: Operation) {
    const response = await request("/courses", op);
    if (!response.ok) throw new Error("Course list unavailable");
    const value = courseEditListResponseSchema.parse(await json(response, op));
    if (value.raceId !== raceId) throw new Error("Course list scope mismatch");
    setCourseList(value); setCourseListError("");
    return value;
  }
  async function loadCourses() {
    if (writingRef.current || pending.current || !requireSession()) return;
    const op = begin();
    try { await readCourses(op); }
    catch { if (current(op)) setCourseListError(text.courseEditListError); }
    finally { finish(op); }
  }
  /** Öppnar redigeringen för en bana, eller för en variant av en gafflad bana. */
  function startCourseEdit(courseId: string, variantCode = "") {
    if (writingRef.current || pending.current) return;
    const course = courseList?.courses.find(row => row.courseId === courseId);
    const variant = course?.variants.find(row => row.code === variantCode);
    if (!course || (variantCode !== "" && !variant)) return;
    setEditingCourseId(courseId); setEditingVariantCode(variantCode); setCourseEditForking(undefined);
    setCourseEditControls((variant?.controlCodes ?? course.controlCodes).join(" "));
    setCourseEditPreview(undefined); setCourseEditError(""); setCourseEditSaved("");
  }
  /**
   * Steg 49: öppnar gafflingarna för en bana: den sparade eller härledda strukturen, eller banans kontroller som
   * grundföljd (en ny gafflad bana byggs från den).
   */
  function startForkingEdit(courseId: string) {
    if (writingRef.current || pending.current) return;
    const course = courseList?.courses.find(row => row.courseId === courseId);
    if (!course) return;
    const items: CourseForkingItem[] = course.forking ? course.forking.items.map(item => structuredClone(item))
      : course.controlCodes.map(code => ({ kind: "CONTROL" as const, code }));
    setEditingCourseId(courseId); setEditingVariantCode(""); setCourseEditControls("");
    setCourseEditForking(items); setCourseEditForkingOriginal(course.forking?.stored ? JSON.stringify(items) : "");
    setCourseEditPreview(undefined); setCourseEditError(""); setCourseEditSaved("");
  }
  function changeCourseEditForking(items: CourseForkingItem[]) {
    setCourseEditForking(items); setCourseEditPreview(undefined); setCourseEditError("");
  }
  function cancelCourseEdit() {
    if (pending.current) return;
    setEditingCourseId(""); setEditingVariantCode(""); setCourseEditControls(""); setCourseEditPreview(undefined); setCourseEditError("");
    setCourseEditForking(undefined); setCourseEditForkingOriginal("");
  }
  function changeCourseEditControls(value: string) {
    setCourseEditControls(value); setCourseEditPreview(undefined); setCourseEditError("");
  }
  /** Strukturen som prövas, eller undefined med ett besked om vad som saknas. */
  function proposedForking(): { items: CourseForkingItem[] } | undefined {
    if (!courseEditForking) return undefined;
    const problems = validateCourseForking({ items: courseEditForking });
    if (problems.length > 0) { setCourseEditError(forkingSv.problem(problems[0]!)); return undefined; }
    return { items: courseEditForking };
  }
  type Proposal = { codes: number[]; forking?: undefined } | { codes?: undefined; forking: { items: CourseForkingItem[] } };
  function proposal(): Proposal | undefined {
    if (courseEditForking) { const forking = proposedForking(); return forking && { forking }; }
    const codes = proposedCodes();
    return codes && { codes };
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
  async function readPreview(op: Operation, proposed: Proposal) {
    if (!courseList) throw new Error("Course list missing");
    const response = await request(`/courses/${editingCourseId}/edit-preview`, op, { method: "POST",
      headers: { "content-type": "application/json", "x-otid-csrf": csrf() },
      body: JSON.stringify({ formatVersion: 1, ...(proposed.forking ? { forking: proposed.forking } : { controlCodes: proposed.codes }),
        ...(editingVariantCode ? { variantCode: editingVariantCode } : {}) }) });
    if (response.status === 409) return "conflict" as const;
    // Steg 49: samma struktur som den sparade är ingen ändring.
    if (response.status === 400 && proposed.forking) { setCourseEditError(text.courseEditUnchanged); return "unchanged" as const; }
    if (!response.ok) throw new Error("Course edit preview unavailable");
    const value = courseEditPreviewResponseSchema.parse(await json(response, op));
    if (value.raceId !== raceId || value.courseId !== editingCourseId || (proposed.codes && !sameCodes(value.controlCodes, proposed.codes)) ||
        (proposed.forking && !value.forking && value.controlCodes.length === 0) ||
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
    if (writingRef.current || pending.current || !requireSession()) return;
    setCourseEditError(""); setCourseEditSaved("");
    const proposed = proposal();
    if (!proposed) return;
    const op = begin();
    try { if (await readPreview(op, proposed) === "conflict") await staleCourseList(op); }
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
    setCourseEditForking(undefined); setCourseEditForkingOriginal("");
    setCourseEditSaved(attempt.request.forking ? forkingSv.saved(receipt.recalculated.length) : text.courseEditSaved(receipt.recalculated.length));
    try { await load(op); await readCourses(op); }
    catch { if (current(op)) setCourseListError(text.courseEditSavedLoadError); }
  }
  /**
   * Sparar direkt om ingen löpares status ändras. Annars visas beskedet först och
   * ändringen sparas när arrangören trycker på "Spara ändringen" igen.
   */
  async function saveCourseEdit() {
    if (writingRef.current || !requireSession()) return;
    const waiting = pending.current;
    const retry = waiting && "kind" in waiting && waiting.kind === "COURSE_EDIT" ? waiting : undefined;
    if (pending.current && !retry) return;
    setCourseEditError(""); setCourseEditSaved("");
    const op = begin(true);
    try {
      let attempt = retry;
      if (!attempt) {
        const proposed = proposal();
        if (!proposed || !courseList) return;
        let preview: CourseEditPreviewResponse | undefined = courseEditPreview;
        if (!preview || (proposed.codes && !sameCodes(preview.controlCodes, proposed.codes))) {
          const read = await readPreview(op, proposed);
          if (read === "conflict") { await staleCourseList(op); return; }
          if (read === "unchanged") return;
          // Någon löpares status ändras: visa beskedet och vänta på bekräftelse.
          if (read.requiresConfirmation) return;
          preview = read;
        }
        const request: CourseEditRequest = { formatVersion: 1, requestId: crypto.randomUUID(),
          courseId: editingCourseId, ...(proposed.forking ? { forking: proposed.forking } : { controlCodes: proposed.codes }),
          ...(editingVariantCode ? { variantCode: editingVariantCode } : {}), confirmResultChanges: preview.requiresConfirmation };
        attempt = { kind: "COURSE_EDIT", request };
        pending.current = attempt; sent.current = false; setCourseEditAttempt(attempt);
      }
      await send(op, attempt);
    } catch { if (current(op)) setCourseEditError(pending.current ? text.unreachable : text.courseEditPreviewError); }
    finally { finish(op); }
  }
  return { readCourses, loadCourses, startCourseEdit, startForkingEdit, changeCourseEditForking, cancelCourseEdit, changeCourseEditControls,
    previewCourseEdit, saveCourseEdit };
}
export type CourseEditActions = ReturnType<typeof createCourseEditActions>;

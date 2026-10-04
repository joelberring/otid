import { useState } from "react";
import { classEditPreviewResponseSchema, classEditResponseSchema, type ClassEditPreviewResponse,
  type ClassEditRequest } from "@o-tid/contracts";
import { classTableSv as text } from "../../i18n/class-table-sv";
import type { ClassEditAttempt, Operation } from "./types";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";
import type { CourseEditActions } from "./course-edit";

type StartRule = ClassEditRequest["startRule"];

/** Redigera klass (ADR-0169): öppen rad, besked och sparande. Klasslistan delas med banorna. */
export function useClassEditState() {
  const [editingClassId, setEditingClassId] = useState("");
  const [classEditName, setClassEditName] = useState("");
  const [classEditCourseId, setClassEditCourseId] = useState("");
  const [classEditStartRule, setClassEditStartRule] = useState<StartRule>("PUNCH");
  const [classEditPreview, setClassEditPreview] = useState<ClassEditPreviewResponse>();
  const [classEditError, setClassEditError] = useState("");
  const [classEditSaved, setClassEditSaved] = useState("");
  const [classEditAttempt, setClassEditAttempt] = useState<ClassEditAttempt>();
  return { editingClassId, setEditingClassId, classEditName, setClassEditName, classEditCourseId, setClassEditCourseId,
    classEditStartRule, setClassEditStartRule, classEditPreview, setClassEditPreview, classEditError, setClassEditError,
    classEditSaved, setClassEditSaved, classEditAttempt, setClassEditAttempt };
}

export function createClassEditActions(ws: Base & RaceDataActions & CourseEditActions) {
  const { raceId, courseList, editingClassId, classEditName, classEditCourseId, classEditStartRule, classEditPreview,
    busyRef, pending, sent, requireSession, begin, finish, current, request, json, csrf, load, readCourses, setCourseListError,
    setEditingClassId, setClassEditName, setClassEditCourseId, setClassEditStartRule, setClassEditPreview, setClassEditError,
    setClassEditSaved, setClassEditAttempt } = ws;
  const editingRow = () => courseList?.classes.find(row => row.classId === editingClassId);

  function startClassEdit(classId: string) {
    if (busyRef.current || pending.current) return;
    const row = courseList?.classes.find(item => item.classId === classId);
    if (!row) return;
    setEditingClassId(classId); setClassEditName(row.name); setClassEditCourseId(row.courseId); setClassEditStartRule(row.startRule);
    setClassEditPreview(undefined); setClassEditError(""); setClassEditSaved("");
  }
  function cancelClassEdit() {
    if (pending.current) return;
    setEditingClassId(""); setClassEditPreview(undefined); setClassEditError("");
  }
  function changeClassEdit(change: { name?: string; courseId?: string; startRule?: StartRule }) {
    if (change.name !== undefined) setClassEditName(change.name);
    if (change.courseId !== undefined) setClassEditCourseId(change.courseId);
    if (change.startRule !== undefined) setClassEditStartRule(change.startRule);
    // Beskedet gäller bara bana och startsätt; ett nytt namn påverkar inga resultat.
    if (change.courseId !== undefined || change.startRule !== undefined) setClassEditPreview(undefined);
    setClassEditError("");
  }
  /** Kontrollerar raden. Ger ändringen eller visar vad som är fel. */
  function proposed() {
    const row = editingRow();
    const name = classEditName.trim();
    if (!row || !name || name.length > 160) { setClassEditError(text.invalidName); return undefined; }
    if (name === row.name && classEditCourseId === row.courseId && classEditStartRule === row.startRule) {
      setClassEditError(text.unchanged); return undefined;
    }
    return { name, courseId: classEditCourseId, startRule: classEditStartRule };
  }
  async function readPreview(op: Operation, courseId: string, startRule: StartRule) {
    if (!courseList) throw new Error("Class list missing");
    const response = await request(`/classes/${editingClassId}/edit-preview`, op, { method: "POST",
      headers: { "content-type": "application/json", "x-otid-csrf": csrf() },
      body: JSON.stringify({ formatVersion: 1, expectedSnapshotVersion: courseList.snapshotVersion, courseId, startRule }) });
    if (response.status === 409) return "conflict" as const;
    if (!response.ok) throw new Error("Class edit preview unavailable");
    const value = classEditPreviewResponseSchema.parse(await json(response, op));
    if (value.raceId !== raceId || value.classId !== editingClassId || value.courseId !== courseId || value.startRule !== startRule) {
      throw new Error("Class edit preview scope mismatch");
    }
    setClassEditPreview(value);
    return value;
  }
  /** Tävlingen har ändrats under tiden: läs om klasserna och be om ett nytt besked. */
  async function staleClassList(op: Operation) {
    setClassEditPreview(undefined); setClassEditError(text.conflict);
    await readCourses(op);
  }
  async function previewClassEdit() {
    if (busyRef.current || pending.current || !requireSession()) return;
    setClassEditError(""); setClassEditSaved("");
    const change = proposed();
    if (!change) return;
    const op = begin();
    try { if (await readPreview(op, change.courseId, change.startRule) === "conflict") await staleClassList(op); }
    catch { if (current(op)) setClassEditError(text.previewError); }
    finally { finish(op); }
  }
  async function send(op: Operation, attempt: ClassEditAttempt) {
    sent.current = true;
    const response = await request(`/classes/${attempt.request.classId}/edit`, op, { method: "POST",
      headers: { "content-type": "application/json", "x-otid-csrf": csrf(), "idempotency-key": `class-edit:${attempt.request.requestId}` },
      body: JSON.stringify(attempt.request) });
    if (response.status === 409 || response.status === 400 || response.status === 404) {
      pending.current = undefined; sent.current = false; setClassEditAttempt(undefined);
      if (response.status === 409) await staleClassList(op);
      else setClassEditError(text.rejected);
      return;
    }
    if (!response.ok) throw new Error("Unknown class edit outcome");
    const receipt = classEditResponseSchema.parse(await json(response, op));
    if (receipt.raceId !== raceId || receipt.requestId !== attempt.request.requestId ||
        JSON.stringify(receipt.request) !== JSON.stringify(attempt.request)) throw new Error("Class edit receipt mismatch");
    pending.current = undefined; sent.current = false; setClassEditAttempt(undefined);
    setEditingClassId(""); setClassEditPreview(undefined); setClassEditError("");
    setClassEditSaved(text.saved(receipt.recalculated.length));
    try { await load(op); await readCourses(op); }
    catch { if (current(op)) setCourseListError(text.savedLoadError); }
  }
  /**
   * Sparar direkt om ingen löpares status ändras. Annars visas beskedet först och
   * ändringen sparas när arrangören trycker på "Spara ändringen" igen.
   */
  async function saveClassEdit() {
    if (busyRef.current || !requireSession()) return;
    const waiting = pending.current;
    const retry = waiting && "kind" in waiting && waiting.kind === "CLASS_EDIT" ? waiting : undefined;
    if (pending.current && !retry) return;
    setClassEditError(""); setClassEditSaved("");
    const op = begin();
    try {
      let attempt = retry;
      if (!attempt) {
        const change = proposed();
        if (!change || !courseList) return;
        let preview = classEditPreview;
        if (!preview || preview.courseId !== change.courseId || preview.startRule !== change.startRule) {
          const read = await readPreview(op, change.courseId, change.startRule);
          if (read === "conflict") { await staleClassList(op); return; }
          // Någon löpares status ändras: visa beskedet och vänta på bekräftelse.
          if (read.requiresConfirmation) return;
          preview = read;
        }
        const request: ClassEditRequest = { formatVersion: 1, requestId: crypto.randomUUID(),
          expectedSnapshotVersion: preview.snapshotVersion, classId: editingClassId, className: change.name,
          courseId: change.courseId, startRule: change.startRule, confirmResultChanges: preview.requiresConfirmation };
        attempt = { kind: "CLASS_EDIT", request };
        pending.current = attempt; sent.current = false; setClassEditAttempt(attempt);
      }
      await send(op, attempt);
    } catch { if (current(op)) setClassEditError(pending.current ? text.unknown : text.previewError); }
    finally { finish(op); }
  }
  return { startClassEdit, cancelClassEdit, changeClassEdit, previewClassEdit, saveClassEdit };
}
export type ClassEditActions = ReturnType<typeof createClassEditActions>;

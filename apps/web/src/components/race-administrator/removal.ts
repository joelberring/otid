import { useState } from "react";
import { classRemovalResponseSchema, courseRemovalResponseSchema, entryRemovalResponseSchema, type RemovalOutcome } from "@o-tid/contracts";
import { removalSv as text } from "../../i18n/removal-sv";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";
import type { CourseEditActions } from "./course-edit";

/** Det som ska tas bort och begäran som skickas (samma id vid ett nytt försök efter nätfel). */
export type RemovalAttempt =
  | { kind: "ENTRY"; id: string; name: string; mode: "DELETE" | "STRIKE"; requestId: string; expectedEntryVersion: number }
  | { kind: "CLASS" | "COURSE"; id: string; name: string; requestId: string };

/** Beskedet efter ett försök, knutet till det som skulle tas bort. */
export type RemovalMessage = { kind: RemovalAttempt["kind"]; id: string; text: string; tone: "ok" | "attention" | "error" };

/** Ta bort och stryk (PLAN.md steg 27): en bekräftelse i taget, beskedet stannar vid raden eller kortet. */
export function useRemovalState() {
  const [removalAttempt, setRemovalAttempt] = useState<RemovalAttempt>();
  const [removalMessage, setRemovalMessage] = useState<RemovalMessage>();
  const [removalUnknown, setRemovalUnknown] = useState(false);
  return { removalAttempt, setRemovalAttempt, removalMessage, setRemovalMessage, removalUnknown, setRemovalUnknown };
}

const blockedText = (outcome: Extract<RemovalOutcome, { outcome: "BLOCKED" }>) =>
  text.blocked(outcome.blocker, { count: outcome.count, names: outcome.names });

export function createRemovalActions(ws: Base & RaceDataActions & CourseEditActions) {
  const { raceId, courseList, selected, effectiveResult, removalAttempt, writingRef, pending, requireSession, begin, finish, current,
    request, json, csrf, load, readCourses, setEntryId, setRemovalAttempt, setRemovalMessage, setRemovalUnknown } = ws;

  function prepareEntryRemoval() {
    if (writingRef.current || pending.current || !selected) return;
    // Utan avläsning och utan resultat tas deltagaren bort; annars stryks den (servern avgör till sist).
    const result = effectiveResult?.entryId === selected.id ? effectiveResult : undefined;
    const hasResult = !result || result.state !== "NO_PUBLISHED_RESULT" || result.history.length > 0 || !!result.cardPunches;
    setRemovalMessage(undefined); setRemovalUnknown(false);
    setRemovalAttempt({ kind: "ENTRY", id: selected.id, name: selected.displayName, mode: hasResult ? "STRIKE" : "DELETE",
      requestId: crypto.randomUUID(), expectedEntryVersion: selected.version });
  }
  function prepareClassRemoval(classId: string) {
    if (writingRef.current || pending.current) return;
    const row = courseList?.classes.find(item => item.classId === classId);
    if (!row) return;
    setRemovalUnknown(false);
    if (row.entryCount > 0) {
      setRemovalAttempt(undefined);
      setRemovalMessage({ kind: "CLASS", id: classId, tone: "attention", text: text.blocked("CLASS_HAS_ENTRIES", { count: row.entryCount }) });
      return;
    }
    setRemovalMessage(undefined);
    setRemovalAttempt({ kind: "CLASS", id: classId, name: row.name, requestId: crypto.randomUUID() });
  }
  function prepareCourseRemoval(courseId: string) {
    if (writingRef.current || pending.current) return;
    const course = courseList?.courses.find(item => item.courseId === courseId);
    if (!course) return;
    setRemovalUnknown(false);
    const users = (courseList?.classes ?? []).filter(row => row.courseId === courseId).map(row => row.name);
    if (users.length > 0) {
      setRemovalAttempt(undefined);
      setRemovalMessage({ kind: "COURSE", id: courseId, tone: "attention", text: text.blocked("COURSE_USED_BY_CLASS", { names: users }) });
      return;
    }
    setRemovalMessage(undefined);
    setRemovalAttempt({ kind: "COURSE", id: courseId, name: course.name, requestId: crypto.randomUUID() });
  }
  function cancelRemoval() { setRemovalAttempt(undefined); setRemovalUnknown(false); }

  async function confirmRemoval() {
    const attempt = removalAttempt;
    if (!attempt || writingRef.current || pending.current || !requireSession()) return;
    const prefix = attempt.kind === "ENTRY" ? "entry-removal" : attempt.kind === "CLASS" ? "class-removal" : "course-removal";
    const path = attempt.kind === "ENTRY" ? `/entries/${attempt.id}/removal` : attempt.kind === "CLASS" ? `/classes/${attempt.id}/removal`
      : `/courses/${attempt.id}/removal`;
    const body = attempt.kind === "ENTRY"
      ? { formatVersion: 1, requestId: attempt.requestId, entryId: attempt.id, mode: attempt.mode, expectedEntryVersion: attempt.expectedEntryVersion }
      : attempt.kind === "CLASS" ? { formatVersion: 1, requestId: attempt.requestId, classId: attempt.id }
        : { formatVersion: 1, requestId: attempt.requestId, courseId: attempt.id };
    const op = begin(true);
    const message = (tone: RemovalMessage["tone"], value: string) => setRemovalMessage({ kind: attempt.kind, id: attempt.id, tone, text: value });
    try {
      const response = await request(path, op, { method: "POST", headers: { "content-type": "application/json", "x-otid-csrf": csrf(),
        "idempotency-key": `${prefix}:${attempt.requestId}` }, body: JSON.stringify(body) });
      if (response.status === 409 || response.status === 404) {
        setRemovalAttempt(undefined); setRemovalUnknown(false); message("error", attempt.kind === "ENTRY" ? text.changed : text.error); return;
      }
      if (!response.ok) throw new Error("Removal not saved");
      const value = await json(response, op);
      const receipt = attempt.kind === "ENTRY" ? entryRemovalResponseSchema.parse(value)
        : attempt.kind === "CLASS" ? classRemovalResponseSchema.parse(value) : courseRemovalResponseSchema.parse(value);
      if (receipt.raceId !== raceId || receipt.requestId !== attempt.requestId) throw new Error("Removal receipt mismatch");
      setRemovalAttempt(undefined); setRemovalUnknown(false);
      const outcome = receipt.result;
      if (outcome.outcome === "BLOCKED") { message("attention", blockedText(outcome)); return; }
      message("ok", attempt.kind === "ENTRY" ? (outcome.outcome === "STRUCK" ? text.entryStruck(attempt.name) : text.entryDeleted(attempt.name))
        : attempt.kind === "CLASS" ? text.classDeleted(attempt.name) : text.courseDeleted(attempt.name));
      if (attempt.kind === "ENTRY") setEntryId("");
      await load(op, attempt.kind === "ENTRY" ? "" : undefined);
      if (attempt.kind !== "ENTRY" || courseList) await readCourses(op);
    } catch {
      if (current(op)) { setRemovalUnknown(true); message("error", text.unreachable); }
    } finally { finish(op); }
  }
  return { prepareEntryRemoval, prepareClassRemoval, prepareCourseRemoval, cancelRemoval, confirmRemoval };
}

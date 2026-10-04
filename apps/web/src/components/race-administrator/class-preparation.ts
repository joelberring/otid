import { useState, type FormEvent } from "react";
import { classCapacityRequestSchema, classCapacityResponseSchema, manualClassCreateRequestSchema,
  manualClassCreateResponseSchema, type ManualClassCreateRequest } from "@o-tid/contracts";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import type { CapacityAttempt, ManualClassAttempt } from "./types";
import type { Base, WorkspaceState } from "./workspace-state";
import type { RaceDataActions } from "./race-data";

/** Förberedelse av klasser: ny klass på befintlig bana och maxantal. Namn, bana och startsätt ändras i klasstabellen. */
export function useClassPreparationState() {
  const [manualClassName, setManualClassName] = useState("");
  const [manualClassCourseVersionId, setManualClassCourseVersionId] = useState("");
  const [manualClassStartRule, setManualClassStartRule] = useState<ManualClassCreateRequest["startRule"]>("PUNCH");
  const [manualClassReview, setManualClassReview] = useState<ManualClassAttempt>();
  const [manualClassAttempt, setManualClassAttempt] = useState<ManualClassAttempt>();
  const [manualClassError, setManualClassError] = useState("");
  const [capacityAttempt, setCapacityAttempt] = useState<CapacityAttempt>();
  const [capacityClassId, setCapacityClassId] = useState("");
  const [capacityInput, setCapacityInput] = useState("");
  return { manualClassName, setManualClassName, manualClassCourseVersionId, setManualClassCourseVersionId, manualClassStartRule,
    setManualClassStartRule, manualClassReview, setManualClassReview, manualClassAttempt, setManualClassAttempt, manualClassError,
    setManualClassError, capacityAttempt, setCapacityAttempt, capacityClassId, setCapacityClassId, capacityInput,
    setCapacityInput };
}

export function deriveClassPreparation(s: WorkspaceState) {
  const { data, capacityClassId } = s;
  const capacityClass = data?.classes.find((row) => row.id === capacityClassId);
  const manualClassTargets = data?.classes.filter((row, index, rows) =>
    rows.findIndex(candidate => candidate.courseVersionId === row.courseVersionId) === index) ?? [];
  return { capacityClass, manualClassTargets };
}

export function createClassPreparationActions(ws: Base & RaceDataActions) {
  const { raceId, data, manualClassCourseVersionId, manualClassName, manualClassStartRule, capacityClassId, capacityInput,
    busyRef, pending, sent, requireSession, begin, finish, current, request, json, csrf, load, setMessage, setUnknown, setData,
    setEntryId, setClassId, setManualClassError, setManualClassReview, setManualClassAttempt, setManualClassName,
    setManualClassCourseVersionId, setManualClassStartRule, setCapacityAttempt, setCapacityClassId, setCapacityInput } = ws;
  function inspectManualClass(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || pending.current || !requireSession() || !data) return;
    setManualClassError("");
    const target = data.classes.find(row => row.courseVersionId === manualClassCourseVersionId);
    if (!target) { setManualClassError(text.manualClassMissingTarget); return; }
    const parsed = manualClassCreateRequestSchema.safeParse({
      formatVersion: 1, requestId: crypto.randomUUID(), expectedSnapshotVersion: data.snapshotVersion,
      courseVersionId: target.courseVersionId, className: manualClassName.trim(), startRule: manualClassStartRule,
    });
    if (!parsed.success) { setManualClassError(text.manualClassInvalid); return; }
    const targetOrdinal = data.classes.findIndex(row => row.courseVersionId === target.courseVersionId) + 1;
    setManualClassReview({ kind: "MANUAL_CLASS", request: parsed.data,
      targetLabel: text.manualClassTargetLabel(target.courseName, target.courseVersion, targetOrdinal) });
  }
  async function submitManualClass(value: ManualClassAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin();
    let committed = false;
    try {
      const token = csrf();
      const response = await request("/classes", op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token,
          "idempotency-key": `manual-class-create:${value.request.requestId}` },
        body: JSON.stringify(value.request) });
      if (!response.ok) throw new Error("Manual class unavailable");
      const receipt = manualClassCreateResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.requestId !== value.request.requestId ||
        receipt.request.formatVersion !== value.request.formatVersion ||
        receipt.request.requestId !== value.request.requestId ||
        receipt.request.expectedSnapshotVersion !== value.request.expectedSnapshotVersion ||
        receipt.request.courseVersionId !== value.request.courseVersionId ||
        receipt.request.className !== value.request.className ||
        receipt.request.startRule !== value.request.startRule ||
        receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion ||
        receipt.courseVersionId !== value.request.courseVersionId) throw new Error("Manual class receipt mismatch");
      committed = true;
      pending.current = undefined; sent.current = false;
      setManualClassAttempt(undefined); setManualClassReview(undefined); setManualClassError("");
      setManualClassName(""); setManualClassCourseVersionId(""); setManualClassStartRule("PUNCH");
      setMessage(text.manualClassSaved);
      await load(op);
    } catch {
      if (current(op)) {
        if (committed) { setManualClassError(text.manualClassSavedLoadError); setMessage(text.manualClassSavedLoadError); }
        else { pending.current = value; sent.current = true; setManualClassAttempt(value); setManualClassError(text.manualClassUnknown); }
      }
    } finally { finish(op); }
  }
  /** Granskning bekräftad: försöket blir väntande och skickas direkt. */
  function confirmManualClass(review: ManualClassAttempt) {
    pending.current = review; sent.current = false; setManualClassAttempt(review);
    void submitManualClass(review);
  }
  function prepareCapacity(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || pending.current || !requireSession()) return;
    const targetClass = data?.classes.find((row) => row.id === capacityClassId);
    const input = capacityInput.trim();
    if (!targetClass || (input !== "" && !/^\d{1,5}$/.test(input))) { setMessage(text.capacityInvalid); return; }
    const parsed = classCapacityRequestSchema.safeParse({ formatVersion: 1,
      expectedCapacityVersion: targetClass.capacityVersion, expectedMaxEntries: targetClass.maxEntries,
      maxEntries: input === "" ? null : Number(input) });
    if (!parsed.success || (parsed.data.maxEntries !== null && parsed.data.maxEntries < targetClass.entryCount)) {
      setMessage(text.capacityInvalid); return;
    }
    const value: CapacityAttempt = { kind: "CAPACITY", id: crypto.randomUUID(), classId: targetClass.id, className: targetClass.name,
      entryCount: targetClass.entryCount, request: parsed.data };
    pending.current = value; sent.current = false; setCapacityAttempt(value); setUnknown(false); setMessage("");
  }
  async function submitCapacity(value: CapacityAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current;
    let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/classes/${value.classId}/capacity`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `class-capacity:${value.id}` },
        body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.capacityUnknown); return; }
        pending.current = undefined; sent.current = false; setCapacityAttempt(undefined); setUnknown(false);
        setData(undefined); setEntryId(""); setClassId(""); setCapacityClassId(""); setCapacityInput("");
        setMessage(text.capacityConflict); return;
      }
      if (!response.ok) throw new Error("Unknown capacity outcome");
      const receipt = classCapacityResponseSchema.parse(await json(response, op));
      if (receipt.requestId !== value.id || receipt.raceId !== raceId || receipt.classId !== value.classId ||
        receipt.versionBefore !== value.request.expectedCapacityVersion ||
        receipt.previousMaxEntries !== value.request.expectedMaxEntries || receipt.maxEntries !== value.request.maxEntries) {
        throw new Error("Capacity receipt mismatch");
      }
      committed = true; pending.current = undefined; sent.current = false; setCapacityAttempt(undefined); setUnknown(false);
      setData(undefined); setCapacityClassId(""); setCapacityInput(""); setMessage(text.capacitySaved);
      await load(op);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.capacitySavedLoadError : text.capacityUnknown); }
    } finally { finish(op); }
  }
  return { inspectManualClass, submitManualClass, confirmManualClass, prepareCapacity, submitCapacity };
}
export type ClassPreparationActions = ReturnType<typeof createClassPreparationActions>;

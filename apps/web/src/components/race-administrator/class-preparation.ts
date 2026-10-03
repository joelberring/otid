import { useRef, useState, type FormEvent } from "react";
import { classCapacityRequestSchema, classCapacityResponseSchema, classStartRuleChangeRequestSchema,
  classStartRuleChangeResponseSchema, classStartRulePreviewSchema, manualClassCreateRequestSchema,
  manualClassCreateResponseSchema, manualClassNameCandidateSchema, manualClassNameChangeRequestSchema,
  manualClassNameChangeResponseSchema, type ClassStartRulePreview, type ManualClassCreateRequest,
  type ManualClassNameCandidate } from "@o-tid/contracts";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import type { CapacityAttempt, ManualClassAttempt, ManualClassNameAttempt, StartRuleAttempt } from "./types";
import type { Base, WorkspaceState } from "./workspace-state";
import type { RaceDataActions } from "./race-data";

/** Förberedelse av klasser: ny klass på befintlig bana, klassnamn, maxantal och startregel. */
export function useClassPreparationState() {
  const [manualClassName, setManualClassName] = useState("");
  const [manualClassCourseVersionId, setManualClassCourseVersionId] = useState("");
  const [manualClassStartRule, setManualClassStartRule] = useState<ManualClassCreateRequest["startRule"]>("PUNCH");
  const [manualClassReview, setManualClassReview] = useState<ManualClassAttempt>();
  const [manualClassAttempt, setManualClassAttempt] = useState<ManualClassAttempt>();
  const [manualClassError, setManualClassError] = useState("");
  const [classNameClassId, setClassNameClassId] = useState("");
  const [classNameCandidate, setClassNameCandidate] = useState<ManualClassNameCandidate>();
  const [classNameInput, setClassNameInput] = useState("");
  const [classNameReview, setClassNameReview] = useState<ManualClassNameAttempt>();
  const [classNameAttempt, setClassNameAttempt] = useState<ManualClassNameAttempt>();
  const [classNameError, setClassNameError] = useState("");
  const classNamePanel = useRef<HTMLDetailsElement>(null);
  const [capacityAttempt, setCapacityAttempt] = useState<CapacityAttempt>();
  const [capacityClassId, setCapacityClassId] = useState("");
  const [capacityInput, setCapacityInput] = useState("");
  const [startRuleClassId, setStartRuleClassId] = useState("");
  const [startRulePreview, setStartRulePreview] = useState<ClassStartRulePreview>();
  const [startRuleReason, setStartRuleReason] = useState("");
  const [startRuleConfirmed, setStartRuleConfirmed] = useState(false);
  const [startRuleAttempt, setStartRuleAttempt] = useState<StartRuleAttempt>();
  const [startRuleOpen, setStartRuleOpen] = useState(false);
  return { manualClassName, setManualClassName, manualClassCourseVersionId, setManualClassCourseVersionId, manualClassStartRule,
    setManualClassStartRule, manualClassReview, setManualClassReview, manualClassAttempt, setManualClassAttempt, manualClassError,
    setManualClassError, classNameClassId, setClassNameClassId, classNameCandidate, setClassNameCandidate, classNameInput,
    setClassNameInput, classNameReview, setClassNameReview, classNameAttempt, setClassNameAttempt, classNameError,
    setClassNameError, classNamePanel, capacityAttempt, setCapacityAttempt, capacityClassId, setCapacityClassId, capacityInput,
    setCapacityInput, startRuleClassId, setStartRuleClassId, startRulePreview, setStartRulePreview, startRuleReason,
    setStartRuleReason, startRuleConfirmed, setStartRuleConfirmed, startRuleAttempt, setStartRuleAttempt, startRuleOpen,
    setStartRuleOpen };
}

export function deriveClassPreparation(s: WorkspaceState) {
  const { data, capacityClassId, startRuleClassId, classNameClassId } = s;
  const capacityClass = data?.classes.find((row) => row.id === capacityClassId);
  const manualClassTargets = data?.classes.filter((row, index, rows) =>
    rows.findIndex(candidate => candidate.courseVersionId === row.courseVersionId) === index) ?? [];
  const startRuleClass = data?.classes.find(row => row.id === startRuleClassId);
  const classNameSelected = data?.classes.find(row => row.id === classNameClassId);
  return { capacityClass, manualClassTargets, startRuleClass, classNameSelected };
}

export function createClassPreparationActions(ws: Base & RaceDataActions) {
  const { raceId, data, manualClassCourseVersionId, manualClassName, manualClassStartRule, classNameCandidate, classNameInput,
    capacityClassId, capacityInput, startRuleClassId, startRulePreview, startRuleConfirmed, startRuleReason, busyRef, pending,
    sent, requireSession, begin, beginRequest, finish, current, request, json, csrf, load, setMessage, setUnknown, setData,
    setEntryId, setClassId, setManualClassError, setManualClassReview, setManualClassAttempt, setManualClassName,
    setManualClassCourseVersionId, setManualClassStartRule, setClassNameCandidate, setClassNameInput, setClassNameError,
    setClassNameReview, setClassNameAttempt, setCapacityAttempt, setCapacityClassId, setCapacityInput, setStartRulePreview,
    setStartRuleReason, setStartRuleConfirmed, setStartRuleAttempt, setStartRuleClassId } = ws;
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
  async function loadClassNameCandidate(classId: string) {
    if (busyRef.current || pending.current || !requireSession() || !data) return;
    const raceClass = data.classes.find(row => row.id === classId);
    if (!raceClass) return;
    setClassNameCandidate(undefined); setClassNameInput(""); setClassNameError("");
    const op = beginRequest();
    try {
      const response = await request(`/classes/${classId}/name`, op);
      if (!response.ok) throw new Error("Class name unavailable");
      const candidate = manualClassNameCandidateSchema.parse(await json(response, op));
      if (candidate.raceId !== raceId || candidate.classId !== classId ||
        candidate.snapshotVersion !== data.snapshotVersion ||
        candidate.className !== raceClass.name || candidate.courseVersionId !== raceClass.courseVersionId) {
        throw new Error("Class name candidate mismatch");
      }
      setClassNameCandidate(candidate); setClassNameInput(candidate.className);
    } catch { if (current(op)) setClassNameError(text.classNameLoadError); }
    finally { finish(op); }
  }
  function inspectClassName(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || pending.current || !requireSession() || !data || !classNameCandidate?.editable) return;
    setClassNameError("");
    const raceClass = data.classes.find(row => row.id === classNameCandidate.classId);
    if (!raceClass || raceClass.name !== classNameCandidate.className ||
      raceClass.courseVersionId !== classNameCandidate.courseVersionId ||
      data.snapshotVersion !== classNameCandidate.snapshotVersion) {
      setClassNameError(text.classNameStale); return;
    }
    const parsed = manualClassNameChangeRequestSchema.safeParse({
      formatVersion: 1, requestId: crypto.randomUUID(),
      expectedSnapshotVersion: classNameCandidate.snapshotVersion,
      expectedClassName: classNameCandidate.className, className: classNameInput.trim(),
    });
    if (!parsed.success) { setClassNameError(text.classNameInvalid); return; }
    setClassNameReview({ kind: "MANUAL_CLASS_NAME", classId: classNameCandidate.classId,
      courseVersionId: classNameCandidate.courseVersionId, request: parsed.data });
  }
  async function submitClassName(value: ManualClassNameAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin();
    let committed = false;
    try {
      const token = csrf();
      const response = await request(`/classes/${value.classId}/name`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token,
          "idempotency-key": `manual-class-name:${value.request.requestId}` },
        body: JSON.stringify(value.request) });
      if (!response.ok) throw new Error("Class name change unavailable");
      const receipt = manualClassNameChangeResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.classId !== value.classId ||
        receipt.courseVersionId !== value.courseVersionId ||
        receipt.requestId !== value.request.requestId ||
        receipt.previousClassName !== value.request.expectedClassName ||
        receipt.className !== value.request.className ||
        receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion ||
        receipt.request.formatVersion !== value.request.formatVersion ||
        receipt.request.requestId !== value.request.requestId ||
        receipt.request.expectedSnapshotVersion !== value.request.expectedSnapshotVersion ||
        receipt.request.expectedClassName !== value.request.expectedClassName ||
        receipt.request.className !== value.request.className) throw new Error("Class name receipt mismatch");
      committed = true;
      pending.current = undefined; sent.current = false;
      setClassNameAttempt(undefined); setClassNameReview(undefined); setClassNameCandidate(undefined);
      setClassNameInput(""); setClassNameError(""); setMessage(text.classNameSaved);
      await load(op);
    } catch {
      if (current(op)) {
        if (committed) { setClassNameError(text.classNameSavedLoadError); setMessage(text.classNameSavedLoadError); }
        else { pending.current = value; sent.current = true; setClassNameAttempt(value); setClassNameError(text.classNameUnknown); }
      }
    } finally { finish(op); }
  }
  /** Granskning bekräftad: försöket blir väntande och skickas direkt. */
  function confirmClassName(review: ManualClassNameAttempt) {
    pending.current = review; sent.current = false; setClassNameAttempt(review);
    void submitClassName(review);
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
  async function loadStartRulePreview() {
    if (busyRef.current || pending.current || !requireSession() || !startRuleClassId) return;
    setStartRulePreview(undefined); setStartRuleReason(""); setStartRuleConfirmed(false); setMessage("");
    const op = begin();
    try {
      const response = await request(`/classes/${startRuleClassId}/start-rule`, op);
      if (!response.ok) throw new Error("Start-rule preview unavailable");
      const value = classStartRulePreviewSchema.parse(await json(response, op));
      if (value.raceId !== raceId || value.classId !== startRuleClassId) throw new Error("Start-rule preview scope mismatch");
      setStartRulePreview(value);
    } catch { if (current(op)) setMessage(text.startRuleLoadError); }
    finally { finish(op); }
  }
  function prepareStartRule(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || pending.current || !requireSession() || !startRulePreview || !startRuleConfirmed) return;
    const request = classStartRuleChangeRequestSchema.safeParse({ formatVersion: 1, requestId: crypto.randomUUID(),
      expectedSnapshotVersion: startRulePreview.snapshotVersion, expectedStartRule: startRulePreview.startRule,
      startRule: startRulePreview.startRule === "FIXED" ? "PUNCH" : "FIXED", reason: startRuleReason });
    if (!request.success) { setMessage(text.startRuleInvalid); return; }
    const value: StartRuleAttempt = { kind: "START_RULE", preview: startRulePreview, request: request.data };
    pending.current = value; sent.current = false; setStartRuleAttempt(value); setUnknown(false); setMessage("");
  }
  async function submitStartRule(value: StartRuleAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current; let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/classes/${value.preview.classId}/start-rule`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token }, body: JSON.stringify(value.request) });
      if ([400, 404, 409, 413].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.startRuleUnknown); return; }
        pending.current = undefined; sent.current = false; setStartRuleAttempt(undefined); setUnknown(false);
        setStartRulePreview(undefined); setMessage(text.startRuleConflict); return;
      }
      if (!response.ok) throw new Error("Unknown start-rule outcome");
      const receipt = classStartRuleChangeResponseSchema.parse(await json(response, op));
      if (receipt.requestId !== value.request.requestId || receipt.raceId !== raceId || receipt.classId !== value.preview.classId ||
        receipt.previousStartRule !== value.request.expectedStartRule || receipt.startRule !== value.request.startRule ||
        receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion) throw new Error("Start-rule receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setStartRuleAttempt(undefined); setUnknown(false);
      setStartRulePreview(undefined); setStartRuleClassId(value.preview.classId); setStartRuleReason(""); setStartRuleConfirmed(false);
      setData(undefined); setMessage(text.startRuleSaved); await load(op);
    } catch { if (current(op)) { setUnknown(!committed); setMessage(committed ? text.startRuleSavedLoadError : text.startRuleUnknown); } }
    finally { finish(op); }
  }
  return { inspectManualClass, submitManualClass, confirmManualClass, loadClassNameCandidate, inspectClassName, submitClassName,
    confirmClassName, prepareCapacity, submitCapacity, loadStartRulePreview, prepareStartRule, submitStartRule };
}
export type ClassPreparationActions = ReturnType<typeof createClassPreparationActions>;

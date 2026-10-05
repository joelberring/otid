import { useState } from "react";
import { rogainingChangePreviewResponseSchema, rogainingChangeResponseSchema, type RogainingChangePreviewResponse,
  type RogainingChangeRequest } from "@o-tid/contracts";
import { rogainingSv as text } from "../../i18n/rogaining-sv";
import type { Operation, RogainingAttempt } from "./types";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";
import type { CourseEditActions } from "./course-edit";

type RuleInput = { limit?: string; penalty?: string };

/**
 * Kontroller & poäng (ADR-0170 beslut 5): ändrade poäng och klassregler som inte sparats ännu, beskedet och
 * sparandet. Värdena som visas är det sparade (banlistans `rogaining`) med arrangörens ändringar ovanpå.
 */
export function useRogainingState() {
  const [rogainingPoints, setRogainingPoints] = useState<Record<number, string>>({});
  const [rogainingRules, setRogainingRules] = useState<Record<string, RuleInput>>({});
  const [rogainingPreview, setRogainingPreview] = useState<RogainingChangePreviewResponse>();
  const [rogainingError, setRogainingError] = useState("");
  const [rogainingSaved, setRogainingSaved] = useState("");
  const [rogainingAttempt, setRogainingAttempt] = useState<RogainingAttempt>();
  return { rogainingPoints, setRogainingPoints, rogainingRules, setRogainingRules, rogainingPreview, setRogainingPreview,
    rogainingError, setRogainingError, rogainingSaved, setRogainingSaved, rogainingAttempt, setRogainingAttempt };
}

/** Ett heltal i intervallet, annars undefined. Tomt fält ger null. */
function whole(value: string, min: number, max: number): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const number = Number(trimmed);
  return number >= min && number <= max ? number : undefined;
}

type Change = Pick<RogainingChangeRequest, "controlPoints" | "classRules">;

export function createRogainingActions(ws: Base & RaceDataActions & CourseEditActions) {
  const { raceId, courseList, rogainingPoints, rogainingRules, rogainingPreview, busyRef, pending, sent, requireSession, begin, finish,
    current, request, json, csrf, load, readCourses, setCourseListError, setRogainingPoints, setRogainingRules, setRogainingPreview,
    setRogainingError, setRogainingSaved, setRogainingAttempt } = ws;

  function changeRogainingPoints(code: number, value: string) {
    setRogainingPoints({ ...rogainingPoints, [code]: value }); setRogainingPreview(undefined); setRogainingError(""); setRogainingSaved("");
  }
  function changeRogainingRule(classId: string, field: keyof RuleInput, value: string) {
    setRogainingRules({ ...rogainingRules, [classId]: { ...rogainingRules[classId], [field]: value } });
    setRogainingPreview(undefined); setRogainingError(""); setRogainingSaved("");
  }
  function resetRogaining() {
    if (pending.current) return;
    setRogainingPoints({}); setRogainingRules({}); setRogainingPreview(undefined); setRogainingError("");
  }

  /** Det som skiljer sig från det sparade. Visar vad som är fel och ger undefined om något inte går att spara. */
  function proposed(): Change | undefined {
    const setup = courseList?.rogaining;
    if (!setup) return undefined;
    const controlPoints: Change["controlPoints"] = [];
    for (const control of setup.controls) {
      const input = rogainingPoints[control.code];
      if (input === undefined) continue;
      const points = whole(input, 0, 1_000);
      if (points === undefined || points === null) { setRogainingError(text.invalid); return undefined; }
      if (points !== control.points) controlPoints.push({ code: control.code, points });
    }
    const classRules: Change["classRules"] = [];
    for (const row of setup.classes) {
      const input = rogainingRules[row.classId];
      if (!input) continue;
      const limit = whole(input.limit ?? String(row.rules?.timeLimitMinutes ?? ""), 1, 2_880);
      const penalty = whole(input.penalty ?? String(row.rules?.penaltyPoints ?? ""), 0, 1_000);
      if (limit === undefined || penalty === undefined) { setRogainingError(text.invalid); return undefined; }
      if (limit === null && penalty === null && !row.rules) continue;
      if (limit === null || penalty === null) { setRogainingError(text.missingRules); return undefined; }
      if (limit !== row.rules?.timeLimitMinutes || penalty !== row.rules.penaltyPoints) {
        classRules.push({ classId: row.classId, timeLimitMinutes: limit, penaltyPoints: penalty });
      }
    }
    if (controlPoints.length + classRules.length === 0) { setRogainingError(text.unchanged); return undefined; }
    return { controlPoints, classRules };
  }
  // Varje ändring i fälten tömmer beskedet, så ett besked som finns gäller alltid fälten som de står.
  const previewIsCurrent = (preview: RogainingChangePreviewResponse | undefined, snapshotVersion: number) =>
    preview !== undefined && preview.snapshotVersion === snapshotVersion;

  async function readPreview(op: Operation, change: Change) {
    if (!courseList) throw new Error("Course list missing");
    const response = await request("/rogaining/preview", op, { method: "POST",
      headers: { "content-type": "application/json", "x-otid-csrf": csrf() },
      body: JSON.stringify({ formatVersion: 1, expectedSnapshotVersion: courseList.snapshotVersion, ...change }) });
    if (response.status === 409) return "conflict" as const;
    if (!response.ok) throw new Error("Rogaining preview unavailable");
    const value = rogainingChangePreviewResponseSchema.parse(await json(response, op));
    if (value.raceId !== raceId || value.snapshotVersion !== courseList.snapshotVersion) throw new Error("Rogaining preview scope mismatch");
    setRogainingPreview(value);
    return value;
  }
  /** Tävlingen har ändrats under tiden: läs om kontrollerna och be om ett nytt besked. */
  async function stale(op: Operation) {
    setRogainingPreview(undefined); setRogainingError(text.conflict);
    await readCourses(op);
  }
  async function previewRogaining() {
    if (busyRef.current || pending.current || !requireSession()) return;
    setRogainingError(""); setRogainingSaved("");
    const change = proposed();
    if (!change) return;
    const op = begin();
    try { if (await readPreview(op, change) === "conflict") await stale(op); }
    catch { if (current(op)) setRogainingError(text.previewError); }
    finally { finish(op); }
  }
  async function send(op: Operation, attempt: RogainingAttempt) {
    sent.current = true;
    const response = await request("/rogaining", op, { method: "POST",
      headers: { "content-type": "application/json", "x-otid-csrf": csrf(), "idempotency-key": `rogaining-change:${attempt.request.requestId}` },
      body: JSON.stringify(attempt.request) });
    if (response.status === 409 || response.status === 400) {
      pending.current = undefined; sent.current = false; setRogainingAttempt(undefined);
      if (response.status === 409) await stale(op);
      else setRogainingError(text.rejected);
      return;
    }
    if (!response.ok) throw new Error("Unknown rogaining outcome");
    const receipt = rogainingChangeResponseSchema.parse(await json(response, op));
    if (receipt.raceId !== raceId || receipt.requestId !== attempt.request.requestId ||
        JSON.stringify(receipt.request) !== JSON.stringify(attempt.request)) throw new Error("Rogaining receipt mismatch");
    pending.current = undefined; sent.current = false; setRogainingAttempt(undefined);
    setRogainingPoints({}); setRogainingRules({}); setRogainingPreview(undefined); setRogainingError("");
    setRogainingSaved(text.saved(receipt.recalculated.length));
    try { await load(op); await readCourses(op); }
    catch { if (current(op)) setCourseListError(text.savedLoadError); }
  }
  /**
   * Sparar direkt om ingen löpares status eller summa ändras. Annars visas beskedet först och ändringen sparas
   * när arrangören trycker på "Spara och räkna om".
   */
  async function saveRogaining() {
    if (busyRef.current || !requireSession()) return;
    const waiting = pending.current;
    const retry = waiting && "kind" in waiting && waiting.kind === "ROGAINING" ? waiting : undefined;
    if (pending.current && !retry) return;
    setRogainingError(""); setRogainingSaved("");
    const op = begin();
    try {
      let attempt = retry;
      if (!attempt) {
        const change = proposed();
        if (!change || !courseList) return;
        let preview = rogainingPreview;
        if (!previewIsCurrent(preview, courseList.snapshotVersion)) {
          const read = await readPreview(op, change);
          if (read === "conflict") { await stale(op); return; }
          // Någon löpares status eller summa ändras: visa beskedet och vänta på bekräftelse.
          if (read.requiresConfirmation) return;
          preview = read;
        }
        const request: RogainingChangeRequest = { formatVersion: 1, requestId: crypto.randomUUID(),
          expectedSnapshotVersion: preview!.snapshotVersion, controlPoints: change.controlPoints, classRules: change.classRules,
          confirmResultChanges: preview!.requiresConfirmation };
        attempt = { kind: "ROGAINING", request };
        pending.current = attempt; sent.current = false; setRogainingAttempt(attempt);
      }
      await send(op, attempt);
    } catch { if (current(op)) setRogainingError(pending.current ? text.unknown : text.previewError); }
    finally { finish(op); }
  }
  return { changeRogainingPoints, changeRogainingRule, resetRogaining, previewRogaining, saveRogaining };
}
export type RogainingActions = ReturnType<typeof createRogainingActions>;

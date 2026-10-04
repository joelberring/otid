import { useState } from "react";
import { classVariantDistributionResponseSchema, entryVariantPreviewResponseSchema, entryVariantResponseSchema,
  type ClassVariantDistributionRequest, type EntryVariantPreviewResponse, type EntryVariantRequest } from "@o-tid/contracts";
import { courseVariantsSv as text } from "../../i18n/course-variants-sv";
import type { Operation } from "./types";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";
import type { CourseEditActions } from "./course-edit";

/**
 * Gafflingar i arbetsytan (ADR-0169 beslut 2): byt variant på deltagarkortet och
 * "Fördela gafflingar" i klasstabellen. Sparas direkt när inget resultat ändras;
 * annars visas beskedet och arrangören bekräftar.
 */
export function useCourseVariantState() {
  const [entryVariantPreview, setEntryVariantPreview] = useState<EntryVariantPreviewResponse>();
  const [entryVariantAttempt, setEntryVariantAttempt] = useState<EntryVariantRequest>();
  const [entryVariantMessage, setEntryVariantMessage] = useState("");
  const [entryVariantError, setEntryVariantError] = useState("");
  const [distributionAttempt, setDistributionAttempt] = useState<ClassVariantDistributionRequest>();
  const [distributionMessage, setDistributionMessage] = useState("");
  return { entryVariantPreview, setEntryVariantPreview, entryVariantAttempt, setEntryVariantAttempt, entryVariantMessage,
    setEntryVariantMessage, entryVariantError, setEntryVariantError, distributionAttempt, setDistributionAttempt,
    distributionMessage, setDistributionMessage };
}

export function createCourseVariantActions(ws: Base & RaceDataActions & CourseEditActions) {
  const { raceId, data, selected, courseList, entryVariantAttempt, distributionAttempt, busyRef, pending, requireSession,
    begin, finish, current, request, json, csrf, load, readCourses, setEntryVariantPreview, setEntryVariantAttempt,
    setEntryVariantMessage, setEntryVariantError, setDistributionAttempt, setDistributionMessage, setCourseListError } = ws;

  async function sendEntryVariant(op: Operation, attempt: EntryVariantRequest) {
    const response = await request(`/entries/${attempt.entryId}/variant`, op, { method: "POST",
      headers: { "content-type": "application/json", "x-otid-csrf": csrf(), "idempotency-key": `entry-variant:${attempt.requestId}` },
      body: JSON.stringify(attempt) });
    if (response.status === 409 || response.status === 400 || response.status === 404) {
      setEntryVariantAttempt(undefined); setEntryVariantPreview(undefined); setEntryVariantError(text.variantConflict);
      await load(op, attempt.entryId);
      return;
    }
    if (!response.ok) throw new Error("Unknown entry variant outcome");
    const receipt = entryVariantResponseSchema.parse(await json(response, op));
    if (receipt.raceId !== raceId || receipt.requestId !== attempt.requestId) throw new Error("Entry variant receipt mismatch");
    setEntryVariantAttempt(undefined); setEntryVariantPreview(undefined);
    setEntryVariantMessage(receipt.recalculated.length > 0 ? text.variantChangedRecalculated(attempt.variantCode)
      : text.variantChanged(attempt.variantCode));
    await load(op, attempt.entryId);
  }

  /** Arrangören väljer en variant i deltagarkortet: besked först om resultatet ändras, annars sparas direkt. */
  async function chooseEntryVariant(variantCode: string) {
    if (busyRef.current || pending.current || !requireSession() || !data || !selected || !variantCode ||
        variantCode === selected.courseVariantCode) return;
    setEntryVariantMessage(""); setEntryVariantError(""); setEntryVariantPreview(undefined);
    const op = begin();
    try {
      const response = await request(`/entries/${selected.id}/variant-preview`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf() },
        body: JSON.stringify({ formatVersion: 1, expectedSnapshotVersion: data.snapshotVersion, expectedEntryVersion: selected.version,
          variantCode }) });
      if (response.status === 409) { setEntryVariantError(text.variantConflict); await load(op, selected.id); return; }
      if (!response.ok) throw new Error("Entry variant preview unavailable");
      const preview = entryVariantPreviewResponseSchema.parse(await json(response, op));
      if (preview.raceId !== raceId || preview.entryId !== selected.id || preview.variantCode !== variantCode) {
        throw new Error("Entry variant preview mismatch");
      }
      const attempt: EntryVariantRequest = { formatVersion: 1, requestId: crypto.randomUUID(),
        expectedSnapshotVersion: preview.snapshotVersion, expectedEntryVersion: selected.version, entryId: selected.id, variantCode,
        confirmResultChanges: preview.requiresConfirmation };
      setEntryVariantAttempt(attempt);
      // Resultatet ändras: visa beskedet och vänta på bekräftelse.
      if (preview.requiresConfirmation) { setEntryVariantPreview(preview); return; }
      await sendEntryVariant(op, attempt);
    } catch { if (current(op)) setEntryVariantError(text.variantError); }
    finally { finish(op); }
  }
  async function confirmEntryVariant() {
    if (busyRef.current || !entryVariantAttempt || !requireSession()) return;
    setEntryVariantError("");
    const op = begin();
    try { await sendEntryVariant(op, entryVariantAttempt); }
    catch { if (current(op)) setEntryVariantError(text.variantError); }
    finally { finish(op); }
  }
  function cancelEntryVariant() {
    setEntryVariantAttempt(undefined); setEntryVariantPreview(undefined); setEntryVariantError("");
  }

  /** "Fördela gafflingar": löpare i klassen utan variant får en. Inget resultat ändras, så det sparas direkt. */
  async function distributeVariants(classId: string) {
    if (busyRef.current || pending.current || !requireSession() || !courseList) return;
    setDistributionMessage("");
    const retry = distributionAttempt?.classId === classId ? distributionAttempt : undefined;
    const attempt: ClassVariantDistributionRequest = retry ?? { formatVersion: 1, requestId: crypto.randomUUID(),
      expectedSnapshotVersion: courseList.snapshotVersion, classId };
    setDistributionAttempt(attempt);
    const op = begin();
    try {
      const response = await request(`/classes/${classId}/variant-distribution`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf(), "idempotency-key": `variant-distribution:${attempt.requestId}` },
        body: JSON.stringify(attempt) });
      if (response.status === 409 || response.status === 400 || response.status === 404) {
        setDistributionAttempt(undefined); setDistributionMessage(text.distributeConflict);
        await load(op); await readCourses(op);
        return;
      }
      if (!response.ok) throw new Error("Unknown distribution outcome");
      const receipt = classVariantDistributionResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.requestId !== attempt.requestId) throw new Error("Distribution receipt mismatch");
      setDistributionAttempt(undefined); setDistributionMessage(text.distributed(receipt.assignedCount));
      try { await load(op); await readCourses(op); }
      catch { if (current(op)) setCourseListError(text.distributeError); }
    } catch { if (current(op)) setDistributionMessage(text.distributeError); }
    finally { finish(op); }
  }
  return { chooseEntryVariant, confirmEntryVariant, cancelEntryVariant, distributeVariants };
}

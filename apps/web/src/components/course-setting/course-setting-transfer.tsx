"use client";

import { workspacePath } from "../../lib/race-sections";
import { useState } from "react";
import { courseSettingEn } from "../../i18n/course-setting-en";
import { sourcesEn } from "../../i18n/workspace-tools-en";
import { useTexts } from "../language-provider";
import Link from "next/link";
import {
  syncApplyResponseSchema, syncConsequenceResponseSchema, type SyncApplyRequest, type SyncConsequence, type SyncPreviewResponse
} from "@o-tid/contracts";
import { courseSettingSv } from "../../i18n/course-setting-sv";
import { sourcesSv } from "../../i18n/sources-sv";
import { courseSettingBase, previewCourseSettingTransfer } from "../../lib/course-setting-api";
import { SourceReviewPanel } from "../race-administrator/source-review";
import type { Message, SourceReview } from "../race-administrator/source-sync-actions";
import { Button, Notice } from "../ui";
import styles from "./course-setting.module.css";
import { adminFetch } from "../../lib/retrying-fetch";
import { inLanguage } from "../../lib/in-language";


/**
 * Banfilssynkens granskning (ADR-0170 beslut 4) utan arbetsytan: samma rader, urval, besked och godkännande med request-id
 * (`source-sync-actions.ts`), med egna anrop från banläggningens sida.
 */
function useStandaloneReview(raceId: string, onApplied: () => void): SourceReview & { busy: boolean } {
  const review = useTexts(sourcesSv.review, sourcesEn.review);
  const [preview, setPreview] = useState<SyncPreviewResponse>();
  const [excluded, setExcluded] = useState<string[]>([]);
  const [consequence, setConsequence] = useState<SyncConsequence>();
  const [attempt, setAttempt] = useState<SyncApplyRequest>();
  const [message, setMessage] = useState<Message>();
  const [busy, setBusy] = useState(false);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => adminFetch(`${courseSettingBase(raceId)}${path}`, {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body) });

  function show(next: SyncPreviewResponse) {
    setPreview(next); setExcluded([]); setConsequence(next.consequence); setAttempt(undefined); setMessage(undefined);
  }
  function close() { setPreview(undefined); setExcluded([]); setConsequence(undefined); setAttempt(undefined); }
  async function consequenceFor(snapshotId: string, rows: string[]) {
    const response = await post("/source-sync/consequence", { formatVersion: 1, snapshotId, excludedRowIds: rows });
    if (response.status === 404 || response.status === 409) return undefined;
    if (!response.ok) throw new Error(inLanguage("Beskedet kunde inte räknas", "The result could not be calculated"));
    return syncConsequenceResponseSchema.parse(await response.json()).consequence;
  }

  async function toggle(rowId: string) {
    if (!preview || busy || attempt) return;
    const next = excluded.includes(rowId) ? excluded.filter(id => id !== rowId) : [...excluded, rowId];
    setExcluded(next); setConsequence(undefined); setMessage(undefined); setBusy(true);
    try {
      const value = await consequenceFor(preview.snapshotId, next);
      if (!value) { close(); setMessage({ tone: "error", text: review.stale }); return; }
      setConsequence(value);
    } catch { setMessage({ tone: "error", text: review.failed }); } finally { setBusy(false); }
  }

  async function apply() {
    if (!preview || !consequence || busy) return;
    const value: SyncApplyRequest = attempt ?? { formatVersion: 1, requestId: crypto.randomUUID(), snapshotId: preview.snapshotId,
      excludedRowIds: excluded, confirmResultChanges: consequence.requiresConfirmation };
    setAttempt(value); setMessage(undefined); setBusy(true);
    try {
      const response = await post("/source-sync", value, { "idempotency-key": `source-sync:${value.requestId}` });
      if (response.status === 409) {
        // Beskedet kan ha ändrats (t.ex. en ny avläsning): visa det nya och låt banläggaren godkänna igen.
        setAttempt(undefined);
        const fresh = await consequenceFor(preview.snapshotId, excluded);
        if (fresh) { setConsequence(fresh); setMessage({ tone: "attention", text: review.consequenceChanged }); }
        else { close(); setMessage({ tone: "error", text: review.stale }); }
        return;
      }
      if (response.status === 400 || response.status === 404) { setAttempt(undefined); close(); setMessage({ tone: "error", text: review.stale }); return; }
      if (!response.ok) throw new Error(inLanguage("Överföringen misslyckades", "The transfer failed"));
      const receipt = syncApplyResponseSchema.parse(await response.json());
      if (receipt.requestId !== value.requestId || receipt.raceId !== raceId) throw new Error(inLanguage("Fel kvitto", "Unexpected receipt"));
      close();
      setMessage({ tone: "ok", text: review.applied(receipt.appliedRows, receipt.recalculatedCount) });
      onApplied();
    } catch { setMessage({ tone: "error", text: review.failed }); } finally { setBusy(false); }
  }

  return { preview, excluded, consequence, attempt, message, setMessage, show, close, toggle, apply, busy };
}

/** "Överför till tävlingen": sparar först, visar sedan skillnaderna mot tävlingens banor och godkänns som en banfil. */
export function TransferPanel({ raceId, ready, flush, version }: { raceId: string; ready: boolean; flush: () => Promise<boolean>; version: () => number }) {
  const text = useTexts(courseSettingSv, courseSettingEn);
  const [problem, setProblem] = useState<string>();
  const [applied, setApplied] = useState(false);
  const [loading, setLoading] = useState(false);
  const state = useStandaloneReview(raceId, () => setApplied(true));

  async function start() {
    setProblem(undefined); setApplied(false); state.setMessage(undefined); setLoading(true);
    try {
      if (!await flush()) { setProblem(text.transfer.waitForSave); return; }
      const result = await previewCourseSettingTransfer(raceId, version());
      if (result.kind === "conflict") { setProblem(text.status.conflict); return; }
      if (result.kind === "problem") {
        const { error, controls } = result.problem;
        setProblem(error === "INVALID_CODES" ? text.transfer.problems.INVALID_CODES(controls.join(", ")) : text.transfer.problems[error]);
        return;
      }
      state.show(result.preview);
    } catch { setProblem(text.transfer.failed); } finally { setLoading(false); }
  }

  return <section className={`${styles.panel} ${state.preview ? styles.review : ""}`} aria-labelledby="course-setting-transfer">
    <h2 id="course-setting-transfer">{text.transfer.heading}</h2>
    <p className={styles.muted}>{text.transfer.help}</p>
    {!state.preview && <div className={styles.row}>
      <Button onClick={() => void start()} disabled={!ready || loading || state.busy}>{text.transfer.button}</Button></div>}
    {problem && <Notice tone="error" role="alert">{problem}</Notice>}
    {state.message && <Notice tone={state.message.tone} role={state.message.tone === "ok" ? "status" : "alert"}>{state.message.text}
      {applied && <> <Link href={workspacePath(raceId, "COURSES")}>{text.back}</Link></>}</Notice>}
    <SourceReviewPanel review={state} busy={state.busy} sourceName={state.preview?.sourceName ?? text.transfer.heading} />
  </section>;
}

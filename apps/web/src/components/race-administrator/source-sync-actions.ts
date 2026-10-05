import { useState } from "react";
import {
  syncApplyResponseSchema, syncConsequenceResponseSchema, type SyncApplyRequest, type SyncConsequence, type SyncPreviewResponse
} from "@o-tid/contracts";
import { sourcesSv } from "../../i18n/sources-sv";
import type { Workspace } from "./workspace-state";

const text = sourcesSv.review;
export type Message = { tone: "ok" | "error" | "attention"; text: string };

/**
 * Granskning av skillnader (ADR-0170 beslut 4), gemensam för Eventor och banfil: rader kan
 * bockas ur, beskedet räknas om för urvalet och godkännandet skickas med ett request-id som
 * behålls tills kvittot kommit (samma id ger samma kvitto vid omförsök).
 */
export function useSourceReview(ws: Workspace) {
  const { busyRef, beginRequest, request, json, finish, current, csrf, requireSession, load, raceId } = ws;
  const [preview, setPreview] = useState<SyncPreviewResponse>();
  const [excluded, setExcluded] = useState<string[]>([]);
  const [consequence, setConsequence] = useState<SyncConsequence>();
  const [attempt, setAttempt] = useState<SyncApplyRequest>();
  const [message, setMessage] = useState<Message>();

  function show(next: SyncPreviewResponse) {
    setPreview(next); setExcluded([]); setConsequence(next.consequence); setAttempt(undefined); setMessage(undefined);
  }
  function close() { setPreview(undefined); setExcluded([]); setConsequence(undefined); setAttempt(undefined); }

  /** Bocka ur eller i en rad; beskedet räknas om för det nya urvalet. */
  async function toggle(rowId: string) {
    if (!preview || busyRef.current || attempt || !requireSession()) return;
    const next = excluded.includes(rowId) ? excluded.filter(id => id !== rowId) : [...excluded, rowId];
    setExcluded(next); setConsequence(undefined); setMessage(undefined);
    const op = beginRequest();
    try {
      const response = await request("/source-sync/consequence", op, { method: "POST", headers: { "content-type": "application/json",
        "x-otid-csrf": csrf() }, body: JSON.stringify({ formatVersion: 1, snapshotId: preview.snapshotId,
        expectedSnapshotVersion: preview.snapshotVersion, excludedRowIds: next }) });
      if (response.status === 404 || response.status === 409) { close(); setMessage({ tone: "error", text: text.stale }); return; }
      if (!response.ok) throw new Error("Consequence unavailable");
      const value = syncConsequenceResponseSchema.parse(await json(response, op));
      if (value.snapshotId !== preview.snapshotId) throw new Error("Consequence mismatch");
      setConsequence(value.consequence);
    } catch { if (current(op)) setMessage({ tone: "error", text: sourcesSv.eventor.failed }); }
    finally { finish(op); }
  }

  async function apply() {
    if (!preview || !consequence || busyRef.current || !requireSession()) return;
    const value: SyncApplyRequest = attempt ?? { formatVersion: 1, requestId: crypto.randomUUID(), snapshotId: preview.snapshotId,
      expectedSnapshotVersion: preview.snapshotVersion, excludedRowIds: excluded, confirmResultChanges: consequence.requiresConfirmation };
    setAttempt(value); setMessage(undefined);
    const op = beginRequest();
    try {
      const response = await request("/source-sync", op, { method: "POST", headers: { "content-type": "application/json",
        "x-otid-csrf": csrf(), "idempotency-key": `source-sync:${value.requestId}` }, body: JSON.stringify(value) });
      if (response.status === 409 && preview) {
        // Beskedet kan ha ändrats (t.ex. en ny avläsning): visa det nya och låt administratören godkänna igen.
        setAttempt(undefined);
        const fresh = await request("/source-sync/consequence", op, { method: "POST", headers: { "content-type": "application/json",
          "x-otid-csrf": csrf() }, body: JSON.stringify({ formatVersion: 1, snapshotId: preview.snapshotId,
          expectedSnapshotVersion: preview.snapshotVersion, excludedRowIds: excluded }) });
        if (fresh.ok) {
          setConsequence(syncConsequenceResponseSchema.parse(await json(fresh, op)).consequence);
          setMessage({ tone: "attention", text: text.consequenceChanged });
        } else { close(); setMessage({ tone: "error", text: text.stale }); }
        return;
      }
      if (response.status === 400 || response.status === 404) { setAttempt(undefined); close(); setMessage({ tone: "error", text: text.stale }); return; }
      if (!response.ok) throw new Error("Apply failed");
      const receipt = syncApplyResponseSchema.parse(await json(response, op));
      if (receipt.requestId !== value.requestId || receipt.raceId !== raceId) throw new Error("Receipt mismatch");
      close();
      setMessage({ tone: "ok", text: text.applied(receipt.appliedRows, receipt.recalculatedCount) });
      await load(op);
    } catch { if (current(op)) setMessage({ tone: "error", text: text.failed }); }
    finally { finish(op); }
  }

  return { preview, excluded, consequence, attempt, message, setMessage, show, close, toggle, apply };
}
export type SourceReview = ReturnType<typeof useSourceReview>;

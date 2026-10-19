"use client";

import { useState } from "react";
import { markRemainingDidNotStartResponseSchema, remainingRunnersResponseSchema, type MarkRemainingDidNotStartRequest,
  type RemainingRunnersResponse } from "@o-tid/contracts";
import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { Button, Notice } from "../ui";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";
import type { Workspace } from "./workspace-state";

/** "Markera alla kvar i skogen som ej start" (PLAN.md steg 25): förhandsvisning, en bekräftelse och kvitto. */
export function useRemainingRunnersState() {
  const [remaining, setRemaining] = useState<RemainingRunnersResponse>();
  /** Begäran behålls tills servern svarat; ett nytt försök efter nätfel skickar samma id. */
  const [remainingRequest, setRemainingRequest] = useState<MarkRemainingDidNotStartRequest>();
  const [remainingMessage, setRemainingMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  return { remaining, setRemaining, remainingRequest, setRemainingRequest, remainingMessage, setRemainingMessage };
}

export function createRemainingRunnersActions(ws: Base & RaceDataActions) {
  const { raceId, remaining, remainingRequest, writingRef, pending, requireSession, begin, finish, current, request, json, csrf, load,
    setRemaining, setRemainingRequest, setRemainingMessage } = ws;
  async function loadRemaining() {
    if (writingRef.current || pending.current || !requireSession()) return;
    const op = begin(); setRemainingRequest(undefined);
    try {
      const response = await request("/remaining-runners", op);
      if (!response.ok) throw new Error("Remaining runners unavailable");
      const value = remainingRunnersResponseSchema.parse(await json(response, op));
      if (value.raceId !== raceId) throw new Error("Remaining runners scope mismatch");
      // Beskedet byts först när listan finns, så att avsnittet står öppet hela tiden.
      setRemaining(value); setRemainingMessage(undefined);
    } catch { if (current(op)) setRemainingMessage({ tone: "error", text: text.remainingLoadError }); }
    finally { finish(op); }
  }
  async function markRemaining() {
    if (writingRef.current || pending.current || !requireSession() || !remaining || remaining.didNotStart.length === 0) return;
    const body: MarkRemainingDidNotStartRequest = remainingRequest ?? { formatVersion: 1, requestId: crypto.randomUUID(),
      entryIds: remaining.didNotStart.map(runner => runner.entryId) };
    setRemainingRequest(body);
    const op = begin(true);
    try {
      const response = await request("/remaining-runners", op, { method: "POST", headers: { "content-type": "application/json",
        "x-otid-csrf": csrf(), "idempotency-key": `remaining-did-not-start:${body.requestId}` }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error("Remaining runners not marked");
      const receipt = markRemainingDidNotStartResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.requestId !== body.requestId) throw new Error("Remaining receipt mismatch");
      setRemaining(undefined); setRemainingRequest(undefined);
      setRemainingMessage({ tone: "ok", text: text.remainingSaved(receipt.marked.length, receipt.skippedCount) });
      await load(op);
    } catch { if (current(op)) setRemainingMessage({ tone: "error", text: text.remainingSaveError }); }
    finally { finish(op); }
  }
  function cancelRemaining() { if (!writingRef.current) { setRemaining(undefined); setRemainingRequest(undefined); } }
  return { loadRemaining, markRemaining, cancelRemaining };
}

/** Efter tävlingen: förhandsvisningen med två listor och en knapp som markerar alla på en gång. */
export function RemainingRunnersSection({ ws }: { ws: Workspace }) {
  const { busy, cancelRemaining, disabled, loadRemaining, markRemaining, remaining, remainingMessage, remainingRequest } = ws;
  return <div className={styles.disclosureBody} data-testid="remaining-runners">
    <p className={styles.workflowHelp}>{text.remainingHelp}</p>
    {!remaining && <div><Button variant="secondary" disabled={disabled} onClick={() => void loadRemaining()}>{text.remainingLoad}</Button></div>}
    {remainingMessage && <Notice tone={remainingMessage.tone} role="status">{remainingMessage.text}</Notice>}
    {remaining && <section className={styles.review} aria-label={text.remainingTitle}>
      <h3>{text.remainingDidNotStart(remaining.didNotStart.length)}</h3>
      {remaining.didNotStart.length === 0 ? <p>{text.remainingNone}</p> : <ul className={styles.changeList}>
        {remaining.didNotStart.map(runner => <li key={runner.entryId}><strong>{runner.name}</strong> · {runner.className}
          {runner.organisationName ? ` · ${runner.organisationName}` : ""}</li>)}</ul>}
      {remaining.missingAtFinish.length > 0 && <>
        <h3>{text.remainingMissing(remaining.missingAtFinish.length)}</h3>
        <ul className={styles.changeList}>{remaining.missingAtFinish.map(runner => <li key={runner.entryId}>
          <strong>{runner.name}</strong> · {runner.className} · {text.remainingEvidence[runner.evidence ?? "START_CHECKIN"]}</li>)}</ul>
        <p>{text.remainingMissingHelp}</p>
      </>}
      <div className={styles.actions}>
        {remaining.didNotStart.length > 0 && <Button disabled={busy} onClick={() => void markRemaining()}>
          {remainingRequest ? text.retry : text.remainingConfirm(remaining.didNotStart.length)}</Button>}
        {!remainingRequest && <Button variant="secondary" disabled={busy} onClick={cancelRemaining}>{text.remainingCancel}</Button>}
      </div>
    </section>}
  </div>;
}

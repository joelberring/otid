"use client";

import { useState } from "react";
import { selfRegistrationCleanupPreviewSchema, selfRegistrationCleanupResponseSchema, type SelfRegistrationCleanupPreview,
  type SelfRegistrationCleanupRequest } from "@o-tid/contracts";
import styles from "../race-administrator-workspace.module.css";
import { selfRegistrationSv } from "../../i18n/self-registration-sv";
import { Button, Notice } from "../ui";
import type { Workspace } from "./workspace-state";

const text = selfRegistrationSv.cleanup;

/**
 * PLAN.md steg 46: "Stryk alla självregistrerade som inte läst ut" under Anmälda. Först en förhandsvisning med namnen,
 * sedan en bekräftelse. Begäran behålls tills servern svarat, så att ett nytt försök efter nätfel skickar samma id.
 */
export function SelfRegistrationCleanup({ ws }: { ws: Workspace }) {
  const { raceId, writingRef, pending, requireSession, begin, finish, current, request, json, csrf, load, disabled, busy, data } = ws;
  const [preview, setPreview] = useState<SelfRegistrationCleanupPreview>();
  const [attempt, setAttempt] = useState<SelfRegistrationCleanupRequest>();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();

  async function loadPreview() {
    if (writingRef.current || pending.current || !requireSession()) return;
    const op = begin(); setAttempt(undefined);
    try {
      const response = await request("/self-registrations", op);
      if (!response.ok) throw new Error("Self registrations unavailable");
      const value = selfRegistrationCleanupPreviewSchema.parse(await json(response, op));
      if (value.raceId !== raceId) throw new Error("Self registrations scope mismatch");
      setPreview(value); setMessage(undefined);
    } catch { if (current(op)) setMessage({ tone: "error", text: text.loadError }); }
    finally { finish(op); }
  }

  async function strike() {
    if (writingRef.current || pending.current || !requireSession() || !preview || preview.entries.length === 0) return;
    const body: SelfRegistrationCleanupRequest = attempt ?? { formatVersion: 1, requestId: crypto.randomUUID(),
      entryIds: preview.entries.map(row => row.entryId) };
    setAttempt(body);
    const op = begin(true);
    try {
      const response = await request("/self-registrations", op, { method: "POST", headers: { "content-type": "application/json",
        "x-otid-csrf": csrf(), "idempotency-key": `self-registration-cleanup:${body.requestId}` }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error("Self registrations not struck");
      const receipt = selfRegistrationCleanupResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.requestId !== body.requestId) throw new Error("Self registration receipt mismatch");
      setPreview(undefined); setAttempt(undefined);
      setMessage({ tone: "ok", text: text.saved(receipt.struckEntryIds.length, receipt.skippedCount) });
      await load(op);
    } catch { if (current(op)) setMessage({ tone: "error", text: text.saveError }); }
    finally { finish(op); }
  }

  // Knappen syns bara när någon är självregistrerad; beskedet står kvar efter att de strukits.
  const any = !!data?.entries.some(entry => entry.selfRegistered);
  if (!any && !preview && !message) return null;
  return <div data-testid="self-registration-cleanup">
    {!preview && any && <Button variant="secondary" disabled={disabled} onClick={() => void loadPreview()}>{text.load}</Button>}
    {message && <Notice tone={message.tone} role="status">{message.text}</Notice>}
    {preview && <section className={styles.review} aria-label={text.title}>
      <h3>{text.count(preview.entries.length)}</h3>
      <p className={styles.workflowHelp}>{text.help}</p>
      {preview.entries.length === 0 ? <p>{text.none}</p> : <ul className={styles.changeList}>
        {preview.entries.map(row => <li key={row.entryId}><strong>{row.name}</strong> · {row.className}
          {row.organisationName ? ` · ${row.organisationName}` : ""}{row.cardNumber ? ` · ${row.cardNumber}` : ""}</li>)}</ul>}
      <div className={styles.actions}>
        {preview.entries.length > 0 && <Button disabled={busy} onClick={() => void strike()}>
          {attempt ? text.retry : text.confirm(preview.entries.length)}</Button>}
        {!attempt && <Button variant="secondary" disabled={busy} onClick={() => { setPreview(undefined); setMessage(undefined); }}>
          {text.cancel}</Button>}
      </div>
    </section>}
  </div>;
}

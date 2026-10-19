"use client";

import styles from "../race-administrator-workspace.module.css";
import { removalSv as text } from "../../i18n/removal-sv";
import { Button, Notice } from "../ui";
import type { RemovalAttempt } from "./removal";
import type { Workspace } from "./workspace-state";

/**
 * Bekräftelsen och beskedet för "Ta bort" och "Stryk" (PLAN.md steg 27), vid raden eller deltagarkortet som det gäller.
 * En mening om följden, en knapp som gör det och Avbryt; efter ett nätfel blir knappen "Försök igen" med samma begäran.
 */
export function RemovalReview({ ws, kind, id }: { ws: Workspace; kind: RemovalAttempt["kind"]; id: string }) {
  const { busy, removalAttempt, removalMessage, removalUnknown, confirmRemoval, cancelRemoval } = ws;
  const attempt = removalAttempt?.kind === kind && removalAttempt.id === id ? removalAttempt : undefined;
  const message = removalMessage?.kind === kind && removalMessage.id === id ? removalMessage : undefined;
  if (!attempt) return message ? <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice> : null;
  const consequence = attempt.kind === "ENTRY"
    ? attempt.mode === "STRIKE" ? text.entryStrikeConsequence(attempt.name) : text.entryDeleteConsequence(attempt.name)
    : attempt.kind === "CLASS" ? text.classDeleteConsequence(attempt.name) : text.courseDeleteConsequence(attempt.name);
  const confirm = attempt.kind === "ENTRY" && attempt.mode === "STRIKE" ? text.confirmStrike
    : attempt.kind === "CLASS" ? text.classDelete : attempt.kind === "COURSE" ? text.courseDelete : text.confirmDelete;
  return <section className={styles.review} role="alert" aria-label={confirm} data-testid="removal-review">
    <p><strong>{consequence}</strong></p>
    {message && <Notice tone={message.tone}>{message.text}</Notice>}
    <div className={styles.actions}>
      <Button disabled={busy} onClick={() => void confirmRemoval()}>{removalUnknown ? text.retry : confirm}</Button>
      {!removalUnknown && <Button variant="secondary" disabled={busy} onClick={cancelRemoval}>{text.cancel}</Button>}
    </div>
  </section>;
}

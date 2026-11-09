"use client";

import { useState } from "react";
import { collaborationEn } from "../../i18n/course-setting-collab-en";
import { useTexts } from "../language-provider";
import type { CourseSettingSuggestion, CourseSettingSuggestionDecided } from "@o-tid/contracts";
import type { CourseSettingDocument, CourseSettingEdit } from "@o-tid/course-setting";
import { collaborationSv } from "../../i18n/course-setting-collaboration-sv";
import { useDescribeEdit } from "./use-describe-edit";
import { Button, Notice } from "../ui";
import styles from "./course-setting.module.css";

/** Förslagsläget (den som föreslår): hur många ändringar, kommentar, skicka eller kasta. */
export function SuggestionDraft({ count, onSend, onDiscard }: { count: number; onSend: (comment: string) => Promise<boolean>; onDiscard: () => void }) {
  const text = useTexts(collaborationSv, collaborationEn);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  return <div className={styles.draft} data-testid="course-setting-draft">
    <strong>{text.suggestions.drafting}</strong>
    <p className={styles.muted}>{text.suggestions.draftHelp}</p>
    <p role="status">{text.suggestions.draftCount(count)}</p>
    <label className={styles.stack}>{text.suggestions.comment}
      <textarea value={comment} rows={2} maxLength={2000} onChange={event => setComment(event.target.value)} /></label>
    <div className={styles.row}>
      <Button disabled={busy || count === 0} onClick={() => {
        setBusy(true); setMessage(undefined);
        void onSend(comment.trim()).then(ok => {
          setMessage(ok ? { tone: "ok", text: text.suggestions.sent } : { tone: "error", text: text.suggestions.failed });
          if (ok) setComment("");
        }).finally(() => setBusy(false));
      }}>{text.suggestions.send}</Button>
      <Button variant="quiet" disabled={busy || count === 0} onClick={() => { if (window.confirm(text.suggestions.discardConfirm)) onDiscard(); }}>
        {text.suggestions.discard}</Button>
    </div>
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
  </div>;
}

/** Ett förslag som granskas: åtgärderna att välja bland, godkänn (alla eller valda) eller avböj med kommentar. */
function Review({ suggestion, document, skip, onSkip, canDecide, onDecide, rejected }: {
  suggestion: CourseSettingSuggestion; document: CourseSettingDocument; skip: ReadonlySet<number>; onSkip: (skip: ReadonlySet<number>) => void;
  canDecide: boolean; onDecide: (decision: "APPROVE" | "DECLINE", comment: string) => Promise<void>; rejected: ReadonlySet<number>;
}) {
  const describeEdit = useDescribeEdit();
  const text = useTexts(collaborationSv, collaborationEn);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedCount = suggestion.edits.length - skip.size;
  return <div className={styles.reviewBox} data-testid="course-setting-review">
    <p className={styles.muted}>{text.suggestions.reviewing}</p>
    {suggestion.comment && <blockquote className={styles.quote}>{suggestion.comment}</blockquote>}
    <fieldset className={styles.editList}>
      <legend>{text.suggestions.pick}</legend>
      {suggestion.edits.map((edit, index) => <label key={index} className={styles.check} data-rejected={rejected.has(index) || undefined}>
        <input type="checkbox" checked={!skip.has(index)} disabled={!canDecide || suggestion.status !== "OPEN"} onChange={event => {
          const next = new Set(skip);
          if (event.target.checked) next.delete(index); else next.add(index);
          onSkip(next);
        }} />
        {describeEdit(edit as CourseSettingEdit, document)}{rejected.has(index) ? ` – ${text.suggestions.notPossible.replace(":", "")}` : ""}
      </label>)}
    </fieldset>
    {canDecide && suggestion.status === "OPEN" && <>
      <div className={styles.row}>
        <Button disabled={busy || selectedCount === 0} onClick={() => { setBusy(true); void onDecide("APPROVE", comment).finally(() => setBusy(false)); }}>
          {skip.size === 0 ? text.suggestions.approveAll : text.suggestions.approveSelected(selectedCount)}</Button>
      </div>
      <label className={styles.stack}>{text.suggestions.declineComment}
        <textarea value={comment} rows={2} maxLength={2000} onChange={event => setComment(event.target.value)} /></label>
      <div className={styles.row}>
        <Button variant="secondary" disabled={busy} onClick={() => { setBusy(true); void onDecide("DECLINE", comment).finally(() => setBusy(false)); }}>
          {text.suggestions.decline}</Button>
      </div>
    </>}
  </div>;
}

/** Förslagen: öppna överst (granska ritar förslaget på kartan), sedan tidigare med beslutet. */
export function SuggestionsPanel({ suggestions, document, reviewing, onReview, skip, onSkip, canDecide, onDecide, result, rejected, draft }: {
  suggestions: readonly CourseSettingSuggestion[]; document: CourseSettingDocument; reviewing: string | undefined;
  onReview: (id: string | undefined) => void; skip: ReadonlySet<number>; onSkip: (skip: ReadonlySet<number>) => void; canDecide: boolean;
  onDecide: (id: string, decision: "APPROVE" | "DECLINE", comment: string) => Promise<void>;
  result: { suggestion: string; decided: CourseSettingSuggestionDecided } | { suggestion: string; failed: true } | undefined;
  rejected: ReadonlySet<number>; draft?: React.ReactNode;
}) {
  const describeEdit = useDescribeEdit();
  const text = useTexts(collaborationSv, collaborationEn);
  const open = suggestions.filter(row => row.status === "OPEN");
  const decided = suggestions.filter(row => row.status !== "OPEN").slice(0, 20);
  const row = (suggestion: CourseSettingSuggestion) => <li key={suggestion.id} data-status={suggestion.status}>
    <div className={styles.suggestionHead}>
      <span><strong>{text.suggestions.status[suggestion.status]}</strong> · {text.suggestions.row(suggestion.createdBy.displayName,
        suggestion.createdAt, suggestion.edits.length)}</span>
      <Button variant="secondary" aria-pressed={reviewing === suggestion.id} onClick={() => onReview(reviewing === suggestion.id ? undefined : suggestion.id)}>
        {reviewing === suggestion.id ? text.suggestions.stopReview : text.suggestions.review}</Button>
    </div>
    {suggestion.status !== "OPEN" && suggestion.decidedAt && <p className={styles.muted}>
      {text.suggestions.decisionBy(suggestion.decidedBy?.displayName ?? null, suggestion.decidedAt)}
      {suggestion.decisionComment ? `: ${suggestion.decisionComment}` : ""}</p>}
    {reviewing === suggestion.id && <Review suggestion={suggestion} document={document} skip={skip} onSkip={onSkip} canDecide={canDecide}
      rejected={rejected} onDecide={(decision, comment) => onDecide(suggestion.id, decision, comment)} />}
    {result?.suggestion === suggestion.id && ("failed" in result ? <Notice tone="error" role="alert">{text.suggestions.decisionFailed}</Notice>
      : <Notice tone={result.decided.saved && result.decided.saved.rejected.length > 0 ? "attention" : "ok"} role="status">
        {result.decided.suggestion.status === "DECLINED" ? text.suggestions.declined : text.suggestions.approved(result.decided.saved?.applied ?? 0)}
        {result.decided.saved && result.decided.saved.rejected.length > 0 && <>
          {" "}{text.suggestions.notPossible}<ul>{result.decided.saved.rejected.map(item =>
            <li key={item.index}>{describeEdit(suggestion.edits[item.index] as CourseSettingEdit, document)}: {item.message}</li>)}</ul></>}
      </Notice>)}
  </li>;
  return <section className={styles.panel} aria-labelledby="course-setting-suggestions" data-testid="course-setting-suggestions">
    <h2 id="course-setting-suggestions">{text.suggestions.heading}</h2>
    {draft}
    <p className={styles.muted}>{open.length === 0 ? text.suggestions.none : text.suggestions.open(open.length)}</p>
    {open.length > 0 && <ul className={styles.suggestionList}>{open.map(row)}</ul>}
    {decided.length > 0 && <>
      <h3 className={styles.muted}>{text.suggestions.history}</h3>
      <ul className={styles.suggestionList}>{decided.map(row)}</ul>
    </>}
  </section>;
}

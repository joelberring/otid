"use client";

import { useState } from "react";
import type { CourseSettingNoteReplyItem } from "@o-tid/contracts";
import { mapLinkSv } from "../../i18n/map-link-sv";
import { HttpStatusError } from "../../lib/course-setting-sync";
import { Button } from "../ui";
import styles from "./note-text.module.css";

const text = mapLinkSv;

/** Vem som skrev svaret: visningsnamnet, eller kartritaren med länken (namnet hen skrev eller "Kartritaren"). */
export function replyAuthor(reply: Pick<CourseSettingNoteReplyItem, "createdBy" | "mapMaker">): string {
  if (reply.mapMaker) return reply.mapMaker.name ?? text.page.mapMaker;
  return reply.createdBy?.displayName ?? text.page.courseSetter;
}

/** Kartritarens besked i tråden ("Åtgärdat i kartan" / "Inte åtgärdat"). */
export function VerdictBadge({ verdict }: { verdict: string | null | undefined }) {
  if (!verdict) return null;
  return <strong className={styles.verdict} data-verdict={verdict}>{text.page.verdicts[verdict]}</strong>;
}

/** "(ändrad 5 nov. 14:02)" när texten har redigerats. */
export function EditedMark({ editedAt }: { editedAt: string | null | undefined }) {
  return editedAt ? <span className={styles.edited} data-testid="note-edited">{text.edit.edited(editedAt)}</span> : null;
}

export type EditOutcome = "ok" | "conflict" | "failed";

/** Gör om felet vid en redigering till ett utfall (409 = någon annan ändrade texten). */
export async function editOutcome(run: () => Promise<unknown>): Promise<EditOutcome> {
  try { await run(); return "ok"; } catch (error) {
    if (error instanceof HttpStatusError && error.status === 409) return "conflict";
    console.error("Ändringen sparades inte", error);
    return "failed";
  }
}

/**
 * ADR-0214 beslut 9: texten i en notis eller ett svar med "Redigera" för den som skrev den. Redigeringen bygger på texten som
 * visas (`expectedText`); har någon annan ändrat den visas beskedet och den nya texten.
 */
export function EditableText({ value, editedAt, canEdit, onSave, as = "p" }: { value: string; editedAt?: string | null | undefined; canEdit: boolean;
  onSave: (text: string, expectedText: string) => Promise<EditOutcome>; as?: "p" | "span" }) {
  const [draft, setDraft] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const Tag = as;
  if (draft === undefined) {
    return <Tag className={styles.text}>
      {value}{" "}<EditedMark editedAt={editedAt} />
      {canEdit && <Button variant="quiet" className={styles.small} onClick={() => { setDraft(value); setMessage(undefined); }}>{text.edit.edit}</Button>}
      {message && <span role="alert" className={styles.message}>{message}</span>}
    </Tag>;
  }
  return <form className={styles.form} onSubmit={event => {
    event.preventDefault();
    const next = draft.trim();
    if (!next || busy) return;
    setBusy(true);
    void onSave(next, value).then(outcome => {
      if (outcome === "ok") { setDraft(undefined); setMessage(undefined); }
      else if (outcome === "conflict") { setDraft(undefined); setMessage(text.edit.conflict); }
      else setMessage(text.edit.failed);
    }).finally(() => setBusy(false));
  }}>
    <label>{text.edit.label}<textarea value={draft} maxLength={2000} rows={3} onChange={event => setDraft(event.target.value)} required /></label>
    {message && <span role="alert" className={styles.message}>{message}</span>}
    <span className={styles.row}>
      <Button type="submit" variant="secondary" disabled={busy || !draft.trim()}>{text.edit.save}</Button>
      <Button variant="quiet" onClick={() => setDraft(undefined)}>{text.edit.cancel}</Button>
    </span>
  </form>;
}

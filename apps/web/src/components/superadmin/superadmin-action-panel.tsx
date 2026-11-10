"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { superadminEn } from "../../i18n/superadmin-en";
import { useTexts, useLocale } from "../language-provider";
import type { SuperadminActionRequest } from "@o-tid/contracts";
import { superadminSv } from "../../i18n/superadmin-sv";
import { Button, CopyButton, Field, Notice } from "../ui";
import styles from "../account-pages.module.css";


export type PendingAction =
  | { kind: "HIDE_RACE" | "UNHIDE_RACE"; raceId: string; label: string }
  | { kind: "DELETE_EVENT"; eventId: string; label: string; confirm: string }
  | { kind: "BLOCK_ACCOUNT" | "UNBLOCK_ACCOUNT" | "CREATE_RESET_LINK"; accountId: string; label: string }
  | { kind: "DELETE_ACCOUNT"; accountId: string; label: string; confirm: string; ownedEvents: number };

export function actionRequest(action: PendingAction, reason: string, confirmation: string): SuperadminActionRequest {
  switch (action.kind) {
    case "HIDE_RACE": case "UNHIDE_RACE": return { formatVersion: 1, action: action.kind, raceId: action.raceId, reason };
    case "DELETE_EVENT": return { formatVersion: 1, action: action.kind, eventId: action.eventId, reason, confirmation };
    case "DELETE_ACCOUNT": return { formatVersion: 1, action: action.kind, accountId: action.accountId, reason, confirmation };
    default: return { formatVersion: 1, action: action.kind, accountId: action.accountId, reason };
  }
}

/** Bekräftelse av en superadminåtgärd: skäl (loggas) och, vid borttagning, namnet eller adressen. */
export function SuperadminActionPanel({ action, busy, error, onSubmit, onCancel }: {
  action: PendingAction; busy: boolean; error: string | undefined;
  onSubmit: (reason: string, confirmation: string) => void; onCancel: () => void;
}) {
  const text = useTexts(superadminSv, superadminEn);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [action]);
  const confirm = "confirm" in action ? action.confirm : undefined;
  const destructive = action.kind === "DELETE_EVENT" || action.kind === "DELETE_ACCOUNT";
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit(reason.trim(), confirmation); };
  return <form className={styles.panel} onSubmit={submit} aria-labelledby="superadmin-action-title">
    <h3 id="superadmin-action-title" ref={heading} tabIndex={-1}>{text.confirmTitle[action.kind]}</h3>
    <dl className={styles.facts}><dt>{text.target}</dt><dd>{action.label}</dd></dl>
    <p>{text.confirmHelp[action.kind]}</p>
    {action.kind === "DELETE_ACCOUNT" && action.ownedEvents > 0 && <Notice tone="attention">{text.ownedEvents(action.ownedEvents)}</Notice>}
    <Field label={text.reason}>
      <input value={reason} maxLength={500} required disabled={busy} onChange={event => setReason(event.target.value)} />
    </Field>
    {confirm && <Field label={action.kind === "DELETE_EVENT" ? text.confirmName(confirm) : text.confirmEmail(confirm)}>
      <input value={confirmation} autoComplete="off" spellCheck={false} required disabled={busy} onChange={event => setConfirmation(event.target.value)} />
    </Field>}
    {error && <Notice tone="error" role="alert">{error}</Notice>}
    <div className={styles.actions}>
      <Button type="submit" className={destructive ? styles.danger : undefined}
        disabled={busy || !reason.trim() || (confirm !== undefined && !confirmation.trim())}>{busy ? text.working : text.perform}</Button>
      <Button variant="secondary" disabled={busy} onClick={onCancel}>{text.cancel}</Button>
    </div>
  </form>;
}

/** Återställningslänken visas en gång, med kopiering. */
export function ResetLink({ url, expiresAt, onClose }: { url: string; expiresAt: string; onClose: () => void }) {
  const locale = useLocale();
  const text = useTexts(superadminSv, superadminEn);
  const [copied, setCopied] = useState<string>();
  const time = new Date(expiresAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return <div className={styles.panel} role="status">
    <h3>{text.resetTitle}</h3>
    <p>{text.resetHelp(time)}</p>
    <output className={styles.link} aria-label={text.resetTitle}>{url}</output>
    <div className={styles.actions}>
      <CopyButton value={url} onResult={ok => setCopied(ok ? text.copied : text.copyFailed)}>{text.copy}</CopyButton>
      <Button variant="secondary" onClick={onClose}>{text.closeLink}</Button>
      {copied && <span>{copied}</span>}
    </div>
  </div>;
}

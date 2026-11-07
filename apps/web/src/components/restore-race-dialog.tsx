"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  raceBackupPreviewSchema, raceBackupProblemSchema, raceRestoreResponseSchema, type RaceBackupPreview, type RaceRestoreResponse
} from "@o-tid/contracts";
import { raceTitle } from "@o-tid/domain";
import { raceBackupSv } from "../i18n/race-backup-sv";
import { readOrganizerCsrf } from "../lib/organizer-client";
import { Button, Field, Notice } from "./ui";
import styles from "./copy-race-dialog.module.css";

const text = raceBackupSv.restore;

/** Skickar filen som den är. Ger svarets status och JSON (eller undefined). */
async function send(path: string, file: File): Promise<{ status: number; json: unknown }> {
  let csrf: string;
  try { csrf = readOrganizerCsrf(document.cookie, new URL(window.location.href)); } catch { return { status: 401, json: undefined }; }
  const response = await fetch(path, { method: "POST", credentials: "same-origin", cache: "no-store", body: file,
    headers: { "content-type": "application/zip", "x-otid-csrf": csrf } });
  let json: unknown;
  try { json = await response.json() as unknown; } catch { json = undefined; }
  return { status: response.status, json };
}

function failure(status: number, json: unknown): string {
  const parsed = raceBackupProblemSchema.safeParse(json);
  if (parsed.success) return text.problems[parsed.data.error](parsed.data.detail);
  if (status === 401) return text.errors.session;
  if (status === 409) return text.errors.conflict;
  return text.errors.generic(status);
}

/**
 * "Återställ tävling från säkerhetskopia" (ADR-0187) i Mina tävlingar: välj filen, servern kontrollerar den och visar vad den
 * nya tävlingen får (antal, datum, formatversion, personer), och först "Skapa tävlingen" sparar. Samma fil och val ger samma
 * begärans id, så ett omförsök efter ett osäkert svar skapar aldrig två tävlingar.
 */
export function RestoreRaceDialog({ open, onClose, onRestored }: {
  open: boolean; onClose: () => void; onRestored?: (response: RaceRestoreResponse) => void;
}) {
  if (!open) return null;
  return createPortal(<RestoreRaceDialogContent onClose={onClose} onRestored={onRestored} />, document.body);
}

function RestoreRaceDialogContent({ onClose, onRestored }: { onClose: () => void; onRestored?: ((response: RaceRestoreResponse) => void) | undefined }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<RaceBackupPreview>();
  const [people, setPeople] = useState<"link" | "skip">("link");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [result, setResult] = useState<RaceRestoreResponse>();
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function choose(next: File | undefined) {
    setFile(next); setPreview(undefined); setProblem(undefined); setRequestId(crypto.randomUUID());
  }

  async function check(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true); setProblem(undefined);
    try {
      const response = await send("/api/organizer/restore/preview", file);
      const parsed = raceBackupPreviewSchema.safeParse(response.json);
      if (response.status !== 200 || !parsed.success) { setProblem(failure(response.status, response.json)); return; }
      setPreview(parsed.data);
    } catch { setProblem(text.errors.network); }
    finally { setBusy(false); }
  }

  async function restore() {
    if (!file) return;
    setBusy(true); setProblem(undefined);
    try {
      const response = await send(`/api/organizer/restore?requestId=${encodeURIComponent(requestId)}&people=${people}`, file);
      const parsed = raceRestoreResponseSchema.safeParse(response.json);
      if ((response.status !== 200 && response.status !== 201) || !parsed.success) { setProblem(failure(response.status, response.json)); return; }
      setResult(parsed.data);
      onRestored?.(parsed.data);
    } catch { setProblem(text.errors.network); }
    finally { setBusy(false); }
  }

  const titleId = "restore-race-title";
  const others = preview?.people ?? [];
  return <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
    <h2 id={titleId}>{text.title}</h2>
    {!preview && !result && <form className={styles.form} noValidate onSubmit={event => void check(event)}>
      <p className={styles.intro}>{text.intro}</p>
      <Field label={text.file}><input type="file" accept=".zip,application/zip" disabled={busy}
        onChange={event => choose(event.target.files?.[0])} /></Field>
      {problem && <Notice tone="error" role="alert">{problem}</Notice>}
      <div className={styles.actions}>
        <Button type="submit" disabled={busy || !file} aria-busy={busy}>{busy ? text.checking : text.check}</Button>
        <Button variant="secondary" disabled={busy} onClick={() => dialogRef.current?.close()}>{text.cancel}</Button>
      </div>
    </form>}
    {preview && !result && <div className={styles.form} data-testid="restore-preview">
      <Notice tone="info"><strong>{text.previewTitle}</strong>
        <span>{raceTitle(preview.race.eventName, preview.race.raceName)} · {preview.race.raceDate}</span>
        <span>{text.counts(preview.counts)}</span>
        <span>{text.createdAt(new Date(preview.createdAt))} · {text.formatVersion(preview.backupFormatVersion)} · {text.size(preview.bytes)}</span>
      </Notice>
      <ul className={styles.intro}>
        {preview.map && <li>{text.map}</li>}
        {preview.staleResults > 0 && <li>{text.stale(preview.staleResults)}</li>}
        {preview.eventorLinked && <li>{text.eventor}</li>}
        {preview.radioLinked && <li>{text.radio}</li>}
        <li>{text.unpublished}</li>
      </ul>
      <fieldset className={styles.form}>
        <legend>{text.peopleTitle}</legend>
        {others.length === 0 && <p className={styles.intro}>{text.peopleNone}</p>}
        {others.length > 0 && <ul className={styles.intro}>{others.map((person, index) => <li key={index}>{person.email ?? text.fromClub} · {person.role.split(",")
          .map(role => text.roles[role] ?? role).join(", ")}</li>)}</ul>}
        {others.length > 0 && <>
          <label className={styles.check}><input type="radio" name="restore-people" checked={people === "link"} disabled={busy}
            onChange={() => { setPeople("link"); setRequestId(crypto.randomUUID()); }} /><span><strong>{text.peopleLink}</strong></span></label>
          <label className={styles.check}><input type="radio" name="restore-people" checked={people === "skip"} disabled={busy}
            onChange={() => { setPeople("skip"); setRequestId(crypto.randomUUID()); }} /><span><strong>{text.peopleSkip}</strong></span></label>
        </>}
      </fieldset>
      <Notice tone="info">{text.personalData}</Notice>
      {problem && <Notice tone="error" role="alert">{problem}</Notice>}
      <div className={styles.actions}>
        <Button disabled={busy} aria-busy={busy} onClick={() => void restore()}>{busy ? text.restoring : text.submit}</Button>
        <Button variant="secondary" disabled={busy} onClick={() => dialogRef.current?.close()}>{text.cancel}</Button>
      </div>
    </div>}
    {result && <div className={styles.form}>
      <Notice tone="ok" role="status"><strong>{text.restored}</strong><span>{text.counts(result.counts)}</span></Notice>
      {result.missingPeople.length > 0 && <Notice tone="info">{text.missing(result.missingPeople)}</Notice>}
      <div className={styles.actions}>
        <Button disabled={opening} aria-busy={opening} onClick={() => { setOpening(true);
          window.location.assign(`/admin/${encodeURIComponent(result.raceId)}/manage`); }}>{opening ? text.opening : text.openRace}</Button>
        <Button variant="secondary" disabled={opening} onClick={() => dialogRef.current?.close()}>{text.close}</Button>
      </div>
    </div>}
  </dialog>;
}

"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { defaultRaceCopyDate, raceCopyResponseSchema, type RaceCopyResponse } from "@o-tid/contracts";
import { raceCopySv as text } from "../i18n/race-copy-sv";
import { accountRequest } from "../lib/account-client";
import { Button, Field, Notice } from "./ui";
import styles from "./copy-race-dialog.module.css";

export interface CopySource { raceId: string; eventName: string; raceName: string; raceDate: string }

type Form = { eventName: string; raceName: string; raceDate: string; includePeople: boolean };

function today(): string {
  // Webbläsarens lokala datum som ÅÅÅÅ-MM-DD.
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function initialForm(source: CopySource): Form {
  return { eventName: source.eventName, raceName: source.raceName, raceDate: defaultRaceCopyDate(source.raceDate, today()), includePeople: true };
}

function failure(status: number): string {
  if (status === 401) return text.errors.session;
  if (status === 403) return text.errors.forbidden;
  if (status === 404) return text.errors.notFound;
  if (status === 400) return text.errors.invalid;
  if (status === 409) return text.errors.conflict;
  return text.errors.generic(status);
}

/**
 * "Ny tävling som …" (PLAN.md steg 21): dialogen, öppen när `source` är satt. Används i Mina tävlingar (en dialog
 * för listan, så att den inte försvinner när listan läses om) och under Inställningar. Ett försök har ett fast
 * request-id tills innehållet ändras, så ett omförsök efter ett osäkert svar skapar aldrig två kopior. `onCopied`
 * får kvittot (t.ex. för att läsa om listan); `onClose` anropas när dialogen stängs.
 */
export function CopyRaceDialog({ source, onClose, onCopied }: {
  source: CopySource | undefined; onClose: () => void; onCopied?: ((response: RaceCopyResponse) => void) | undefined;
}) {
  if (!source) return null;
  // Dialogen läggs direkt i body så att omgivningens stilar inte följer med in i den.
  return createPortal(<CopyRaceDialogContent key={source.raceId} source={source} onClose={onClose} onCopied={onCopied} />, document.body);
}

function CopyRaceDialogContent({ source, onClose, onCopied }: {
  source: CopySource; onClose: () => void; onCopied?: ((response: RaceCopyResponse) => void) | undefined;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<Form>(() => initialForm(source));
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [result, setResult] = useState<RaceCopyResponse>();
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function change(patch: Partial<Form>) {
    setForm(current => ({ ...current, ...patch }));
    // Ändrat innehåll är ett nytt försök.
    setRequestId(crypto.randomUUID());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(undefined);
    try {
      const response = await accountRequest(`/api/organizer/races/${encodeURIComponent(source.raceId)}/copy`, { method: "POST", csrf: true,
        body: { formatVersion: 1, requestId, eventName: form.eventName.trim(), raceName: form.raceName.trim(), raceDate: form.raceDate,
          includePeople: form.includePeople } });
      if (response.status !== 200 && response.status !== 201) { setProblem(failure(response.status)); return; }
      const parsed = raceCopyResponseSchema.safeParse(response.json);
      if (!parsed.success) { setProblem(text.errors.generic(response.status)); return; }
      setResult(parsed.data);
      onCopied?.(parsed.data);
    } catch { setProblem(text.errors.network); }
    finally { setBusy(false); }
  }

  async function openCopy(raceId: string) {
    setOpening(true);
    try {
      const response = await accountRequest(`/api/organizer/races/${encodeURIComponent(raceId)}/enter`, { method: "POST", csrf: true });
      if (response.status === 200) { window.location.assign(`/admin/${encodeURIComponent(raceId)}/manage`); return; }
      setProblem(response.status === 401 ? text.errors.session : text.errors.open);
    } catch { setProblem(text.errors.network); }
    setOpening(false);
  }

  const titleId = `copy-race-${source.raceId}-title`;
  return <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
    <h2 id={titleId}>{text.title}</h2>
    {!result && <form className={styles.form} onSubmit={event => void submit(event)}>
      <p className={styles.intro}>{text.intro(source.raceName === source.eventName ? source.eventName : `${source.eventName} · ${source.raceName}`)}</p>
      <Field label={text.eventName}><input value={form.eventName} minLength={2} maxLength={160} required disabled={busy}
        onChange={event => change({ eventName: event.target.value })} /></Field>
      <div className={styles.row}>
        <Field label={text.raceName}><input value={form.raceName} minLength={2} maxLength={160} required disabled={busy}
          onChange={event => change({ raceName: event.target.value })} /></Field>
        <Field label={text.raceDate}><input type="date" value={form.raceDate} required disabled={busy}
          onChange={event => change({ raceDate: event.target.value })} /></Field>
      </div>
      <label className={styles.check}>
        <input type="checkbox" checked={form.includePeople} disabled={busy} onChange={event => change({ includePeople: event.target.checked })} />
        <span><strong>{text.includePeople}</strong><small>{form.includePeople ? text.includePeopleHelp : text.includePeopleOff}</small></span>
      </label>
      <dl className={styles.scope}>
        <div><dt>{text.copiedTitle}</dt><dd>{text.copiedList}</dd></div>
        <div><dt>{text.notCopiedTitle}</dt><dd>{text.notCopiedList}</dd></div>
      </dl>
      {problem && <Notice tone="error" role="alert">{problem}</Notice>}
      <div className={styles.actions}>
        <Button type="submit" disabled={busy} aria-busy={busy}>{busy ? text.copying : text.submit}</Button>
        <Button variant="secondary" disabled={busy} onClick={() => dialogRef.current?.close()}>{text.cancel}</Button>
      </div>
    </form>}
    {result && <div className={styles.form}>
      <Notice tone="ok" role="status"><strong>{text.created}</strong><span>{form.eventName.trim()} · {form.raceDate}</span>
        <span>{text.summary(result.copied)}</span></Notice>
      {result.copied.eventorNotCopied && <Notice tone="info">{text.eventorNote}</Notice>}
      {result.copied.radioControls > 0 && <Notice tone="info">{text.radioNote}</Notice>}
      {problem && <Notice tone="error" role="alert">{problem}</Notice>}
      <div className={styles.actions}>
        <Button disabled={opening} aria-busy={opening} onClick={() => void openCopy(result.raceId)}>{opening ? text.opening : text.open}</Button>
        <Button variant="secondary" disabled={opening} onClick={() => dialogRef.current?.close()}>{text.close}</Button>
      </div>
    </div>}
  </dialog>;
}

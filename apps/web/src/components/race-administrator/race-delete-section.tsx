"use client";

import { useState, type FormEvent } from "react";
import { accountSv } from "../../i18n/account-sv";
import { accountRequest } from "../../lib/account-client";
import { Button, Field, Notice, Section } from "../ui";
import styles from "../account-pages.module.css";

const text = accountSv.raceDelete;

/**
 * Inställningar → Ta bort tävling (ADR-0172 beslut 2). Bara ägaren; bekräftas genom att skriva tävlingens namn.
 * Anropet görs med kontots inloggning, som avgör ägarskapet.
 */
export function RaceDeleteSection({ raceId, eventName, disabled }: { raceId: string; eventName: string; disabled: boolean }) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(undefined);
    try {
      const response = await accountRequest(`/api/organizer/races/${encodeURIComponent(raceId)}/delete`, { method: "POST", csrf: true,
        body: { formatVersion: 1, confirmation } });
      if (response.status === 200) { window.location.assign("/organizer"); return; }
      setProblem(response.status === 409 ? text.mismatch : response.status === 404 ? text.ownerOnly
        : response.status === 401 ? accountSv.sessionExpired : accountSv.genericError(response.status));
    } catch { setProblem(accountSv.networkError); }
    finally { setBusy(false); }
  }

  return <Section id={`settings-${raceId}-delete`} title={text.title} help={text.help}>
    <form className={styles.form} onSubmit={event => void submit(event)}>
      <Field label={text.confirm(eventName)}>
        <input value={confirmation} autoComplete="off" spellCheck={false} required disabled={busy || disabled}
          onChange={event => setConfirmation(event.target.value)} />
      </Field>
      {problem && <Notice tone="error" role="alert">{problem}</Notice>}
      <Button type="submit" className={styles.danger} disabled={busy || disabled || confirmation.trim() !== eventName.trim()}>{text.button}</Button>
    </form>
  </Section>;
}

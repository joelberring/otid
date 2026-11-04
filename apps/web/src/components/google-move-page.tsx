"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { googleMoveDetailsSchema, googleMoveResponseSchema, type GoogleMoveDetails } from "@o-tid/contracts";
import { accountSv } from "../i18n/account-sv";
import { accountRequest } from "../lib/account-client";
import { readOrganizerCsrf } from "../lib/organizer-client";
import { AccountMenu } from "./account-menu";
import { PasswordInput } from "./password-field";
import { Button, Notice, Section } from "./ui";
import styles from "./account-pages.module.css";

const text = accountSv.googleMove;

/**
 * ADR-0205 tillägg: Google-kontot är kopplat till ett annat konto som är tomt (ägarens dubblett). Sidan säger vad som händer –
 * kopplingen flyttas hit och det tomma kontot tas bort – och flytten bekräftas med lösenordet (eller en inloggning nyss).
 */
export function GoogleMovePage() {
  const [details, setDetails] = useState<GoogleMoveDetails>();
  const [who, setWho] = useState<{ displayName: string; email: string }>();
  const [problem, setProblem] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const failure = (status: number, error?: unknown) => status === 410 ? text.expired : error === "GOOGLE_IN_USE" ? text.inUse
    : error === "LOGIN_AGAIN" ? text.loginAgain : error === "CONFIRMATION_MISMATCH" ? text.wrongPassword
      : status === 401 ? accountSv.sessionExpired : accountSv.genericError(status);

  useEffect(() => {
    void (async () => {
      try {
        const [move, session] = await Promise.all([accountRequest("/api/account/google/move"), accountRequest("/api/organizer/session")]);
        const parsed = googleMoveDetailsSchema.safeParse(move.json);
        const current = session.json as { displayName?: string; email?: string } | undefined;
        if (current?.displayName && current.email) setWho({ displayName: current.displayName, email: current.email });
        if (move.status === 200 && parsed.success) setDetails(parsed.data);
        else setProblem(failure(move.status, (move.json as { error?: unknown } | undefined)?.error));
      } catch { setProblem(accountSv.networkError); }
    })();
  }, []);

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setProblem("");
    try {
      const response = await accountRequest("/api/account/google/move", { method: "POST", csrf: true,
        body: { formatVersion: 1, ...(details?.needsPassword ? { password } : {}) } });
      setPassword("");
      const moved = googleMoveResponseSchema.safeParse(response.json);
      if (response.status === 200 && moved.success) { window.location.assign("/konto?google=flyttad"); return; }
      setProblem(failure(response.status, (response.json as { error?: unknown } | undefined)?.error));
    } catch { setProblem(accountSv.networkError); }
    finally { setBusy(false); }
  }

  async function cancel() {
    let csrf = "";
    try { csrf = readOrganizerCsrf(document.cookie, new URL(window.location.href)); } catch { csrf = ""; }
    await fetch("/api/account/google/move", { method: "DELETE", credentials: "same-origin", headers: csrf ? { "x-otid-csrf": csrf } : {} })
      .catch(() => undefined);
    window.location.assign("/konto");
  }

  const created = details ? new Date(details.sourceCreatedAt).toLocaleDateString("sv-SE") : "";
  return <main className={`${styles.page} ${styles.narrow}`}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>{text.kicker}</p><h1>{text.title}</h1></div>
      <nav className={styles.headerNav} aria-label={accountSv.me.title}><Link href="/konto">{accountSv.me.title}</Link>
        {who && <AccountMenu who={who} />}</nav>
    </header>
    {!details && !problem && <p role="status">{text.loading}</p>}
    {problem && <Notice tone="error" role="alert">{problem}</Notice>}
    {details && who && <Section id="flytta-google" title={text.title}>
      <div className={styles.prose} data-testid="google-move">
        <p>{text.what(details.googleEmail, details.sourceEmail, who.email)}</p>
        <p>{text.duplicate(details.sourceEmail, created)}</p>
      </div>
      <form className={styles.form} onSubmit={event => void confirm(event)}>
        {details.needsPassword
          ? <><PasswordInput label={text.password} value={password} onChange={setPassword} autoComplete="current-password" disabled={busy} />
            <p className={styles.muted}>{text.passwordHelp}</p></>
          : <p className={styles.muted}>{details.recentLogin ? text.recentLogin : text.loginAgain}</p>}
        <div className={styles.actions}>
          <Button type="submit" disabled={busy || (details.needsPassword ? !password : !details.recentLogin)} aria-busy={busy}>{text.confirm}</Button>
          <Button type="button" variant="quiet" disabled={busy} onClick={() => void cancel()}>{text.cancel}</Button>
        </div>
      </form>
    </Section>}
  </main>;
}

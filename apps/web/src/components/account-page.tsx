"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { accountProfileSchema, type AccountProfile } from "@o-tid/contracts";
import { accountSv } from "../i18n/account-sv";
import { accountRequest } from "../lib/account-client";
import { Button, Field, Notice, Section } from "./ui";
import styles from "./account-pages.module.css";

const text = accountSv.me;
type Message = { tone: "ok" | "error"; text: string } | undefined;

/** Mitt konto (ADR-0172 beslut 2): namn, lösenord och att ta bort kontot med de tävlingar det äger. */
export function AccountPage() {
  const [profile, setProfile] = useState<AccountProfile>();
  const [loadError, setLoadError] = useState<string>();
  const [displayName, setDisplayName] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [nameMessage, setNameMessage] = useState<Message>();
  const [passwordMessage, setPasswordMessage] = useState<Message>();
  const [deleteMessage, setDeleteMessage] = useState<Message>();
  const [deleted, setDeleted] = useState(false);

  async function load() {
    try {
      const response = await accountRequest("/api/account");
      if (response.status === 401) { setLoadError(accountSv.sessionExpired); return; }
      const parsed = accountProfileSchema.safeParse(response.json);
      if (response.status !== 200 || !parsed.success) throw new Error(accountSv.genericError(response.status));
      setProfile(parsed.data);
      setDisplayName(parsed.data.displayName);
    } catch (error) { setLoadError(error instanceof Error ? error.message : accountSv.networkError); }
  }
  useEffect(() => { void load(); }, []);

  async function run(action: () => Promise<Message>, set: (message: Message) => void) {
    setBusy(true);
    set(undefined);
    try { set(await action()); }
    catch { set({ tone: "error", text: accountSv.networkError }); }
    finally { setBusy(false); }
  }

  const failure = (status: number): Message => ({ tone: "error", text: status === 409 ? text.wrongPassword
    : status === 401 ? accountSv.sessionExpired : accountSv.genericError(status) });

  function saveName(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const response = await accountRequest("/api/account/display-name", { method: "POST", csrf: true, body: { formatVersion: 1, displayName } });
      if (response.status !== 200) return failure(response.status);
      setProfile(value => value && { ...value, displayName: displayName.trim() });
      return { tone: "ok", text: text.nameSaved };
    }, setNameMessage);
  }

  function savePassword(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const response = await accountRequest("/api/account/password", { method: "POST", csrf: true,
        body: { formatVersion: 1, currentPassword: current, newPassword: next } });
      setCurrent("");
      setNext("");
      return response.status === 200 ? { tone: "ok", text: text.passwordSaved } : failure(response.status);
    }, setPasswordMessage);
  }

  function deleteAccount(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const response = await accountRequest("/api/account/delete", { method: "POST", csrf: true, body: { formatVersion: 1, password: deletePassword } });
      setDeletePassword("");
      if (response.status !== 200) return failure(response.status);
      setDeleted(true);
      return { tone: "ok", text: text.deleted };
    }, setDeleteMessage);
  }

  const notice = (message: Message) => message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>;
  return <main className={`${styles.page} ${styles.narrow}`}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>{text.kicker}</p><h1>{text.title}</h1></div>
      {!deleted && <nav aria-label={text.title}><Link href="/organizer">{accountSv.backToEvents}</Link></nav>}
    </header>
    {!profile && !loadError && <p role="status">{text.loading}</p>}
    {loadError && <Notice tone="error" role="alert">{loadError} <Link href="/organizer">{accountSv.logIn}</Link></Notice>}
    {deleted && <><Notice tone="ok" role="status">{text.deleted}</Notice><p><Link href="/">O-Tid</Link></p></>}

    {profile && !deleted && <>
      <Section id="konto-uppgifter" title={text.details} help={text.detailsHelp}>
        <dl className={styles.facts}>
          <dt>{text.email}</dt><dd>{profile.email}</dd>
          <dt>{text.created}</dt><dd>{new Date(profile.createdAt).toLocaleDateString("sv-SE")}</dd>
          {profile.superadmin && <><dt>{text.role}</dt><dd><Link href="/superadmin">{text.superadmin}</Link></dd></>}
        </dl>
        <form className={styles.form} onSubmit={saveName}>
          <Field label={text.displayName}>
            <input autoComplete="name" maxLength={120} value={displayName} required disabled={busy} onChange={event => setDisplayName(event.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" disabled={busy || !displayName.trim() || displayName.trim() === profile.displayName}>{text.saveName}</Button>
          {notice(nameMessage)}
        </form>
      </Section>

      <Section id="konto-losenord" title={text.password} help={text.passwordHelp}>
        <form className={styles.form} onSubmit={savePassword}>
          <Field label={text.currentPassword}>
            <input type="password" autoComplete="current-password" value={current} required disabled={busy} onChange={event => setCurrent(event.target.value)} />
          </Field>
          <Field label={text.newPassword} help={text.passwordRule}>
            <input type="password" autoComplete="new-password" minLength={8} maxLength={1024} value={next} required disabled={busy}
              onChange={event => setNext(event.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" disabled={busy || !current || next.length < 8}>{text.savePassword}</Button>
          {notice(passwordMessage)}
        </form>
      </Section>

      <Section id="konto-ta-bort" title={text.delete} help={text.deleteHelp}>
        {profile.ownedEvents.length > 0 ? <div className={styles.prose}>
          <p>{text.deleteEvents}</p>
          <ul className={styles.list}>{profile.ownedEvents.map(event => <li key={event.eventId}>{event.eventName} ({event.startsOn})</li>)}</ul>
          <p className={styles.muted}>{text.deleteOthers}</p>
        </div> : <p className={styles.muted}>{text.deleteNoEvents}</p>}
        <form className={styles.form} onSubmit={deleteAccount}>
          <Field label={text.deletePassword}>
            <input type="password" autoComplete="current-password" value={deletePassword} required disabled={busy}
              onChange={event => setDeletePassword(event.target.value)} />
          </Field>
          <Button type="submit" className={styles.danger} disabled={busy || !deletePassword}>{text.deleteButton}</Button>
          {notice(deleteMessage)}
        </form>
      </Section>
    </>}
  </main>;
}

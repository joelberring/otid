"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { accountProfileSchema, type AccountProfile } from "@o-tid/contracts";
import { accountSv as accountSvAll } from "../i18n/account-sv";
import { accountPageEn, type AccountPage as AccountPageTexts } from "../i18n/account-en";
import { useTexts } from "./language-provider";
import { accountRequest } from "../lib/account-client";
import { NewPasswordFields, PasswordInput, passwordsReady } from "./password-field";
import { Button, Field, Notice, Section } from "./ui";
import { AccountClubs } from "./club-affiliation/account-clubs";
import { AccountMenu } from "./account-menu";
import { AccountGoogle, LogoutEverywhere } from "./account-google";
import { AccountAi } from "./account-ai";
import { AccountMapSources } from "./account-map-sources";
import styles from "./account-pages.module.css";

type Message = { tone: "ok" | "error"; text: string } | undefined;

/**
 * Mitt konto (ADR-0172 beslut 2): namn, lösenord och att ta bort kontot med de tävlingar det äger. ADR-0205 tillägg: Koppla
 * Google-konto (med Google på servern), Logga ut från alla enheter och kontomenyn.
 */
export function AccountPage({ googleEnabled = false }: { googleEnabled?: boolean }) {
  const accountSv = useTexts<AccountPageTexts>(accountSvAll, accountPageEn), text = accountSv.me;
  const [profile, setProfile] = useState<AccountProfile>();
  const [loadError, setLoadError] = useState<string>();
  const [displayName, setDisplayName] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [nameMessage, setNameMessage] = useState<Message>();
  const [passwordMessage, setPasswordMessage] = useState<Message>();
  const [deleteMessage, setDeleteMessage] = useState<Message>();
  const [deleted, setDeleted] = useState(false);
  const [googleOutcome, setGoogleOutcome] = useState<string>();

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
  useEffect(() => {
    // Ändrat 2026-11-07 (ADR-0205): beskedet efter "Ta bort kontot" med Google (`/konto?radera=…`), som sedan tas bort ur adressen.
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get("radera");
    if (outcome !== null) {
      url.searchParams.delete("radera");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      if (outcome === "borttaget") { setDeleted(true); return; }
      setGoogleOutcome(outcome);
    }
    void load();
  }, []);

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
    if (!passwordsReady(next, repeat)) return;
    void run(async () => {
      const response = await accountRequest("/api/account/password", { method: "POST", csrf: true,
        body: { formatVersion: 1, currentPassword: current, newPassword: next } });
      setCurrent("");
      if (response.status === 200) { setNext(""); setRepeat(""); }
      return response.status === 200 ? { tone: "ok", text: text.passwordSaved } : failure(response.status);
    }, setPasswordMessage);
  }

  function deleteAccount(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const response = await accountRequest("/api/account/delete", { method: "POST", csrf: true, body: { formatVersion: 1, password: deletePassword } });
      setDeletePassword("");
      // Ensam ägare (ändrat 2026-11-07): listan visas ovanför; läs om profilen så att den stämmer.
      if (response.status === 409 && (response.json as { error?: unknown } | undefined)?.error === "SOLE_OWNER") {
        void load();
        return { tone: "error", text: text.deleteSoleOwner };
      }
      if (response.status !== 200) return failure(response.status);
      setDeleted(true);
      return { tone: "ok", text: text.deleted };
    }, setDeleteMessage);
  }

  function deleteWithGoogle() {
    void run(async () => {
      const response = await accountRequest("/api/account/google/delete", { method: "POST", csrf: true, body: { formatVersion: 1 } });
      const location = (response.json as { location?: unknown } | undefined)?.location;
      if (response.status === 200 && typeof location === "string") { window.location.assign(location); return { tone: "ok", text: text.deleteGoing }; }
      return failure(response.status);
    }, setDeleteMessage);
  }
  const googleOnly = googleEnabled && profile?.hasPassword === false && Boolean(profile.google);
  const googleMessage: Message = googleOutcome ? { tone: "error", text: text.deleteDone[googleOutcome] ?? text.deleteDone.fel! } : undefined;

  const soleOwnerOf = profile?.soleOwnerOf ?? [];
  const notice = (message: Message) => message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>;
  return <main className={`${styles.page} ${styles.narrow}`}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>{text.kicker}</p><h1>{text.title}</h1></div>
      {!deleted && <nav className={styles.headerNav} aria-label={text.title}><Link href="/organizer">{accountSv.backToEvents}</Link>
        {profile && <AccountMenu who={{ displayName: profile.displayName, email: profile.email }} />}</nav>}
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

      {googleEnabled && <AccountGoogle profile={profile} onChange={() => void load()} />}

      <AccountClubs />

      <AccountAi />

      <AccountMapSources />

      <Section id="konto-losenord" title={text.password} help={text.passwordHelp}>
        <form className={styles.form} onSubmit={savePassword}>
          <PasswordInput label={text.currentPassword} value={current} onChange={setCurrent} autoComplete="current-password" disabled={busy} />
          <NewPasswordFields label={text.newPassword} password={next} repeat={repeat} onPassword={setNext} onRepeat={setRepeat} disabled={busy} />
          <Button type="submit" variant="secondary" disabled={busy || !current || !passwordsReady(next, repeat)}>{text.savePassword}</Button>
          {notice(passwordMessage)}
        </form>
      </Section>

      <LogoutEverywhere />

      <Section id="konto-ta-bort" title={text.delete} help={text.deleteHelp}>
        {profile.ownedEvents.length > 0 ? <div className={styles.prose}>
          <p>{text.deleteEvents}</p>
          <ul className={styles.list}>{profile.ownedEvents.map(event => <li key={event.eventId}>{event.eventName} ({event.startsOn})</li>)}</ul>
          <p className={styles.muted}>{text.deleteOthers}</p>
        </div> : <p className={styles.muted}>{text.deleteNoEvents}</p>}
        {soleOwnerOf.length > 0 && <Notice tone="attention" role="status">
          <span data-testid="account-sole-owner">{text.deleteHandOver(soleOwnerOf.map(item => item.name))}</span>
          <ul className={styles.list}>{soleOwnerOf.map(item => <li key={`${item.kind}:${item.id}`}>
            <Link href={item.kind === "CLUB" ? `/organizer/clubs/${item.id}` : item.kind === "MAP_PROJECT" ? `/organizer/map-projects/${item.id}`
              : `/organizer/groups/${item.id}`}>
              {item.kind === "CLUB" ? text.soleOwnerClub(item.name) : item.kind === "MAP_PROJECT" ? text.soleOwnerMapProject(item.name)
                : text.soleOwnerGroup(item.name)}</Link></li>)}</ul>
          <span className={styles.muted}>{text.deleteHandOverAlone}</span>
        </Notice>}
        {googleOnly ? <div className={styles.form} data-testid="account-delete-google">
          <p>{text.deleteWithGoogle}</p>
          <Button type="button" className={styles.danger} disabled={busy || soleOwnerOf.length > 0} aria-busy={busy}
            onClick={deleteWithGoogle}>{text.deleteWithGoogleButton}</Button>
          {notice(deleteMessage ?? googleMessage)}
        </div> : <form className={styles.form} onSubmit={deleteAccount}>
          <Field label={text.deletePassword}>
            <input type="password" autoComplete="current-password" value={deletePassword} required disabled={busy}
              onChange={event => setDeletePassword(event.target.value)} />
          </Field>
          <Button type="submit" className={styles.danger} disabled={busy || !deletePassword || soleOwnerOf.length > 0}>{text.deleteButton}</Button>
          {notice(deleteMessage ?? googleMessage)}
        </form>}
      </Section>
    </>}
  </main>;
}

"use client";

import { useEffect, useState } from "react";
import type { AccountProfile } from "@o-tid/contracts";
import { accountSv } from "../i18n/account-sv";
import { accountMenuSv } from "../i18n/account-menu-sv";
import { accountRequest } from "../lib/account-client";
import { logOut, pendingOfflineChanges } from "../lib/account-logout";
import { Button, Notice, Section } from "./ui";
import styles from "./account-pages.module.css";

const text = accountSv.me;
type Message = { tone: "ok" | "error"; text: string } | undefined;
type Outcome = keyof typeof text.googleDone;

/** ADR-0205 tillägg: beskedet efter återkomsten från Google (`/konto?google=…`), som sedan tas bort ur adressen. */
function takeOutcome(): Outcome | "flyttad" | undefined {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("google");
  if (code === null) return undefined;
  url.searchParams.delete("google");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  if (code === "flyttad") return code;
  return Object.hasOwn(text.googleDone, code) ? code as Outcome : "fel";
}

/**
 * ADR-0205 tillägg: Mitt konto → Inloggning med Google. "Koppla Google-konto" går till Google i läget "link" (bundet till den
 * här inloggningen); tillbaka visar sidan beskedet. Kopplingen visas bara med Googles adress och "Ta bort kopplingen", som
 * vägras när kontot då saknar sätt att logga in.
 */
export function AccountGoogle({ profile, onChange }: { profile: AccountProfile; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>();
  const [outcome, setOutcome] = useState<Outcome | "flyttad">();

  // Bara när adressen har ett besked (React kör effekten två gånger i utvecklingsläget; andra gången är beskedet redan taget).
  useEffect(() => { const taken = takeOutcome(); if (taken) setOutcome(taken); }, []);
  useEffect(() => {
    if (!outcome) return;
    const email = profile.google?.email ?? "";
    if (outcome === "kopplat") setMessage({ tone: "ok", text: text.googleDone.kopplat(email) });
    else if (outcome === "flyttad") setMessage({ tone: "ok", text: text.moved(email) });
    else setMessage({ tone: "error", text: text.googleDone[outcome] });
  }, [outcome, profile.google?.email]);

  async function link() {
    setBusy(true); setMessage(undefined);
    try {
      const response = await accountRequest("/api/account/google/link", { method: "POST", csrf: true, body: { formatVersion: 1 } });
      const location = (response.json as { location?: unknown } | undefined)?.location;
      if (response.status === 200 && typeof location === "string") { setMessage({ tone: "ok", text: text.googleLinking }); window.location.assign(location); return; }
      setMessage({ tone: "error", text: response.status === 401 ? accountSv.sessionExpired : accountSv.genericError(response.status) });
      setBusy(false);
    } catch { setMessage({ tone: "error", text: accountSv.networkError }); setBusy(false); }
  }

  async function unlink() {
    setBusy(true); setMessage(undefined); setOutcome(undefined);
    try {
      const response = await accountRequest("/api/account/google/unlink", { method: "POST", csrf: true });
      if (response.status === 200) { setMessage({ tone: "ok", text: text.googleUnlinked }); onChange(); }
      else setMessage({ tone: "error", text: response.status === 409 ? text.googleLastMethod : accountSv.genericError(response.status) });
    } catch { setMessage({ tone: "error", text: accountSv.networkError }); }
    finally { setBusy(false); }
  }

  const linked = profile.google;
  return <Section id="konto-google" title={text.google} help={text.googleHelp}>
    <div className={styles.form} data-testid="account-google">
      {linked ? <p>{linked.email ? text.googleLinked(linked.email) : text.googleLinkedUnknown}</p> : <p className={styles.muted}>{text.googleNone}</p>}
      {linked ? <>
        <Button type="button" variant="secondary" disabled={busy || profile.hasPassword === false} onClick={() => void unlink()}>{text.googleUnlink}</Button>
        {profile.hasPassword === false && <p className={styles.muted}>{text.googleLastMethod}</p>}
      </> : <Button type="button" variant="secondary" disabled={busy} aria-busy={busy} onClick={() => void link()}>{text.googleLink}</Button>}
      {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
    </div>
  </Section>;
}

/** ADR-0205 tillägg: "Logga ut från alla enheter" – alla kontots sessioner spärras, också den här, och webbläsarens data tas bort. */
export function LogoutEverywhere() {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<number>();
  const [problem, setProblem] = useState("");

  async function leave() {
    setBusy(true); setProblem("");
    try {
      const result = await logOut({ everywhere: true });
      if (!result.ok) { setProblem(text.logoutAllFailed); setBusy(false); }
    } catch { setProblem(text.logoutAllFailed); setBusy(false); }
  }
  async function start() {
    setBusy(true);
    const counted = await pendingOfflineChanges();
    if (counted.total > 0) { setPending(counted.total); setBusy(false); return; }
    await leave();
  }

  return <Section id="konto-utloggning" title={text.sessions} help={text.sessionsHelp}>
    <div className={styles.form}>
      {pending === undefined
        ? <Button type="button" variant="secondary" disabled={busy} aria-busy={busy} onClick={() => void start()}>{text.logoutAll}</Button>
        : <Notice tone="error" role="alert">{accountMenuSv.pending(pending)}{" "}
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void leave()}>{accountMenuSv.logoutAnyway}</Button>{" "}
          <Button type="button" variant="quiet" onClick={() => setPending(undefined)}>{accountMenuSv.cancel}</Button></Notice>}
      {problem && <Notice tone="error" role="alert">{problem}</Notice>}
    </div>
  </Section>;
}

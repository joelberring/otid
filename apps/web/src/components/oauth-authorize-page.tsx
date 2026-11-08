"use client";

import { useEffect, useState } from "react";
import { aiSv } from "../i18n/ai-sv";
import { accountRequest } from "../lib/account-client";
import { saveAfterLogin } from "../lib/after-login";
import { Button, Notice } from "./ui";
import styles from "./account-pages.module.css";

const text = aiSv.authorize;
type State =
  | { kind: "checking" } | { kind: "login" } | { kind: "failed" } | { kind: "invalid"; description: string }
  | { kind: "ready"; clientName: string; redirectHost: string; accountEmail: string };

/**
 * ADR-0219 (K2): godkännandet av en AI-koppling (OAuth). Sidan frågar servern vad som begärs; den som inte är inloggad loggar
 * in och kommer tillbaka hit. Tillåt eller neka skickar webbläsaren till AI-tjänstens adress med koden eller felet.
 */
export function OauthAuthorizePage() {
  const [state, setState] = useState<State>({ kind: "checking" });
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState<Record<string, string>>({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQuery(Object.fromEntries(params));
    void (async () => {
      try {
        const result = await accountRequest(`/api/oauth/authorize?${params.toString()}`);
        if (result.status === 401) { saveAfterLogin(`/oauth/authorize?${params.toString()}`); setState({ kind: "login" }); return; }
        const body = result.json as { status?: string; description?: string; redirect?: string; clientName?: string; redirectHost?: string; accountEmail?: string };
        if (result.status !== 200 || !body) { setState({ kind: "failed" }); return; }
        if (body.status === "redirect-error" && body.redirect) { window.location.assign(body.redirect); return; }
        if (body.status === "invalid") { setState({ kind: "invalid", description: body.description ?? "" }); return; }
        if (body.status === "ok") setState({ kind: "ready", clientName: body.clientName ?? "", redirectHost: body.redirectHost ?? "", accountEmail: body.accountEmail ?? "" });
        else setState({ kind: "failed" });
      } catch { setState({ kind: "failed" }); }
    })();
  }, []);

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      const result = await accountRequest("/api/oauth/authorize", { method: "POST", csrf: true, body: { query, approve } });
      const body = result.json as { status?: string; redirect?: string; description?: string } | undefined;
      if (result.status === 200 && body?.status === "redirect" && body.redirect) { window.location.assign(body.redirect); return; }
      if (result.status === 200 && body?.status === "invalid") { setState({ kind: "invalid", description: body.description ?? "" }); return; }
      setState({ kind: "failed" });
    } catch { setState({ kind: "failed" }); } finally { setBusy(false); }
  }

  return <main className={`${styles.page} ${styles.narrow}`}>
    <header className={styles.header}><div><p className={styles.kicker}>{text.kicker}</p><h1>{text.title}</h1></div></header>
    {state.kind === "checking" && <p role="status">{text.checking}</p>}
    {state.kind === "failed" && <Notice tone="error" role="alert">{text.failed}</Notice>}
    {state.kind === "invalid" && <Notice tone="error" role="alert">{text.invalid(state.description)}</Notice>}
    {state.kind === "login" && <>
      <p>{text.loginNeeded}</p>
      <p><Button onClick={() => window.location.assign("/organizer")}>{text.login}</Button></p>
    </>}
    {state.kind === "ready" && <section className={styles.prose} data-testid="oauth-consent">
      <p><strong>{text.asks(state.clientName)}</strong></p>
      <p className={styles.muted}>{text.account(state.accountEmail)}</p>
      <p>{text.can}:</p>
      <ul className={styles.list}>{text.canItems.map(item => <li key={item}>{item}</li>)}</ul>
      <p>{text.cannot}</p>
      <p className={styles.muted}>{text.redirect(state.redirectHost)} {text.revokeHint}</p>
      <p className={styles.actions}>
        <Button disabled={busy} aria-busy={busy} onClick={() => void decide(true)}>{busy ? text.sending : text.approve}</Button>{" "}
        <Button variant="secondary" disabled={busy} onClick={() => void decide(false)}>{text.deny}</Button>
      </p>
    </section>}
  </main>;
}

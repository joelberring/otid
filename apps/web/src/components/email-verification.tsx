"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { emailVerificationCheckResponseSchema, passwordResetTokenSchema, type EmailVerificationCheckResponse } from "@o-tid/contracts";
import { accountSv } from "../i18n/account-sv";
import { accountRequest } from "../lib/account-client";
import { NewPasswordFields, passwordsReady } from "./password-field";
import { Button, Notice, Section } from "./ui";
import styles from "./account-pages.module.css";

const text = accountSv.verify;
type State = EmailVerificationCheckResponse["state"];

/** Läser engångsnyckeln ur adressens #token=… och tar bort den ur adressfältet och historiken (som återställningslänken). */
function takeTokenFromLocation(): string | undefined {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? undefined;
  if (window.location.hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return token && passwordResetTokenSchema.safeParse(token).success ? token : undefined;
}

/**
 * ADR-0186, ändrat av ADR-0205: bekräfta e-postadressen. Länken i mejlet (#token=…) bevisar adressen; personen väljer lösenordet
 * (två gånger, samma som vid registreringen eller ett nytt), och sedan är adressen bekräftad och kontot inloggat. Sidan frågar
 * först servern vad länken leder till, så att en gammal länk eller en redan bekräftad adress ger ett tydligt nästa steg.
 */
export function EmailVerification() {
  const [token, setToken] = useState<string>();
  const [checked, setChecked] = useState(false);
  const [state, setState] = useState<State>();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error" | "info"; text: string }>();

  useEffect(() => {
    // Bara en hittad nyckel sätts: effekten kan köras två gånger (React strict mode), och andra gången är adressen redan tömd.
    const found = takeTokenFromLocation();
    if (found) setToken(found);
    else setChecked(true);
    const onHash = () => { const found = takeTokenFromLocation(); if (found) { setToken(found); setMessage(undefined); setState(undefined); } };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!token) return;
    let current = true;
    void (async () => {
      try {
        const response = await accountRequest("/api/organizer/verify-email/check", { method: "POST", body: { formatVersion: 1, token } });
        const parsed = emailVerificationCheckResponseSchema.safeParse(response.json);
        if (!current) return;
        if (response.status === 200 && parsed.success) setState(parsed.data.state);
        else setMessage({ tone: "error", text: accountSv.genericError(response.status) });
      } catch { if (current) setMessage({ tone: "error", text: accountSv.networkError }); }
      finally { if (current) setChecked(true); }
    })();
    return () => { current = false; };
  }, [token]);

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!passwordsReady(password, repeat)) return;
    setBusy(true);
    setMessage({ tone: "info", text: text.verifying });
    try {
      const response = await accountRequest("/api/organizer/verify-email", { method: "POST", body: { formatVersion: 1, token, password } });
      if (response.status === 200) { window.location.assign("/organizer"); return; }
      if (response.status === 409) { setState("already-verified"); setMessage(undefined); }
      else if (response.status === 404) { setState("invalid"); setMessage(undefined); }
      else setMessage({ tone: "error", text: accountSv.genericError(response.status) });
    } catch { setMessage({ tone: "error", text: accountSv.networkError }); }
    finally { setBusy(false); }
  }

  return <main className={`${styles.page} ${styles.narrow}`}>
    <header className={styles.header}><div><p className={styles.kicker}>{text.kicker}</p><h1>{text.title}</h1></div></header>
    {!checked && <p role="status">{accountSv.reset.checking}</p>}
    {checked && !token && <Notice tone="error" role="alert">{text.noToken}</Notice>}
    {checked && token && state === "valid" && <Section label={text.title}>
      <form className={styles.form} onSubmit={event => void verify(event)}>
        <p>{text.intro}</p>
        <NewPasswordFields password={password} repeat={repeat} onPassword={setPassword} onRepeat={setRepeat} disabled={busy} />
        <Button type="submit" disabled={busy || !passwordsReady(password, repeat)}>{text.submit}</Button>
      </form>
      {message && <Notice tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>{message.text}</Notice>}
    </Section>}
    {checked && token && state === "already-verified" && <Section label={text.title}>
      <Notice tone="ok" role="status">{text.alreadyVerified}</Notice>
      <div className={styles.actions}><Link href="/organizer">{accountSv.logIn}</Link><Link href="/recover">{accountSv.reset.title}</Link></div>
    </Section>}
    {checked && token && state === "invalid" && <Section label={text.title}>
      <Notice tone="error" role="alert">{text.invalid}</Notice>
      <div className={styles.actions}><Link href="/recover">{text.newPassword}</Link><Link href="/organizer">{accountSv.logIn}</Link></div>
    </Section>}
    {checked && token && !state && message && <Notice tone={message.tone} role="alert">{message.text}</Notice>}
    {state !== "already-verified" && state !== "invalid" && <p><Link href="/organizer">{accountSv.reset.backToLogin}</Link></p>}
  </main>;
}

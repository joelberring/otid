"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { passwordResetTokenSchema } from "@o-tid/contracts";
import { accountSv } from "../i18n/account-sv";
import { accountRequest } from "../lib/account-client";
import { Button, Field, Notice, Section } from "./ui";
import styles from "./account-pages.module.css";

const text = accountSv.verify;

/** Läser engångsnyckeln ur adressens #token=… och tar bort den ur adressfältet och historiken (som återställningslänken). */
function takeTokenFromLocation(): string | undefined {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? undefined;
  if (window.location.hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return token && passwordResetTokenSchema.safeParse(token).success ? token : undefined;
}

/**
 * ADR-0185: bekräfta e-postadressen. Länken i mejlet (#token=…) och lösenordet som valdes när kontot skapades; sedan är adressen
 * bekräftad och kontot inloggat. Lösenordet krävs så att ingen kan låta ägaren av adressen bekräfta ett konto med ett lösenord
 * som någon annan valt.
 */
export function EmailVerification() {
  const [token, setToken] = useState<string>();
  const [checked, setChecked] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error" | "info"; text: string }>();

  useEffect(() => {
    // Bara en hittad nyckel sätts: effekten kan köras två gånger (React strict mode), och andra gången är adressen redan tömd.
    const found = takeTokenFromLocation();
    if (found) setToken(found);
    setChecked(true);
    const onHash = () => { const found = takeTokenFromLocation(); if (found) { setToken(found); setMessage(undefined); } };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage({ tone: "info", text: text.verifying });
    try {
      const response = await accountRequest("/api/organizer/verify-email", { method: "POST", body: { formatVersion: 1, token, password } });
      if (response.status === 200) { window.location.assign("/organizer"); return; }
      setMessage({ tone: "error", text: response.status === 404 || response.status === 400 ? text.invalid : accountSv.genericError(response.status) });
    } catch { setMessage({ tone: "error", text: accountSv.networkError }); }
    finally { setPassword(""); setBusy(false); }
  }

  return <main className={`${styles.page} ${styles.narrow}`}>
    <header className={styles.header}><div><p className={styles.kicker}>{text.kicker}</p><h1>{text.title}</h1></div></header>
    {!checked && <p role="status">{accountSv.reset.checking}</p>}
    {checked && !token && <Notice tone="error" role="alert">{text.noToken}</Notice>}
    {checked && token && <Section label={text.title}>
      <form className={styles.form} onSubmit={event => void verify(event)}>
        <p>{text.intro}</p>
        <Field label={text.password}>
          <input type="password" autoComplete="current-password" maxLength={1024} value={password} required disabled={busy}
            onChange={event => setPassword(event.target.value)} />
        </Field>
        <Button type="submit" disabled={busy || !password}>{text.submit}</Button>
      </form>
      {message && <Notice tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>{message.text}</Notice>}
    </Section>}
    <p><Link href="/organizer">{accountSv.reset.backToLogin}</Link></p>
  </main>;
}

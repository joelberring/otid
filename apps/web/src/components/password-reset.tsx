"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { passwordResetAvailabilitySchema, passwordResetTokenSchema, type PasswordResetAvailability } from "@o-tid/contracts";
import { accountSv as accountSvAll } from "../i18n/account-sv";
import { accountEntryEn, type AccountEntry } from "../i18n/account-en";
import { useTexts } from "./language-provider";
import { accountRequest } from "../lib/account-client";
import { NewPasswordFields, passwordsReady } from "./password-field";
import { Button, Field, Notice, Section } from "./ui";
import styles from "./account-pages.module.css";

type Message = { tone: "ok" | "error" | "info"; text: string };

/** Läser engångsnyckeln ur adressens #token=… och tar bort den ur adressfältet och historiken. */
function takeTokenFromLocation(): string | undefined {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? undefined;
  if (window.location.hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return token && passwordResetTokenSchema.safeParse(token).success ? token : undefined;
}

/**
 * Glömt lösenord (ADR-0172 beslut 1). Med e-post på servern: be om en länk. Med länken (#token=…): välj nytt
 * lösenord. Utan e-post: kontakta den som driver O-Tid, som kan skapa en länk på superadminsidan.
 */
export function PasswordReset() {
  const accountSv = useTexts<AccountEntry>(accountSvAll, accountEntryEn), text = accountSv.reset;
  const [token, setToken] = useState<string>();
  const [checked, setChecked] = useState(false);
  const [availability, setAvailability] = useState<PasswordResetAvailability>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>();
  const [done, setDone] = useState(false);

  // En länk som öppnas i samma flik som redan visar sidan ändrar bara #-delen.
  useEffect(() => {
    const onHash = () => {
      const found = takeTokenFromLocation();
      if (found) { setToken(found); setDone(false); setMessage(undefined); setPassword(""); setRepeat(""); setChecked(true); }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    // Bara en hittad nyckel sätts: effekten kan köras två gånger (React strict mode), och andra gången är adressen redan tömd.
    const found = takeTokenFromLocation();
    if (found) { setToken(found); setChecked(true); return; }
    void (async () => {
      try {
        const response = await accountRequest("/api/account/password-reset");
        const parsed = passwordResetAvailabilitySchema.safeParse(response.json);
        if (response.status !== 200 || !parsed.success) throw new Error(accountSv.genericError(response.status));
        setAvailability(parsed.data);
      } catch (error) {
        setMessage({ tone: "error", text: error instanceof Error ? error.message : accountSv.networkError });
      } finally { setChecked(true); }
    })();
  }, []);

  async function requestLink(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage({ tone: "info", text: text.sending });
    try {
      const response = await accountRequest("/api/account/password-reset", { method: "POST", body: { formatVersion: 1, email } });
      if (response.status === 202) { setDone(true); setMessage({ tone: "ok", text: text.sent }); }
      else setMessage({ tone: "error", text: response.status === 400 ? text.invalidEmail : accountSv.genericError(response.status) });
    } catch { setMessage({ tone: "error", text: accountSv.networkError }); }
    finally { setBusy(false); }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (!passwordsReady(password, repeat)) return;
    setBusy(true);
    setMessage({ tone: "info", text: text.saving });
    try {
      const response = await accountRequest("/api/account/password-reset/complete", { method: "POST",
        body: { formatVersion: 1, token, password } });
      // ADR-0205: länken loggar in (och bekräftar adressen); vidare till Mina tävlingar.
      if (response.status === 200) { setDone(true); setMessage({ tone: "ok", text: text.saved }); window.location.assign("/organizer"); return; }
      if (response.status === 404) { setDone(true); setMessage({ tone: "error", text: text.invalidLink }); }
      else setMessage({ tone: "error", text: accountSv.genericError(response.status) });
    } catch { setMessage({ tone: "error", text: accountSv.networkError }); }
    finally { setBusy(false); }
  }

  const notice = message && <Notice tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>{message.text}</Notice>;
  return <main className={`${styles.page} ${styles.narrow}`}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>{text.kicker}</p><h1>{token ? text.newTitle : text.title}</h1></div>
    </header>
    {!checked && <p role="status">{text.checking}</p>}

    {checked && token && <Section label={text.newTitle}>
      {!done && <form className={styles.form} onSubmit={event => void savePassword(event)}>
        <p>{text.newIntro}</p>
        <NewPasswordFields label={text.password} password={password} repeat={repeat} onPassword={setPassword} onRepeat={setRepeat}
          disabled={busy} />
        <Button type="submit" disabled={busy || !passwordsReady(password, repeat)}>{text.save}</Button>
      </form>}
      {notice}
      {done && message?.tone === "error" && <div className={styles.actions}>
        <Link href="/organizer">{accountSv.logIn}</Link>
        {message?.tone === "error" && <a href="/recover">{text.newLink}</a>}
      </div>}
    </Section>}

    {checked && !token && availability?.emailEnabled && <Section label={text.title}>
      {!done && <form className={styles.form} onSubmit={event => void requestLink(event)}>
        <p>{text.intro}</p>
        <Field label={text.email}>
          <input type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} value={email} required
            disabled={busy} onChange={event => setEmail(event.target.value)} />
        </Field>
        <Button type="submit" disabled={busy || !email.trim()}>{text.send}</Button>
      </form>}
      {notice}
    </Section>}

    {checked && !token && availability && !availability.emailEnabled && <Section label={text.noMailTitle}>
      <Notice tone="info"><strong>{text.noMailTitle}</strong><p>{text.noMail}</p>
        {availability.contactEmail && <p>{text.contact} <a href={`mailto:${availability.contactEmail}`}>{availability.contactEmail}</a></p>}
      </Notice>
    </Section>}
    {checked && !token && !availability && notice}

    {!(token && done) && <p><Link href="/organizer">{text.backToLogin}</Link></p>}
  </main>;
}

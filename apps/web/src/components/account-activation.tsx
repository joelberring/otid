"use client";

import Link from "next/link";
import React from "react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  accountInvitationActivationRequestSchema,
  accountInvitationActivationResponseSchema,
  type AccountInvitationActivationRequest,
  type AccountInvitationActivationResponse
} from "@o-tid/contracts";
import styles from "./account-activation.module.css";

const text = {
  title: "Aktivera ditt konto",
  introduction: "Ange användarnamnet och engångskoden som du fick privat av en betrodd arrangör.",
  loginName: "Användarnamn",
  code: "Engångskod",
  prepare: "Skapa mitt lösenord",
  passwordTitle: "Spara ditt nya lösenord innan du fortsätter",
  passwordHint: "Lösenordet skapas på den här enheten. Spara det i en lösenordshanterare eller kopiera det till en säker plats.",
  copyPassword: "Kopiera lösenord",
  copied: "Lösenordet är kopierat. Spara det på en säker plats innan du aktiverar kontot.",
  copyFailed: "Kopieringen misslyckades. Markera lösenordet och kopiera det manuellt till en säker plats.",
  savedAcknowledgement: "Jag har sparat eller kopierat lösenordet och kan komma åt det efter aktiveringen.",
  activate: "Aktivera konto",
  retry: "Försök igen med samma uppgifter",
  sending: "Aktiverar…",
  genericError: "Aktiveringen kunde inte bekräftas. Kontrollera uppgifterna och försök igen med samma försök, eller kontakta den betrodda arrangör som gav dig koden.",
  noRecoveryTitle: "Viktigt om lösenordet",
  noRecovery: "Om du förlorar lösenordet finns ännu ingen självtjänståterställning. Kontakta en betrodd arrangör.",
  successTitle: "Kontot är aktiverat",
  successText: "Logga nu in med ditt användarnamn och det sparade lösenordet. Aktiveringen ger inte automatiskt åtkomst till tävlingar eller anmälningar.",
  organizerLogin: "Logga in som arrangör",
  participantLogin: "Gå till Mina tävlingar och Mitt resultat",
  home: "Till O-Tid"
} as const;

type ActivationAttempt = {
  request: AccountInvitationActivationRequest;
};

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function generateSecret32(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

function validResponse(value: unknown, expectedLoginName: string): AccountInvitationActivationResponse {
  const parsed = accountInvitationActivationResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.loginName !== expectedLoginName) {
    throw new Error(text.genericError);
  }
  return parsed.data;
}

function clearInputValues() {
  for (const field of document.querySelectorAll<HTMLElement>("[data-activation-secret]")) {
    if (field instanceof HTMLInputElement) field.value = "";
    else field.textContent = "";
  }
}

export function AccountActivation() {
  const [loginName, setLoginName] = useState("");
  const [code, setCode] = useState("");
  const [attempt, setAttempt] = useState<ActivationAttempt>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<AccountInvitationActivationResponse>();
  const attemptRef = useRef<ActivationAttempt | undefined>(undefined);
  const activeRequestRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const clearSecrets = () => {
      activeRequestRef.current?.abort();
      activeRequestRef.current = undefined;
      attemptRef.current = undefined;
      clearInputValues();
      setAttempt(undefined);
      setCode("");
      setAcknowledged(false);
    };
    window.addEventListener("pagehide", clearSecrets);
    return () => {
      window.removeEventListener("pagehide", clearSecrets);
      clearSecrets();
    };
  }, []);

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const normalizedLoginName = loginName.trim().toLowerCase();
    const canonicalCode = code.trim();
    try {
      const request = accountInvitationActivationRequestSchema.parse({
        formatVersion: 1,
        requestId: crypto.randomUUID(),
        loginName: normalizedLoginName,
        code: canonicalCode,
        password: generateSecret32()
      });
      const next = { request };
      attemptRef.current = next;
      setAttempt(next);
      setAcknowledged(false);
      setCopied(false);
    } catch {
      setError("Kontrollera användarnamnet och att engångskoden är komplett.");
    }
  }

  async function submit(current: ActivationAttempt) {
    if (busy || !acknowledged || attemptRef.current !== current) return;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    activeRequestRef.current = controller;
    try {
      const response = await fetch("/api/account/activation", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(current.request)
      });
      if (!response.ok) throw new Error(text.genericError);
      const result = validResponse(await response.json() as unknown, current.request.loginName);
      if (attemptRef.current !== current) return;
      attemptRef.current = undefined;
      setAttempt(undefined);
      setCode("");
      setLoginName("");
      setAcknowledged(false);
      setSuccess(result);
    } catch {
      if (!controller.signal.aborted && attemptRef.current === current) setError(text.genericError);
    } finally {
      if (activeRequestRef.current === controller) activeRequestRef.current = undefined;
      setBusy(false);
    }
  }

  async function copyPassword() {
    if (!attempt) return;
    setCopied(false);
    try {
      await navigator.clipboard.writeText(attempt.request.password);
      setCopied(true);
    } catch {
      setError(text.copyFailed);
    }
  }

  if (success) {
    return <main className={styles.page}>
      <section className={styles.card} aria-labelledby="activation-title">
        <p className={styles.eyebrow}>O-Tid · Konto</p>
        <h1 id="activation-title">{text.successTitle}</h1>
        <p>{text.successText}</p>
        <p className={styles.accountName}>{success.loginName}</p>
        <nav className={styles.successLinks} aria-label="Inloggning">
          <Link className={styles.primaryLink} href="/organizer">{text.organizerLogin}</Link>
          <Link className={styles.secondaryLink} href="/me">{text.participantLogin}</Link>
        </nav>
      </section>
    </main>;
  }

  return <main className={styles.page}>
    <section className={styles.card} aria-labelledby="activation-title">
      <p className={styles.eyebrow}>O-Tid · Konto</p>
      <h1 id="activation-title">{text.title}</h1>
      <p className={styles.introduction}>{text.introduction}</p>

      <div className={styles.warning} role="note">
        <h2>{text.noRecoveryTitle}</h2>
        <p>{text.noRecovery}</p>
      </div>

      {!attempt && <form className={styles.form} onSubmit={prepare}>
        <label htmlFor="activation-login-name">{text.loginName}
          <input id="activation-login-name" name="loginName" type="text" autoComplete="username" autoCapitalize="none"
            autoCorrect="off" spellCheck={false} maxLength={80} required value={loginName}
            onChange={(event) => setLoginName(event.target.value)} />
        </label>
        <label htmlFor="activation-code">{text.code}
          <input id="activation-code" name="code" data-activation-secret type="text" autoComplete="off" autoCapitalize="none"
            autoCorrect="off" spellCheck={false} maxLength={43} required value={code}
            onChange={(event) => setCode(event.target.value)} />
        </label>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button className={styles.primaryButton} type="submit">{text.prepare}</button>
      </form>}

      {attempt && <div className={styles.form}>
        <div className={styles.passwordPanel}>
          <h2>{text.passwordTitle}</h2>
          <p>{text.passwordHint}</p>
          <output className={styles.password} aria-label="Ditt nya lösenord" data-activation-secret>{attempt.request.password}</output>
          <button className={styles.secondaryButton} type="button" onClick={() => void copyPassword()} disabled={busy}>
            {text.copyPassword}
          </button>
          {copied && <p className={styles.notice} role="status">{text.copied}</p>}
          <label className={styles.acknowledgement}>
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={busy} />
            <span>{text.savedAcknowledgement}</span>
          </label>
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button className={styles.primaryButton} type="button" disabled={!acknowledged || busy}
          onClick={() => void submit(attempt)}>
          {busy ? text.sending : error ? text.retry : text.activate}
        </button>
        <p className={styles.retryHint} aria-live="polite">
          {error ? "Samma användarnamn, kod, lösenord och request-id används vid försöket." : "Aktiveringen kräver internetanslutning."}
        </p>
      </div>}

      <footer className={styles.footer}><Link href="/">{text.home}</Link></footer>
    </section>
  </main>;
}

"use client";

import Link from "next/link";
import React from "react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  accountPasswordRecoveryRedeemRequestSchema,
  accountPasswordRecoveryRedeemResponseSchema,
  type AccountPasswordRecoveryRedeemRequest
} from "@o-tid/contracts";
import { accountRecoverySv as text } from "../i18n/account-recovery-sv";
import styles from "./account-recovery.module.css";

type RecoveryAttempt = { request: AccountPasswordRecoveryRedeemRequest };

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function generatePassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

function clearSecretNodes() {
  for (const node of document.querySelectorAll<HTMLElement>("[data-recovery-secret]")) {
    if (node instanceof HTMLInputElement) node.value = "";
    else node.textContent = "";
  }
}

export function AccountRecovery() {
  const [loginName, setLoginName] = useState("");
  const [code, setCode] = useState("");
  const [attempt, setAttempt] = useState<RecoveryAttempt>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const attemptRef = useRef<RecoveryAttempt | undefined>(undefined);
  const activeRequestRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const clearSecrets = () => {
      activeRequestRef.current?.abort();
      activeRequestRef.current = undefined;
      attemptRef.current = undefined;
      clearSecretNodes();
      setAttempt(undefined);
      setCode("");
      setAcknowledged(false);
    };
    window.addEventListener("pagehide", clearSecrets);
    return () => {
      window.removeEventListener("pagehide", clearSecrets);
      activeRequestRef.current?.abort();
      activeRequestRef.current = undefined;
      attemptRef.current = undefined;
      clearSecretNodes();
    };
  }, []);

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      const request = accountPasswordRecoveryRedeemRequestSchema.parse({
        formatVersion: 1,
        requestId: crypto.randomUUID(),
        loginName: loginName.trim().toLowerCase(),
        code: code.trim(),
        password: generatePassword()
      });
      const next = { request };
      attemptRef.current = next;
      setAttempt(next);
      setCode("");
      setAcknowledged(false);
      setCopied(false);
    } catch {
      setError(text.invalidInput);
    }
  }

  async function submit(current: RecoveryAttempt) {
    if (busy || !acknowledged || attemptRef.current !== current) return;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    activeRequestRef.current = controller;
    try {
      const response = await fetch("/api/account/recovery", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(current.request)
      });
      if (!response.ok) throw new Error(text.genericError);
      const parsed = accountPasswordRecoveryRedeemResponseSchema.safeParse(await response.json() as unknown);
      if (!parsed.success || parsed.data.loginName !== current.request.loginName) throw new Error(text.genericError);
      if (attemptRef.current !== current) return;
      attemptRef.current = undefined;
      setAttempt(undefined);
      setLoginName("");
      setAcknowledged(false);
      setSuccess(true);
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

  if (success) return <main className={styles.page}>
    <section className={styles.card} aria-labelledby="recovery-title">
      <p className={styles.eyebrow}>O-Tid · Konto</p>
      <h1 id="recovery-title">{text.successTitle}</h1>
      <p>{text.successText}</p>
      <nav className={styles.links} aria-label="Inloggning">
        <Link className={styles.primaryLink} href="/organizer">{text.organizerLogin}</Link>
        <Link className={styles.secondaryLink} href="/me">{text.participantLogin}</Link>
      </nav>
    </section>
  </main>;

  return <main className={styles.page}>
    <section className={styles.card} aria-labelledby="recovery-title">
      <p className={styles.eyebrow}>O-Tid · Konto</p>
      <h1 id="recovery-title">{text.title}</h1>
      <p className={styles.introduction}>{text.introduction}</p>
      {!attempt && <form className={styles.form} onSubmit={prepare}>
        <label htmlFor="recovery-login-name">{text.loginName}
          <input id="recovery-login-name" name="loginName" type="text" autoComplete="username" autoCapitalize="none"
            autoCorrect="off" spellCheck={false} maxLength={80} required value={loginName}
            onChange={(event) => setLoginName(event.target.value)} />
        </label>
        <label htmlFor="recovery-code">{text.code}
          <input id="recovery-code" name="code" data-recovery-secret type="text" autoComplete="off" autoCapitalize="none"
            autoCorrect="off" spellCheck={false} maxLength={43} required value={code}
            onChange={(event) => setCode(event.target.value)} />
        </label>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button className={styles.primaryButton} type="submit">{text.prepare}</button>
      </form>}
      {attempt && <div className={styles.form}>
        <section className={styles.passwordPanel} aria-labelledby="recovery-password-title">
          <h2 id="recovery-password-title">{text.passwordTitle}</h2>
          <p>{text.passwordHint}</p>
          <output className={styles.password} aria-label="Ditt nya lösenord" data-recovery-secret>{attempt.request.password}</output>
          <button className={styles.secondaryButton} type="button" onClick={() => void copyPassword()} disabled={busy}>{text.copyPassword}</button>
          {copied && <p className={styles.notice} role="status">{text.copied}</p>}
          <label className={styles.acknowledgement}>
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={busy} />
            <span>{text.savedAcknowledgement}</span>
          </label>
        </section>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button className={styles.primaryButton} type="button" disabled={!acknowledged || busy} onClick={() => void submit(attempt)}>
          {busy ? text.sending : error ? text.retry : text.submit}
        </button>
        <p className={styles.retryHint}>{text.onlineOnly}</p>
      </div>}
      <footer className={styles.footer}><Link href="/">{text.home}</Link></footer>
    </section>
  </main>;
}

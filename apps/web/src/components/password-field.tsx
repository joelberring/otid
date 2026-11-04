"use client";

import { useId, useState } from "react";
import { ACCOUNT_PASSWORD_MIN_LENGTH } from "@o-tid/contracts";
import { accountSv } from "../i18n/account-sv";
import styles from "./password-field.module.css";

const text = accountSv.passwordField;

interface PasswordInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  disabled?: boolean | undefined;
  help?: string | undefined;
  error?: string | undefined;
  minLength?: number | undefined;
}

/** Öga: visa (öppet öga) eller dölj (överstruket). Bara form, ingen färg som bär betydelse. */
function Eye({ open }: { open: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
    {!open && <path d="M4 20 20 4" />}
  </svg>;
}

/**
 * ADR-0205: ett lösenordsfält med en knapp som visar lösenordet (hjälper i telefonen). Knappen ligger utanför etiketten, så
 * fältets namn är bara etiketten ("Lösenord").
 */
export function PasswordInput({ label, value, onChange, autoComplete, disabled, help, error, minLength }: PasswordInputProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const described = [help ? `${id}-help` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return <div className={styles.field}>
    <label className={styles.label} htmlFor={id}>{label}</label>
    <div className={styles.row}>
      <input id={id} type={visible ? "text" : "password"} autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false}
        maxLength={1024} minLength={minLength} value={value} required disabled={disabled} aria-describedby={described}
        aria-invalid={error ? true : undefined} onChange={event => onChange(event.target.value)} />
      <button type="button" className={styles.toggle} aria-label={visible ? text.hide : text.show} aria-pressed={visible} aria-controls={id}
        title={visible ? text.hide : text.show} onClick={() => setVisible(shown => !shown)}><Eye open={!visible} /></button>
    </div>
    {help && <span className={styles.help} id={`${id}-help`}>{help}</span>}
    <span className={styles.error} id={`${id}-error`} aria-live="polite">{error ?? ""}</span>
  </div>;
}

/** Skiljer sig upprepningen redan från lösenordet? (Visas medan personen skriver, inte först när formuläret skickas.) */
export function passwordMismatch(password: string, repeat: string): boolean {
  if (!repeat) return false;
  return repeat.length >= password.length ? repeat !== password : !password.startsWith(repeat);
}

/** Båda fälten ifyllda, lika och minst 8 tecken. */
export function passwordsReady(password: string, repeat: string): boolean {
  return password.length >= ACCOUNT_PASSWORD_MIN_LENGTH && password === repeat;
}

/** ADR-0205: nytt lösenord två gånger ("Lösenord" och "Upprepa lösenordet"), med regeln och beskedet när de skiljer sig. */
export function NewPasswordFields({ password, repeat, onPassword, onRepeat, disabled, label = text.password }: {
  password: string; repeat: string; onPassword: (value: string) => void; onRepeat: (value: string) => void;
  disabled?: boolean | undefined; label?: string | undefined;
}) {
  const tooShort = password.length > 0 && password.length < ACCOUNT_PASSWORD_MIN_LENGTH && repeat.length > 0;
  return <>
    <PasswordInput label={label} value={password} onChange={onPassword} autoComplete="new-password" disabled={disabled}
      help={text.rule} minLength={ACCOUNT_PASSWORD_MIN_LENGTH} error={tooShort ? text.tooShort : undefined} />
    <PasswordInput label={text.repeat} value={repeat} onChange={onRepeat} autoComplete="new-password" disabled={disabled}
      error={passwordMismatch(password, repeat) ? text.mismatch : undefined} />
  </>;
}

"use client";

import React, { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { Button, Field } from "./index";
import styles from "./ui.module.css";
import { useLanguage } from "../language-provider";

/**
 * Text till urklippet. Falskt om urklippet saknas, nekas eller inte svarar inom två sekunder (det kan vänta på ett
 * tillstånd som aldrig kommer); då får anroparen visa texten så att den kan kopieras för hand.
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    return await Promise.race([navigator.clipboard.writeText(value).then(() => true),
      new Promise<boolean>(resolve => window.setTimeout(() => resolve(false), 2000))]);
  } catch { return false; }
}

/** En knapp som kopierar `value`; `onResult` får veta om det gick, så att vyn kan visa sitt besked där det hör hemma. */
export function CopyButton({ value, onResult, variant = "primary", disabled, children }: { value: string; onResult: (copied: boolean) => void;
  variant?: "primary" | "secondary" | "quiet" | undefined; disabled?: boolean | undefined; children: ReactNode }) {
  return <Button variant={variant} disabled={disabled} onClick={() => void copyText(value).then(onResult)}>{children}</Button>;
}

/**
 * En modal dialog: `<dialog>` som öppnas med showModal när den visas. Esc och `close()` anropar `onClose`. `dialogRef` ger
 * vyn tillgång till elementet (t.ex. Avbryt-knappens `close()`); `closeOnBackdrop` stänger vid klick utanför innehållet.
 */
export function Dialog({ dialogRef, className, labelledBy, describedBy, onClose, closeOnBackdrop, testId, children }: {
  dialogRef?: RefObject<HTMLDialogElement | null> | undefined; className?: string | undefined; labelledBy: string;
  describedBy?: string | undefined; onClose: () => void; closeOnBackdrop?: boolean | undefined; testId?: string | undefined; children: ReactNode }) {
  const own = useRef<HTMLDialogElement>(null);
  const ref = dialogRef ?? own;
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal?.(); }, [ref]);
  return <dialog ref={ref} className={className} aria-labelledby={labelledBy} aria-describedby={describedBy} data-testid={testId} onClose={onClose}
    onClick={closeOnBackdrop ? event => { if (event.target === event.currentTarget) event.currentTarget.close(); } : undefined}>
    {children}
  </dialog>;
}

/**
 * Gemensam bekräftelsedialog (ersätter `window.confirm`). Använder `<Dialog>` med en inre behållare så klick på bakgrunden
 * bara stänger utanför innehållet och Esc anropar `onCancel` exakt en gång.
 */
export function ConfirmDialog({ title, message, confirmLabel, cancelLabel, danger = false, busy = false, onConfirm, onCancel, testId }: {
  title: ReactNode; message?: ReactNode; confirmLabel: string; cancelLabel?: string | undefined; danger?: boolean | undefined;
  busy?: boolean | undefined; onConfirm: () => void; onCancel: () => void; testId?: string | undefined }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closedRef = useRef(false);
  const titleId = useId();
  const messageId = useId();
  const english = useLanguage() === "en";
  const finishCancel = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    onCancel();
  };
  const closeByCancel = () => {
    const element = dialogRef.current;
    if (element?.open && typeof element.close === "function") element.close();
    else finishCancel();
  };
  const handleConfirm = () => {
    if (closedRef.current || busy) return;
    closedRef.current = true;
    onConfirm();
  };
  return <Dialog dialogRef={dialogRef} className={styles.dialog} labelledBy={titleId} describedBy={message ? messageId : undefined}
    onClose={finishCancel} closeOnBackdrop={!busy} testId={testId}>
    <div className={styles.dialogBody}>
      <h2 id={titleId} className={styles.dialogTitle}>{title}</h2>
      {message && <div id={messageId} className={styles.dialogMessage}>{message}</div>}
      <div className={styles.dialogActions}>
        <Button variant="secondary" disabled={busy} onClick={closeByCancel}>{cancelLabel ?? (english ? "Cancel" : "Avbryt")}</Button>
        <Button variant={danger ? "danger" : "primary"} disabled={busy} onClick={handleConfirm}>{confirmLabel}</Button>
      </div>
    </div>
  </Dialog>;
}

/**
 * Gemensam frågedialog med textfält (ersätter `window.prompt`). Enter skickar formuläret, Esc eller Avbryt stänger utan att
 * dubbelanropa `onCancel`.
 */
export function PromptDialog({ title, message, label, defaultValue = "", placeholder, maxLength, required = true, confirmLabel, cancelLabel,
  danger = false, busy = false, onConfirm, onCancel, testId }: {
  title: ReactNode; message?: ReactNode; label: string; defaultValue?: string | undefined; placeholder?: string | undefined;
  maxLength?: number | undefined; required?: boolean | undefined; confirmLabel: string; cancelLabel?: string | undefined;
  danger?: boolean | undefined; busy?: boolean | undefined; onConfirm: (value: string) => void; onCancel: () => void; testId?: string | undefined }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closedRef = useRef(false);
  const titleId = useId();
  const messageId = useId();
  const english = useLanguage() === "en";
  const [value, setValue] = useState(defaultValue);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    if (defaultValue) input.select();
  }, [defaultValue]);
  const finishCancel = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    onCancel();
  };
  const closeByCancel = () => {
    const element = dialogRef.current;
    if (element?.open && typeof element.close === "function") element.close();
    else finishCancel();
  };
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (closedRef.current || busy || (required && !trimmed)) return;
    closedRef.current = true;
    onConfirm(trimmed);
  };
  return <Dialog dialogRef={dialogRef} className={styles.dialog} labelledBy={titleId} describedBy={message ? messageId : undefined}
    onClose={finishCancel} closeOnBackdrop={!busy} testId={testId}>
    <form className={styles.dialogBody} noValidate onSubmit={handleSubmit}>
      <h2 id={titleId} className={styles.dialogTitle}>{title}</h2>
      {message && <div id={messageId} className={styles.dialogMessage}>{message}</div>}
      <Field label={label}>
        <input ref={inputRef} value={value} placeholder={placeholder} maxLength={maxLength} disabled={busy}
          onChange={event => setValue(event.target.value)} />
      </Field>
      <div className={styles.dialogActions}>
        <Button variant="secondary" disabled={busy} onClick={closeByCancel}>{cancelLabel ?? (english ? "Cancel" : "Avbryt")}</Button>
        <Button type="submit" variant={danger ? "danger" : "primary"} disabled={busy || (required && !value.trim())}>{confirmLabel}</Button>
      </div>
    </form>
  </Dialog>;
}

/**
 * En kort text (en förkortning, ett märke eller ett streck) med en förklaring som går att nå på pekskärm (översynen
 * 2026-11-17, C4): ett tryck visar förklaringen direkt efter texten, ett tryck till döljer den. Med mus står den också
 * som verktygstips; `title` är också knappens beskrivning för skärmläsare. Texten i knappen är oförändrad (listor och test läser den). Utan `children` är knappen ett litet "i"
 * (t.ex. vid en knapp vars namn inte räcker), och förklaringen hamnar på en egen rad under.
 */
export function Explain({ text, children, className, defaultOpen = false, testId }: { text: string; children?: ReactNode;
  className?: string | undefined; defaultOpen?: boolean | undefined; testId?: string | undefined }) {
  const [open, setOpen] = useState(defaultOpen);
  const english = useLanguage() === "en";
  const info = children === undefined;
  return <>
    <button type="button" className={[info ? styles.info : styles.explain, className].filter(Boolean).join(" ")} aria-expanded={open}
      title={text} data-testid={testId} onClick={() => setOpen(value => !value)}>
      {info ? <><span aria-hidden="true">i</span><span className="visually-hidden">{english ? "Explanation" : "Förklaring"}</span></> : children}
    </button>
    {open && <span className={info ? styles.explainedLine : styles.explained}> {text}</span>}
  </>;
}

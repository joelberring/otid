"use client";

import React, { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Button } from "./index";
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
export function Dialog({ dialogRef, className, labelledBy, onClose, closeOnBackdrop, children }: {
  dialogRef?: RefObject<HTMLDialogElement | null> | undefined; className?: string | undefined; labelledBy: string; onClose: () => void;
  closeOnBackdrop?: boolean | undefined; children: ReactNode }) {
  const own = useRef<HTMLDialogElement>(null);
  const ref = dialogRef ?? own;
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal?.(); }, [ref]);
  return <dialog ref={ref} className={className} aria-labelledby={labelledBy} onClose={onClose}
    onClick={closeOnBackdrop ? event => { if (event.target === event.currentTarget) event.currentTarget.close(); } : undefined}>
    {children}
  </dialog>;
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

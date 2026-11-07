"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Button } from "./index";

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

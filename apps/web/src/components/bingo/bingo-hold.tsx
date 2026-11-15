"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./bingo.module.css";

const HOLD_MS = 2000;

/**
 * Knapp som kräver ett långt tryck (2 s) i fickläget, så att den inte trycks av misstag. Med tangentbordet (eller en
 * skärmläsare) blir det en bekräftelse i stället.
 */
export function HoldButton({ label, hold, confirmText, onDone, testId }: { label: string; hold: string; confirmText: string; onDone: () => void;
  testId: string }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const stop = () => { window.clearTimeout(timer.current); timer.current = undefined; setHolding(false); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return <button type="button" className={styles.hold} data-holding={holding || undefined} data-testid={testId}
    onPointerDown={event => { event.preventDefault(); setHolding(true); timer.current = window.setTimeout(() => { stop(); onDone(); }, HOLD_MS); }}
    onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onContextMenu={event => event.preventDefault()}
    onClick={event => { if (event.detail === 0 && window.confirm(confirmText)) onDone(); }}>
    <span>{label}</span><span className={styles.holdHelp}>{hold}</span>
    <span className={styles.holdBar} aria-hidden="true" />
  </button>;
}

/** Klockan varje sekund medan `active`. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

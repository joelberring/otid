"use client";

import type { ReactNode } from "react";
import type { BingoMode } from "@o-tid/contracts";
import { bingoEn } from "../../i18n/bingo-en";
import { bingoSv } from "../../i18n/bingo-sv";
import { useTexts } from "../language-provider";
import styles from "./bingo.module.css";

/**
 * Instruktionen före Starta och bakom «?» under loppet (ägaren 2026-11-16): högst fem korta punkter per läge med en liten
 * bild, stora bokstäver, skriven för ungdomar från cirka 9 år.
 */
export function BingoGuide({ mode, action, dark }: { mode: BingoMode; action: ReactNode; dark?: boolean }) {
  const text = useTexts(bingoSv.runner, bingoEn.runner);
  return <section className={dark ? styles.guideDark : styles.guide} aria-labelledby="bingo-guide" data-testid="bingo-guide">
    <h2 id="bingo-guide">{text.instructions}</h2>
    <ol>{text.guide[mode].map(item => <li key={item.text}><span aria-hidden="true">{item.icon}</span><span>{item.text}</span></li>)}</ol>
    {action}
  </section>;
}

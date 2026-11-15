"use client";

import { useEffect, useState } from "react";
import type { BingoGroup, BingoLeaderboard, BingoMode } from "@o-tid/contracts";
import { bingoEn } from "../../i18n/bingo-en";
import { bingoSv } from "../../i18n/bingo-sv";
import { readBingoName, saveBingoName } from "../../lib/bingo-run";
import { useTexts } from "../language-provider";
import { Button, Notice } from "../ui";
import { BingoBoard } from "./bingo-board";
import { BingoGuide } from "./bingo-guide";
import styles from "./bingo.module.css";

/** Anmälan på plats (ADR-0225): namnet först, sedan gruppen och Starta; instruktionen och topplistan under. */
export function BingoSignup({ mode, title, groups, georeferenced, board, onStart }: { mode: BingoMode; title: string; groups: readonly BingoGroup[];
  georeferenced: boolean; board: BingoLeaderboard; onStart: (name: string, course: string) => void }) {
  const text = useTexts(bingoSv.runner, bingoEn.runner);
  const ships = useTexts(bingoSv.ships, bingoEn.ships);
  const [name, setName] = useState("");
  const [course, setCourse] = useState<string>();
  useEffect(() => setName(readBingoName()), []);
  const trimmed = name.trim();
  const ready = groups.length > 0 && georeferenced;
  const [guide, setGuide] = useState(false);
  return <main className={styles.page} data-testid="bingo-signup">
    <h1>{mode === "SHIPS" ? ships.title : text.title}</h1>
    <p className={styles.kicker}>{title}</p>
    <p>{mode === "SHIPS" ? ships.intro : text.intro}</p>
    {!georeferenced && <Notice tone="error" role="alert">{text.noGeoreference}</Notice>}
    {groups.length === 0 && <Notice tone="error" role="alert">{text.noGroups}</Notice>}
    {guide && trimmed && course ? <>
      <BingoGuide mode={mode} action={<Button className={styles.start} onClick={() => onStart(trimmed.slice(0, 60), course)} data-testid="bingo-understood">
        {text.understood}</Button>} />
      <Button variant="quiet" onClick={() => setGuide(false)}>{text.back}</Button>
    </> : <form className={styles.signup} onSubmit={event => {
      event.preventDefault();
      if (!trimmed || !course || !ready) return;
      saveBingoName(trimmed);
      // Först instruktionen; «Jag förstår – starta» startar (användarens tryck låser upp ljudet och skärmen).
      setGuide(true);
    }}>
      <label className={styles.field}>{text.name}
        <input type="text" value={name} maxLength={60} autoComplete="given-name" required onChange={event => setName(event.target.value)}
          data-testid="bingo-runner-name" />
        <span className={styles.muted}>{text.nameHelp}</span></label>
      <fieldset className={styles.groups} disabled={!trimmed}>
        <legend>{text.group}</legend>
        {groups.map(group => <label key={group.course} className={styles.groupChoice}>
          <input type="radio" name="bingo-group" value={group.course} checked={course === group.course} onChange={() => setCourse(group.course)} />
          <span><strong>{group.name}</strong> <span className={styles.muted}>{text.groupLine(group.cells.length, group.cellMeters)}</span></span>
        </label>)}
      </fieldset>
      <Button type="submit" className={styles.start} disabled={!trimmed || !course || !ready} data-testid="bingo-start">{text.start}</Button>
    </form>}
    <BingoBoard board={board} />
  </main>;
}
